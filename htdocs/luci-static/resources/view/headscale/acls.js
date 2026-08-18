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

var callGetACL = rpc.declare({
	object: 'luci.headscale',
	method: 'get_acl',
	expect: { content: '' }
});

var callSetACL = rpc.declare({
	object: 'luci.headscale',
	method: 'set_acl',
	params: [ 'content' ],
	expect: { code: 0 }
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
	if (src === '*') return _('All Devices (*)');
	if (src === 'autogroup:self') return _('Same User Devices (autogroup:self)');
	if (src === 'autogroup:admin') return _('Admin Devices (autogroup:admin)');
	return src;
}

function describeDst(dst) {
	if (dst === '*:*') return _('All Targets & All Ports (*:*)');
	if (dst === 'autogroup:self:*') return _('Same User Devices (All Ports)');
	if (dst === '192.168.1.0/24:*') return _('Local LAN Subnet (192.168.1.0/24)');
	if (dst.endsWith(':80,443') || dst.endsWith(':80,443,8080')) return dst.split(':')[0] + ' ' + _('(Web HTTP/HTTPS)');
	if (dst.endsWith(':22')) return dst.split(':')[0] + ' ' + _('(SSH: 22)');
	if (dst.endsWith(':3389,5900') || dst.endsWith(':3389')) return dst.split(':')[0] + ' ' + _('(Remote Desktop RDP)');
	if (dst.endsWith(':445')) return dst.split(':')[0] + ' ' + _('(File Sharing SMB)');
	return dst;
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

	markUciChanged: function() {
		uci.set('headscale', 'server', '_acl_seq', Date.now().toString());
	},

	renderRulesTable: function() {
		var self = this;
		if (!self.tableContainer) return;
		var policyObj = self.currentPolicyObj;
		var aclsList = policyObj.acls || [];

		var table = E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:60px;' }, [ _('ID') ]),
				E('th', { 'class': 'th', 'style': 'width:28%;' }, [ _('Source Devices (Who)') ]),
				E('th', { 'class': 'th', 'style': 'width:36%;' }, [ _('Target & Ports (What)') ]),
				E('th', { 'class': 'th center', 'style': 'width:120px;' }, [ _('Action') ]),
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
						self.markUciChanged();
						self.renderRulesTable();
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
						E('span', { 'class': 'badge label success' }, [ _('Allow') ])
					]),
					E('td', { 'class': 'td center' }, [
						E('div', { 'class': 'center' }, [ delBtn ])
					])
				]));
			});
		}

		self.tableContainer.innerHTML = '';
		self.tableContainer.appendChild(table);
	},

	render: function(data) {
		var self = this;
		var aclData = data[0];
		var rawContent = (aclData && aclData.content) ? aclData.content : '';
		try {
			self.initialPolicyObj = JSON.parse(rawContent);
		} catch (e) {
			self.initialPolicyObj = DEFAULT_ACL_OBJ;
		}

		if (!self.initialPolicyObj || !Array.isArray(self.initialPolicyObj.acls)) {
			self.initialPolicyObj = DEFAULT_ACL_OBJ;
		}

		self.currentPolicyObj = JSON.parse(JSON.stringify(self.initialPolicyObj));

		var viewRoot = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Access Control Policy (ACL)') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Manage inter-device communication permissions and network access rules.')
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
			E('option', { 'value': '*' }, [ _('All Devices (*)') ]),
			E('option', { 'value': 'autogroup:self' }, [ _('Same User Devices (autogroup:self)') ]),
			E('option', { 'value': 'autogroup:admin' }, [ _('Admin Devices (autogroup:admin)') ]),
			E('option', { 'value': 'custom' }, [ _('-- Custom Tag / Group / Subnet --') ])
		]);
		var srcCustomInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': 'tag:server, 192.168.1.0/24',
			'style': 'width:240px;margin-left:8px;display:none;'
		});
		srcSelect.addEventListener('change', function() {
			srcCustomInput.style.display = (srcSelect.value === 'custom') ? 'inline-block' : 'none';
		});

		var dstSelect = E('select', { 'class': 'cbi-input-select', 'style': 'width:260px;' }, [
			E('option', { 'value': '*' }, [ _('All Target Devices (*)') ]),
			E('option', { 'value': 'autogroup:self' }, [ _('Same User Devices (autogroup:self)') ]),
			E('option', { 'value': '192.168.1.0/24' }, [ _('Home Local LAN (192.168.1.0/24)') ]),
			E('option', { 'value': 'custom' }, [ _('-- Custom Tag / Subnet / IP --') ])
		]);
		var dstCustomInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': 'tag:homelab, 10.0.0.0/8',
			'style': 'width:240px;margin-left:8px;display:none;'
		});
		dstSelect.addEventListener('change', function() {
			dstCustomInput.style.display = (dstSelect.value === 'custom') ? 'inline-block' : 'none';
		});

		var portSelect = E('select', { 'class': 'cbi-input-select', 'style': 'width:260px;' }, [
			E('option', { 'value': '*' }, [ _('All Ports (*)') ]),
			E('option', { 'value': '80,443' }, [ _('Web Services (HTTP/HTTPS: 80, 443)') ]),
			E('option', { 'value': '22' }, [ _('Remote SSH (22)') ]),
			E('option', { 'value': '3389,5900' }, [ _('Remote Desktop (RDP/VNC: 3389, 5900)') ]),
			E('option', { 'value': '445' }, [ _('Windows File Sharing (SMB: 445)') ]),
			E('option', { 'value': 'custom' }, [ _('-- Custom Port Numbers --') ])
		]);
		var portCustomInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': '8080, 9000-9100',
			'style': 'width:200px;margin-left:8px;display:none;'
		});
		portSelect.addEventListener('change', function() {
			portCustomInput.style.display = (portSelect.value === 'custom') ? 'inline-block' : 'none';
		});

		var addSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Add New Access Rule') ]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'table' }, [
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width:25%;font-weight:bold;' }, [ _('1. Source (Who initiates traffic)') ]),
						E('div', { 'class': 'td left' }, [ srcSelect, srcCustomInput ])
					]),
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width:25%;font-weight:bold;' }, [ _('2. Target (Destination device/subnet)') ]),
						E('div', { 'class': 'td left' }, [ dstSelect, dstCustomInput ])
					]),
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width:25%;font-weight:bold;' }, [ _('3. Service / Ports (Allowed ports)') ]),
						E('div', { 'class': 'td left' }, [ portSelect, portCustomInput ])
					])
				]),
				E('div', { 'style': 'margin-top:12px;' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': function() {
							var srcFinal = (srcSelect.value === 'custom') ? srcCustomInput.value.trim() : srcSelect.value;
							var dstFinal = (dstSelect.value === 'custom') ? dstCustomInput.value.trim() : dstSelect.value;
							var portFinal = (portSelect.value === 'custom') ? portCustomInput.value.trim() : portSelect.value;

							if (!srcFinal || !dstFinal || !portFinal) return;

							var combinedDst = dstFinal + ':' + portFinal;
							if (!Array.isArray(self.currentPolicyObj.acls)) self.currentPolicyObj.acls = [];
							self.currentPolicyObj.acls.push({
								"action": "accept",
								"src": [ srcFinal ],
								"dst": [ combinedDst ]
							});
							self.markUciChanged();
							self.renderRulesTable();
						}
					}, [ _('+ Add Rule') ])
				])
			])
		]);

		// ------------------- Section 3: Global Quick Presets -------------------
		var hasSSH = self.currentPolicyObj.ssh && self.currentPolicyObj.ssh.length > 0;
		var optionsSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Quick Options & Presets') ]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'style': 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							self.currentPolicyObj = JSON.parse(JSON.stringify(DEFAULT_ACL_OBJ));
							self.markUciChanged();
							self.renderRulesTable();
						}
					}, [ _('Reset to Default (Allow All)') ]),

					E('button', {
						'class': hasSSH ? 'btn cbi-button cbi-button-reset' : 'btn cbi-button cbi-button-action',
						'click': function() {
							if (self.currentPolicyObj.ssh) {
								delete self.currentPolicyObj.ssh;
							} else {
								self.currentPolicyObj.ssh = [
									{
										"action": "accept",
										"src": ["autogroup:member"],
										"dst": ["autogroup:self"],
										"users": ["autogroup:nonroot", "root"]
									}
								];
							}
							self.markUciChanged();
							self.renderRulesTable();
						}
					}, [ hasSSH ? _('Disable Tailscale SSH') : _('Enable Tailscale SSH') ])
				])
			])
		]);

		viewRoot.appendChild(tableSection);
		viewRoot.appendChild(addSection);
		viewRoot.appendChild(optionsSection);

		return viewRoot;
	},

	handleSave: function(ev) {
		var self = this;
		var jsonStr = JSON.stringify(self.currentPolicyObj, null, 2);
		return callSetACL(jsonStr).then(function() {
			self.initialPolicyObj = JSON.parse(jsonStr);
			self.markUciChanged();
			return uci.save().then(function() {
				self.renderRulesTable();
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
		this.currentPolicyObj = JSON.parse(JSON.stringify(this.initialPolicyObj));
		this.renderRulesTable();
		return uci.unload('headscale');
	}
});
