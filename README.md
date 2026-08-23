# luci-app-headscale

OpenWrt LuCI modern management application for the [Headscale](https://github.com/juanfont/headscale) control server.

`luci-app-headscale` provides a fully integrated, high-performance web interface designed for network engineers and system administrators to manage self-hosted Tailscale control networks directly from OpenWrt routers.

> **IMPORTANT: Storage & Flash Endurance Advisory**
>
> Headscale operates on an embedded SQLite database engine with frequent write cycles for node state synchronization, peer heartbeat updates, and pre-auth token tracking. Continuous database I/O may accelerate the wear on onboard SPI NOR / NAND flash with limited write cycles.
>
> **Recommended Deployment Targets:**
> * **x86_64 / ARM64 Soft Routers & Mini PCs** with SSD / NVMe / eMMC storage.
> * **Routers with External Storage**: USB flash drives, external SSDs, or conventional HDDs.
> * Devices configured to store Headscale databases and runtime vaults on persistent, wear-leveled external mount points.

---

## Overview & Architecture

`luci-app-headscale` integrates seamlessly with OpenWrt's native UCI configuration system, the LuCI JavaScript runtime (`luci-static/resources/view`), and OpenWrt's RPC daemon (`rpcd`).

```
+------------------------------------------------------------------+
|                    Client Browser (LuCI JS)                      |
| (Native Views: Overview, Settings, Nodes, Users, AuthKeys, ACL)  |
+---------------------------------+--------------------------------+
                                  | ubus JSON-RPC
                                  v
+------------------------------------------------------------------+
|                    OpenWrt RPCD (`luci.headscale`)               |
|      (/usr/libexec/rpcd/luci.headscale & libubox/jshn)           |
+-------------------+------------------------------+---------------+
                    |                              |
                    v                              v
     +------------------------------+   +--------------------+
     |      Headscale Daemon        |   |   OpenWrt Procd    |
     | (CLI / SQLite DB / Socket)   |   |   /etc/init.d/     |
     +------------------------------+   +--------------------+
                    |
                    v
     +------------------------------+
     |   Persistent Key Vault       |
     |   (/etc/headscale/vault.db)  |
     +------------------------------+
```

---

## Key Features

### 1. 100% Native OpenWrt Lifecycle & Transaction Model
* **UCI State Machine Compliance**: Full support for OpenWrt staging, rollback, and transaction lifecycles (`handleSave`, `handleSaveApply`, `handleReset`).
* **ComboButton Integration**: Uses OpenWrt's standard "Save & Apply", "Save", and "Reset" action controls. Changes are cached into `/tmp/.uci/` with real-time unsaved changes badge indicators before committing.
* **Non-Blocking Execution**: Asynchronous `ubus` background invocation prevents UI freezing during long-running tasks.

### 2. Comprehensive Service Status & Telemetry
* Real-time monitoring of Headscale daemon runtime status, process PID, memory footprint, and listening socket bindings (`HTTP`, `gRPC`, `STUN`).
* Live network interface detection and assigned IP prefixes (IPv4 CGNAT `100.64.0.0/10` and IPv6 ULA `fd7a:115c:a1e0::/48`).
* Aggregated metrics for total registered users, active/online nodes, and valid pre-auth keys.

### 3. Deep UCI Configuration Management
* Fine-grained control over core daemon parameters:
  * Server listen address and port (`0.0.0.0:8080`).
  * Server URL (`server_url`) for client registration endpoints.
  * Embedded DERP / STUN server configuration (`stun_listen_addr`).
  * IP allocation prefix definitions for dual-stack operation.
  * DNS & MagicDNS configuration, base domain naming, and custom upstream nameservers.
  * Ephemeral node expiration timeouts and gRPC listen interfaces.
* Automatic generation of compliant `/etc/headscale/config.yaml` from UCI parameters via `/etc/init.d/headscale`.

### 4. Machine & Node Management
* Tabular node monitoring with real-time connectivity status (online/offline indicators based on last-seen timestamps).
* Dynamic IP allocation inspection (IPv4 and IPv6 Tailscale addresses).
* Inline node renaming and user/namespace re-assignment.
* Subnet routing inspection and route toggling (e.g., enabling advertised LAN routes and exit nodes).
* Node expiration inspection and force-expiry/removal actions.

### 5. Multi-Tenant User Management
* User (namespace) CRUD operations with duplicate detection and validation.
* Real-time user node count aggregation and creation timestamps.
* Transactional deletion with automatic safety checks.

### 6. Pre-Authentication Keys & Persistent Key Vault
* Support for creating single-use, reusable, and ephemeral pre-authentication keys with custom TTL (e.g., `24h`, `720h`, `8760h`).
* **Persistent Key Vault (`/etc/headscale/vault.db`)**:
  * Headscale's upstream database stores only SHA-256 hashes of generated keys, obscuring plaintext tokens upon reload.
  * `luci-app-headscale` maintains a secure local vault that preserves full 80-character plaintext tokens and full enrollment commands.
  * Enables one-click clipboard copying of keys and complete CLI join commands at any time without accessing CLI logs or databases.
* One-click key revocation and expiration management.

### 7. ACL & Access Policy Management
* Integrated ACL editor supporting HuJSON / JSON policy definitions.
* Direct synchronization with Headscale's policy engine.

### 8. Real-time Service Logging
* Live log streamer reading directly from OpenWrt's system log buffer (`logread`).
* Tail filtering, log clear, and log download functionality.

### 9. Interactive Client Onboarding Guide
* Built-in configuration guide providing copy-paste commands and configuration profiles for:
  * Linux (`tailscale up --login-server ...`)
  * macOS (Tailscale App standalone profile configuration)
  * Windows (Registry overrides and CLI parameters)
  * iOS and Android client connections

---

## Directory Structure

```
luci-app-headscale/
├── Makefile                                       # OpenWrt package build recipe
├── htdocs/luci-static/resources/view/headscale/    # LuCI JavaScript views
│   ├── acls.js                                    # ACL policy management view
│   ├── guide.js                                   # Client onboarding guide view
│   ├── log.js                                     # Real-time daemon log viewer
│   ├── nodes.js                                   # Node/machine management view
│   ├── overview.js                                # System telemetry & summary view
│   ├── preauthkeys.js                             # Pre-auth key & vault view
│   ├── settings.js                                # Daemon UCI configuration view
│   └── users.js                                   # Multi-tenant user management view
├── po/zh_Hans/headscale.po                        # Simplified Chinese translations
└── root/
    └── usr/
        ├── libexec/rpcd/luci.headscale            # Backend RPCD provider script
        └── share/
            ├── rpcd/acl.d/luci-app-headscale.json # Ubus ACL permissions schema
            └── luci/menu.d/luci-app-headscale.json # LuCI navigation menu definition
```

---

## Dependencies & Requirements

* **Target System**: OpenWrt 21.02, 22.03, 23.05, 24.10, or SNAPSHOT.
* **Core Packages**:
  * `headscale` (v0.22.x - v0.29.x+)
  * `luci-base`
  * `rpcd`
  * `rpcd-mod-file`
  * `jshn`

---

## Build & Installation

### Building from OpenWrt SDK / Buildroot

1. Clone the repository into your OpenWrt source tree package directory:
   ```bash
   cd /path/to/openwrt
   git clone https://github.com/permails/luci-app-headscale.git package/luci-app-headscale
   ```

2. Update feeds and select the package in `menuconfig`:
   ```bash
   ./scripts/feeds update -a
   ./scripts/feeds install -a
   make menuconfig
   ```
   Navigate to:
   ```
   LuCI --->
     3. Applications --->
       <*> luci-app-headscale....... LuCI Support for Headscale Control Server
   ```

3. Compile the package:
   ```bash
   make package/luci-app-headscale/compile V=s
   ```

### Manual Installation on Target Device

Transfer the compiled `.ipk` package to your router and install via `opkg`:

```bash
opkg update
opkg install luci-app-headscale_*.ipk
/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
```

---

## Default Configuration Example (`/etc/config/headscale`)

```uci
config headscale 'server'
	option enabled '1'
	option server_url 'http://192.168.1.1:8080'
	option listen_addr '0.0.0.0:8080'
	option metrics_listen_addr '0.0.0.0:9090'
	option stun_listen_addr '0.0.0.0:3478'
	option base_domain 'example.net'
	option ip_prefix_v4 '100.64.0.0/10'
	option ip_prefix_v6 'fd7a:115c:a1e0::/48'
	option magic_dns '1'
```

---

## Security Considerations

* **Key Vault Isolation**: `/etc/headscale/vault.db` is readable only by the `root` user and the `rpcd` service context.
* **RPC Protection**: All remote procedure calls are protected by OpenWrt's standard ubus ACL policies located in `/usr/share/rpcd/acl.d/luci-app-headscale.json`.

---

## License

Licensed under the Apache License, Version 2.0 (the "License"). You may obtain a copy of the License at:

```
http://www.apache.org/licenses/LICENSE-2.0
```

---

## Author & Maintainer

* **Author**: permails <logo@permails.com>
* **Repository**: [https://github.com/permails/luci-app-headscale](https://github.com/permails/luci-app-headscale)
