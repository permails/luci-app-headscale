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

var callListNodes = rpc.declare({
	object: 'luci.headscale',
	method: 'list_nodes',
	expect: { nodes: [] }
});

var callDeleteNode = rpc.declare({
	object: 'luci.headscale',
	method: 'delete_node',
	params: [ 'id' ],
	expect: { code: 0 }
});

var callExpireNode = rpc.declare({
	object: 'luci.headscale',
	method: 'expire_node',
	params: [ 'id' ],
	expect: { code: 0 }
});

var callRenameNode = rpc.declare({
	object: 'luci.headscale',
	method: 'rename_node',
	params: [ 'id', 'name' ],
	expect: { code: 0 }
});

var callApproveRoutes = rpc.declare({
	object: 'luci.headscale',
	method: 'approve_routes',
	params: [ 'id', 'routes' ],
	expect: { code: 0 }
});

var callGetStatus = rpc.declare({
	object: 'luci.headscale',
	method: 'get_status',
	expect: { }
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

function isNodeExpired(node) {
	if (node.online === false) return true;
	if (node.expiration) {
		var d = parseTimestamp(node.expiration);
		if (d && d.getTime() < Date.now()) return true;
	}
	return false;
}

return view.extend({
	rawNodes: [],
	stagedRenames: {},
	stagedRoutes: {},
	stagedExpires: {},
	stagedDeletes: {},
	editingRename: {},
	editingRoutes: {},
	tableElement: null,
	isRunning: true,

	load: function() {
		return Promise.all([
			callListNodes(),
			uci.load('headscale'),
			callGetStatus()
		]);
	},

	markUciChanged: function() {
		uci.set('headscale', 'server', '_nodes_seq', Date.now().toString());
	},

	renderTableRows: function() {
		var self = this;
		if (!self.tableElement) return;
		var rows = [];

		if (self.rawNodes && self.rawNodes.length > 0) {
			self.rawNodes.forEach(function(node) {
				var nid = node.id;
				var isMarkedDelete = self.stagedDeletes[nid] === true;
				var isMarkedExpire = self.stagedExpires[nid] === true;
				var isRenamed = self.stagedRenames[nid] !== undefined;
				var isRoutesModified = self.stagedRoutes[nid] !== undefined;

				var ips = node.ip_addresses || node.ipAddresses || [];
				var hostinfo = node.hostinfo || {};
				var rawName = node.name || '-';
				var initialName = node.given_name || node.givenName || rawName;
				var currentDisplayName = isRenamed ? self.stagedRenames[nid] : initialName;
				var uName = (node.user && node.user.name) ? node.user.name : (node.user || '-');
				var isOnline = (node.online === true) && !isMarkedExpire;
				var expired = isNodeExpired(node) || isMarkedExpire;

				var hostCell = null;
				if (self.editingRename[nid]) {
					var renameInput = E('input', {
						'type': 'text',
						'class': 'cbi-input-text',
						'value': currentDisplayName,
						'style': 'width:120px;font-size:12px;display:inline-block;'
					});
					hostCell = E('div', { 'style': 'display:flex;gap:4px;align-items:center;' }, [
						renameInput,
						E('button', {
							'class': 'btn cbi-button cbi-button-action',
							'style': 'padding:2px 6px;font-size:11px;width:auto;margin:0;',
							'click': function() {
								var newName = renameInput.value.trim();
								if (newName && newName !== initialName) {
									self.stagedRenames[nid] = newName;
								} else {
									delete self.stagedRenames[nid];
								}
								delete self.editingRename[nid];
								self.markUciChanged();
								self.renderTableRows();
							}
						}, [ _('OK') ]),
						E('button', {
							'class': 'btn cbi-button cbi-button-neutral',
							'style': 'padding:2px 6px;font-size:11px;width:auto;margin:0;',
							'click': function() {
								delete self.editingRename[nid];
								self.renderTableRows();
							}
						}, [ _('Cancel') ])
					]);
				} else {
					hostCell = E('div', {}, [
						E('div', { 'style': 'font-weight:600;' + (isMarkedDelete ? 'text-decoration:line-through;color:#a0aec0;' : '') }, [
							currentDisplayName,
							isRenamed ? E('span', { 'class': 'badge label warning', 'style': 'font-size:10px;margin-left:4px;' }, [ _('Modified') ]) : ''
						]),
						(currentDisplayName !== rawName) ? E('div', { 'style': 'font-size:11px;color:#64748b;font-family:monospace;' }, [ rawName ]) : ''
					]);
				}

				var ipCell = null;
				if (self.editingRoutes[nid]) {
					var routesInput = E('input', {
						'type': 'text',
						'class': 'cbi-input-text',
						'value': self.stagedRoutes[nid] || '',
						'placeholder': '192.168.1.0/24',
						'style': 'width:140px;font-size:11px;display:inline-block;'
					});
					ipCell = E('div', { 'style': 'display:flex;flex-direction:column;gap:4px;' }, [
						E('div', { 'style': 'font-size:11px;color:#718096;' }, [ _('Subnet Routes:') ]),
						E('div', { 'style': 'display:flex;gap:4px;align-items:center;' }, [
							routesInput,
							E('button', {
								'class': 'btn cbi-button cbi-button-action',
								'style': 'padding:2px 6px;font-size:11px;width:auto;margin:0;',
								'click': function() {
									self.stagedRoutes[nid] = routesInput.value.trim();
									delete self.editingRoutes[nid];
									self.markUciChanged();
									self.renderTableRows();
								}
							}, [ _('OK') ]),
							E('button', {
								'class': 'btn cbi-button cbi-button-neutral',
								'style': 'padding:2px 6px;font-size:11px;width:auto;margin:0;',
								'click': function() {
									delete self.editingRoutes[nid];
									self.renderTableRows();
								}
							}, [ _('Cancel') ])
						])
					]);
				} else {
					ipCell = E('div', { 'style': 'display:flex;flex-direction:column;gap:2px;' + (isMarkedDelete ? 'opacity:0.5;' : '') },
						ips.map(function(ip) {
							var isV4 = ip.indexOf('.') !== -1;
							return E('code', { 'style': 'font-size:12px;color:' + (isV4 ? '#0284c7' : '#64748b') + ';' }, [ ip ]);
						})
					);
					if (isRoutesModified) {
						ipCell.appendChild(E('div', { 'style': 'font-size:11px;color:#d69e2e;' }, [
							_('Routes:') + ' ' + self.stagedRoutes[nid]
						]));
					}
				}

				var osCell = E('div', { 'style': isMarkedDelete ? 'opacity:0.5;' : '' }, [
					E('div', {}, [ hostinfo.os || hostinfo.OS || '-' ]),
					hostinfo.distro ? E('div', { 'style': 'font-size:11px;color:#64748b;' }, [ hostinfo.distro ]) : ''
				]);

				var statusBadge = isMarkedDelete ?
					E('span', { 'class': 'badge label danger' }, [ _('To Delete') ]) :
					(isMarkedExpire ?
						E('span', { 'class': 'badge label warning' }, [ _('To Expire') ]) :
						(isOnline ? E('span', { 'class': 'badge label success' }, [ _('Online') ]) : E('span', { 'class': 'badge label' }, [ _('Offline') ])));

				var actionBtns = E('div', { 'style': 'display:inline-flex;gap:4px;justify-content:center;' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'style': 'padding:2px 8px;font-size:12px;width:auto;margin:0;',
						'disabled': isMarkedDelete ? true : null,
						'click': function() {
							self.editingRename[nid] = !self.editingRename[nid];
							self.renderTableRows();
						}
					}, [ _('Rename') ]),

					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 8px;font-size:12px;width:auto;margin:0;',
						'disabled': isMarkedDelete ? true : null,
						'click': function() {
							self.editingRoutes[nid] = !self.editingRoutes[nid];
							self.renderTableRows();
						}
					}, [ _('Routes') ]),

					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'style': 'padding:2px 8px;font-size:12px;width:auto;margin:0;',
						'disabled': isMarkedDelete ? true : (expired && !isMarkedExpire ? true : null),
						'click': function() {
							if (isMarkedExpire) {
								delete self.stagedExpires[nid];
							} else {
								self.stagedExpires[nid] = true;
							}
							self.markUciChanged();
							self.renderTableRows();
						}
					}, [ isMarkedExpire ? _('Undo') : (expired ? _('Expired') : _('Expire')) ]),

					E('button', {
						'class': 'btn cbi-button ' + (isMarkedDelete ? 'cbi-button-neutral' : 'cbi-button-remove'),
						'style': 'padding:2px 8px;font-size:12px;width:auto;margin:0;',
						'click': function() {
							if (isMarkedDelete) {
								delete self.stagedDeletes[nid];
							} else {
								self.stagedDeletes[nid] = true;
							}
							self.markUciChanged();
							self.renderTableRows();
						}
					}, [ isMarkedDelete ? _('Undo') : _('Delete') ])
				]);

				rows.push([
					E('div', { 'class': 'center' }, [ nid ? nid.toString() : '-' ]),
					hostCell,
					E('span', { 'class': 'badge label' }, [ uName ]),
					ipCell,
					osCell,
					E('div', { 'class': 'center' }, [ statusBadge ]),
					E('div', { 'class': 'center' }, [ actionBtns ])
				]);
			});
		}

		var emptyMsg = self.isRunning ?
			_('No registered nodes found in this Headscale server.') :
			_('Headscale service is not running, unable to fetch nodes list.');
		cbi_update_table(self.tableElement, rows, E('em', { 'style': !self.isRunning ? 'color:#a0aec0;' : '' }, [ emptyMsg ]));
	},

	render: function(data) {
		var self = this;
		var rawNodes = data[0];
		var status = data[2] || {};
		self.isRunning = (status.running === true || status.running === 1);
		self.rawNodes = Array.isArray(rawNodes) ? rawNodes : ((rawNodes && rawNodes.nodes) ? rawNodes.nodes : []);
		self.stagedRenames = {};
		self.stagedRoutes = {};
		self.stagedExpires = {};
		self.stagedDeletes = {};
		self.editingRename = {};
		self.editingRoutes = {};

		self.tableElement = E('table', { 'class': 'table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:50px;' }, [ _('ID') ]),
				E('th', { 'class': 'th', 'style': 'width:190px;' }, [ _('Hostname') ]),
				E('th', { 'class': 'th', 'style': 'width:110px;' }, [ _('User') ]),
				E('th', { 'class': 'th' }, [ _('IP Addresses') ]),
				E('th', { 'class': 'th', 'style': 'width:130px;' }, [ _('OS') ]),
				E('th', { 'class': 'th center', 'style': 'width:80px;' }, [ _('Status') ]),
				E('th', { 'class': 'th center nowrap cbi-section-actions', 'style': 'width:230px;' }, [ _('Action') ])
			])
		]);

		self.renderTableRows();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Registered Nodes') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Manage all Tailscale client devices and nodes registered to this Headscale server.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				self.tableElement
			])
		]);
	},

	handleSave: function(ev) {
		var self = this;
		var tasks = [];

		Object.keys(self.stagedDeletes).forEach(function(nid) {
			tasks.push(callDeleteNode(nid));
		});

		Object.keys(self.stagedExpires).forEach(function(nid) {
			if (!self.stagedDeletes[nid]) {
				tasks.push(callExpireNode(nid));
			}
		});

		Object.keys(self.stagedRenames).forEach(function(nid) {
			if (!self.stagedDeletes[nid]) {
				tasks.push(callRenameNode(nid, self.stagedRenames[nid]));
			}
		});

		Object.keys(self.stagedRoutes).forEach(function(nid) {
			if (!self.stagedDeletes[nid]) {
				tasks.push(callApproveRoutes(nid, self.stagedRoutes[nid]));
			}
		});

		return Promise.all(tasks).then(function() {
			self.stagedRenames = {};
			self.stagedRoutes = {};
			self.stagedExpires = {};
			self.stagedDeletes = {};
			self.editingRename = {};
			self.editingRoutes = {};
			self.markUciChanged();
			return uci.save().then(function() {
				return callListNodes().then(function(data) {
					self.rawNodes = Array.isArray(data) ? data : ((data && data.nodes) ? data.nodes : []);
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
		this.stagedRenames = {};
		this.stagedRoutes = {};
		this.stagedExpires = {};
		this.stagedDeletes = {};
		this.editingRename = {};
		this.editingRoutes = {};
		this.renderTableRows();
		return uci.unload('headscale');
	}
});
