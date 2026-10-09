#!/usr/bin/env bash
# 在本地 Android 模拟器上装**线上那个包**，启动并截图 —— 发布前自己看一眼。
#
# 为什么要有这一步：2026-10-09 的闪退事故，本质是把**没在任何设备上跑过**的包推给了真人。
# 这个脚本把"看一眼"变成一条命令。
#
# 前提：先跑过 scripts/setup-android-env.sh
# 用法：
#   bash scripts/verify-apk-on-emulator.sh                    # 装官网当前的包
#   bash scripts/verify-apk-on-emulator.sh <apk-url-or-path>  # 装指定的包
#
# 踩过的三个坑（都已在代码里绕开，别再改回去）：
#   1. **avdmanager 必须用 cmd.exe 调**。Git Bash 传过去的 ANDROID_HOME 会被 MSYS
#      路径转换弄坏，avdmanager 报 "Valid system image paths are: null"。
#   2. **下载要重试 + 校验**。本机直连境外不稳定：APK 下到 81 字节、系统镜像下到 33%
#      就被截断（报 "Error on ZipFile unknown archive"）。所以带 --retry，并检查大小与
#      PK 魔数；系统镜像按累计体积判断是否装完。
#   3. **模拟器无窗口启动**，截图靠 adb（这台机器不需要真的开图形界面）。
set -uo pipefail

BASE=/d/Android
SDK="$BASE/sdk"
AVD=tf_test
PKG=com.talkfirst.app
IMG="system-images;android-35;google_apis;x86_64"
OUT_DIR="$BASE/shots"

WIN_SDK='D:\Android\sdk'
WIN_JDK='D:\Android\jdk17'
export ANDROID_HOME="$WIN_SDK"
export ANDROID_SDK_ROOT="$WIN_SDK"
export JAVA_HOME="$WIN_JDK"
export PATH="$BASE/jdk17/bin:$SDK/platform-tools:$SDK/emulator:$PATH"

SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"
mkdir -p "$OUT_DIR"

# ── 0. 系统镜像（缺了就下，带重试）────────────────────────────────────────────
img_size() { du -sm "$SDK/system-images" 2>/dev/null | cut -f1; }
if [ "$(img_size || echo 0)" -lt 800 ]; then
  echo "[0/5] 系统镜像未装好（当前 $(img_size)MB），开始下载（约 1.5GB，带重试）…"
  for attempt in 1 2 3 4 5; do
    echo "      —— 第 $attempt 次"
    yes | "$SDKM" --sdk_root="$WIN_SDK" "$IMG" 2>&1 | tail -1
    [ "$(img_size || echo 0)" -gt 800 ] && { echo "      镜像已就绪"; break; }
    sleep 5
  done
  [ "$(img_size || echo 0)" -gt 800 ] || { echo "镜像仍不完整，放弃（网络不稳）。先解决网络再跑。"; exit 1; }
fi

# ── 1. 目标包 ────────────────────────────────────────────────────────────────
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "[1/5] 取官网当前下载地址…"
  TARGET="$(curl -sS --ssl-no-revoke -o /dev/null -w '%{redirect_url}' https://talkfirst.ccwu.cc/download/android)"
fi
echo "      目标包：$TARGET"

APK="$BASE/talkfirst-under-test.apk"
if [ -f "$TARGET" ]; then
  cp "$TARGET" "$APK"
else
  echo "[1/5] 下载 APK（带重试）…"
  curl -L --ssl-no-revoke --retry 5 --retry-all-errors -C - -o "$APK" "$TARGET" || true
fi
SIZE=$(stat -c %s "$APK" 2>/dev/null || echo 0)
MAGIC=$(head -c 2 "$APK" 2>/dev/null)
echo "      大小：$((SIZE/1024/1024))MB，魔数：$MAGIC"
if [ "$SIZE" -lt 10000000 ] || [ "$MAGIC" != "PK" ]; then
  echo "APK 不完整（不是有效的 zip/apk）。下载被截断了 —— 网络问题，重跑即可。"
  exit 1
fi

# ── 2. AVD（用 cmd.exe 建，见文件头坑 1）──────────────────────────────────────
echo "[2/5] 准备模拟器 $AVD…"
HAS_AVD=$(cmd.exe /c "set ANDROID_HOME=$WIN_SDK&& $SDK/cmdline-tools/latest/bin/avdmanager.bat list avd" 2>/dev/null | grep -c "$AVD" || true)
if [ "${HAS_AVD:-0}" -eq 0 ]; then
  echo no | cmd.exe /c "set ANDROID_HOME=$WIN_SDK&& set ANDROID_SDK_ROOT=$WIN_SDK&& set JAVA_HOME=$WIN_JDK&& $SDK/cmdline-tools/latest/bin/avdmanager.bat create avd -n $AVD -k \"$IMG\" --device pixel_6 --force" 2>&1 | tail -3
fi

# ── 3. 启动模拟器 ────────────────────────────────────────────────────────────
echo "[3/5] 启动模拟器（无窗口）…"
adb start-server >/dev/null 2>&1
if ! adb devices | grep -q "emulator-"; then
  "$SDK/emulator/emulator.exe" -avd "$AVD" -no-window -no-audio -no-boot-anim \
    -gpu swiftshader_indirect -no-snapshot >"$BASE/emulator.log" 2>&1 &
fi
adb wait-for-device
printf "      等待开机"
for _ in $(seq 1 120); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  printf "."; sleep 5
done
echo
adb shell getprop sys.boot_completed | tr -d '\r' | sed 's/^/      boot_completed=/'

# ── 4. 安装 + 启动 ───────────────────────────────────────────────────────────
echo "[4/5] 安装并启动…"
adb install -r "$APK" 2>&1 | tail -2
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 25

# ── 5. 截图 + 崩溃日志 ───────────────────────────────────────────────────────
SHOT="$OUT_DIR/launch-$(date +%H%M%S).png"
adb exec-out screencap -p > "$SHOT"
echo "[5/5] 启动截图：$SHOT（$(stat -c %s "$SHOT" 2>/dev/null) 字节）"
echo "      崩溃日志（应为空）："
adb logcat -d 2>/dev/null | grep -iE "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS.*Error" | tail -15
echo "完成。"
