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

var callListKeys = rpc.declare({
	object: 'luci.headscale',
	method: 'list_preauthkeys',
	expect: { keys: [] }
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
 * pending key operations which only take effect on "Save & Apply". */
var STAGING_OPT = '_preauthkeys_pending';

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

function getKeyTime(k) {
	if (!k) return 0;
	var t = k.created_at || k.createdAt;
	var d = parseTimestamp(t);
	if (d) return d.getTime();
	var idNum = parseInt(k.id, 10);
	if (!isNaN(idNum)) return idNum * 1000;
	return 0;
}

function formatDateTime(t) {
	var d = parseTimestamp(t);
	if (!d) return _('Never');
	var pad = function(n) { return (n < 10 ? '0' : '') + n; };
	return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function maskKey(key) {
	if (!key || typeof key !== 'string' || key === '-') return '-';
	if (key.length <= 14) {
		return key.substring(0, 3) + '****' + key.substring(key.length - 3);
	}
	var prefix = '';
	var rest = key;
	if (key.indexOf('hskey-auth-') === 0) {
		prefix = 'hskey-auth-';
		rest = key.substring(11);
	}
	if (rest.length <= 12) {
		return prefix + rest.substring(0, 3) + '******' + rest.substring(rest.length - 3);
	}
	return prefix + rest.substring(0, 6) + '****************' + rest.substring(rest.length - 5);
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
		return E('span', { 'class': 'badge label' }, [ _('No') ]);
	}
}

return view.extend({
	rawKeys: [],
	pendingOps: [],
	recentlyGeneratedKeys: {},
	tableElement: null,
	hintElement: null,
	isRunning: true,

	load: function() {
		return Promise.all([
			callListUsers(),
			callListKeys(),
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
						return op && op.uid != null && (
							(op.op === 'create' && op.user && op.expiration) ||
							(op.op === 'expire' && (op.key || op.id))
						);
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
		return callClearStaging('preauthkeys').then(function() {
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
		var serverUrl = uci.get('headscale', 'server', 'server_url') || 'http://192.168.1.1:8188';

		var copyKeyLabel = _('Copy Key');
		var copyCmdLabel = _('Copy Join Command');
		var fullKeyBadgeLabel = _('Full Key');

		// 1. 渲染待生成的暂存 Key 行（仅在"保存并应用"后由服务真正生成）
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
				E('strong', {}, [ op.user ]),
				E('div', {}, [
					E('em', { 'style': 'color:#2b6cb0;' }, [ _('(Generated on Save & Apply)') ]),
					' ',
					E('span', { 'class': 'badge label warning', 'style': 'font-size:11px;' }, [ _('To Create') ])
				]),
				E('div', { 'class': 'center' }, [ renderYesNoBadge(op.reusable, 'success') ]),
				E('div', { 'class': 'center' }, [ renderYesNoBadge(op.ephemeral, 'info') ]),
				E('div', { 'class': 'center' }, [ renderYesNoBadge(false) ]),
				E('div', { 'class': 'center' }, [ op.expiration ]),
				E('div', { 'class': 'center' }, [ E('span', { 'class': 'badge label warning' }, [ _('Pending') ]) ]),
				E('div', { 'class': 'center' }, [ undoBtn ])
			]);
		});

		// 2. 渲染现有 Keys：有效优先，且按时间从近到远（最新在上）向下排列
		if (self.rawKeys && self.rawKeys.length > 0) {
			var isStagedExpire = function(k, keyStr) {
				return self.pendingOps.filter(function(o) {
					return o.op === 'expire' && (
						(k.id != null && o.id != null && String(o.id) === String(k.id)) ||
						(o.key && o.key === keyStr)
					);
				})[0];
			};

			var sortedKeys = self.rawKeys.slice().sort(function(a, b) {
				var aKeyStr = a.key || (a.id ? a.id.toString() : '');
				var aIsRevoked = (isStagedExpire(a, aKeyStr) != null);
				var aIsExpired = isExpiredKey(a.expiration) || aIsRevoked || a.used;

				var bKeyStr = b.key || (b.id ? b.id.toString() : '');
				var bIsRevoked = (isStagedExpire(b, bKeyStr) != null);
				var bIsExpired = isExpiredKey(b.expiration) || bIsRevoked || b.used;

				// 1. 有效排前面，已失效排后面
				if (!aIsExpired && bIsExpired) return -1;
				if (aIsExpired && !bIsExpired) return 1;

				// 2. 同状态下，按创建时间从近到远（新 -> 旧）排列
				var timeA = getKeyTime(a);
				var timeB = getKeyTime(b);
				if (timeA !== timeB) {
					return timeB - timeA;
				}

				// 3. ID 降序兜底
				var idA = parseInt(a.id || 0, 10);
				var idB = parseInt(b.id || 0, 10);
				return idB - idA;
			});
			sortedKeys.forEach(function(k) {
				var uName = (k.user && k.user.name) ? k.user.name : (k.user || '-');
				var keyStr = k.key || (k.id ? k.id.toString() : '-');
				var keyId = k.id ? k.id.toString() : keyStr;
				var expireOp = isStagedExpire(k, keyStr);
				var isMarkedRevoke = (expireOp != null);
				var isExpired = isExpiredKey(k.expiration) || isMarkedRevoke || k.used;
				var expText = formatDateTime(k.expiration);

				var fullGenKey = k.full_key || self.recentlyGeneratedKeys[keyId] || self.recentlyGeneratedKeys[keyStr];

				var keyDisplayCell = null;
				if (fullGenKey) {
					var joinCmd = 'tailscale up --login-server ' + serverUrl + ' --auth-key ' + fullGenKey;

					var copyKeyBtn = E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'style': 'padding:1px 8px;font-size:11px;width:auto;',
						'click': function(ev) {
							copyToClipboard(fullGenKey, ev.currentTarget);
						}
					}, [ copyKeyLabel ]);

					var copyCmdBtn = E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:1px 8px;font-size:11px;width:auto;',
						'click': function(ev) {
							copyToClipboard(joinCmd, ev.currentTarget);
						}
					}, [ copyCmdLabel ]);

					keyDisplayCell = E('div', {}, [
						E('div', { 'style': 'font-family:monospace;font-size:12px;color:#1e293b;margin-bottom:6px;word-break:break-all;' }, [
							E('span', { 'class': 'badge label success', 'style': 'font-size:10px;margin-right:6px;' }, [ fullKeyBadgeLabel ]),
							E('span', { 'style': 'letter-spacing:0.5px;' }, [ maskKey(fullGenKey) ])
						]),
						E('div', { 'style': 'display:flex;gap:6px;' }, [
							copyKeyBtn,
							copyCmdBtn
						])
					]);
				} else {
					var rawKey = keyStr;
					var isShortKey = (rawKey && rawKey.length > 0 && rawKey !== '-');
					var joinCmd = isShortKey ? ('tailscale up --login-server ' + serverUrl + ' --auth-key ' + rawKey) : '';

					var btns = [];
					if (isShortKey) {
						btns.push(E('button', {
							'class': 'btn cbi-button cbi-button-action',
							'style': 'padding:1px 8px;font-size:11px;width:auto;',
							'click': function(ev) {
								copyToClipboard(rawKey, ev.currentTarget);
							}
						}, [ copyKeyLabel ]));
						btns.push(E('button', {
							'class': 'btn cbi-button cbi-button-neutral',
							'style': 'padding:1px 8px;font-size:11px;width:auto;',
							'click': function(ev) {
								copyToClipboard(joinCmd, ev.currentTarget);
							}
						}, [ copyCmdLabel ]));
					}

					keyDisplayCell = E('div', {}, [
						E('div', { 'style': 'font-family:monospace;font-size:12px;color:#64748b;margin-bottom:4px;' }, [
							maskKey(keyStr)
						]),
						btns.length > 0 ? E('div', { 'style': 'display:flex;gap:6px;' }, btns) : null
					]);
				}

				var statusBadge = isExpired ?
					E('span', { 'class': 'badge label', 'style': 'background:#94a3b8;color:#fff;' }, [ _('Expired / Used') ]) :
					E('span', { 'class': 'badge label success' }, [ _('Valid') ]);

				var actBtn = isMarkedRevoke ?
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function(ev) {
							ev.preventDefault();
							self.removeOp(expireOp.uid);
						}
					}, [ _('Undo') ]) :
					(isExpired ? E('span', { 'style': 'color:#a0aec0;font-size:12px;' }, [ '-' ]) :
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'style': 'padding:2px 10px;font-size:12px;display:inline-block;width:auto;margin:0;',
						'click': function(ev) {
							ev.preventDefault();
							self.clearHint();
							if (isStagedExpire(k, keyStr)) return;
							self.addOp({ op: 'expire', user: uName, key: keyStr, id: (k.id != null ? k.id.toString() : '') });
						}
					}, [ _('Expire') ]));

				rows.push([
					E('div', { 'class': 'center' }, [ (k.id || '-').toString() ]),
					E('strong', {}, [ uName ]),
					keyDisplayCell,
					E('div', { 'class': 'center' }, [ renderYesNoBadge(k.reusable, 'success') ]),
					E('div', { 'class': 'center' }, [ renderYesNoBadge(k.ephemeral, 'info') ]),
					E('div', { 'class': 'center' }, [ renderYesNoBadge(k.used, 'warning') ]),
					E('div', { 'class': 'center' }, [ expText ]),
					E('div', { 'class': 'center' }, [ statusBadge ]),
					E('div', { 'class': 'center' }, [ actBtn ])
				]);
			});
		}

		var emptyMsg = self.isRunning ?
			_('No pre-auth keys found.') :
			_('Headscale service is not running, unable to fetch pre-auth keys.');
		cbi_update_table(self.tableElement, rows, E('em', { 'style': !self.isRunning ? 'color:#a0aec0;' : '' }, [ emptyMsg ]));
	},

	render: function(data) {
		var self = this;
		var rawUsers = data[0];
		var rawKeys = data[1];
		var status = data[3] || {};
		self.isRunning = (status.running === true || status.running === 1);
		var users = Array.isArray(rawUsers) ? rawUsers : ((rawUsers && rawUsers.users) ? rawUsers.users : []);
		self.rawKeys = Array.isArray(rawKeys) ? rawKeys : ((rawKeys && rawKeys.keys) ? rawKeys.keys : []);
		self.syncFromUCI();

		self.hintElement = E('div', {
			'style': 'margin-top:10px;font-size:13px;color:#dc2626;display:none;'
		}, []);

		var userOptions = [];
		if (!self.isRunning) {
			userOptions.push(E('option', { 'value': '', 'disabled': 'disabled', 'selected': 'selected' }, [ _('-- Service not running, no users available --') ]));
		} else if (!users || users.length === 0) {
			userOptions.push(E('option', { 'value': '', 'disabled': 'disabled', 'selected': 'selected' }, [ _('-- No users found (create a user first) --') ]));
		} else {
			users.forEach(function(u) {
				var uName = (typeof u === 'string') ? u : (u.name || u.Name || u.user || u.username || u.id || '');
				if (uName) {
					userOptions.push(E('option', { 'value': uName }, [ uName ]));
				}
			});
		}

		var userSelect = E('select', {
			'id': 'hs_key_user',
			'class': 'cbi-input-select',
			'style': 'width:280px;' + ((!self.isRunning || users.length === 0) ? 'background-color:#f1f5f9 !important;color:#94a3b8 !important;cursor:not-allowed !important;border-color:#cbd5e1 !important;' : ''),
			'disabled': (!self.isRunning || users.length === 0) ? 'disabled' : null
		}, userOptions);

		var reusableInput = E('input', {
			'type': 'checkbox',
			'id': 'hs_key_reusable',
			'class': 'cbi-input-checkbox',
			'checked': 'checked',
			'style': !self.isRunning ? 'cursor:not-allowed !important;' : '',
			'disabled': !self.isRunning ? 'disabled' : null
		});

		var ephemeralInput = E('input', {
			'type': 'checkbox',
			'id': 'hs_key_ephemeral',
			'class': 'cbi-input-checkbox',
			'style': !self.isRunning ? 'cursor:not-allowed !important;' : '',
			'disabled': !self.isRunning ? 'disabled' : null
		});

		var expirationInput = E('input', {
			'type': 'text',
			'id': 'hs_key_expiration',
			'class': 'cbi-input-text',
			'value': '24h',
			'placeholder': self.isRunning ? '24h, 720h, 8760h' : _('Service not running'),
			'disabled': !self.isRunning ? 'disabled' : null,
			'style': 'width:180px;' + (!self.isRunning ? 'background-color:#f1f5f9 !important;color:#94a3b8 !important;cursor:not-allowed !important;border-color:#cbd5e1 !important;' : '')
		});

		var handleAddKey = function() {
			if (!self.isRunning) return;
			var userSelectElem = document.getElementById('hs_key_user');
			var uName = userSelectElem ? userSelectElem.value : '';
			if (!uName) return;
			var reusable = document.getElementById('hs_key_reusable').checked;
			var ephemeral = document.getElementById('hs_key_ephemeral').checked;
			var expiration = document.getElementById('hs_key_expiration').value.trim() || '24h';

			if (!/^([0-9]+(s|m|h|d))+$/i.test(expiration)) {
				self.showHint(_('Invalid expiration format. Examples: 1h, 24h, 720h (30 days).'));
				return;
			}

			self.clearHint();
			self.addOp({
				op: 'create',
				user: uName,
				reusable: reusable,
				ephemeral: ephemeral,
				expiration: expiration
			});
		};

		var addBtn = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'disabled': (!self.isRunning || users.length === 0) ? 'disabled' : null,
			'title': !self.isRunning ? _('Headscale service is not running') : (users.length === 0 ? _('Create a user first') : ''),
			'style': ((!self.isRunning || users.length === 0) ? 'opacity:0.5 !important;cursor:not-allowed !important;pointer-events:none !important;' : ''),
			'click': handleAddKey
		}, [ _('Add') ]);

		self.tableElement = E('table', { 'class': 'table', 'style': 'width:100%;' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th center', 'style': 'width:50px;' }, [ _('ID') ]),
				E('th', { 'class': 'th', 'style': 'width:110px;' }, [ _('User') ]),
				E('th', { 'class': 'th', 'style': 'width:300px;' }, [ _('Key & Registration Command') ]),
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('Reusable') ]),
				E('th', { 'class': 'th center', 'style': 'width:80px;' }, [ _('Ephemeral') ]),
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('Used') ]),
				E('th', { 'class': 'th center', 'style': 'width:140px;' }, [ _('Expiration') ]),
				E('th', { 'class': 'th center', 'style': 'width:70px;' }, [ _('Status') ]),
				E('th', { 'class': 'th center nowrap cbi-section-actions', 'style': 'width:90px;' }, [ _('Action') ])
			])
		]);

		self.renderTableRows();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Pre-Auth Keys') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Create and manage pre-authentication keys for client registration without interactive login.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Create Pre-Auth Key') ]),
				E('div', { 'class': 'cbi-section-descr' }, [
					_('Pre-auth keys allow automated non-interactive login. Generated keys and commands are securely stored below.')
				]),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('User') ]),
						E('div', { 'class': 'cbi-value-field' }, [ userSelect ])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Reusable') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							reusableInput,
							E('label', { 'for': 'hs_key_reusable', 'style': 'margin-left:6px;' }, [ _('Allow this key to be used more than once.') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Ephemeral Node') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							ephemeralInput,
							E('label', { 'for': 'hs_key_ephemeral', 'style': 'margin-left:6px;' }, [ _('Nodes created with this key are automatically removed when disconnected.') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Expiration') ]),
						E('div', { 'class': 'cbi-value-field', 'style': 'display:flex;align-items:center;flex-wrap:wrap;' }, [
							expirationInput,
							E('span', { 'class': 'cbi-value-description', 'style': 'display:inline-flex;align-items:center;margin:0 0 0 1.5em;' }, [ _('Time duration string, e.g. 1h, 24h, 720h (30 days).') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('div', { 'class': 'cbi-value-field' }, [
							addBtn
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('div', { 'class': 'cbi-value-field' }, [ self.hintElement ])
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Pre-Auth Keys List') ]),
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
