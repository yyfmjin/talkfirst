#!/usr/bin/env bash
# 生成 Google Play 的**上传密钥**（upload key）。
#
# 为什么单独一把：
#   • 之前本地出包用的 talkfirst-local.keystore 口令是 `talkfirst-local`，只用于
#     自签名 APK 侧载；它一旦成为 Play 的上传密钥，弱口令就等于把发版权限交出去。
#   • Play App Signing 下，上传密钥只负责「证明这个 AAB 是你上传的」，
#     真正的应用签名密钥由 Google 保管 —— 所以现在换钥匙是安全的，
#     不需要和已安装的侧载版本保持同一签名（那些用户本来也要重装 Play 版本）。
#
# 产物（都在仓库之外，不会被提交）：
#   /d/Android/keystores/talkfirst-play-upload.keystore   密钥本体
#   /d/Android/keystores/keystore.properties              gradle 读的口令（chmod 600）
#   /d/Android/keystores/UPLOAD-KEY-README.txt            备份说明 + 口令副本
#
# 用法：bash scripts/new-upload-key.sh
set -uo pipefail

KS_DIR=/d/Android/keystores
KS="$KS_DIR/talkfirst-play-upload.keystore"
PROPS="$KS_DIR/keystore.properties"
README="$KS_DIR/UPLOAD-KEY-README.txt"
ALIAS=talkfirst
export PATH="/d/Android/jdk17/bin:$PATH"

if [ -f "$KS" ]; then
  echo "已存在 $KS —— 不覆盖（覆盖会让已上传的版本再也对不上）。"
  echo "确实要换，先手动把它挪走并备份。"
  exit 1
fi

mkdir -p "$KS_DIR"

# 24 字节随机 → base64 → 去掉 base64 里会让 .properties 解析出岔子的字符
PASS=$(python -c "import secrets,base64;print(base64.b64encode(secrets.token_bytes(24)).decode().replace('/','_').replace('+','-').replace('=',''))")

keytool -genkeypair -v \
  -keystore "$KS" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storetype PKCS12 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=TalkFirst, OU=Mobile, O=TalkFirst, L=Shanghai, C=CN" >/tmp/keygen.log 2>&1 || {
    echo "keytool 失败："; tail -5 /tmp/keygen.log; exit 1; }

chmod 600 "$KS"

cat > "$PROPS" <<PROPS
storeFile=D:/Android/keystores/talkfirst-play-upload.keystore
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
PROPS
chmod 600 "$PROPS"

FP=$(keytool -list -v -keystore "$KS" -storepass "$PASS" 2>/dev/null \
  | grep -E "SHA256:" | head -1 | sed 's/.*SHA256: //')

cat > "$README" <<README
TalkFirst —— Google Play 上传密钥

文件：$KS
别名：$ALIAS
口令：$PASS
SHA-256：$FP
生成时间：$(date '+%Y-%m-%d %H:%M')

怎么备份（三份，别只留一份）：
  1. 密码管理器里存：口令 + SHA-256 指纹
  2. 离线介质（U 盘/移动硬盘）存 talkfirst-play-upload.keystore 本体
  3. 云盘私密目录再存一份 .keystore

丢了会怎样：
  上传密钥丢失不影响已上架的 App（签名密钥在 Google 那边），
  但**没有它就发不了新版**，只能向 Google 申请重置上传密钥（需要申诉，通常几天）。
README
chmod 600 "$README"

echo "生成完成：$KS"
echo "别名：$ALIAS"
echo "SHA-256：$FP"
echo "口令与备份说明：$README"
