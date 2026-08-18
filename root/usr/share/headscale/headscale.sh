#!/bin/sh
# Headscale configuration generator for OpenWrt
# Generates /var/etc/headscale/config.yaml from /etc/config/headscale
# Copyright (C) 2026 permails <logo@permails.com>
#
# This is free software, licensed under the Apache License, Version 2.0.
#

CONF_DIR="/var/etc/headscale"
CONF_FILE="$CONF_DIR/config.yaml"

mkdir -p "$CONF_DIR"
mkdir -p /etc/headscale
mkdir -p /var/run/headscale
mkdir -p /var/log/headscale

# Default HuJSON policy file if not existing
if [ ! -f /etc/headscale/acl.hujson ]; then
	cat << 'EOF' > /etc/headscale/acl.hujson
{
  "acls": [
    {
      "action": "accept",
      "src": ["*"],
      "dst": ["*:*"]
    }
  ]
}
EOF
fi

# Load UCI config
. /lib/functions.sh

config_load headscale

# Server section
config_get server_url server server_url "http://127.0.0.1:8080"
config_get listen_addr server listen_addr "0.0.0.0:8080"
config_get metrics_listen_addr server metrics_listen_addr "127.0.0.1:9090"
config_get grpc_listen_addr server grpc_listen_addr "127.0.0.1:50443"
config_get_bool grpc_allow_insecure server grpc_allow_insecure 0
config_get log_level server log_level "info"
config_get log_format server log_format "text"
config_get_bool disable_check_updates server disable_check_updates 1
config_get ephemeral_timeout server ephemeral_node_inactivity_timeout "30m"
config_get_bool use_system_cert server use_system_cert 0
config_get tls_cert_path server tls_cert_path ""
config_get tls_key_path server tls_key_path ""

generate_selfsigned_cert() {
	local cert="/etc/headscale/tls.crt"
	local key="/etc/headscale/tls.key"
	[ -f "$cert" ] && [ -f "$key" ] && return 0

	mkdir -p /etc/headscale
	if command -v px5g >/dev/null 2>&1; then
		px5g selfsigned -days 3650 -newkey rsa:2048 -keyout "$key" -out "$cert" -subj "/CN=Headscale-Server/O=OpenWrt" 2>/dev/null
	elif command -v openssl >/dev/null 2>&1; then
		openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout "$key" -out "$cert" -subj "/CN=Headscale-Server/O=OpenWrt" 2>/dev/null
	fi
}

# Auto-detect uhttpd/system certificates if requested or if paths empty but HTTPS configured
if [ "$use_system_cert" = "1" ] || ( echo "$server_url" | grep -q "^https://" && [ -z "$tls_cert_path" ] ); then
	if [ -f "/etc/uhttpd.crt" ] && [ -f "/etc/uhttpd.key" ]; then
		tls_cert_path="/etc/uhttpd.crt"
		tls_key_path="/etc/uhttpd.key"
	elif [ -f "/etc/ssl/uhttpd.crt" ] && [ -f "/etc/ssl/uhttpd.key" ]; then
		tls_cert_path="/etc/ssl/uhttpd.crt"
		tls_key_path="/etc/ssl/uhttpd.key"
	elif [ -f "/etc/nginx/conf.d/_lan.crt" ] && [ -f "/etc/nginx/conf.d/_lan.key" ]; then
		tls_cert_path="/etc/nginx/conf.d/_lan.crt"
		tls_key_path="/etc/nginx/conf.d/_lan.key"
	else
		generate_selfsigned_cert
		if [ -f "/etc/headscale/tls.crt" ] && [ -f "/etc/headscale/tls.key" ]; then
			tls_cert_path="/etc/headscale/tls.crt"
			tls_key_path="/etc/headscale/tls.key"
		fi
	fi
fi

# IP Prefixes
config_get v4 ip_prefixes v4 "100.64.0.0/10"
config_get v6 ip_prefixes v6 "fd7a:115c:a1e0::/48"
config_get allocation ip_prefixes allocation "sequential"

# DERP
config_get_bool derp_embedded derp embedded_enabled 0
config_get derp_region_id derp region_id "999"
config_get derp_region_code derp region_code "headscale"
config_get derp_region_name derp region_name "Headscale Embedded DERP"
config_get derp_stun_listen_addr derp stun_listen_addr "0.0.0.0:3478"
config_get_bool derp_verify_clients derp verify_clients 1
config_get_bool derp_auto_update derp auto_update_enabled 1
config_get derp_update_freq derp update_frequency "24h"

# Database
config_get db_type database type "sqlite"
config_get sqlite_path database sqlite_path "/etc/headscale/db.sqlite"

# Policy
config_get policy_mode policy mode "file"
config_get policy_path policy path "/etc/headscale/acl.hujson"

# DNS
config_get_bool magic_dns dns magic_dns 1
config_get base_domain dns base_domain "example.com"

# Start writing config.yaml
cat << EOF > "$CONF_FILE"
---
server_url: ${server_url}
listen_addr: ${listen_addr}
metrics_listen_addr: ${metrics_listen_addr}
grpc_listen_addr: ${grpc_listen_addr}
grpc_allow_insecure: $([ "$grpc_allow_insecure" = "1" ] && echo "true" || echo "false")

noise:
  private_key_path: /etc/headscale/noise_private.key

prefixes:
  v4: ${v4}
  v6: ${v6}
  allocation: ${allocation}

derp:
  server:
    enabled: $([ "$derp_embedded" = "1" ] && echo "true" || echo "false")
    region_id: ${derp_region_id}
    region_code: "${derp_region_code}"
    region_name: "${derp_region_name}"
    verify_clients: $([ "$derp_verify_clients" = "1" ] && echo "true" || echo "false")
    stun_listen_addr: "${derp_stun_listen_addr}"
    private_key_path: /etc/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true
  urls:
EOF

has_derp_urls=0
append_derp_url() {
	[ -n "$1" ] && { echo "    - $1" >> "$CONF_FILE"; has_derp_urls=1; }
}
config_list_foreach derp urls append_derp_url
[ "$has_derp_urls" = "0" ] && echo "    []" >> "$CONF_FILE"

cat << EOF >> "$CONF_FILE"
  paths: []
  auto_update_enabled: $([ "$derp_auto_update" = "1" ] && echo "true" || echo "false")
  update_frequency: ${derp_update_freq}

disable_check_updates: $([ "$disable_check_updates" = "1" ] && echo "true" || echo "false")

node:
  ephemeral:
    inactivity_timeout: ${ephemeral_timeout}

database:
  type: ${db_type}
  sqlite:
    path: ${sqlite_path}
    write_ahead_log: true
    wal_autocheckpoint: 1000

log:
  level: ${log_level}
  format: ${log_format}

policy:
  mode: ${policy_mode}
  path: ${policy_path}

dns:
  magic_dns: $([ "$magic_dns" = "1" ] && echo "true" || echo "false")
  base_domain: ${base_domain}
  nameservers:
    global:
EOF

has_nameservers=0
append_nameserver() {
	[ -n "$1" ] && { echo "      - $1" >> "$CONF_FILE"; has_nameservers=1; }
}
config_list_foreach dns nameservers append_nameserver
[ "$has_nameservers" = "0" ] && echo "      []" >> "$CONF_FILE"

cat << EOF >> "$CONF_FILE"
    split: {}
  search_domains:
EOF

has_search_domains=0
append_search_domain() {
	[ -n "$1" ] && { echo "    - $1" >> "$CONF_FILE"; has_search_domains=1; }
}
config_list_foreach dns search_domains append_search_domain
[ "$has_search_domains" = "0" ] && echo "    []" >> "$CONF_FILE"

cat << EOF >> "$CONF_FILE"
  extra_records: []

unix_socket: /var/run/headscale/headscale.sock
unix_socket_permission: "0770"

tls_cert_path: "${tls_cert_path}"
tls_key_path: "${tls_key_path}"
EOF

chmod 600 "$CONF_FILE"

# Create symlink for CLI tools (headscale users/nodes/preauthkeys commands)
ln -sf "$CONF_FILE" /etc/headscale/config.yaml

exit 0
