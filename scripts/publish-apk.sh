#!/usr/bin/env bash
# 把本地打好的 APK 发布到官网下载入口（2026-10-25）。
#
# 为什么需要这个脚本：0.1.3–0.1.6 一路都只传到了**带版本号的新文件名**，而官网的
# `/download/android` 一直指向固定的 `/apk/talkfirst.apk` —— 那个文件停在 0.1.2，
# 用户下载到的永远是旧版。这个脚本把「覆盖稳定入口」变成一次命令，而不是靠记性。
#
# 用法：
#   bash scripts/publish-apk.sh /path/to/app-release.apk
#
# 做四件事：
#   1. 从 app.json 读版本号，校验 APK 的 versionName 与之一致（防传错包）；
#   2. 上传两份：`talkfirst-<ver>.apk`（留档）与 `talkfirst.apk`（官网固定入口）；
#   3. 重启 web（Next 对 public 下**新增**文件有缓存，重启最稳）；
#   4. 走公网地址重新下载，比对 sha256 —— 不比对就不算发布成功。
set -uo pipefail

APK=${1:-}
[ -f "$APK" ] || { echo "用法: bash scripts/publish-apk.sh <apk 路径>"; exit 1; }

REPO=$(cd "$(dirname "$0")/.." && pwd)
HOST=ubuntu@18.216.101.31
SSH="ssh -o ConnectTimeout=30 -i $HOME/.ssh/id_ed25519 $HOST"
REMOTE_DIR=/home/ubuntu/talkfirst/apps/web/public/apk
AAPT=/d/Android/sdk/build-tools/36.0.0/aapt2.exe
BASE=https://talkfirst.ccwu.cc

# 必须 cd 进目录再用相对路径：Windows 版 node 不认识 MSYS 的 /d/... 路径，
# 直接传绝对路径会变成 D:\d\文件\... 而读不到文件。
VER=$(cd "$REPO/apps/mobile" && node -e "const s=require('fs').readFileSync('app.json','utf8').replace(/\/\*[\s\S]*?\*\//g,'');console.log(JSON.parse(s).expo.version)")
BADGING=$("$AAPT" dump badging "$APK" 2>/dev/null | head -1)
APK_VER=$(echo "$BADGING" | sed -E "s/.*versionName='([^']+)'.*/\1/")
APK_CODE=$(echo "$BADGING" | sed -E "s/.*versionCode='([^']+)'.*/\1/")
[ "$VER" = "$APK_VER" ] || { echo "版本不一致：app.json=$VER，APK=$APK_VER —— 拒绝发布"; exit 1; }
echo "发布 $VER（versionCode $APK_CODE）"

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
scp -q -i "$HOME/.ssh/id_ed25519" "$APK" "$HOST:$REMOTE_DIR/talkfirst-$VER.apk" || exit 1
$SSH "cd $REMOTE_DIR && cp talkfirst-$VER.apk talkfirst.apk" || exit 1
$SSH "export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:\$PATH; pm2 restart talkfirst-web >/dev/null 2>&1" || exit 1
sleep 6

# 公网自检：必须下载到同一份字节。
REMOTE_SHA=$(curl -s -m 300 -L "$BASE/download/android" | sha256sum | cut -d' ' -f1)
echo "本地 sha256: $SHA"
echo "线上 sha256: $REMOTE_SHA"
if [ "$SHA" = "$REMOTE_SHA" ]; then
  echo "✅ $BASE/download/android 已指向 $VER"
else
  echo "❌ 线上内容与本地不一致，检查 nginx / public 目录"
  exit 1
fi
