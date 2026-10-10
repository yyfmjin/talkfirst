#!/usr/bin/env bash
# 从国内镜像补 Android NDK —— 本机 gradle 出包的必需件。
#
# 为什么需要：`gradle assembleRelease` 要 `ndk;26.1.10909125`（RN 0.76 指定版本），
# 而 gradle 自己的下载用了不到 1GB 就断（`Archive is not a ZIP archive`）——
# 和系统镜像那次同一个病：本机直连 Google 的大文件必被截断（sdkmanager 是 Java，
# 不读 https_proxy，只能直连）。腾讯镜像实测 HTTP 206、支持 -C - 续传。
#
# 用法：bash scripts/fetch-ndk-mirror.sh
set -uo pipefail

BASE=/d/Android
SDK="$BASE/sdk"
VERSION=26.1.10909125
ZIP="$BASE/android-ndk-r26b-windows.zip"
MIRROR="https://mirrors.cloud.tencent.com/AndroidSDK/android-ndk-r26b-windows.zip"
GOOGLE="https://dl.google.com/android/repository/android-ndk-r26b-windows.zip"

log() { echo "[$(date +%H:%M:%S)] $*"; }
DEST="$SDK/ndk/$VERSION"

if [ -f "$DEST/source.properties" ]; then
  log "NDK 已就位：$DEST"
  exit 0
fi

log "下载 NDK r26b（约 600MB，优先镜像，支持续传）…"
for i in 1 2 3 4 5; do
  if timeout 2400 curl -L --ssl-no-revoke --retry 5 --retry-all-errors -C - -o "$ZIP" "$MIRROR"; then break; fi
  log "第 $i 次中断，续传重试…"; sleep 3
done
SIZE=$(stat -c %s "$ZIP" 2>/dev/null || echo 0)
log "已下载 $((SIZE/1024/1024))MB，魔数 $(head -c 2 "$ZIP")"
if [ "$(head -c 2 "$ZIP")" != "PK" ]; then
  log "镜像包不完整，改用 Google 源重试…"
  timeout 2400 curl -L --ssl-no-revoke --retry 5 --retry-all-errors -C - -o "$ZIP" "$GOOGLE" || exit 1
fi
[ "$(head -c 2 "$ZIP")" = "PK" ] || { log "两个源都没下全，放弃"; exit 1; }

log "解压到 $SDK/ndk/…"
mkdir -p "$SDK/ndk"
rm -rf "$SDK/ndk/android-ndk-r26b" "$DEST"
unzip -q -o "$ZIP" -d "$SDK/ndk" || exit 1
if [ -d "$SDK/ndk/android-ndk-r26b" ]; then
  mv "$SDK/ndk/android-ndk-r26b" "$DEST"
fi
log "结果："
ls "$DEST" 2>/dev/null | head -5
[ -f "$DEST/source.properties" ] && log "NDK 安装完成 ✓" || { log "目录结构不对，请检查"; exit 1; }
