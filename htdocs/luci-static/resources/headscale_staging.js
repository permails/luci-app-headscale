/*
 * Cross-page staging executor for luci-app-headscale.
 *
 * The "Unsaved Changes" indicator is global: staged work from the ACL,
 * Users and Pre-Auth Keys pages shares one uci delta. Applying on any
 * page must therefore flush EVERY page's staged operations, not just
 * the current page's queue.
 *
 * Staged work is read from these hidden uci options:
 *   _users_pending        JSON array of user operations
 *   _preauthkeys_pending  JSON array of pre-auth key operations
 *   _acl_content          full ACL policy JSON
 *
 * Execution order is users -> preauthkeys -> acl, so a batch may e.g.
 * create a user and then generate a key for it.
 */

'use strict';
'require baseclass';
'require rpc';
'require uci';
'require ui';

var callCreateUser = rpc.declare({
	object: 'luci.headscale',
	method: 'create_user',
	params: [ 'name' ]
});

var callDeleteUser = rpc.declare({
	object: 'luci.headscale',
	method: 'delete_user',
	params: [ 'name' ]
});

/* NOTE: no "expect" — rpc.js extracts the FIRST expect key only, which
 * would discard the error "message" needed for failure reports. */
var callCreateKey = rpc.declare({
	object: 'luci.headscale',
	method: 'create_preauthkey',
	params: [ 'user', 'reusable', 'ephemeral', 'expiration' ]
});

var callExpireKey = rpc.declare({
	object: 'luci.headscale',
	method: 'expire_preauthkey',
	params: [ 'user', 'key', 'id' ]
});

var callSetACL = rpc.declare({
	object: 'luci.headscale',
	method: 'set_acl',
	params: [ 'content' ]
});

/* Removes a staging option from the uci delta (client-side uci.unset()
 * is a no-op for options that only exist in the staging delta). */
var callClearStaging = rpc.declare({
	object: 'luci.headscale',
	method: 'clear_staging',
	params: [ 'scope' ]
});

return baseclass.extend({
	OPT_USERS: '_users_pending',
	OPT_KEYS: '_preauthkeys_pending',
	OPT_ACL: '_acl_content',

	scopeLabel: function(scope) {
		if (scope === 'users')
			return _('users');
		else if (scope === 'preauthkeys')
			return _('pre-auth keys');
		return _('ACL policy');
	},

	/* Read every page's staged work from the shared uci config. */
	readStaged: function() {
		var staged = { users: [], preauthkeys: [], acl: null };

		var readJson = function(opt) {
			var raw = uci.get('headscale', 'server', opt);
			if (!raw)
				return null;
			try {
				return JSON.parse(raw);
			} catch (e) {
				return null;
			}
		};

		var u = readJson(this.OPT_USERS);
		if (Array.isArray(u))
			staged.users = u.filter(function(op) {
				return op && op.name && (op.op === 'create' || op.op === 'delete');
			});

		var k = readJson(this.OPT_KEYS);
		if (Array.isArray(k))
			staged.preauthkeys = k.filter(function(op) {
				return op && ((op.op === 'create' && op.user && op.expiration) ||
				              (op.op === 'expire' && (op.key || op.id)));
			});

		var a = readJson(this.OPT_ACL);
		if (a && Array.isArray(a.acls))
			staged.acl = a;

		return staged;
	},

	hasStaged: function() {
		var s = this.readStaged();
		return (s.users.length > 0 || s.preauthkeys.length > 0 || s.acl != null);
	},

	runUserOp: function(op) {
		return (op.op === 'create') ? callCreateUser(op.name) : callDeleteUser(op.name);
	},

	runKeyOp: function(op) {
		if (op.op === 'create')
			return callCreateKey(op.user, op.reusable, op.ephemeral, op.expiration);

		return callExpireKey(op.user, op.key, op.id);
	},

	/* Execute the staged work of ALL pages, in dependency order.
	 * Fails fast; the rejection carries err.plan (the full execution
	 * plan) and err.appliedCount (operations that already succeeded)
	 * so the caller can restage the not-executed remainder. */
	executeAll: function() {
		var self = this;
		var staged = self.readStaged();
		var plan = [];

		staged.users.forEach(function(op) {
			plan.push({ scope: 'users', op: op });
		});
		staged.preauthkeys.forEach(function(op) {
			plan.push({ scope: 'preauthkeys', op: op });
		});
		if (staged.acl)
			plan.push({ scope: 'acl' });

		if (plan.length === 0)
			return Promise.resolve({ executed: false });

		var appliedCount = 0;
		var chain = Promise.resolve();

		plan.forEach(function(item) {
			chain = chain.then(function() {
				var p;

				if (item.scope === 'users')
					p = self.runUserOp(item.op);
				else if (item.scope === 'preauthkeys')
					p = self.runKeyOp(item.op);
				else
					p = callSetACL(JSON.stringify(staged.acl, null, 2));

				return p.then(function(res) {
					if (!res || res.code != 0) {
						var err = new Error((res && res.message) ? res.message : _('Unknown error'));
						err.appliedCount = appliedCount;
						err.scope = item.scope;
						err.plan = plan;
						throw err;
					}
					appliedCount++;
				}).catch(function(e) {
					/* Normalize transport-level rejections, too. */
					if (e && e.plan)
						throw e;
					var err = new Error((e && e.message) ? e.message : (e || _('Unknown error')));
					err.appliedCount = appliedCount;
					err.scope = item.scope;
					err.plan = plan;
					throw err;
				});
			});
		});

		return chain.then(function() {
			return { executed: true };
		});
	},

	/* After a partial failure, write the not-executed remainder back
	 * into the per-page staging options so a retry resumes cleanly.
	 * Re-syncs the browser-side uci tree afterwards, since cleared
	 * options only vanish server-side. */
	restageRemaining: function(err) {
		var self = this;
		var rem = { users: [], keys: [] };
		var tasks = [];

		(err.plan || []).slice(err.appliedCount || 0).forEach(function(item) {
			if (item.scope === 'users')
				rem.users.push(item.op);
			else if (item.scope === 'preauthkeys')
				rem.keys.push(item.op);
			/* scope 'acl': its staging option is still intact — execution
			 * never modifies the staging options themselves. */
		});

		if (rem.users.length > 0)
			uci.set('headscale', 'server', self.OPT_USERS, JSON.stringify(rem.users));
		else
			tasks.push(callClearStaging('users'));

		if (rem.keys.length > 0)
			uci.set('headscale', 'server', self.OPT_KEYS, JSON.stringify(rem.keys));
		else
			tasks.push(callClearStaging('preauthkeys'));

		return Promise.all(tasks).then(function() {
			return uci.save();
		}).then(function() {
			uci.unload('headscale');
			return uci.load('headscale');
		}).then(function() {
			ui.changes.init();
		});
	}
});
