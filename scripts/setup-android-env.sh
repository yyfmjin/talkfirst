#!/usr/bin/env bash
# 本机 Android 工具链（Windows / Git Bash）。装在 D:\Android —— 纯 ASCII 路径。
#
# 为什么装在 D 盘、而且必须是 ASCII 路径：
#   1. C 盘空间紧（约 48G 可用），D 盘空闲 570G；
#   2. **路径含中文**是本仓库踩过两次的坑：Windows 版 hermesc 在中文路径下以退出码 6
#      失败（OTA 发不出去就是这个原因）；gradle / adb 对非 ASCII 路径同样不友好。
#      仓库本身在 D:\文件\网站\TalkFirst（含中文），所以本地构建如果要跑通，
#      还得在 ASCII 路径下另克隆一份；这个脚本先把**工具链**装对。
#
# 装完得到：JDK 17、Android SDK（platform-tools / android-35 / build-tools / emulator）
# 以及一个可启动的模拟器，用来在发布前**自己装上跑一遍**。
#
# 用法：bash scripts/setup-android-env.sh        （下载量约 2.5GB，第一次 20–40 分钟）
set -uo pipefail

BASE="/d/Android"
SDK="$BASE/sdk"
JDK="$BASE/jdk17"
WIN_SDK='D:\Android\sdk'
WIN_JDK='D:\Android\jdk17'

log() { echo "[$(date +%H:%M:%S)] $*"; }

mkdir -p "$BASE" "$SDK"

# ── 1. JDK 17 ────────────────────────────────────────────────────────────────
if [ ! -x "$JDK/bin/java.exe" ]; then
  log "下载 JDK 17（Temurin）…"
  curl -L --ssl-no-revoke -o /tmp/jdk17.zip \
    "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" || exit 1
  log "解压 JDK…"
  rm -rf /tmp/jdkx && mkdir -p /tmp/jdkx
  (cd /tmp/jdkx && unzip -q -o /tmp/jdk17.zip) || exit 1
  inner="$(find /tmp/jdkx -maxdepth 1 -type d -name 'jdk*' | head -1)"
  [ -n "$inner" ] || { echo "解压后找不到 jdk 目录"; exit 1; }
  rm -rf "$JDK" && mv "$inner" "$JDK"
fi
export JAVA_HOME="$WIN_JDK"
export PATH="$JDK/bin:$PATH"
log "JDK：$( "$JDK/bin/java.exe" -version 2>&1 | head -1 )"

# ── 2. Android cmdline-tools ─────────────────────────────────────────────────
SM="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"
if [ ! -f "$SM" ]; then
  log "下载 Android cmdline-tools…"
  curl -L --ssl-no-revoke -o /tmp/cmdtools.zip \
    "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" || exit 1
  rm -rf /tmp/cmdt && mkdir -p /tmp/cmdt
  (cd /tmp/cmdt && unzip -q -o /tmp/cmdtools.zip) || exit 1
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv /tmp/cmdt/cmdline-tools "$SDK/cmdline-tools/latest" || exit 1
fi

export ANDROID_HOME="$WIN_SDK"
export ANDROID_SDK_ROOT="$WIN_SDK"

# ── 3. SDK 组件 ──────────────────────────────────────────────────────────────
log "安装 platform-tools / android-35 / build-tools / emulator…"
yes | "$SM" --sdk_root="$WIN_SDK" \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator" 2>&1 | tail -4

log "安装系统镜像 system-images;android-35;google_apis;x86_64（约 1.5GB）…"
yes | "$SM" --sdk_root="$WIN_SDK" \
  "system-images;android-35;google_apis;x86_64" 2>&1 | tail -4

log "接受许可…"
yes | "$SM" --sdk_root="$WIN_SDK" --licenses 2>&1 | tail -2

log "完成。SDK 内容："
ls "$SDK"
log "下一步：bash scripts/create-avd.sh  （建模拟器并启动）"
