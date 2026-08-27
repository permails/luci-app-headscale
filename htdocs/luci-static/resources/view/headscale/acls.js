/*
 * Copyright (C) 2026 permails <logo@permails.com>
 *
 * This is free software, licensed under the Apache License, Version 2.0.
 */

'use strict';
'require view';
'require dom';
'require rpc';
'require ui';
'require uci';
'require headscale_staging';

var callGetACL = rpc.declare({
	object: 'luci.headscale',
	method: 'get_acl'
	// NOTE: do not declare an "expect" here — rpc.js picks the FIRST
	// expect key only, which would swallow the "content" payload.
	// Resolves to the { content: "..." } object that render() parses.
});

var DEFAULT_ACL_OBJ = {
	"acls": [
		{
			"action": "accept",
			"src": ["*"],
			"dst": ["*:*"]
		}
	]
};

function describeSrc(src) {
	if (src === '*') return _('All Connected Devices (*)');
	if (src === 'autogroup:member') return _('All Member Devices (autogroup:member)');
	if (src === 'autogroup:tagged') return _('All Tagged Devices (autogroup:tagged)');
	if (src.indexOf('tag:') === 0) return _('Tagged Devices (%s)').format(src);
	return src;
}

function describeDst(dst) {
	if (dst === '*:*') return _('All Destination Devices & Ports (*:*)');
	if (dst === 'autogroup:self:*') return _('Own Devices (All Ports)');
	if (dst.indexOf('192.168.1.0/24') === 0) return _('Home Local LAN (192.168.1.0/24)');
	if (dst.endsWith(':*')) return dst.replace(':*', ' ') + ' (' + _('All Ports') + ')';
	if (dst.endsWith(':80,443')) return dst.split(':')[0] + ' (' + _('Web HTTP/HTTPS: 80, 443') + ')';
	if (dst.endsWith(':22')) return dst.split(':')[0] + ' (' + _('SSH: 22') + ')';
	if (dst.endsWith(':3389,5900')) return dst.split(':')[0] + ' (' + _('RDP/VNC: 3389, 5900') + ')';
	if (dst.endsWith(':445')) return dst.split(':')[0] + ' (' + _('SMB: 445') + ')';
	return dst;
}

function validateRule(src, dst, port) {
	if (!src || !dst || !port) {
		return _('Please specify source, destination and port.');
	}
	if (src === 'autogroup:self') {
		return _('Source cannot be "autogroup:self". Please use * or autogroup:member.');
	}
	if (src === 'autogroup:admin') {
		return _('Headscale does not support "autogroup:admin". Please use autogroup:member or autogroup:tagged.');
	}
	if ((src === 'autogroup:tagged' || src.indexOf('/') !== -1 || src.indexOf('.') !== -1) && dst.indexOf('autogroup:self') === 0) {
		return _('Tagged devices (autogroup:tagged) and IP subnets have no user ownership. Destination cannot be "autogroup:self".');
	}
	if (src.indexOf('tag:') === 0 || (dst.indexOf('tag:') === 0 && dst !== 'autogroup:tagged')) {
		return _('Custom tag (%s) requires tagOwners defined on the server.').format(src.indexOf('tag:') === 0 ? src : dst);
	}
	if (port !== '*' && !/^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$/.test(port)) {
		return _('Invalid port format. Examples: 80, 80,443, 9000-9100, or *.');
	}
	return null;
}

/*
 * Split a destination into its entity part and its trailing port part.
 * The entity itself may contain a colon (e.g. "autogroup:self", "tag:server"),
 * so a plain indexOf(':') cannot be used to detect the port separator.
 * Returns null when no trailing port section is present.
 */
function splitDstPorts(dst) {
	var m = /^(.*?):([0-9*][0-9*,-]*)$/.exec(dst);
	return m ? { entity: m[1], ports: m[2] } : null;
}

function combineDst(dst, port) {
	var parts = splitDstPorts(dst);
	var entity = parts ? parts.entity : dst;
	var existingPorts = parts ? parts.ports : null;
	// An explicit port selection always wins; "*" keeps ports already
	// embedded in a custom destination and defaults to all ports otherwise.
	var ports = (port !== '*') ? port : (existingPorts || '*');
	return entity + ':' + ports;
}

return view.extend({
	initialPolicyObj: null,
	currentPolicyObj: null,
	tableContainer: null,

	load: function() {
		return Promise.all([
			callGetACL(),
			uci.load('headscale')
		]);
	},

	syncFromUCI: function() {
		var self = this;
		var pending = uci.get('headscale', 'server', '_acl_content');
		if (pending) {
			try {
				self.currentPolicyObj = JSON.parse(pending);
			} catch(e) {
				self.currentPolicyObj = JSON.parse(JSON.stringify(self.initialPolicyObj || DEFAULT_ACL_OBJ));
			}
		} else {
			self.currentPolicyObj = JSON.parse(JSON.stringify(self.initialPolicyObj || DEFAULT_ACL_OBJ));
		}
	},

	renderRulesTable: function() {
		var self = this;
		if (!self.tableContainer) return;
		var policyObj = self.currentPolicyObj || DEFAULT_ACL_OBJ;
		var aclsList = policyObj.acls || [];

		var table = E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:60px;' }, [ _('ID') ]),
				E('th', { 'class': 'th', 'style': 'width:28%;' }, [ _('Source Device (Who)') ]),
				E('th', { 'class': 'th', 'style': 'width:36%;' }, [ _('Destination Device & Port (What)') ]),
				E('th', { 'class': 'th center', 'style': 'width:120px;' }, [ _('Policy') ]),
				E('th', { 'class': 'th center nowrap cbi-section-actions', 'style': 'width:100px;' }, [ _('Actions') ])
			])
		]);

		if (aclsList.length === 0) {
			table.appendChild(E('tr', { 'class': 'tr cbi-section-table-row placeholder' }, [
				E('td', { 'class': 'td center', 'colspan': 5 }, [
					E('em', {}, [ _('No ACL rules defined. Default is Deny All.') ])
				])
			]));
		} else {
			aclsList.forEach(function(rule, idx) {
				var srcText = (rule.src || []).join(', ');
				var dstText = (rule.dst || []).join(', ');

				var delBtn = E('button', {
					'class': 'btn cbi-button cbi-button-remove',
					'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
					'click': function() {
						self.currentPolicyObj.acls.splice(idx, 1);
						uci.set('headscale', 'server', '_acl_content', JSON.stringify(self.currentPolicyObj));
						uci.save().then(function() { ui.changes.init(); }).then(function() {
							self.renderRulesTable();
						});
					}
				}, [ _('Delete') ]);

				table.appendChild(E('tr', { 'class': 'tr cbi-section-table-row' }, [
					E('td', { 'class': 'td center' }, [ (idx + 1).toString() ]),
					E('td', { 'class': 'td' }, [
						E('div', { 'style': 'font-weight:600;' }, [ describeSrc(srcText) ]),
						E('div', { 'style': 'font-size:11px;color:#718096;font-family:monospace;' }, [ srcText ])
					]),
					E('td', { 'class': 'td' }, [
						E('div', { 'style': 'font-weight:600;' }, [ describeDst(dstText) ]),
						E('div', { 'style': 'font-size:11px;color:#718096;font-family:monospace;' }, [ dstText ])
					]),
					E('td', { 'class': 'td center' }, [
						E('span', { 'class': 'badge label success' }, [ _('ACCEPT') ])
					]),
					E('td', { 'class': 'td center' }, [
						E('div', { 'class': 'center' }, [ delBtn ])
					])
				]));
			});
		}

		dom.content(self.tableContainer, table);
	},

	render: function(data) {
		var self = this;
		var rawAcl = data[0] || {};
		try {
			if (rawAcl && rawAcl.content) {
				self.initialPolicyObj = JSON.parse(rawAcl.content);
			} else {
				self.initialPolicyObj = DEFAULT_ACL_OBJ;
			}
		} catch (e) {
			self.initialPolicyObj = DEFAULT_ACL_OBJ;
		}

		if (!self.initialPolicyObj || !Array.isArray(self.initialPolicyObj.acls)) {
			self.initialPolicyObj = DEFAULT_ACL_OBJ;
		}

		self.syncFromUCI();

		var viewRoot = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Access Control Policy (ACL)') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Manage inter-device connectivity permissions and network access control policies.')
			])
		]);

		// ------------------- Section 1: ACL Rules Table -------------------
		self.tableContainer = E('div', { 'class': 'cbi-section-node' });
		var tableSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Access Control Rules') ]),
			self.tableContainer
		]);

		self.renderRulesTable();

		// ------------------- Section 2: Visual Rule Builder -------------------
		var srcSelect = E('select', { 'class': 'cbi-input-select', 'style': 'width:260px;' }, [
			E('option', { 'value': 'autogroup:member' }, [ _('All Member Devices (autogroup:member)') ]),
			E('option', { 'value': '*' }, [ _('All Connected Devices (*)') ]),
			E('option', { 'value': 'autogroup:tagged' }, [ _('All Tagged Devices (autogroup:tagged)') ]),
			E('option', { 'value': 'custom' }, [ _('-- Custom IP / CIDR Subnet --') ])
		]);
		var srcCustomInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': '192.168.1.0/24, 10.0.0.1',
			'style': 'width:240px;margin-left:8px;display:none;'
		});
		var hintDiv = E('div', {
			'style': 'margin-top:10px;font-size:13px;color:#dc2626;display:none;'
		}, []);

		var clearHint = function() {
			hintDiv.style.display = 'none';
			hintDiv.textContent = '';
		};

		var dstSelect = E('select', { 'class': 'cbi-input-select', 'style': 'width:260px;' }, [
			E('option', { 'value': 'autogroup:self' }, [ _('Own Devices (autogroup:self)') ]),
			E('option', { 'value': '*' }, [ _('All Destination Devices (*)') ]),
			E('option', { 'value': '192.168.1.0/24' }, [ _('Home Local LAN (192.168.1.0/24)') ]),
			E('option', { 'value': 'custom' }, [ _('-- Custom IP / CIDR Subnet --') ])
		]);
		var dstCustomInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': '10.0.0.0/8, 192.168.2.1',
			'style': 'width:240px;margin-left:8px;display:none;'
		});

		var portSelect = E('select', { 'class': 'cbi-input-select', 'style': 'width:260px;' }, [
			E('option', { 'value': '*' }, [ _('All Ports (*)') ]),
			E('option', { 'value': '80,443' }, [ _('Web Services (HTTP/HTTPS: 80, 443)') ]),
			E('option', { 'value': '22' }, [ _('SSH Terminal (22)') ]),
			E('option', { 'value': '3389,5900' }, [ _('Remote Desktop (RDP/VNC: 3389, 5900)') ]),
			E('option', { 'value': '445' }, [ _('Windows File Sharing (SMB: 445)') ]),
			E('option', { 'value': 'custom' }, [ _('-- Custom Port Number --') ])
		]);
		var portCustomInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': '8188, 9000-9100',
			'style': 'width:200px;margin-left:8px;display:none;'
		});

		var updateSelectCompat = function() {
			var srcVal = (srcSelect.value === 'custom') ? srcCustomInput.value.trim() : srcSelect.value;
			var dstOptSelf = dstSelect.querySelector('option[value="autogroup:self"]');

			var isTaggedOrIp = (srcVal === 'autogroup:tagged' || srcVal.indexOf('/') !== -1 || srcVal.indexOf('.') !== -1);
			if (isTaggedOrIp) {
				if (dstOptSelf) {
					dstOptSelf.disabled = true;
					dstOptSelf.text = _('Own Devices (autogroup:self) - [Tagged devices have no user, unavailable]');
				}
				if (dstSelect.value === 'autogroup:self') {
					dstSelect.value = '*';
				}
			} else {
				if (dstOptSelf) {
					dstOptSelf.disabled = false;
					dstOptSelf.text = _('Own Devices (autogroup:self)');
				}
			}
		};

		srcSelect.addEventListener('change', function() {
			srcCustomInput.style.display = (srcSelect.value === 'custom') ? 'inline-block' : 'none';
			updateSelectCompat();
			clearHint();
		});
		srcCustomInput.addEventListener('input', function() {
			updateSelectCompat();
			clearHint();
		});

		dstSelect.addEventListener('change', function() {
			dstCustomInput.style.display = (dstSelect.value === 'custom') ? 'inline-block' : 'none';
			clearHint();
		});
		dstCustomInput.addEventListener('input', clearHint);

		portSelect.addEventListener('change', function() {
			portCustomInput.style.display = (portSelect.value === 'custom') ? 'inline-block' : 'none';
			clearHint();
		});
		portCustomInput.addEventListener('input', clearHint);

		var addSection = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:36px;' }, [
			E('h3', {}, [ _('Add New Access Rule') ]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'table' }, [
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width:25%;font-weight:bold;' }, [ _('1. Source Device (Initiator)') ]),
						E('div', { 'class': 'td left' }, [ srcSelect, srcCustomInput ])
					]),
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width:25%;font-weight:bold;' }, [ _('2. Destination Device / Subnet') ]),
						E('div', { 'class': 'td left' }, [ dstSelect, dstCustomInput ])
					]),
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width:25%;font-weight:bold;' }, [ _('3. Allowed Services & Ports') ]),
						E('div', { 'class': 'td left' }, [ portSelect, portCustomInput ])
					])
				]),
				E('div', { 'style': 'margin-top:14px;margin-bottom:10px;' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': function() {
							var srcFinal = (srcSelect.value === 'custom') ? srcCustomInput.value.trim() : srcSelect.value;
							var dstFinal = (dstSelect.value === 'custom') ? dstCustomInput.value.trim() : dstSelect.value;
							var portFinal = (portSelect.value === 'custom') ? portCustomInput.value.trim() : portSelect.value;

							var err = validateRule(srcFinal, dstFinal, portFinal);
							if (err) {
								hintDiv.style.display = 'block';
								hintDiv.style.color = '#dc2626';
								hintDiv.textContent = err;
								return;
							}

							var combinedDst = combineDst(dstFinal, portFinal);
							var dstCheck = splitDstPorts(combinedDst);
							if (!dstCheck || !dstCheck.entity || !/^(\*|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)$/.test(dstCheck.ports)) {
								hintDiv.style.display = 'block';
								hintDiv.style.color = '#dc2626';
								hintDiv.textContent = _('Destination must end with a port section, e.g. "%s".').format(dstFinal + ':*');
								return;
							}

							var existingRules = self.currentPolicyObj.acls || [];
							var duplicateIdx = -1;
							for (var i = 0; i < existingRules.length; i++) {
								var r = existingRules[i];
								var rSrc = (r.src || []).join(',');
								var rDst = (r.dst || []).join(',');
								if (rSrc === srcFinal && rDst === combinedDst) {
									duplicateIdx = i;
									break;
								}
							}

							if (duplicateIdx !== -1) {
								var dupMsg = _('This rule already exists (Rule #%d). Cannot add duplicate.').format(duplicateIdx + 1);
								hintDiv.style.display = 'block';
								hintDiv.style.color = '#dc2626';
								hintDiv.textContent = dupMsg;
								return;
							}

							clearHint();
							self.currentPolicyObj.acls.push({
								"action": "accept",
								"src": [ srcFinal ],
								"dst": [ combinedDst ]
							});
							uci.set('headscale', 'server', '_acl_content', JSON.stringify(self.currentPolicyObj));
							uci.save().then(function() { ui.changes.init(); }).then(function() {
								self.renderRulesTable();
							});
						}
					}, [ _('Add Rule') ]),
					hintDiv
				])
			])
		]);

		viewRoot.appendChild(tableSection);
		viewRoot.appendChild(addSection);

		return viewRoot;
	},

	handleSave: function(ev) {
		var self = this;
		if (ev && ev.preventDefault) ev.preventDefault();
		// Save only: store to pending state, do not apply to headscale
		uci.set('headscale', 'server', '_acl_content', JSON.stringify(self.currentPolicyObj || DEFAULT_ACL_OBJ));
		return uci.save().then(function() { ui.changes.init(); });
	},

	handleSaveApply: function(ev, mode) {
		var self = this;
		if (ev && ev.preventDefault) ev.preventDefault();

		// Stage the in-memory policy first so the shared executor sees it.
		return self.handleSave().then(function() {
			/* The "Unsaved Changes" indicator is global: flush the staged
			 * work of ALL headscale pages (users, pre-auth keys, ACL),
			 * not just this page's queue. */
			if (!headscale_staging.hasStaged())
				return Promise.resolve(ui.changes.apply(mode != '1'));

			return headscale_staging.executeAll().then(function() {
				/* Everything executed by the headscale service. Run the
				 * STANDARD LuCI apply flow: commits the staging delta (its
				 * leftovers are cleaned up by the init script reload),
				 * shows the countdown modal, clears the "Unsaved Changes"
				 * indicator and reloads the page.
				 * mode '1' is the "Apply unchecked" combo variant. */
				return Promise.resolve(ui.changes.apply(mode != '1'));
			}).catch(function(err) {
				if (!err || !err.plan) {
					ui.addNotification(null, E('p', {}, [ _('Error: ') + _(err && err.message ? err.message : err) ]), 'danger');
					return;
				}
				/* Keep the operations that did not run staged for a retry. */
				return headscale_staging.restageRemaining(err).then(function() {
					self.syncFromUCI();
					self.renderRulesTable();
					ui.addNotification(null, E('p', {}, [
						_('Failed to apply operation #%d (%s): %s').format(
							(err.appliedCount || 0) + 1,
							headscale_staging.scopeLabel(err.scope),
							_(err.message || err))
					]), 'danger');
				});
			});
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [ _('Error: ') + _(err.message || err) ]), 'danger');
		});
	},

	addFooter: function() {
		var self = this;
		var saveApplyBtn = new ui.ComboButton('0', {
			0: [ _('Save & Apply') ],
			1: [ _('Apply unchecked') ]
		}, {
			classes: {
				0: 'btn cbi-button cbi-button-apply important',
				1: 'btn cbi-button cbi-button-negative important'
			},
			click: ui.createHandlerFn(this, 'handleSaveApply')
		}).render();

		return E('div', { 'class': 'cbi-page-actions' }, [
			saveApplyBtn,
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-save',
				'click': ui.createHandlerFn(this, 'handleSave')
			}, [ _('Save') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'click': function(ev) {
					ev.preventDefault();
					// Standard LuCI revert: wipes all pending uci deltas
					// (incl. the staged ACL). ui.js reloads the page once
					// the revert completed; revert() itself does not return
					// a promise, so there is nothing to chain on.
					ui.changes.revert();
				}
			}, [ _('Restore') ])
		]);
	}
});
