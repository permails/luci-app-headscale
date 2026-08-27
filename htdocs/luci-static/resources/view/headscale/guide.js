/*
 * Copyright (C) 2026 permails <logo@permails.com>
 *
 * This is free software, licensed under the Apache License, Version 2.0.
 */

'use strict';
'require view';
'require rpc';
'require ui';
'require uci';

var callGetStatus = rpc.declare({
	object: 'luci.headscale',
	method: 'get_status',
	expect: { }
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('headscale'),
			callGetStatus()
		]);
	},

	render: function(data) {
		var status = data[1] || {};
		var serverUrl = uci.get('headscale', 'server', 'server_url') || 'http://192.168.1.1:8188';
		var listenAddr = uci.get('headscale', 'server', 'listen_addr') || '0.0.0.0:8188';
		var rawLanIp = status.lan_ip || window.location.hostname || '192.168.1.1';
		var lanIp = rawLanIp.split('/')[0];
		var listenPort = (listenAddr.indexOf(':') !== -1) ? listenAddr.split(':')[1] : '8188';
		var lanUrl = 'http://' + lanIp + ':' + listenPort;

		var configuredServerUrl = uci.get('headscale', 'server', 'server_url');
		var wanIp = status.wan_ip ? status.wan_ip.split('/')[0] : '';
		var wanUrl = '';

		if (configuredServerUrl && configuredServerUrl !== 'http://192.168.1.1:8188' && configuredServerUrl !== 'http://127.0.0.1:8188' && configuredServerUrl.indexOf(lanIp) === -1) {
			wanUrl = configuredServerUrl;
		} else if (status.cert_domain) {
			wanUrl = 'https://' + status.cert_domain + ':' + listenPort;
		} else if (wanIp) {
			wanUrl = 'http://' + wanIp + ':' + listenPort;
		} else {
			wanUrl = configuredServerUrl || lanUrl;
		}

		var viewRoot = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Headscale - Setup & Configuration Guide') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Zero-barrier novice onboarding tutorial and complete step-by-step connection guide for Headscale.')
			])
		]);

		// ------------------- Section 1: Server URL Quick Reference Bar -------------------
		var urlBanner = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:16px;' }, [
			E('div', { 'style': 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:20px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;gap:8px;' }, [
					E('span', { 'style': 'font-weight:bold;color:#475569;' }, [ _('LAN Server URL:') ]),
					E('code', { 'style': 'font-family:monospace;font-size:13px;padding:2px 6px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;' }, [ lanUrl ]),
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 8px;font-size:11px;',
						'click': function() {
							navigator.clipboard.writeText(lanUrl);
							ui.addNotification(null, E('p', {}, [ _('LAN Server URL copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				]),
				E('div', { 'style': 'display:flex;align-items:center;gap:8px;' }, [
					E('span', { 'style': 'font-weight:bold;color:#475569;' }, [ _('WAN / Public URL:') ]),
					E('code', { 'style': 'font-family:monospace;font-size:13px;padding:2px 6px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;' }, [ wanUrl ]),
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'style': 'padding:2px 8px;font-size:11px;',
						'click': function() {
							navigator.clipboard.writeText(wanUrl);
							ui.addNotification(null, E('p', {}, [ _('WAN Server URL copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			])
		]);

		// ------------------- Section 2: Novice 4-Step Zero-Barrier Onboarding -------------------
		var wizardSteps = E('div', { 'style': 'display:flex;flex-direction:column;gap:14px;' }, [
			// Step 1
			E('div', { 'style': 'background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #3182ce;border-radius:4px;padding:14px 16px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' }, [
					E('div', { 'style': 'font-size:14px;font-weight:bold;color:#2b6cb0;' }, [ _('Step 1: Check Server Settings & Firewall') ]),
					E('a', { 'href': L.url('admin/vpn/headscale/settings'), 'class': 'btn cbi-button cbi-button-action', 'style': 'font-size:12px;padding:2px 8px;' }, [ _('Go to Settings Tab') ])
				]),
				E('div', { 'style': 'font-size:13px;color:#4a5568;line-height:1.6;' }, [
					_('Make sure "Enable Headscale Service" is checked. If you need remote access outside your home, enter your DDNS domain in "Server URL" (e.g. http://myrouter.ddns.net:8188) and check "Open Firewall Port". Default port is 8188.')
				])
			]),

			// Step 2
			E('div', { 'style': 'background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #3182ce;border-radius:4px;padding:14px 16px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' }, [
					E('div', { 'style': 'font-size:14px;font-weight:bold;color:#2b6cb0;' }, [ _('Step 2: Create a User (Namespace)') ]),
					E('a', { 'href': L.url('admin/vpn/headscale/users'), 'class': 'btn cbi-button cbi-button-action', 'style': 'font-size:12px;padding:2px 8px;' }, [ _('Go to User Management') ])
				]),
				E('div', { 'style': 'font-size:13px;color:#4a5568;line-height:1.6;' }, [
					_('Headscale requires devices to belong to a user. Enter a simple username (e.g. "admin" or "family") and click "Create User".')
				])
			]),

			// Step 3
			E('div', { 'style': 'background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #3182ce;border-radius:4px;padding:14px 16px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' }, [
					E('div', { 'style': 'font-size:14px;font-weight:bold;color:#2b6cb0;' }, [ _('Step 3: Generate a Pre-Auth Key (Passwordless Login)') ]),
					E('a', { 'href': L.url('admin/vpn/headscale/preauthkeys'), 'class': 'btn cbi-button cbi-button-action', 'style': 'font-size:12px;padding:2px 8px;' }, [ _('Go to Pre-Auth Keys') ])
				]),
				E('div', { 'style': 'font-size:13px;color:#4a5568;line-height:1.6;' }, [
					_('Click "Create Pre-Auth Key", select your user, check "Reusable" so all your family devices can use the same key, and click Create. Copy the generated key.')
				])
			]),

			// Step 4
			E('div', { 'style': 'background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #3182ce;border-radius:4px;padding:14px 16px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' }, [
					E('div', { 'style': 'font-size:14px;font-weight:bold;color:#2b6cb0;' }, [ _('Step 4: Connect Client Devices & Enjoy') ]),
					E('a', { 'href': L.url('admin/vpn/headscale/nodes'), 'class': 'btn cbi-button cbi-button-action', 'style': 'font-size:12px;padding:2px 8px;' }, [ _('Go to Nodes Management') ])
				]),
				E('div', { 'style': 'font-size:13px;color:#4a5568;line-height:1.6;' }, [
					_('Install official Tailscale App on your phone/PC, enter your Server URL and Auth Key to connect. Once connected, your device will appear in the "Nodes" tab!')
				])
			])
		]);

		var wizardSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Novice 4-Step Zero-Barrier Setup Guide') ]),
			E('div', { 'class': 'cbi-section-descr' }, [
				_('Follow these 4 simple steps in sequence to complete your private VPN mesh network in 3 minutes.')
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				wizardSteps
			])
		]);

		// ------------------- Section 3: Network Topology & Scenario Guide (Home vs Remote) -------------------
		var scenarioTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:20%;' }, [ _('Usage Scenario') ]),
				E('th', { 'class': 'th', 'style': 'width:25%;' }, [ _('Server URL Setting') ]),
				E('th', { 'class': 'th', 'style': 'width:55%;' }, [ _('Network Setup & Port Forwarding Required') ])
			]),

			// Scenario 1: Pure LAN / Home
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Home / Local LAN Only') ]) ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'http://192.168.1.1:8188' ]) ]),
				E('td', { 'class': 'td' }, [
					_('No extra network configuration required. All phones and computers connected to this router Wi-Fi/LAN can register and interconnect directly.')
				])
			]),

			// Scenario 2: Public IP / Router PPPoE
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Router Dial-up (PPPoE / Public IP)') ]) ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'http://<DDNS_Domain>:8188' ]) ]),
				E('td', { 'class': 'td' }, [
					_('Simply check "Open Firewall Port" in the Settings tab. Remote mobile devices can connect anytime using your DDNS domain name.')
				])
			]),

			// Scenario 3: Behind ISP Optical Modem (NAT2)
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Behind ISP Modem (Secondary Router)') ]) ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'http://<DDNS_Domain>:8188' ]) ]),
				E('td', { 'class': 'td' }, [
					_('Log in to your optical ISP modem admin page -> find "Port Forwarding / Virtual Server" -> forward external TCP 8188 to this OpenWrt router WAN IP.')
				])
			])
		]);

		var scenarioSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Common Network Scenarios & Port Forwarding') ]),
			E('div', { 'class': 'cbi-section-descr' }, [
				_('How to configure Server URL and port forwarding based on your home network topology.')
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				scenarioTable
			])
		]);

		// ------------------- Section 4: Full Platform Client Setup Table -------------------
		var clientTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:18%;' }, [ _('Platform / OS') ]),
				E('th', { 'class': 'th', 'style': 'width:34%;' }, [ _('Configuration Steps') ]),
				E('th', { 'class': 'th', 'style': 'width:36%;' }, [ _('Command / Server URL') ]),
				E('th', { 'class': 'th right cbi-section-actions', 'style': 'width:12%;' }, [ _('Action') ])
			]),

			// Linux
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Linux (Debian/Ubuntu/CentOS/Arch)') ]) ]),
				E('td', { 'class': 'td' }, [ _('Install official Tailscale package, then execute login command in root terminal.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'tailscale up --login-server ' + serverUrl + ' --accept-routes' ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('tailscale up --login-server ' + serverUrl + ' --accept-routes');
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			]),

			// Windows
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Windows (10 / 11)') ]) ]),
				E('td', { 'class': 'td' }, [ _('Hold Shift and right-click Tailscale tray icon -> "Custom Login Server" -> enter URL; or run in CMD/PowerShell.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'tailscale up --login-server ' + serverUrl ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('tailscale up --login-server ' + serverUrl);
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			]),

			// macOS
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('macOS (Standalone / App Store)') ]) ]),
				E('td', { 'class': 'td' }, [ _('Hold Option key and click top menu bar Tailscale icon -> "Custom Login Server" -> enter URL.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'tailscale up --login-server ' + serverUrl ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('tailscale up --login-server ' + serverUrl);
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			]),

			// Android
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Android / HarmonyOS') ]) ]),
				E('td', { 'class': 'td' }, [ _('Open Tailscale App -> tap top-right 3-dots menu 3 times to unlock Developer Mode -> tap Change Server.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ serverUrl ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText(serverUrl);
							ui.addNotification(null, E('p', {}, [ _('Server URL copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy URL') ])
				])
			]),

			// iOS
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('iOS (iPhone / iPad)') ]) ]),
				E('td', { 'class': 'td' }, [ _('Open iOS system Settings -> scroll down to Tailscale -> enable "Custom Server" -> paste server URL.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ serverUrl ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText(serverUrl);
							ui.addNotification(null, E('p', {}, [ _('Server URL copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy URL') ])
				])
			]),

			// Synology / QNAP NAS
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Synology / QNAP NAS') ]) ]),
				E('td', { 'class': 'td' }, [ _('SSH into NAS as root, execute Tailscale login command with login-server parameter.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'sudo tailscale up --login-server ' + serverUrl + ' --accept-routes' ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('sudo tailscale up --login-server ' + serverUrl + ' --accept-routes');
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			])
		]);

		var clientSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Client Platform Connection Guide') ]),
			E('div', { 'class': 'cbi-section-descr' }, [
				_('Instructions for logging into Headscale across all desktop, mobile and NAS operating systems.')
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				clientTable
			])
		]);

		// ------------------- Section 5: Advanced Scenarios (Subnet Router / Exit Node) -------------------
		var advancedTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr cbi-section-table-titles' }, [
				E('th', { 'class': 'th', 'style': 'width:20%;' }, [ _('Advanced Feature') ]),
				E('th', { 'class': 'th', 'style': 'width:32%;' }, [ _('Description & Purpose') ]),
				E('th', { 'class': 'th', 'style': 'width:36%;' }, [ _('Example Command') ]),
				E('th', { 'class': 'th right cbi-section-actions', 'style': 'width:12%;' }, [ _('Action') ])
			]),

			// Subnet Router
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Subnet Router (LAN Access)') ]) ]),
				E('td', { 'class': 'td' }, [ _('Advertise local home/office subnet so remote devices can access printers, NAS and servers without installing Tailscale on each device.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'tailscale up --login-server ' + serverUrl + ' --advertise-routes=192.168.1.0/24 --accept-routes' ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('tailscale up --login-server ' + serverUrl + ' --advertise-routes=192.168.1.0/24 --accept-routes');
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			]),

			// Exit Node
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Exit Node (Default Gateway)') ]) ]),
				E('td', { 'class': 'td' }, [ _('Route all remote client internet traffic through this router (Full tunneling for public Wi-Fi security).') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'tailscale up --login-server ' + serverUrl + ' --advertise-exit-node' ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('tailscale up --login-server ' + serverUrl + ' --advertise-exit-node');
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			]),

			// Pre-Auth Key Automation
			E('tr', { 'class': 'tr cbi-section-table-row' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ _('Automated Script Login') ]) ]),
				E('td', { 'class': 'td' }, [ _('Pass an auth key directly for headless server or Docker container auto-enrollment.') ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ 'tailscale up --login-server ' + serverUrl + ' --authkey <YOUR_PREAUTH_KEY>' ]) ]),
				E('td', { 'class': 'td right cbi-section-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function() {
							navigator.clipboard.writeText('tailscale up --login-server ' + serverUrl + ' --authkey <YOUR_PREAUTH_KEY>');
							ui.addNotification(null, E('p', {}, [ _('Command copied to clipboard.') ]), 'info');
						}
					}, [ _('Copy') ])
				])
			])
		]);

		var advancedSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Advanced Networking Scenarios') ]),
			E('div', { 'class': 'cbi-section-descr' }, [
				_('Configuring advanced networking capabilities such as subnet routing and default exit gateways.')
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				advancedTable
			])
		]);

		viewRoot.appendChild(urlBanner);
		viewRoot.appendChild(wizardSection);
		viewRoot.appendChild(scenarioSection);
		viewRoot.appendChild(clientSection);
		viewRoot.appendChild(advancedSection);

		return viewRoot;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
