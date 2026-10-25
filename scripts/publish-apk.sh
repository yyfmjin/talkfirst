#!/usr/bin/env bash
# 发版收尾：把打好的安装包发布到位（2026-10-25）。
#
# 为什么需要这个脚本：0.1.3–0.1.6 一路都只传到了**带版本号的新文件名**，而官网的
# `/download/android` 一直指向固定的 `/apk/talkfirst.apk` —— 那个文件停在 0.1.2，
# 用户下载到的永远是旧版。发版流程缺的就是这一步。
#
# 用法：
#   bash scripts/publish-apk.sh --apk D:/Android/play/talkfirst-0.1.6.apk
#   bash scripts/publish-apk.sh --aab D:/Android/play/talkfirst-0.1.6.aab
#   bash scripts/publish-apk.sh --apk <apk> --aab <aab>     # 两个一起
#
# APK 会：校验版本 → 上传两份（版本化 + 官网固定入口）→ 重启 web → 公网下载比对 sha256。
# AAB 会：校验版本 → 16 KB 对齐闸门 → 归档到 play 目录 → 把文档里的路径/版本号改写掉。
set -uo pipefail

APK=""
AAB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apk) APK=${2:-}; shift 2 ;;
    --aab) AAB=${2:-}; shift 2 ;;
    *) APK=${1:-}; shift ;;   # 兼容旧的「直接把 APK 路径当第一个参数」
  esac
done

[ -n "$APK" ] || [ -n "$AAB" ] || {
  echo "用法: bash scripts/publish-apk.sh --apk <apk> [--aab <aab>]"
  exit 1
}

REPO=$(cd "$(dirname "$0")/.." && pwd)
HOST=ubuntu@18.216.101.31
SSH="ssh -o ConnectTimeout=30 -i $HOME/.ssh/id_ed25519 $HOST"
REMOTE_DIR=/home/ubuntu/talkfirst/apps/web/public/apk
AAPT=/d/Android/sdk/build-tools/36.0.0/aapt2.exe
BASE=https://talkfirst.ccwu.cc
PLAY_DIR=/d/Android/play

# Windows 版 node 不认识 MSYS 的 /d/... 路径，必须 cd 进目录再用相对路径。
VER=$(cd "$REPO/apps/mobile" && node -e "const s=require('fs').readFileSync('app.json','utf8').replace(/\/\*[\s\S]*?\*\//g,'');console.log(JSON.parse(s).expo.version)")
CODE=$(cd "$REPO/apps/mobile" && node -e "const s=require('fs').readFileSync('app.json','utf8').replace(/\/\*[\s\S]*?\*\//g,'');console.log(JSON.parse(s).expo.android.versionCode)")
[ -n "$VER" ] || { echo "读不到 app.json 的版本号"; exit 1; }

# ── APK：发布到官网 ────────────────────────────────────────────────────────
if [ -n "$APK" ]; then
  [ -f "$APK" ] || { echo "APK 不存在: $APK"; exit 1; }
  BADGING=$("$AAPT" dump badging "$APK" 2>/dev/null | head -1)
  APK_VER=$(echo "$BADGING" | sed -E "s/.*versionName='([^']+)'.*/\1/")
  [ "$VER" = "$APK_VER" ] || { echo "版本不一致：app.json=$VER，APK=$APK_VER —— 拒绝发布"; exit 1; }
  echo "发布 APK $VER（versionCode $CODE）"

  SHA=$(sha256sum "$APK" | cut -d' ' -f1)
  scp -q -i "$HOME/.ssh/id_ed25519" "$APK" "$HOST:$REMOTE_DIR/talkfirst-$VER.apk" || exit 1
  $SSH "cd $REMOTE_DIR && cp talkfirst-$VER.apk talkfirst.apk" || exit 1
  $SSH "export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:\$PATH; pm2 restart talkfirst-web >/dev/null 2>&1" || exit 1
  sleep 6

  REMOTE_SHA=$(curl -s -m 300 -L "$BASE/download/android" | sha256sum | cut -d' ' -f1)
  echo "本地 sha256: $SHA"
  echo "线上 sha256: $REMOTE_SHA"
  if [ "$SHA" = "$REMOTE_SHA" ]; then
    echo "✅ $BASE/download/android 已指向 $VER"
  else
    echo "❌ 线上内容与本地不一致，检查 nginx / public 目录"
    exit 1
  fi
fi

# ── AAB：归档 + 16 KB 闸门 + 文档回填 ──────────────────────────────────────
if [ -n "$AAB" ]; then
  [ -f "$AAB" ] || { echo "AAB 不存在: $AAB"; exit 1; }

  # AAB 是 zip，二进制清单里能搜到 versionName 的 UTF-8 字节；用它挡「传错包」。
  FOUND=$(python - "$AAB" "$VER" <<'PY'
import sys, zipfile
aab, ver = sys.argv[1], sys.argv[2]
try:
    blob = zipfile.ZipFile(aab).read("base/manifest/AndroidManifest.xml")
except Exception as exc:            # noqa: BLE001 - 传给脚本的是任意路径
    print(f"unreadable: {exc}")
    raise SystemExit(0)
print("ok" if ver.encode() in blob else "missing")
PY
)
  [ "$FOUND" = "ok" ] || { echo "AAB 里找不到版本 $VER（$FOUND）—— 拒绝发布"; exit 1; }

  # 必须 cd 进仓库再用相对脚本路径（同 node 那条：Windows 解释器不认 /d/... 的脚本路径，
  # 但参数里的 POSIX 路径会被 MSYS 自动转换，所以 AAB 路径可以直接传）。
  if ! ( cd "$REPO" && python scripts/check-16kb.py "$AAB" ) > /tmp/aab-16kb.log 2>&1; then
    tail -3 /tmp/aab-16kb.log
    echo "❌ 16 KB 对齐未通过，AAB 不能上传 Play"
    exit 1
  fi

  mkdir -p "$PLAY_DIR"
  cp "$AAB" "$PLAY_DIR/talkfirst-$VER.aab"
  SIZE_MB=$(( $(stat -c %s "$PLAY_DIR/talkfirst-$VER.aab") / 1048576 ))
  echo "归档 AAB：$PLAY_DIR/talkfirst-$VER.aab（${SIZE_MB}MB，versionCode $CODE）"

  # 文档里的路径与版本号是手写的，每次发版都会过期 —— 在这里一次改掉。
  python - "$REPO" "$VER" "$CODE" "$SIZE_MB" <<'PY'
import io, sys
repo, ver, code, size = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

# 路径用 chr(92) 拼：源码里写反斜杠字面量会被当转义（\t 变制表符、\A 报错），
# 这个坑踩过两次了。
SEP = chr(92)
aab_path = f"D:{SEP}Android{SEP}play{SEP}talkfirst-{ver}.aab"


def rewrite(path, matcher, build):
    lines = io.open(path, encoding="utf-8").read().split("\n")
    hit = 0
    for index, line in enumerate(lines):
        if matcher(line):
            lines[index] = build()
            hit += 1
    io.open(path, "w", encoding="utf-8").write("\n".join(lines))
    return hit


n1 = rewrite(
    f"{repo}/docs/PLAY-STORE.md",
    lambda line: line.startswith("| AAB（交给 Play 的文件） |"),
    lambda: f"| AAB（交给 Play 的文件） | `{aab_path}`（{size}MB，versionCode {code}，targetSdk 36） |",
)
n2 = rewrite(
    f"{repo}/docs/PLAY-SUBMISSION-CHECKLIST.md",
    lambda line: line.startswith("- [ ] `versionCode` 比上一次上传的大"),
    lambda: f"- [ ] `versionCode` 比上一次上传的大（当前 `{code}`，versionName `{ver}`）",
)
print(f"文档已同步：PLAY-STORE.md({n1}) / PLAY-SUBMISSION-CHECKLIST.md({n2})")
PY
fi
