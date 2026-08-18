/*
 * Copyright (C) 2026 permails <logo@permails.com>
 *
 * This is free software, licensed under the Apache License, Version 2.0.
 */

'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var callGetLog = rpc.declare({
	object: 'luci.headscale',
	method: 'get_log',
	params: [ 'lines' ],
	expect: { log: '' }
});

var callCleanLog = rpc.declare({
	object: 'luci.headscale',
	method: 'clean_log',
	expect: { code: 0 }
});

function extractLogString(res) {
	if (typeof(res) === 'string') {
		return res;
	}
	if (res && typeof(res.log) === 'string') {
		return res.log;
	}
	return '';
}

return view.extend({
	load: function() {
		return callGetLog(200);
	},

	render: function(initialData) {
		var rawLogText = extractLogString(initialData);

		var viewRoot = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - System Logs') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Live output and connection logs from the Headscale daemon.')
			])
		]);

		// Filter Input
		var filterInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': _('Filter log entries...'),
			'style': 'width:220px;'
		});

		// Line Count Select
		var lineSelect = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': '50' }, [ _('50 lines') ]),
			E('option', { 'value': '100' }, [ _('100 lines') ]),
			E('option', { 'value': '200', 'selected': '' }, [ _('200 lines') ]),
			E('option', { 'value': '500' }, [ _('500 lines') ]),
			E('option', { 'value': '1000' }, [ _('1000 lines') ])
		]);

		// Standard Textarea Log Output Box
		var logTextarea = E('textarea', {
			'id': 'headscale_log_view',
			'class': 'cbi-input-textarea',
			'style': 'width:100%;font-family:monospace;font-size:12px;line-height:1.4em;resize:vertical;',
			'readonly': 'readonly',
			'wrap': 'off',
			'rows': 25
		}, [ rawLogText || _('No log entries found.') ]);

		function updateLogDisplay() {
			var filter = filterInput.value.trim().toLowerCase();
			if (!filter) {
				logTextarea.value = rawLogText || _('No log entries found.');
			} else {
				var lines = rawLogText.split('\n');
				var filtered = lines.filter(function(line) {
					return line.toLowerCase().indexOf(filter) !== -1;
				});
				logTextarea.value = filtered.length > 0 ? filtered.join('\n') : _('No matching log entries found.');
			}
		}

		filterInput.addEventListener('input', updateLogDisplay);

		function fetchLogs() {
			var count = parseInt(lineSelect.value, 10) || 200;
			return callGetLog(count).then(function(res) {
				var newLog = extractLogString(res);
				if (newLog !== undefined) {
					var isScrolledToBottom = (logTextarea.scrollHeight - logTextarea.clientHeight) <= (logTextarea.scrollTop + 30);
					rawLogText = newLog;
					updateLogDisplay();
					if (isScrolledToBottom) {
						logTextarea.scrollTop = logTextarea.scrollHeight;
					}
				}
			});
		}

		lineSelect.addEventListener('change', fetchLogs);

		// Scroll to Head Button
		var scrollUpButton = E('button', {
			'class': 'btn cbi-button cbi-button-neutral',
			'style': 'margin-right:6px;',
			'click': function() {
				logTextarea.scrollTop = 0;
			}
		}, [ _('Scroll to head') ]);

		// Scroll to Tail Button
		var scrollDownButton = E('button', {
			'class': 'btn cbi-button cbi-button-neutral',
			'style': 'margin-right:6px;',
			'click': function() {
				logTextarea.scrollTop = logTextarea.scrollHeight;
			}
		}, [ _('Scroll to tail') ]);

		// Refresh Button
		var refreshBtn = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'style': 'margin-right:6px;',
			'click': function() {
				return fetchLogs().then(function() {
					logTextarea.scrollTop = logTextarea.scrollHeight;
				});
			}
		}, [ _('Refresh') ]);

		// Copy Button
		var copyBtn = E('button', {
			'class': 'btn cbi-button cbi-button-neutral',
			'style': 'margin-right:6px;',
			'click': function() {
				navigator.clipboard.writeText(logTextarea.value).then(function() {
					ui.addNotification(null, E('p', {}, [ _('Log copied to clipboard.') ]), 'info');
				}).catch(function() {
					logTextarea.select();
					document.execCommand('copy');
					ui.addNotification(null, E('p', {}, [ _('Log copied to clipboard.') ]), 'info');
				});
			}
		}, [ _('Copy') ]);

		// Clear Logs Button
		var clearBtn = E('button', {
			'class': 'btn cbi-button cbi-button-remove',
			'click': function() {
				ui.showModal(_('Clear Logs'), [
					E('p', {}, [ _('Are you sure you want to clear the Headscale log entries?') ]),
					E('div', { 'class': 'right' }, [
						E('button', {
							'class': 'btn cbi-button cbi-button-neutral',
							'style': 'margin-right:8px;',
							'click': ui.hideModal
						}, [ _('Cancel') ]),
						E('button', {
							'class': 'btn cbi-button cbi-button-remove',
							'click': function() {
								ui.hideModal();
								callCleanLog().then(function() {
									rawLogText = '';
									updateLogDisplay();
									ui.addNotification(null, E('p', {}, [ _('Log cleared successfully.') ]), 'info');
								});
							}
						}, [ _('Clear') ])
					])
				]);
			}
		}, [ _('Clear Logs') ]);

		// Standard OpenWrt CBI Section
		var section = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-descr', 'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;gap:6px;' }, [
					E('label', {}, [ _('Filter: ') ]),
					filterInput,
					E('label', { 'style': 'margin-left:6px;' }, [ _('Rows: ') ]),
					lineSelect
				]),
				E('div', { 'style': 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;' }, [
					scrollUpButton,
					scrollDownButton,
					refreshBtn,
					copyBtn,
					clearBtn
				])
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				logTextarea
			])
		]);

		viewRoot.appendChild(section);

		// Initial display & scroll to bottom
		updateLogDisplay();
		setTimeout(function() {
			logTextarea.scrollTop = logTextarea.scrollHeight;
		}, 100);

		// Background polling every 3 seconds (OpenWrt standard poll mechanism)
		poll.add(function() {
			var count = parseInt(lineSelect.value, 10) || 200;
			return callGetLog(count).then(function(res) {
				var polledLog = extractLogString(res);
				if (polledLog && polledLog !== rawLogText) {
					var isScrolledToBottom = (logTextarea.scrollHeight - logTextarea.clientHeight) <= (logTextarea.scrollTop + 30);
					rawLogText = polledLog;
					updateLogDisplay();
					if (isScrolledToBottom) {
						logTextarea.scrollTop = logTextarea.scrollHeight;
					}
				}
			});
		}, 3);

		return viewRoot;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
