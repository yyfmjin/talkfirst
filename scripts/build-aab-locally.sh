#!/usr/bin/env bash
# 本机出 Google Play 用的 AAB（Android App Bundle）。
#
# 与 build-apk-locally.sh 的区别：
#   • 产物是 .aab（Play 只收 AAB，不收 APK）；
#   • 每次 **prebuild --clean**，让 app.json 成为唯一事实源
#     （blockedPermissions / versionCode / targetSdkVersion 都靠它生效）；
#   • 签名用 keystore.properties 读密钥，不把口令写进 build.gradle。
#
# 前提：克隆到纯 ASCII 路径 D:\talkfirst（中文路径下 hermesc / gradle 会挂）。
# 用法：bash scripts/build-aab-locally.sh [版本号，如 0.1.3]
set -uo pipefail

SRC="D:/文件/网站/TalkFirst"
DEST=/d/talkfirst
KS_DIR=/d/Android/keystores
KS="$KS_DIR/talkfirst-play-upload.keystore"
OUT_DIR=/d/Android/play

export ANDROID_HOME='D:\Android\sdk'
export ANDROID_SDK_ROOT='D:\Android\sdk'
export JAVA_HOME='D:\Android\jdk17'
export PATH="/d/Android/jdk17/bin:/d/Android/sdk/platform-tools:$PATH"
export EXPO_NO_METRO_WORKSPACE_ROOT=1

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── 1. 同步代码（本地 fetch，绕开 GitHub 连不上）────────────────────────────
if [ ! -d "$DEST/.git" ]; then
  log "克隆到 $DEST（纯 ASCII 路径）…"
  git clone "$SRC" "$DEST" || exit 1
fi
cd "$DEST" || exit 1
# REF 默认 master；在分支上试升级时用 `REF=feat/xxx bash scripts/build-aab-locally.sh`，
# 否则会把待验证的改动当成 master 构建（曾经踩过）。
REF="${REF:-master}"
git fetch -q "$SRC" "$REF" || { log "fetch 失败（$REF）"; exit 1; }
git reset -q --hard FETCH_HEAD || exit 1
log "构建分支：$REF"
log "代码：$(git log --oneline -1)"

# ── 2. 检查上传密钥（prebuild --clean 会删掉 android/，密钥必须放在仓库外）───
mkdir -p "$KS_DIR" "$OUT_DIR"
if [ ! -f "$KS" ]; then
  # 不再自动回退到旧的 talkfirst-local.keystore：那把口令是弱口令，
  # 只适合侧载调试，拿它当 Play 上传密钥等于把发版权限交出去。
  log "错误：找不到 Play 上传密钥 $KS"
  log "先跑：bash scripts/new-upload-key.sh"
  exit 1
fi
if [ ! -f "$KS_DIR/keystore.properties" ]; then
  cat > "$KS_DIR/keystore.properties" <<'PROPS'
# storeFile 必须是 **Windows 路径**（正斜杠）：gradle 按 JVM 的 File 解析，
# 写 MSYS 的 /d/... 会被当成相对路径拼到 android/app 下面。
storeFile=D:/Android/keystores/talkfirst-upload.keystore
storePassword=talkfirst-local
keyAlias=talkfirst
keyPassword=talkfirst-local
PROPS
  sed -i "s|^storeFile=.*|storeFile=D:/Android/keystores/talkfirst-upload.keystore|" "$KS_DIR/keystore.properties"
  chmod 600 "$KS_DIR/keystore.properties"
  log "写入 $KS_DIR/keystore.properties（密钥口令，别提交、别外传）"
fi

# ── 3. 依赖 ──────────────────────────────────────────────────────────────────
# 不能只看「node_modules 存不存在」：升级 SDK 后 lockfile 变了，而克隆目录里的旧
# node_modules 依然存在 —— 结果 prebuild 用了新配置，gradle 编的却是旧版 RN
# （实测：SDK 54 的代码却链着 react-android 0.76.7，16 KB 检查直接不过）。
# 用 lockfile 与 npm 自己的标记文件比时间，依赖变更才重装。
LOCK="$DEST/package-lock.json"
MARK="$DEST/node_modules/.package-lock.json"
if [ ! -d "$DEST/node_modules" ] || [ ! -f "$MARK" ] || [ "$LOCK" -nt "$MARK" ]; then
  log "依赖有变更（package-lock 比安装标记新），npm ci（约 3-5 分钟）…"
  # 上一次构建的 gradle 守护进程会往 node_modules/@react-native/gradle-plugin/.gradle
  # 里写锁文件，npm ci 删目录时报 EBUSY: resource busy or locked。先停 daemon 再删。
  if [ -x "$DEST/apps/mobile/android/gradlew" ]; then
    ( cd "$DEST/apps/mobile/android" && ./gradlew --stop >/dev/null 2>&1 )
  fi
  rm -rf "$DEST/node_modules/@react-native/gradle-plugin/.gradle" 2>/dev/null
  ( cd "$DEST" && npm ci --legacy-peer-deps >/tmp/aab-npmci.log 2>&1 ) || {
    if grep -q EBUSY /tmp/aab-npmci.log; then
      log "仍被占用，删掉 node_modules 后重试…"
      sleep 5
      rm -rf "$DEST/node_modules" 2>/dev/null
      ( cd "$DEST" && npm ci --legacy-peer-deps >/tmp/aab-npmci.log 2>&1 ) || { tail -20 /tmp/aab-npmci.log; exit 1; }
    else
      tail -20 /tmp/aab-npmci.log; exit 1
    fi
  }
fi

# ── 4. 重新生成 android/ 工程 ────────────────────────────────────────────────
cd "$DEST/apps/mobile" || exit 1
log "expo prebuild --clean（app.json 是唯一事实源）…"
rm -rf android
npx expo prebuild --platform android --no-install >/tmp/aab-prebuild.log 2>&1 || {
  tail -30 /tmp/aab-prebuild.log; exit 1;
}

MANIFEST="$DEST/apps/mobile/android/app/src/main/AndroidManifest.xml"
# 只看真正保留的权限：blockedPermissions 生成的是 <uses-permission ... tools:node="remove"/>
# —— 那行是「移除指令」，不是权限声明。不按行过滤的话自检永远误报。
GNAME=$(grep 'uses-permission' "$MANIFEST" | grep -v 'tools:node="remove"' \
  | grep -o 'android.permission.[A-Z_]*' | sort -u | tr '\n' ' ')
log "清单里保留的权限：$GNAME"
case "$GNAME" in
  *RECORD_AUDIO*|*SYSTEM_ALERT_WINDOW*|*CAMERA*|*READ_EXTERNAL_STORAGE*)
    log "错误：blockedPermissions 没生效，清单里仍有敏感权限，停止"; exit 1;;
esac

# ── 5. 签名：release 指向 keystore.properties 里的 upload key ────────────────
BG="$DEST/apps/mobile/android/app/build.gradle"
cp "$KS_DIR/keystore.properties" "$DEST/apps/mobile/android/keystore.properties"
cat >> "$BG" <<'SIGNING'

// ── build-aab-locally.sh 追加：release 用 upload key 签名 ──────────────────
def tfKeystore = new Properties()
def tfKeystoreFile = rootProject.file("keystore.properties")
if (tfKeystoreFile.exists()) {
    tfKeystore.load(new FileInputStream(tfKeystoreFile))
}
android {
    signingConfigs {
        talkfirstUpload {
            if (tfKeystoreFile.exists()) {
                storeFile file(tfKeystore['storeFile'])
                storePassword tfKeystore['storePassword']
                keyAlias tfKeystore['keyAlias']
                keyPassword tfKeystore['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.talkfirstUpload
        }
    }
}
SIGNING

# ── 6. 热更新渠道 meta-data（prebuild 不会写，缺了 OTA 收不到）───────────────
if ! grep -q "UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" "$MANIFEST"; then
  python - "$MANIFEST" <<'PY'
import io, sys
path = sys.argv[1]
html = io.open(path, encoding='utf-8').read()
meta = ('    <meta-data\n'
        '      android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"\n'
        "      android:value='{\"expo-channel-name\":\"preview\"}' />\n")
io.open(path, 'w', encoding='utf-8').write(html.replace('</application>', meta + '  </application>', 1))
PY
  log "已写入 expo-channel-name=preview"
fi

# ── 7. 出 AAB ────────────────────────────────────────────────────────────────
cd "$DEST/apps/mobile/android" || exit 1
log "gradle bundleRelease（首次 10-25 分钟）…"
./gradlew bundleRelease --no-daemon >/tmp/aab-gradle.log 2>&1
STATUS=$?
if [ $STATUS -ne 0 ]; then
  log "gradle 失败（exit $STATUS），最后 40 行："
  tail -40 /tmp/aab-gradle.log
  exit 1
fi

AAB=$(ls -1 "$DEST"/apps/mobile/android/app/build/outputs/bundle/release/*.aab 2>/dev/null | head -1)
[ -n "$AAB" ] || { log "没找到产物"; exit 1; }
# 版本号用 node 读（app.json 带注释，JSON.parse 不行，用 @expo/config 的 json5）；
# 不写 python：Windows 上的 python 读不了 MSYS 的 /d/... 路径，会静默得到空字符串。
VER=$(cd "$DEST/apps/mobile" && node -e "const j=require('@expo/config').getConfig(process.cwd()).exp.version;console.log(j)" 2>/dev/null)
[ -n "$VER" ] || VER=$(grep -m1 '"version"' "$DEST/apps/mobile/app.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
cp "$AAB" "$OUT_DIR/talkfirst-$VER.aab"
log "出包成功：$OUT_DIR/talkfirst-$VER.aab（$(( $(stat -c %s "$AAB") / 1048576 ))MB）"

# ── 7.5 16 KB 页对齐闸门 ────────────────────────────────────────────────────
# Play 对面向 Android 15+ 的应用要求 64 位原生库按 16 KB 对齐。不过就直接失败：
# 这种问题到了上架阶段才被驳，代价是一整轮审核。确需跳过时 SKIP_16KB=1。
if [ "${SKIP_16KB:-0}" != "1" ]; then
  python "$SRC/scripts/check-16kb.py" "$AAB" || {
    log "16 KB 对齐未通过 —— 通常是依赖没重装（旧版 RN 的预编译库）"
    exit 1
  }
fi

# ── 8. 用合并后的清单自检（版本号 / 权限 / targetSdk）───────────────────────
MERGED=$(find "$DEST/apps/mobile/android/app/build/intermediates/merged_manifests" -name AndroidManifest.xml | head -1)
if [ -n "$MERGED" ]; then
  log "合并清单：$MERGED"
  grep -oE 'android:versionCode="[0-9]+"|android:versionName="[^"]+"|targetSdkVersion="[0-9]+"' "$MERGED" | sort -u
  grep -o 'android.permission.[A-Z_]*' "$MERGED" | sort -u | tr '\n' ' '; echo
fi
