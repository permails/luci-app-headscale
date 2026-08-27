/*
 * Copyright (C) 2026 permails <logo@permails.com>
 *
 * This is free software, licensed under the Apache License, Version 2.0.
 */

'use strict';
'require view';
'require form';
'require uci';
'require rpc';

var callSetFirewall = rpc.declare({
	object: 'luci.headscale',
	method: 'set_firewall',
	params: [ 'enabled', 'port', 'stun_port' ],
	expect: { code: 0 }
});

var callDetectCerts = rpc.declare({
	object: 'luci.headscale',
	method: 'detect_certs',
	expect: { found: false, type: 'none', cert: '', key: '' }
});

return view.extend({
	load: function() {
		return Promise.all([
			callDetectCerts()
		]);
	},

	render: function(data) {
		var certInfo = data[0] || {};
		var m, s, o;

		m = new form.Map('headscale', _('Headscale - Settings'),
			_('Configure Headscale coordination server options, IP allocation, MagicDNS, and DERP relays.'));

		// Tabbed Section
		s = m.section(form.NamedSection, 'server', 'headscale', _('General Settings'));
		s.tab('general', _('General'));
		s.tab('ip_prefixes', _('IP Allocation'));
		s.tab('dns', _('MagicDNS'));
		s.tab('derp', _('DERP Relay'));
		s.tab('tls', _('TLS / Security'));
		s.tab('log', _('Logging'));

		// ------------------- General Tab -------------------
		o = s.taboption('general', form.Flag, 'enabled', _('Enable Headscale Service'),
			_('Enable or disable the Headscale background daemon.'));
		o.rmempty = false;

		o = s.taboption('general', form.Flag, 'open_firewall', _('Open Firewall Port'),
			_('Automatically open WAN firewall port (TCP 8188) to allow external devices to connect.'));
		o.default = '0';
		o.write = function(section_id, formvalue) {
			uci.set('headscale', section_id, 'open_firewall', formvalue);
			var listenAddr = this.section.formvalue(section_id, 'listen_addr') || uci.get('headscale', section_id, 'listen_addr') || '0.0.0.0:8188';
			var listenPort = (listenAddr.indexOf(':') !== -1) ? listenAddr.split(':').pop() : '8188';
			var stunAddr = uci.get('headscale', 'derp', 'stun_listen_addr') || '0.0.0.0:3478';
			var stunPort = (stunAddr.indexOf(':') !== -1) ? stunAddr.split(':').pop() : '3478';
			return callSetFirewall(formvalue === '1', listenPort, stunPort);
		};

		o = s.taboption('general', form.Value, 'server_url', _('Server URL'),
			_('The URL clients will connect to. Example: http://192.168.1.1:8188 or https://headscale.example.com') + (certInfo.domain ? (' (' + _('Detected SSL Domain: ') + certInfo.domain + ')') : ''));
		o.placeholder = certInfo.domain ? ('https://' + certInfo.domain + ':8188') : 'http://192.168.1.1:8188';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'listen_addr', _('Listen Address'),
			_('Address and port to bind the Headscale HTTP server.'));
		o.placeholder = '0.0.0.0:8188';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'metrics_listen_addr', _('Metrics Listen Address'),
			_('Address for Prometheus metrics endpoint (/metrics). Leave empty to disable.'));
		o.placeholder = '127.0.0.1:9090';

		o = s.taboption('general', form.Value, 'grpc_listen_addr', _('gRPC Listen Address'),
			_('Address for internal CLI and gRPC communications.'));
		o.placeholder = '127.0.0.1:50443';

		o = s.taboption('general', form.ListValue, 'log_level', _('Log Level'),
			_('Verbosity level of the system logs.'));
		o.value('trace', _('Trace (Detailed)'));
		o.value('debug', _('Debug'));
		o.value('info', _('Info (Standard)'));
		o.value('warn', _('Warn'));
		o.value('error', _('Error'));
		o.default = 'info';

		o = s.taboption('general', form.ListValue, 'log_format', _('Log Format'),
			_('Output format for log entries.'));
		o.value('text', _('Plain Text'));
		o.value('json', _('JSON'));
		o.default = 'text';

		o = s.taboption('general', form.Value, 'ephemeral_timeout', _('Ephemeral Node Inactivity Timeout'),
			_('Timeout after which inactive ephemeral nodes are automatically deleted (e.g. 30m, 1h).'));
		o.placeholder = '30m';
		o.default = '30m';

		// ------------------- IP Allocation Tab -------------------
		o = s.taboption('ip_prefixes', form.Value, 'v4', _('IPv4 Overlay Prefix'),
			_('Virtual IPv4 subnet pool allocated to Tailscale nodes. Default 100.64.0.0/10.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'ip_prefixes';
		o.placeholder = '100.64.0.0/10';
		o.default = '100.64.0.0/10';
		o.datatype = 'cidr4';

		o = s.taboption('ip_prefixes', form.Value, 'v6', _('IPv6 Overlay Prefix'),
			_('Virtual IPv6 subnet pool allocated to Tailscale nodes. Default fd7a:115c:a1e0::/48.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'ip_prefixes';
		o.placeholder = 'fd7a:115c:a1e0::/48';
		o.default = 'fd7a:115c:a1e0::/48';
		o.datatype = 'cidr6';

		o = s.taboption('ip_prefixes', form.ListValue, 'allocation', _('IP Allocation Strategy'),
			_('Strategy for assigning virtual IP addresses to new nodes.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'ip_prefixes';
		o.value('sequential', _('Sequential'));
		o.value('random', _('Random (Recommended)'));
		o.default = 'sequential';

		// ------------------- MagicDNS Tab -------------------
		o = s.taboption('dns', form.Flag, 'magic_dns', _('Enable MagicDNS'),
			_('Automatically register node hostnames as reachable DNS records.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'dns';
		o.default = '1';

		o = s.taboption('dns', form.Value, 'base_domain', _('Base Domain'),
			_('Domain suffix used for MagicDNS (e.g. example.com or home.internal).'));
		o.uciconfig = 'headscale';
		o.ucisection = 'dns';
		o.placeholder = 'example.com';
		o.default = 'example.com';
		o.depends('magic_dns', '1');

		o = s.taboption('dns', form.DynamicList, 'nameservers', _('Upstream Nameservers'),
			_('DNS resolvers pushed to connected Tailscale clients (e.g. 223.5.5.5, 119.29.29.29, 1.1.1.1).'));
		o.uciconfig = 'headscale';
		o.ucisection = 'dns';
		o.placeholder = '223.5.5.5';

		o = s.taboption('dns', form.DynamicList, 'search_domains', _('Search Domains'),
			_('Custom search domains pushed to Tailscale clients.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'dns';

		// ------------------- DERP Relay Tab -------------------
		o = s.taboption('derp', form.Flag, 'embedded_enabled', _('Enable Embedded DERP Server'),
			_('Run an embedded DERP relay on this router for NAT traversal.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.default = '0';

		o = s.taboption('derp', form.Value, 'stun_listen_addr', _('STUN Listen Address'),
			_('UDP address for STUN NAT discovery.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.placeholder = '0.0.0.0:3478';
		o.default = '0.0.0.0:3478';
		o.depends('embedded_enabled', '1');

		o = s.taboption('derp', form.Value, 'region_id', _('DERP Region ID'),
			_('Numeric ID for embedded DERP region (default 999).'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.placeholder = '999';
		o.default = '999';
		o.depends('embedded_enabled', '1');

		o = s.taboption('derp', form.Value, 'region_name', _('DERP Region Name'),
			_('Human-readable name for embedded DERP region.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.placeholder = 'Headscale Embedded DERP';
		o.depends('embedded_enabled', '1');

		o = s.taboption('derp', form.Flag, 'verify_clients', _('Verify Clients'),
			_('Only allow nodes registered on this Headscale server to use the relay.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.default = '1';
		o.depends('embedded_enabled', '1');

		o = s.taboption('derp', form.Flag, 'auto_update_enabled', _('Auto Update Public DERP List'),
			_('Periodically fetch updated public DERP server maps from official Tailscale servers.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.default = '1';

		o = s.taboption('derp', form.Value, 'update_frequency', _('Update Frequency'),
			_('Frequency for updating public DERP map list (default 24h).'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';
		o.placeholder = '24h';
		o.default = '24h';

		o = s.taboption('derp', form.DynamicList, 'urls', _('External DERP Map URLs'),
			_('URLs to fetch external DERP map definitions.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'derp';

		// ------------------- TLS / Security Tab -------------------
		var certStatusDesc = certInfo.found ?
			(_('Detected system SSL certificate: ') + certInfo.cert + ' (' + certInfo.key + ')') :
			_('No system SSL certificate detected at default paths (/etc/uhttpd.crt).');

		o = s.taboption('tls', form.Flag, 'use_system_cert', _('Use System Web SSL Certificate (uhttpd / Nginx)'),
			certStatusDesc + ' ' + _('When HTTPS is enabled, automatically use router system certificates.'));
		o.default = certInfo.found ? '1' : '0';

		o = s.taboption('tls', form.Value, 'tls_cert_path', _('Custom TLS Certificate Path'),
			_('Absolute path to TLS certificate file (.crt / .pem). Leave empty to use system cert.'));
		o.placeholder = certInfo.found ? certInfo.cert : '/etc/headscale/tls.crt';
		o.depends('use_system_cert', '0');

		o = s.taboption('tls', form.Value, 'tls_key_path', _('Custom TLS Key Path'),
			_('Absolute path to TLS private key file (.key). Leave empty to use system key.'));
		o.placeholder = certInfo.found ? certInfo.key : '/etc/headscale/tls.key';
		o.depends('use_system_cert', '0');

		// ------------------- Log Tab -------------------
		o = s.taboption('log', form.ListValue, 'level', _('Log Level'),
			_('Verbosity of the daemon log (Set to Debug when troubleshooting).'));
		o.uciconfig = 'headscale';
		o.ucisection = 'log';
		o.value('debug', _('Debug (Detailed)'));
		o.value('info', _('Info (Standard)'));
		o.value('warn', _('Warn (Warnings Only)'));
		o.value('error', _('Error (Errors Only)'));
		o.default = 'info';

		o = s.taboption('log', form.ListValue, 'format', _('Log Format'),
			_('Format of daemon logs.'));
		o.uciconfig = 'headscale';
		o.ucisection = 'log';
		o.value('text', _('Plain Text'));
		o.value('json', _('JSON (Structured Data)'));
		o.default = 'text';

		return m.render();
	}
});
