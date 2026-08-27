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
'require headscale_staging';

var callListUsers = rpc.declare({
	object: 'luci.headscale',
	method: 'list_users',
	expect: { users: [] }
});

/* Wipes the given staging option from the uci delta. Client-side
 * uci.unset() is a no-op for options that only exist in the staging
 * delta (never committed), so removal must happen on the backend. */
var callClearStaging = rpc.declare({
	object: 'luci.headscale',
	method: 'clear_staging',
	params: [ 'scope' ]
});

var callGetStatus = rpc.declare({
	object: 'luci.headscale',
	method: 'get_status',
	expect: { }
});

/* UCI option (in the headscale staging delta) holding the JSON array of
 * pending user operations which only take effect on "Save & Apply". */
var STAGING_OPT = '_users_pending';

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
	pendingOps: [],
	tableElement: null,
	hintElement: null,
	isRunning: true,

	load: function() {
		return Promise.all([
			callListUsers(),
			uci.load('headscale'),
			callGetStatus()
		]);
	},

	syncFromUCI: function() {
		var self = this;
		var ops = [];
		var raw = uci.get('headscale', 'server', STAGING_OPT);
		if (raw) {
			try {
				var parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					ops = parsed.filter(function(op) {
						return op && op.uid != null && op.name &&
							(op.op === 'create' || op.op === 'delete');
					});
				}
			} catch (e) {}
		}
		self.pendingOps = ops;
	},

	/* Persist the current pending operations into the uci staging delta
	 * (this is what makes the "Unsaved Changes" indicator appear). When
	 * the list becomes empty the staged option must be wiped on the
	 * backend, since uci.unset() cannot remove staging-only options. */
	stageOps: function() {
		var self = this;
		if (self.pendingOps.length > 0) {
			uci.set('headscale', 'server', STAGING_OPT, JSON.stringify(self.pendingOps));
			return uci.save().then(function() { ui.changes.init(); });
		}
		return callClearStaging('users').then(function() {
			uci.unload('headscale');
			return uci.load('headscale');
		}).then(function() { ui.changes.init(); });
	},

	newOpId: function() {
		return Date.now().toString(36) + Math.floor(Math.random() * 65536).toString(36);
	},

	addOp: function(op) {
		var self = this;
		op.uid = self.newOpId();
		self.pendingOps.push(op);
		return self.stageOps().then(function() { self.renderTableRows(); });
	},

	removeOp: function(uid) {
		var self = this;
		self.pendingOps = self.pendingOps.filter(function(o) { return o.uid !== uid; });
		return self.stageOps().then(function() { self.renderTableRows(); });
	},

	showHint: function(msg) {
		if (this.hintElement) {
			this.hintElement.style.display = 'block';
			this.hintElement.textContent = msg;
		}
	},

	clearHint: function() {
		if (this.hintElement) {
			this.hintElement.style.display = 'none';
			this.hintElement.textContent = '';
		}
	},

	renderTableRows: function() {
		var self = this;
		if (!self.tableElement) return;
		var rows = [];

		// 1. 渲染待创建的暂存用户（仅在"保存并应用"后生效）
		self.pendingOps.forEach(function(op) {
			if (op.op !== 'create') return;

			var undoBtn = E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
				'click': function(ev) {
					ev.preventDefault();
					self.removeOp(op.uid);
				}
			}, [ _('Undo') ]);

			rows.push([
				E('div', { 'class': 'center' }, [ E('span', { 'class': 'badge label warning' }, [ _('Pending') ]) ]),
				E('div', {}, [
					E('strong', { 'style': 'color:#2b6cb0;' }, [ op.name ]),
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
				var uName = (typeof u === 'string') ? u : (u.name || u.Name || u.user || u.username || u.id || '-');
				var uId = (typeof u === 'object' && u.id) ? u.id.toString() : '-';
				var uCreatedAt = (typeof u === 'object') ? (u.created_at || u.createdAt) : null;
				var deleteOp = self.pendingOps.filter(function(o) {
					return o.op === 'delete' && o.name === uName;
				})[0];
				var isMarkedDelete = !!deleteOp;

				var actBtn = isMarkedDelete ?
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function(ev) {
							ev.preventDefault();
							self.removeOp(deleteOp.uid);
						}
					}, [ _('Undo') ]) :
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function(ev) {
							ev.preventDefault();
							self.clearHint();
							self.addOp({ op: 'delete', name: uName });
						}
					}, [ _('Delete') ]);

				var nameCell = isMarkedDelete ?
					E('div', { 'style': 'text-decoration:line-through;color:#a0aec0;' }, [
						E('strong', {}, [ uName ]),
						' ',
						E('span', { 'class': 'badge label danger', 'style': 'font-size:11px;' }, [ _('To Delete') ])
					]) :
					E('strong', {}, [ uName ]);

				rows.push([
					E('div', { 'class': 'center' }, [ uId ]),
					nameCell,
					E('div', { 'class': 'center', 'style': isMarkedDelete ? 'text-decoration:line-through;color:#a0aec0;' : '' }, [
						formatDateTime(uCreatedAt)
					]),
					E('div', { 'class': 'center' }, [ actBtn ])
				]);
			});
		}

		var emptyMsg = self.isRunning ?
			_('No users found. Create a user above to get started.') :
			_('Headscale service is not running, unable to fetch user list.');
		cbi_update_table(self.tableElement, rows, E('em', { 'style': !self.isRunning ? 'color:#a0aec0;' : '' }, [ emptyMsg ]));
	},

	render: function(data) {
		var self = this;
		var rawUsers = data[0];
		var status = data[2] || {};
		self.isRunning = (status.running === true || status.running === 1);
		self.rawUsers = Array.isArray(rawUsers) ? rawUsers : ((rawUsers && rawUsers.users) ? rawUsers.users : []);
		self.syncFromUCI();

		self.hintElement = E('div', {
			'style': 'margin-top:10px;font-size:13px;color:#dc2626;display:none;'
		}, []);

		var handleAddUser = function() {
			if (!self.isRunning) return;
			var nameInput = document.getElementById('hs_new_username');
			var name = nameInput ? nameInput.value.trim() : '';

			if (!name) {
				self.showHint(_('Please enter a username.'));
				return;
			}
			if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
				self.showHint(_('Username may only contain letters, digits, ".", "-" and "_", and must start with a letter or digit.'));
				return;
			}
			var exists = (self.rawUsers || []).some(function(u) {
				return u === name || (u && typeof u === 'object' && (u.name === name || u.username === name));
			});
			if (exists) {
				self.showHint(_('A user with this name already exists.'));
				return;
			}
			if (self.pendingOps.some(function(o) { return o.op === 'create' && o.name === name; })) {
				self.showHint(_('This user is already staged for creation.'));
				return;
			}

			self.clearHint();
			if (nameInput) nameInput.value = '';
			self.addOp({ op: 'create', name: name });
		};

		var nameInput = E('input', {
			'type': 'text',
			'id': 'hs_new_username',
			'class': 'cbi-input-text',
			'placeholder': self.isRunning ? 'alice, bob, family, work' : _('Service not running, unable to create user'),
			'disabled': !self.isRunning ? 'disabled' : null,
			'style': 'width:280px;margin-right:8px;' + (!self.isRunning ? 'background-color:#f1f5f9 !important;color:#94a3b8 !important;cursor:not-allowed !important;border-color:#cbd5e1 !important;' : ''),
			'keydown': function(ev) {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					handleAddUser();
				}
			}
		});

		var createBtn = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'disabled': !self.isRunning ? 'disabled' : null,
			'title': !self.isRunning ? _('Headscale service is not running') : '',
			'style': (!self.isRunning ? 'opacity:0.5 !important;cursor:not-allowed !important;pointer-events:none !important;' : ''),
			'click': self.isRunning ? handleAddUser : null
		}, [ _('Create User') ]);

		self.tableElement = E('table', { 'class': 'table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('ID') ]),
				E('th', { 'class': 'th' }, [ _('Username') ]),
				E('th', { 'class': 'th center', 'style': 'width:200px;' }, [ _('Created At') ]),
				E('th', { 'class': 'th center nowrap cbi-section-actions', 'style': 'width:120px;' }, [ _('Action') ])
			])
		]);

		self.renderTableRows();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Users') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Manage Headscale users (namespaces) to isolate nodes and generate credentials.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Create New User') ]),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Username') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							nameInput,
							createBtn
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('div', { 'class': 'cbi-value-field' }, [ self.hintElement ])
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
		if (ev && ev.preventDefault) ev.preventDefault();
		// Save only: keep the staged operations pending, do not apply
		// anything to the headscale service.
		return self.stageOps();
	},

	handleSaveApply: function(ev, mode) {
		var self = this;
		if (ev && ev.preventDefault) ev.preventDefault();

		return self.stageOps().then(function() {
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
					self.renderTableRows();
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
					// (incl. the staged operations). ui.js reloads the page
					// once the revert completed; revert() itself does not
					// return a promise, so there is nothing to chain on.
					ui.changes.revert();
				}
			}, [ _('Restore') ])
		]);
	}
});
