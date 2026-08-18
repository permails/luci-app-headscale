/*
 * Copyright (C) 2026 permails <logo@permails.com>
 *
 * This is free software, licensed under the Apache License, Version 2.0.
 */

'use strict';
'require view';
'require rpc';
'require uci';
'require ui';

var callListUsers = rpc.declare({
	object: 'luci.headscale',
	method: 'list_users',
	expect: { users: [] }
});

var callListKeys = rpc.declare({
	object: 'luci.headscale',
	method: 'list_preauthkeys',
	expect: { keys: [] }
});

var callCreateKey = rpc.declare({
	object: 'luci.headscale',
	method: 'create_preauthkey',
	params: [ 'user', 'reusable', 'ephemeral', 'expiration' ],
	expect: { code: 0, key: '', full_key: '', output: '' }
});

var callExpireKey = rpc.declare({
	object: 'luci.headscale',
	method: 'expire_preauthkey',
	params: [ 'user', 'key' ],
	expect: { code: 0 }
});

function parseTimestamp(t) {
	if (!t) return null;
	if (typeof(t) === 'object' && t.seconds !== undefined) {
		return new Date(t.seconds * 1000);
	}
	if (typeof(t) === 'number') {
		return new Date(t > 1e11 ? t : t * 1000);
	}
	if (typeof(t) === 'string') {
		var d = new Date(t);
		if (!isNaN(d.getTime())) return d;
	}
	return null;
}

function formatDateTime(t) {
	var d = parseTimestamp(t);
	if (!d) return _('Never');
	var pad = function(n) { return (n < 10 ? '0' : '') + n; };
	return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function copyToClipboard(text, btn) {
	if (!text) return;
	var onSuccess = function() {
		var oldText = btn.innerText;
		btn.innerText = _('Copied!');
		btn.style.color = '#28a745';
		btn.style.borderColor = '#28a745';
		setTimeout(function() {
			btn.innerText = oldText;
			btn.style.color = '';
			btn.style.borderColor = '';
		}, 2000);
	};

	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(onSuccess, function() {
			fallbackCopy(text, onSuccess);
		});
	} else {
		fallbackCopy(text, onSuccess);
	}
}

function fallbackCopy(text, cb) {
	var input = document.createElement('textarea');
	input.value = text;
	input.style.position = 'fixed';
	input.style.opacity = '0';
	document.body.appendChild(input);
	input.focus();
	input.select();
	try {
		document.execCommand('copy');
		if (cb) cb();
	} catch (e) {}
	document.body.removeChild(input);
}

function isExpiredKey(t) {
	var d = parseTimestamp(t);
	if (!d) return false;
	return d.getTime() < Date.now();
}

function renderYesNoBadge(val, activeClass) {
	if (val) {
		return E('span', { 'class': 'badge label ' + (activeClass || 'success') }, [ _('Yes') ]);
	} else {
		return E('span', { 'class': 'badge label' }, [ _('No') === '不' ? '否' : _('No') ]);
	}
}

return view.extend({
	rawKeys: [],
	stagedKeyCreations: [],
	stagedKeyRevocations: {},
	recentlyGeneratedKeys: {},
	tableElement: null,

	load: function() {
		return Promise.all([
			callListUsers(),
			callListKeys(),
			uci.load('headscale')
		]);
	},

	markUciChanged: function() {
		uci.set('headscale', 'server', '_keys_seq', Date.now().toString());
	},

	renderTableRows: function() {
		var self = this;
		if (!self.tableElement) return;
		var rows = [];
		var serverUrl = uci.get('headscale', 'server', 'server_url') || 'http://192.168.1.1:8080';

		// 1. 渲染待生成的暂存 Key 行
		self.stagedKeyCreations.forEach(function(item, idx) {
			var undoBtn = E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
				'click': function() {
					self.stagedKeyCreations.splice(idx, 1);
					self.markUciChanged();
					self.renderTableRows();
				}
			}, [ _('Undo') ]);

			rows.push([
				E('div', { 'class': 'center' }, [ E('span', { 'class': 'badge label warning' }, [ _('Pending') ]) ]),
				E('strong', {}, [ item.user ]),
				E('div', {}, [
					E('em', { 'style': 'color:#2b6cb0;' }, [ _('(Generated on Save & Apply)') ]),
					' ',
					E('span', { 'class': 'badge label warning', 'style': 'font-size:11px;' }, [ _('To Create') ])
				]),
				E('div', { 'class': 'center' }, [ renderYesNoBadge(item.reusable, 'success') ]),
				E('div', { 'class': 'center' }, [ renderYesNoBadge(item.ephemeral, 'info') ]),
				E('div', { 'class': 'center' }, [ renderYesNoBadge(false) ]),
				E('div', { 'class': 'center' }, [ item.expiration ]),
				E('div', { 'class': 'center' }, [ E('span', { 'class': 'badge label warning' }, [ _('Pending') ]) ]),
				E('div', { 'class': 'center' }, [ undoBtn ])
			]);
		});

		// 2. 渲染现有 Keys（倒序排列，最新的在最上方）
		if (self.rawKeys && self.rawKeys.length > 0) {
			var sortedKeys = self.rawKeys.slice().reverse();
			sortedKeys.forEach(function(k) {
				var uName = (k.user && k.user.name) ? k.user.name : (k.user || '-');
				var keyStr = k.key || k.id || '-';
				var keyId = k.id || keyStr;
				var isMarkedRevoke = self.stagedKeyRevocations[keyId] !== undefined;
				var isExpired = isExpiredKey(k.expiration) || isMarkedRevoke;
				var expText = formatDateTime(k.expiration);

				// 获取完整明文（优先从 RPC full_key 或 recentlyGeneratedKeys 获取）
				var fullGenKey = k.full_key || self.recentlyGeneratedKeys[keyId];

				var keyDisplayCell = null;
				if (fullGenKey) {
					var joinCmd = 'tailscale up --login-server ' + serverUrl + ' --auth-key ' + fullGenKey;

					var copyKeyBtn = E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'style': 'padding:1px 6px;font-size:11px;width:auto;',
						'click': function(ev) {
							copyToClipboard(fullGenKey, ev.currentTarget);
						}
					}, [ _('Copy Key') ]);

					var copyCmdBtn = E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'style': 'padding:1px 6px;font-size:11px;width:auto;margin-left:4px;',
						'click': function(ev) {
							copyToClipboard(joinCmd, ev.currentTarget);
						}
					}, [ _('Copy Command') ]);

					keyDisplayCell = E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;' }, [
						E('code', { 'style': 'font-size:11px;color:#2b6cb0;' }, [
							fullGenKey.substring(0, 22) + '...'
						]),
						E('div', { 'style': 'display:inline-flex;align-items:center;' }, [
							copyKeyBtn,
							copyCmdBtn
						])
					]);
				} else {
					var copyMaskedBtn = E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:1px 6px;font-size:11px;width:auto;',
						'click': function(ev) {
							copyToClipboard(keyStr, ev.currentTarget);
						}
					}, [ _('Copy') ]);

					keyDisplayCell = E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;' }, [
						E('code', { 'style': 'font-size:12px;' + (isMarkedRevoke ? 'text-decoration:line-through;color:#a0aec0;' : '') }, [
							keyStr
						]),
						copyMaskedBtn
					]);
				}

				var statusBadge = isMarkedRevoke ?
					E('span', { 'class': 'badge label danger' }, [ _('To Revoke') ]) :
					(isExpired ?
						E('span', { 'class': 'badge label' }, [ _('Expired') ]) :
						(k.used && !k.reusable ? E('span', { 'class': 'badge label warning' }, [ _('Used') ]) : E('span', { 'class': 'badge label success' }, [ _('Valid') ])));

				var actBtn = isMarkedRevoke ?
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function() {
							delete self.stagedKeyRevocations[keyId];
							self.markUciChanged();
							self.renderTableRows();
						}
					}, [ _('Undo') ]) :
					(!isExpired ?
						E('button', {
							'class': 'btn cbi-button cbi-button-reset',
							'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
							'click': function() {
								self.stagedKeyRevocations[keyId] = { user: uName, key: k.key || k.id };
								self.markUciChanged();
								self.renderTableRows();
							}
						}, [ _('Revoke') ]) :
						E('span', { 'style': 'color:#94a3b8;font-size:12px;' }, [ _('Revoked') ]));

				var actCell = E('div', { 'class': 'center' }, [ actBtn ]);

				rows.push([
					E('div', { 'class': 'center' }, [ k.id ? k.id.toString() : '-' ]),
					E('strong', { 'style': isMarkedRevoke ? 'text-decoration:line-through;color:#a0aec0;' : '' }, [ uName ]),
					keyDisplayCell,
					E('div', { 'class': 'center' }, [ renderYesNoBadge(k.reusable, 'success') ]),
					E('div', { 'class': 'center' }, [ renderYesNoBadge(k.ephemeral, 'info') ]),
					E('div', { 'class': 'center' }, [ renderYesNoBadge(k.used, 'warning') ]),
					E('div', { 'class': 'center' }, [ expText ]),
					E('div', { 'class': 'center' }, [ statusBadge ]),
					actCell
				]);
			});
		}

		cbi_update_table(self.tableElement, rows, E('em', {}, [ _('No pre-auth keys found.') ]));
	},

	render: function(data) {
		var self = this;
		var rawUsers = data[0];
		var rawKeys = data[1];
		var users = Array.isArray(rawUsers) ? rawUsers : ((rawUsers && rawUsers.users) ? rawUsers.users : []);
		self.rawKeys = Array.isArray(rawKeys) ? rawKeys : ((rawKeys && rawKeys.keys) ? rawKeys.keys : []);
		self.stagedKeyCreations = [];
		self.stagedKeyRevocations = {};

		self.tableElement = E('table', { 'class': 'table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:50px;' }, [ _('ID') ]),
				E('th', { 'class': 'th', 'style': 'width:110px;' }, [ _('User') ]),
				E('th', { 'class': 'th', 'style': 'width:280px;' }, [ _('Key & Join Command') ]),
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('Reusable') ]),
				E('th', { 'class': 'th center', 'style': 'width:80px;' }, [ _('Ephemeral') ]),
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('Used') ]),
				E('th', { 'class': 'th center', 'style': 'width:140px;' }, [ _('Expiration') ]),
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('Status') ]),
				E('th', { 'class': 'th center nowrap cbi-section-actions', 'style': 'width:90px;' }, [ _('Actions') ])
			])
		]);

		self.renderTableRows();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Pre-Auth Keys') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Create and manage pre-authentication keys for unattended or automated client device enrollment.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Create New Pre-Auth Key') ]),
				E('div', { 'class': 'cbi-section-descr', 'style': 'color:#4a5568;' }, [
					_('Pre-auth keys allow unattended device enrollment. Full plaintext keys and copy buttons will remain accessible in this table.')
				]),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Belongs to User') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'hs_key_user', 'class': 'cbi-input-select', 'style': 'width:220px;' },
								users.map(function(u) {
									return E('option', { 'value': u.name }, [ u.name ]);
								})
							)
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Reusable Key') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'checkbox', 'id': 'hs_key_reusable', 'class': 'cbi-input-checkbox', 'checked': 'checked' }),
							E('label', { 'for': 'hs_key_reusable', 'style': 'margin-left:6px;' }, [
								_('Allow enrolling multiple devices with this single key.')
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Ephemeral Node') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'checkbox', 'id': 'hs_key_ephemeral', 'class': 'cbi-input-checkbox' }),
							E('label', { 'for': 'hs_key_ephemeral', 'style': 'margin-left:6px;' }, [
								_('Auto-remove device registration from server once device goes offline.')
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Expiration') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', { 'type': 'text', 'id': 'hs_key_expiration', 'class': 'cbi-input-text', 'value': '24h', 'placeholder': '24h, 720h, 8760h', 'style': 'width:180px;' }),
							E('span', { 'style': 'margin-left:8px;font-size:12px;color:#718096;' }, [ _('Examples: 1h, 24h, 720h (30 days), 8760h (1 year).') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ '' ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('button', {
								'class': 'btn cbi-button cbi-button-action',
								'click': function() {
									var userSelect = document.getElementById('hs_key_user');
									var uName = userSelect ? userSelect.value : '';
									var reusable = document.getElementById('hs_key_reusable').checked;
									var ephemeral = document.getElementById('hs_key_ephemeral').checked;
									var expiration = document.getElementById('hs_key_expiration').value.trim() || '24h';

									if (!uName) return;

									self.stagedKeyCreations.push({
										user: uName,
										reusable: reusable,
										ephemeral: ephemeral,
										expiration: expiration
									});

									self.markUciChanged();
									self.renderTableRows();
								}
							}, [ _('Add') ])
						])
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Active & Historical Pre-Auth Keys') ]),
				self.tableElement
			])
		]);
	},

	handleSave: function(ev) {
		var self = this;
		var tasks = [];

		Object.keys(self.stagedKeyRevocations).forEach(function(kId) {
			var item = self.stagedKeyRevocations[kId];
			tasks.push(callExpireKey(item.user, item.key));
		});

		self.stagedKeyCreations.forEach(function(item) {
			tasks.push(
				callCreateKey(item.user, item.reusable, item.ephemeral, item.expiration).then(function(res) {
					var rawKey = (res && (res.key || res.full_key || res.output)) ? (res.key || res.full_key || res.output) : '';
					if (rawKey) {
						self.recentlyGeneratedKeys['pending_' + Date.now()] = rawKey;
					}
				})
			);
		});

		return Promise.all(tasks).then(function() {
			self.stagedKeyCreations = [];
			self.stagedKeyRevocations = {};
			self.markUciChanged();
			return uci.save().then(function() {
				return callListKeys().then(function(rawKeys) {
					self.rawKeys = Array.isArray(rawKeys) ? rawKeys : ((rawKeys && rawKeys.keys) ? rawKeys.keys : []);
					self.renderTableRows();
				});
			});
		});
	},

	handleSaveApply: function(ev, mode) {
		var self = this;
		return self.handleSave(ev).then(function() {
			return ui.changes.apply(mode == '0');
		});
	},

	handleReset: function(ev) {
		this.stagedKeyCreations = [];
		this.stagedKeyRevocations = {};
		this.renderTableRows();
		return uci.unload('headscale');
	}
});
