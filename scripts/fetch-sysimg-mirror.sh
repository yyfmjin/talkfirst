#!/usr/bin/env bash
# 从**国内镜像**补 Android 系统镜像（Google 直连在这台机器上必然被截断：三次都停在 33%）。
#
# 为什么不用 sdkmanager 直接下：sdkmanager 是 Java 程序，**不读 https_proxy 这类环境变量**，
# 所以本机的系统代理对它无效，它只会直连 dl.google.com —— 然后被掐断。
# 而 avdmanager/sdkmanager 本身没有"换镜像源"的开关，能换的只有"包的下载地址"。
# 所以这里直接从镜像取 sys-img 的 zip（腾讯镜像实测 HTTP 206，支持 -C - 续传），
# 解压到 SDK 的标准位置 —— 与 sdkmanager 装出来的目录结构一致。
#
# 镜像目录：https://mirrors.cloud.tencent.com/AndroidSDK/
# 用法：bash scripts/fetch-sysimg-mirror.sh
set -uo pipefail

BASE=/d/Android
SDK="$BASE/sdk"
API=35
ABI=x86_64
DEST="$SDK/system-images/android-$API/google_apis"
ZIP="$BASE/sysimg-$ABI-$API.zip"
URL="https://mirrors.cloud.tencent.com/AndroidSDK/sys-img/google_apis/$ABI-$API"_r*.zip

log() { echo "[$(date +%H:%M:%S)] $*"; }
mkdir -p "$DEST"

# 镜像上的文件名带修订号（如 x86_64-35_r09.zip），而 sdkmanager 要的是同一个包。
# 先用目录页/已知修订号找到真实文件名：优先已知的 r09，失败再试 r10、r08。
CANDIDATES="x86_64-35_r09.zip x86_64-35_r10.zip x86_64-35_r08.zip"
FOUND=""
for name in $CANDIDATES; do
  code=$(timeout 40 curl -sS --ssl-no-revoke -o /dev/null -w '%{http_code}' -r 0-64 \
    "https://mirrors.cloud.tencent.com/AndroidSDK/sys-img/google_apis/$name" 2>/dev/null || echo 000)
  log "探测 $name → HTTP $code"
  if [ "$code" = "206" ] || [ "$code" = "200" ]; then URL="https://mirrors.cloud.tencent.com/AndroidSDK/sys-img/google_apis/$name"; FOUND=$name; break; fi
done
[ -n "$FOUND" ] || { log "镜像上找不到该镜像包，放弃"; exit 1; }
log "使用 $FOUND"

log "下载（支持续传，最多 5 次）…"
for i in 1 2 3 4 5; do
  if timeout 1800 curl -L --ssl-no-revoke --retry 5 --retry-all-errors -C - -o "$ZIP" "$URL"; then break; fi
  log "第 $i 次中断，续传重试…"; sleep 3
done
SIZE=$(stat -c %s "$ZIP" 2>/dev/null || echo 0)
log "已下载 $((SIZE/1024/1024))MB，魔数 $(head -c 2 "$ZIP")"
[ "$(head -c 2 "$ZIP")" = "PK" ] || { log "不是合法 zip"; exit 1; }

log "解压到 $DEST …"
unzip -q -o "$ZIP" -d "$DEST" || exit 1
log "解压结果："
ls "$DEST" | head -5
log "system-images 累计：$(du -sm "$SDK/system-images" 2>/dev/null | cut -f1)MB"
log "完成。下一步：bash scripts/verify-apk-on-emulator.sh <apk>"
