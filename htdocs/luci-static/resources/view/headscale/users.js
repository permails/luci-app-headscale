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

var callCreateUser = rpc.declare({
	object: 'luci.headscale',
	method: 'create_user',
	params: [ 'name' ],
	expect: { code: 0 }
});

var callDeleteUser = rpc.declare({
	object: 'luci.headscale',
	method: 'delete_user',
	params: [ 'name' ],
	expect: { code: 0 }
});

function formatDateTime(t) {
	if (!t) return '-';
	var d = null;
	if (typeof(t) === 'object' && t.seconds !== undefined) {
		d = new Date(t.seconds * 1000);
	} else if (typeof(t) === 'number') {
		d = new Date(t > 1e11 ? t : t * 1000);
	} else if (typeof(t) === 'string') {
		d = new Date(t);
	}
	if (d && !isNaN(d.getTime())) {
		var pad = function(n) { return (n < 10 ? '0' : '') + n; };
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
	}
	return typeof(t) === 'string' ? t : '-';
}

return view.extend({
	rawUsers: [],
	stagedCreations: [],
	stagedDeletions: {},
	tableElement: null,

	load: function() {
		return Promise.all([
			callListUsers(),
			uci.load('headscale')
		]);
	},

	markUciChanged: function() {
		uci.set('headscale', 'server', '_users_seq', Date.now().toString());
	},

	renderTableRows: function() {
		var self = this;
		if (!self.tableElement) return;
		var rows = [];

		// 1. 渲染待创建的暂存用户
		self.stagedCreations.forEach(function(name, idx) {
			var undoBtn = E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
				'click': function() {
					self.stagedCreations.splice(idx, 1);
					self.markUciChanged();
					self.renderTableRows();
				}
			}, [ _('Undo') ]);

			rows.push([
				E('div', { 'class': 'center' }, [ E('span', { 'class': 'badge label warning' }, [ _('Pending') ]) ]),
				E('div', {}, [
					E('strong', { 'style': 'color:#2b6cb0;' }, [ name ]),
					' ',
					E('span', { 'class': 'badge label warning', 'style': 'font-size:11px;' }, [ _('To Create') ])
				]),
				E('div', { 'class': 'center', 'style': 'color:#718096;' }, [ _('Not saved') ]),
				E('div', { 'class': 'center' }, [ undoBtn ])
			]);
		});

		// 2. 渲染现有用户
		if (self.rawUsers && self.rawUsers.length > 0) {
			self.rawUsers.forEach(function(u) {
				var isMarkedDelete = self.stagedDeletions[u.name] === true;

				var actBtn = isMarkedDelete ?
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function() {
							delete self.stagedDeletions[u.name];
							self.markUciChanged();
							self.renderTableRows();
						}
					}, [ _('Undo') ]) :
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function() {
							self.stagedDeletions[u.name] = true;
							self.markUciChanged();
							self.renderTableRows();
						}
					}, [ _('Delete') ]);

				var nameCell = isMarkedDelete ?
					E('div', { 'style': 'text-decoration:line-through;color:#a0aec0;' }, [
						E('strong', {}, [ u.name || '-' ]),
						' ',
						E('span', { 'class': 'badge label danger', 'style': 'font-size:11px;' }, [ _('To Delete') ])
					]) :
					E('strong', {}, [ u.name || '-' ]);

				rows.push([
					E('div', { 'class': 'center' }, [ u.id ? u.id.toString() : '-' ]),
					nameCell,
					E('div', { 'class': 'center', 'style': isMarkedDelete ? 'text-decoration:line-through;color:#a0aec0;' : '' }, [
						formatDateTime(u.created_at || u.createdAt)
					]),
					E('div', { 'class': 'center' }, [ actBtn ])
				]);
			});
		}

		cbi_update_table(self.tableElement, rows, E('em', {}, [ _('No users found. Create a user above to get started.') ]));
	},

	render: function(data) {
		var self = this;
		var rawUsers = data[0];
		var status = data[2] || {};
		self.rawUsers = Array.isArray(rawUsers) ? rawUsers : ((rawUsers && rawUsers.users) ? rawUsers.users : []);
		self.stagedCreations = [];
		self.stagedDeletions = {};

		var handleAddUser = function() {
			var nameInput = document.getElementById('hs_new_username');
			var name = nameInput ? nameInput.value.trim() : '';
			if (!name) return;
			if (self.stagedCreations.indexOf(name) === -1) {
				self.stagedCreations.unshift(name);
				self.markUciChanged();
			}
			if (nameInput) nameInput.value = '';
			self.renderTableRows();
		};

		var nameInput = E('input', {
			'type': 'text',
			'id': 'hs_new_username',
			'class': 'cbi-input-text',
			'placeholder': 'alice, bob, family, work',
			'style': 'width:240px;margin-right:8px;',
			'keydown': function(ev) {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					handleAddUser();
				}
			}
		});

		self.tableElement = E('table', { 'class': 'table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('ID') ]),
				E('th', { 'class': 'th' }, [ _('Username') ]),
				E('th', { 'class': 'th center', 'style': 'width:200px;' }, [ _('Created At') ]),
				E('th', { 'class': 'th center nowrap cbi-section-actions', 'style': 'width:120px;' }, [ _('Actions') ])
			])
		]);

		self.renderTableRows();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Users') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Manage Headscale users (namespaces) for segmenting registered nodes and generating authentication keys.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Create New User') ]),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Username') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							nameInput,
							E('button', {
								'class': 'btn cbi-button cbi-button-action',
								'click': handleAddUser
							}, [ _('Create User') ])
						])
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Existing Users') ]),
				self.tableElement
			])
		]);
	},

	handleSave: function(ev) {
		var self = this;
		var tasks = [];

		Object.keys(self.stagedDeletions).forEach(function(uName) {
			tasks.push(callDeleteUser(uName));
		});

		self.stagedCreations.forEach(function(uName) {
			tasks.push(callCreateUser(uName));
		});

		return Promise.all(tasks).then(function(results) {
			(results || []).forEach(function(res) {
				if (res && res.code && res.code !== 0) {
					ui.addNotification(null, E('p', {}, [ _('Operation failed: ') + (res.message || _('Unknown error')) ]), 'danger');
				}
			});
			self.stagedCreations = [];
			self.stagedDeletions = {};
			self.markUciChanged();
			return uci.save().then(function() {
				return callListUsers().then(function(data) {
					self.rawUsers = Array.isArray(data) ? data : ((data && data.users) ? data.users : []);
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
		this.stagedCreations = [];
		this.stagedDeletions = {};
		this.renderTableRows();
		return uci.unload('headscale');
	}
});
