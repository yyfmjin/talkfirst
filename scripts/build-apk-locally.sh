#!/usr/bin/env bash
# 本机出 Android APK —— 不再依赖 EAS 的免费额度。
#
# 为什么需要它：2026-10-10 EAS 免费档本月的 Android 构建额度被用尽
# （EasBuildFreeTierLimitExceededError，要到 11-01 才重置）。而本机已经有了
# JDK + Android SDK + build-tools（见 scripts/setup-android-env.sh），
# 所以可以自己 gradle 出包。
#
# 两个关键前提：
#   1. **必须克隆到纯 ASCII 路径**（`D:\talkfirst`）。仓库原位置 `D:\文件\网站\TalkFirst`
#      含中文 —— Windows 版 hermesc 在中文路径下退出码 6，gradle 也不友好。
#   2. 用**自己的签名密钥**（下图自动生成一次，之后复用），这样后续版本能覆盖安装；
#      注意它与 EAS 那个包签名不同，第一次装本机包需要先卸载 EAS 那个。
#
# 用法：bash scripts/build-apk-locally.sh        （首次约 20-40 分钟）
set -uo pipefail

SRC="D:/文件/网站/TalkFirst"
DEST=/d/talkfirst
KS="$DEST/apps/mobile/android/app/talkfirst-local.keystore"
KS_PASS=talkfirst-local
export ANDROID_HOME='D:\Android\sdk'
export ANDROID_SDK_ROOT='D:\Android\sdk'
export JAVA_HOME='D:\Android\jdk17'
export PATH="/d/Android/jdk17/bin:/d/Android/sdk/platform-tools:$PATH"
# 关键：仓库根有 workspaces 字段，SDK 52 的 Metro 会把 server root 解析成工作区根
# D:\talkfirst，而 gradle 传入的入口 index.ts 是相对 apps/mobile 的，导致
# export:embed 从工作区根解析报 "Unable to resolve module ./index.ts"。
# 这个变量让 server root 钉回 apps/mobile（本仓库已自行把 workspace root 加进 watchFolders）。
export EXPO_NO_METRO_WORKSPACE_ROOT=1

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── 1. 克隆到 ASCII 路径 ─────────────────────────────────────────────────────
if [ ! -d "$DEST/.git" ]; then
  log "克隆到 $DEST（纯 ASCII 路径）…"
  git clone "$SRC" "$DEST" || exit 1
fi
cd "$DEST" || exit 1
git fetch --all -q 2>/dev/null; git checkout -q master 2>/dev/null; git pull -q 2>/dev/null
log "当前提交：$(git log --oneline -1)"

# ── 2. 依赖 ──────────────────────────────────────────────────────────────────
if [ ! -d "$DEST/node_modules" ]; then
  log "npm ci（约 2-4 分钟）…"
  npm ci --legacy-peer-deps >/tmp/local-npmci.log 2>&1 || { tail -20 /tmp/local-npmci.log; exit 1; }
fi

# ── 3. 生成 android 工程 + 签名密钥 ──────────────────────────────────────────
cd "$DEST/apps/mobile" || exit 1
if [ ! -d android ]; then
  log "expo prebuild（生成 android/ 工程）…"
  npx expo prebuild --platform android --no-install >/tmp/local-prebuild.log 2>&1 || { tail -20 /tmp/local-prebuild.log; exit 1; }
fi
if [ ! -f "$KS" ]; then
  log "生成本机签名密钥（一次即可，后续复用）…"
  keytool -genkeypair -v -keystore "$KS" -alias talkfirst -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=TalkFirst Local, OU=Dev, O=TalkFirst, L=-, S=-, C=CN" >/dev/null 2>&1 || exit 1
fi

# ── 4. 注入签名配置（gradle 读它）────────────────────────────────────────────
cat > "$DEST/apps/mobile/android/gradle.properties.local" <<PROPS
TALKFIRST_UPLOAD_STORE_FILE=talkfirst-local.keystore
TALKFIRST_UPLOAD_KEY_ALIAS=talkfirst
TALKFIRST_UPLOAD_STORE_PASSWORD=$KS_PASS
TALKFIRST_UPLOAD_KEY_PASSWORD=$KS_PASS
PROPS
grep -q "gradle.properties.local" "$DEST/apps/mobile/android/gradle.properties" 2>/dev/null || \
  echo "include=gradle.properties.local" >> "$DEST/apps/mobile/android/gradle.properties"

# ── 5. gradle 出包 ───────────────────────────────────────────────────────────
log "gradle assembleRelease（首次 15-30 分钟，会下载 gradle 与依赖）…"
cd "$DEST/apps/mobile/android" || exit 1
./gradlew assembleRelease --no-daemon >/tmp/local-gradle.log 2>&1
STATUS=$?
if [ $STATUS -ne 0 ]; then
  log "gradle 失败（exit $STATUS），最后 30 行："
  tail -30 /tmp/local-gradle.log
  exit 1
fi

APK=$(ls -1 "$DEST"/apps/mobile/android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)
log "出包成功：$APK（$(( $(stat -c %s "$APK") / 1048576 ))MB）"
cp "$APK" /d/Android/talkfirst-local.apk
log "已复制到 D:\\Android\\talkfirst-local.apk"
