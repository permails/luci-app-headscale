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
'require uci';

var callGetStatus = rpc.declare({
	object: 'luci.headscale',
	method: 'get_status',
	expect: { }
});

var callListNodes = rpc.declare({
	object: 'luci.headscale',
	method: 'list_nodes',
	expect: { nodes: [] }
});

var callListUsers = rpc.declare({
	object: 'luci.headscale',
	method: 'list_users',
	expect: { users: [] }
});

var callGetFirewallStatus = rpc.declare({
	object: 'luci.headscale',
	method: 'get_firewall_status',
	expect: { opened: false, port: '8080' }
});

var callSetFirewall = rpc.declare({
	object: 'luci.headscale',
	method: 'set_firewall',
	params: [ 'enabled' ],
	expect: { code: 0 }
});

var callServiceAction = rpc.declare({
	object: 'luci.headscale',
	method: 'service_action',
	params: [ 'action' ],
	expect: { code: 0 }
});

return view.extend({
	load: function() {
		return Promise.all([
			callGetStatus(),
			uci.load('headscale'),
			callGetFirewallStatus(),
			callListNodes(),
			callListUsers()
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var fwStatus = data[2] || {};
		var rawNodes = data[3];
		var rawUsers = data[4];
		var nodes = Array.isArray(rawNodes) ? rawNodes : ((rawNodes && rawNodes.nodes) ? rawNodes.nodes : []);
		var users = Array.isArray(rawUsers) ? rawUsers : ((rawUsers && rawUsers.users) ? rawUsers.users : []);

		var serverUrl = uci.get('headscale', 'server', 'server_url') || 'http://192.168.1.1:8080';
		var listenAddr = uci.get('headscale', 'server', 'listen_addr') || '0.0.0.0:8080';
		var baseDomain = uci.get('headscale', 'dns', 'base_domain') || 'example.com';
		var derpEnabled = uci.get('headscale', 'derp', 'embedded_enabled') === '1';
		var enabled = (status.enabled !== undefined) ? status.enabled : (uci.get('headscale', 'server', 'enabled') === '1');

		var rawLanIp = status.lan_ip || window.location.hostname || '192.168.1.1';
		var lanIp = rawLanIp.split('/')[0];
		var listenPort = (listenAddr.indexOf(':') !== -1) ? listenAddr.split(':')[1] : '8080';
		var lanUrl = 'http://' + lanIp + ':' + listenPort;

		var configuredServerUrl = uci.get('headscale', 'server', 'server_url');
		var wanIp = status.wan_ip ? status.wan_ip.split('/')[0] : '';
		var wanUrl = '';

		if (configuredServerUrl && configuredServerUrl !== 'http://192.168.1.1:8080' && configuredServerUrl !== 'http://127.0.0.1:8080' && configuredServerUrl.indexOf(lanIp) === -1) {
			wanUrl = configuredServerUrl;
		} else if (status.cert_domain) {
			wanUrl = 'https://' + status.cert_domain + ':' + listenPort;
		} else if (wanIp) {
			wanUrl = 'http://' + wanIp + ':' + listenPort;
		} else {
			wanUrl = configuredServerUrl || lanUrl;
		}

		var onlineNodesCount = 0;
		nodes.forEach(function(n) {
			if (n.online !== false) onlineNodesCount++;
		});

		var viewRoot = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Control Server') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Headscale is an open-source, self-hosted implementation of the Tailscale coordination server.')
			])
		]);

		// ------------------- 1. Metrics Cards (KPI Summary) -------------------
		var statGrid = E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:16px;' }, [
			// Card 1: Service Status
			E('div', { 'style': 'background:#fdfdfe;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04);' }, [
				E('div', { 'style': 'font-size:12px;color:#718096;margin-bottom:6px;font-weight:bold;' }, [ _('Service Status') ]),
				E('div', { 'id': 'hs_stat_status', 'style': 'margin-bottom:4px;' }, [
					status.running ?
						E('span', { 'class': 'badge label success', 'style': 'font-size:13px;padding:4px 8px;' }, [ _('RUNNING') ]) :
						E('span', { 'class': 'badge label fatal', 'style': 'font-size:13px;padding:4px 8px;' }, [ enabled ? _('STOPPED') : _('DISABLED') ])
				]),
				E('div', { 'style': 'font-size:12px;color:#a0aec0;' }, [
					status.running ? ('PID: ' + status.pid) : _('Service Inactive')
				])
			]),

			// Card 2: Registered Nodes
			E('div', { 'style': 'background:#fdfdfe;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04);cursor:pointer;', 'click': function() { location.href = L.url('admin/vpn/headscale/nodes'); } }, [
				E('div', { 'style': 'font-size:12px;color:#718096;margin-bottom:6px;font-weight:bold;' }, [ _('Registered Nodes') ]),
				E('div', { 'style': 'font-size:22px;font-weight:bold;color:#2b6cb0;margin-bottom:4px;' }, [ nodes.length.toString() ]),
				E('div', { 'style': 'font-size:12px;color:#718096;' }, [
					_('Online: ') + onlineNodesCount + ' / ' + nodes.length + ' ' + _('nodes')
				])
			]),

			// Card 3: Users
			E('div', { 'style': 'background:#fdfdfe;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04);cursor:pointer;', 'click': function() { location.href = L.url('admin/vpn/headscale/users'); } }, [
				E('div', { 'style': 'font-size:12px;color:#718096;margin-bottom:6px;font-weight:bold;' }, [ _('Users (Namespaces)') ]),
				E('div', { 'style': 'font-size:22px;font-weight:bold;color:#2b6cb0;margin-bottom:4px;' }, [ users.length.toString() ]),
				E('div', { 'style': 'font-size:12px;color:#718096;' }, [
					_('Click to manage users')
				])
			]),

			// Card 4: WAN Firewall
			E('div', { 'style': 'background:#fdfdfe;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04);' }, [
				E('div', { 'style': 'font-size:12px;color:#718096;margin-bottom:6px;font-weight:bold;' }, [ _('WAN Firewall') ]),
				E('div', { 'id': 'hs_stat_fw', 'style': 'margin-bottom:4px;' }, [
					fwStatus.opened ?
						E('span', { 'class': 'badge label success', 'style': 'font-size:13px;padding:4px 8px;' }, [ _('OPENED') ]) :
						E('span', { 'class': 'badge label', 'style': 'font-size:13px;padding:4px 8px;' }, [ _('BLOCKED') ])
				]),
				E('div', { 'style': 'font-size:12px;color:#a0aec0;' }, [
					fwStatus.opened ? (_('Port: ') + fwStatus.port + '/tcp') : _('External access blocked')
				])
			])
		]);

		var statsSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('System Overview & Metrics') ]),
			E('div', { 'class': 'cbi-section-node' }, [
				statGrid
			])
		]);

		// ------------------- 2. Harmonized Parameter & Action Panel -------------------
		var detailSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Service Details & Quick Operations') ]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('table', { 'class': 'table cbi-section-table', 'style': 'width:100%;margin:0;border-collapse:collapse;' }, [
					// Row 1: Running Status + Control Buttons
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('Service Status') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							E('div', { 'style': 'display:flex;align-items:center;gap:10px;' }, [
								E('span', { 'id': 'hs_detail_status' }, [
									status.running ?
										E('span', { 'class': 'badge label success', 'style': 'padding:3px 8px;font-size:12px;' }, [ _('RUNNING') + ' (PID: ' + status.pid + ')' ]) :
										E('span', { 'class': 'badge label fatal', 'style': 'padding:3px 8px;font-size:12px;' }, [ enabled ? _('STOPPED') : _('DISABLED') ])
								]),
								status.running ? E('button', {
									'class': 'btn cbi-button cbi-button-action',
									'style': 'padding:2px 10px;font-size:12px;',
									'click': function() {
										ui.showModal(_('Restarting Service'), [
											E('p', { 'class': 'spinning' }, [ _('Restarting Headscale service...') ])
										]);
										return callServiceAction('restart').then(function() {
											location.reload();
										});
									}
								}, [ _('Restart Service') ]) : '',
								status.running ? E('button', {
									'class': 'btn cbi-button cbi-button-reset',
									'style': 'padding:2px 10px;font-size:12px;',
									'click': function() {
										ui.showModal(_('Stopping Service'), [
											E('p', { 'class': 'spinning' }, [ _('Stopping Headscale service and disabling in config...') ])
										]);
										return callServiceAction('stop').then(function() {
											location.reload();
										});
									}
								}, [ _('Stop Service') ]) : E('button', {
									'class': 'btn cbi-button cbi-button-apply',
									'style': 'padding:2px 10px;font-size:12px;',
									'click': function() {
										ui.showModal(_('Starting Service'), [
											E('p', { 'class': 'spinning' }, [ _('Enabling and starting Headscale service...') ])
										]);
										return callServiceAction('start').then(function() {
											location.reload();
										});
									}
								}, [ _('Start Service') ])
							])
						])
					]),

					// Row 2: WAN Firewall Toggle
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('WAN Firewall Port') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							E('div', { 'style': 'display:flex;align-items:center;gap:10px;' }, [
								E('span', { 'id': 'hs_detail_fw' }, [
									fwStatus.opened ?
										E('span', { 'class': 'badge label success', 'style': 'padding:3px 8px;font-size:12px;' }, [ _('OPENED') + ' (' + fwStatus.port + '/tcp)' ]) :
										E('span', { 'class': 'badge label', 'style': 'padding:3px 8px;font-size:12px;' }, [ _('CLOSED / BLOCKED') ])
								]),
								E('button', {
									'class': fwStatus.opened ? 'btn cbi-button cbi-button-reset' : 'btn cbi-button cbi-button-positive',
									'style': 'padding:2px 10px;font-size:12px;',
									'click': function() {
										var targetState = !fwStatus.opened;
										var msg = targetState ?
											_('Open WAN firewall port (%s/tcp) to allow external connections?').format(fwStatus.port || '8080') :
											_('Close WAN firewall port for Headscale?');
										if (confirm(msg)) {
											ui.showModal(_('Updating Firewall'), [
												E('p', { 'class': 'spinning' }, [ _('Configuring firewall rules and reloading...') ])
											]);
											return callSetFirewall(targetState).then(function() {
												location.reload();
											});
										}
									}
								}, [ fwStatus.opened ? _('Close Firewall Port') : _('Open Firewall Port') ]),
								E('span', { 'style': 'color:#888;font-size:12px;' }, [
									fwStatus.opened ? _('External Tailscale clients can connect directly via WAN IP.') : _('Only devices on local LAN can connect currently.')
								])
							])
						])
					]),

					// Row 3: LAN Server URL
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('LAN Server URL') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							E('div', { 'style': 'display:flex;align-items:center;gap:10px;' }, [
								E('code', { 'style': 'font-family:monospace;font-size:13px;padding:3px 8px;border-radius:4px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;' }, [ lanUrl ]),
								E('button', {
									'class': 'btn cbi-button cbi-button-neutral',
									'style': 'padding:2px 10px;font-size:12px;',
									'click': function() {
										navigator.clipboard.writeText(lanUrl).then(function() {
											ui.addNotification(null, E('p', {}, [ _('LAN Server URL copied to clipboard.') ]), 'info');
										});
									}
								}, [ _('Copy URL') ]),
								E('span', { 'style': 'color:#888;font-size:12px;' }, [ _('For devices connecting within home/office local LAN.') ])
							])
						])
					]),

					// Row 4: WAN / Public Server URL
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('WAN / Public Server URL') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							E('div', { 'style': 'display:flex;align-items:center;gap:10px;' }, [
								E('code', { 'style': 'font-family:monospace;font-size:13px;padding:3px 8px;border-radius:4px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;' }, [ wanUrl ]),
								E('button', {
									'class': 'btn cbi-button cbi-button-neutral',
									'style': 'padding:2px 10px;font-size:12px;',
									'click': function() {
										navigator.clipboard.writeText(wanUrl).then(function() {
											ui.addNotification(null, E('p', {}, [ _('WAN Server URL copied to clipboard.') ]), 'info');
										});
									}
								}, [ _('Copy URL') ]),
								E('span', { 'style': 'color:#888;font-size:12px;' }, [ _('For remote mobile devices via DDNS or Public IP (configure in Settings tab).') ])
							])
						])
					]),

					// Row 5: Listen Address
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('Listen Address') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							E('code', { 'style': 'font-family:monospace;font-size:13px;padding:3px 8px;border-radius:4px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;' }, [ listenAddr ])
						])
					]),

					// Row 6: MagicDNS Base Domain
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('MagicDNS Base Domain') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							E('code', { 'style': 'font-family:monospace;font-size:13px;padding:3px 8px;border-radius:4px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;' }, [ baseDomain ])
						])
					]),

					// Row 7: Embedded DERP Relay
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('Embedded DERP Relay') ]),
						E('td', { 'class': 'td', 'style': 'vertical-align:middle;padding:10px 12px;' }, [
							derpEnabled ?
								E('span', { 'class': 'badge label success', 'style': 'padding:3px 8px;font-size:12px;' }, [ _('ENABLED') ]) :
								E('span', { 'class': 'badge label', 'style': 'padding:3px 8px;font-size:12px;' }, [ _('DISABLED') ])
						])
					]),

					// Row 8: Software Version
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'width:220px;vertical-align:middle;padding:10px 12px;font-weight:500;color:#4a5568;' }, [ _('Program Version') ]),
						E('td', { 'class': 'td', 'id': 'hs_version', 'style': 'vertical-align:middle;padding:10px 12px;font-size:13px;color:#2d3748;' }, [
							status.version || _('N/A')
						])
					])
				])
			])
		]);

		viewRoot.appendChild(statsSection);
		viewRoot.appendChild(detailSection);

		// Lightweight Polling (10s interval)
		poll.add(function() {
			return callGetStatus().then(function(res) {
				var statBadge = document.getElementById('hs_stat_status');
				var detailBadge = document.getElementById('hs_detail_status');
				if (res) {
					if (statBadge) {
						statBadge.innerHTML = res.running ?
							'<span class="badge label success" style="font-size:13px;padding:4px 8px;">' + _('RUNNING') + '</span>' :
							'<span class="badge label fatal" style="font-size:13px;padding:4px 8px;">' + (enabled ? _('STOPPED') : _('DISABLED')) + '</span>';
					}
					if (detailBadge) {
						detailBadge.innerHTML = res.running ?
							'<span class="badge label success" style="padding:3px 8px;font-size:12px;">' + _('RUNNING') + ' (PID: ' + res.pid + ')</span>' :
							'<span class="badge label fatal" style="padding:3px 8px;font-size:12px;">' + (enabled ? _('STOPPED') : _('DISABLED')) + '</span>';
					}
				}
			});
		}, 10);

		return viewRoot;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
