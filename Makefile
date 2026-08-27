#
# Copyright (C) 2026 permails <logo@permails.com>
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Headscale Control Server
LUCI_DEPENDS:=+headscale +luci-base +rpcd +rpcd-mod-file +jshn
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-headscale
PKG_VERSION:=1.26.8
PKG_RELEASE:=2
PKG_LICENSE:=Apache-2.0
PKG_AUTHOR:=permails <logo@permails.com>
PKG_MAINTAINER:=permails <logo@permails.com>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
