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

# ── 4. 让 release 用我们的密钥签名 ───────────────────────────────────────────
#
# 2026-10-11 踩过的坑：expo prebuild 生成的模板里，release 构建类型指向的是
# `signingConfigs.debug`（Android 通用调试密钥，SHA-1 5e8f1606…cabf625）。
# 于是"发布包"实际是调试签名的：
#   • 与之前 EAS 发布的包签名不同 → 覆盖安装被系统拒绝（用户手上报的是
#     "package info is null"）；
#   • 调试私钥是公开的，任何人都能签一个同密钥的假包冒充升级 —— 对一个
#     公开下载的 App 来说这是实打实的安全问题。
# 这里在 build.gradle **末尾追加** 一个 android{} 块（Groovy DSL 里同名块会合并），
# 只用我们自己的密钥，并且幂等：已经打过补丁就不再动。
BG="$DEST/apps/mobile/android/app/build.gradle"
if ! grep -q "talkfirst-local.keystore" "$BG"; then
  log "给 release 挂上本机密钥（替代模板的调试签名）…"
  cat >> "$BG" <<'SIGNING'

// ── build-apk-locally.sh 追加：release 用本机密钥签名，勿手改 ──────────────
// （模板默认把 release 指向 signingConfigs.debug，是公开的调试密钥。）
android {
    signingConfigs {
        talkfirstRelease {
            storeFile file("talkfirst-local.keystore")
            storePassword "talkfirst-local"
            keyAlias "talkfirst"
            keyPassword "talkfirst-local"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.talkfirstRelease
        }
    }
}
SIGNING
fi

# ── 5. 只打真机架构 + 出包 ──────────────────────────────────────────────────
#
# 只保留 arm64-v8a + armeabi-v7a（覆盖所有真机：64 位 + 32 位）。
# x86/x86_64 只用于模拟器，真机用不上，砍掉后包从 ~67MB 降到 ~39MB，
# 下载更不容易断（2026-10-11 用户手机下载大包易失败，正是这个原因）。
GP="$DEST/apps/mobile/android/gradle.properties"
if grep -q "^reactNativeArchitectures=" "$GP"; then
  sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=armeabi-v7a,arm64-v8a/' "$GP"
  log "ABI 已钉为 armeabi-v7a,arm64-v8a"
fi
log "gradle assembleRelease（arm64+v7a，首次 15-30 分钟）…"
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
