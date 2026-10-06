#!/usr/bin/env bash
#
# backup-db.sh — 服务器端数据库备份（含保留策略），可挂 cron。
#
#   scripts/backup-db.sh              # 备份一次，保留最近 14 份
#   scripts/backup-db.sh --keep 30    # 换保留份数
#   scripts/backup-db.sh --dir /path  # 换输出目录（默认 ~/talkfirst-backups）
#
# 用法（在服务器上，cron 里也是这一行）：
#   15 3 * * * /home/ubuntu/talkfirst/scripts/backup-db.sh >> /home/ubuntu/talkfirst-backups/backup.log 2>&1
#
# ## 为什么输出目录必须在仓库外
#
# `scripts/deploy-pull.sh` 要求工作区干净（`git status --porcelain` 为空）才会部署。
# 备份写进仓库目录会让每次部署都被自己拦下 —— 所以默认落在 `~/talkfirst-backups`。
#
# ## 顺序上的两个要点
#
# 1. **先校验，再清理旧份**。今天这次没成功（连接失败 / 文件是空的 / gzip 自检不过）
#    就**不**删任何历史备份 —— 否则一次故障会顺手把仅有的历史也清掉。
# 2. 用 `gzip` 后再落盘，并在写完做一次 `gzip -t` 完整性检查。dump 到一半被中断时，
#    留一个能看出来是坏的 `.gz`，好过留一个看不出坏在哪的 `.sql`。
#
# ## 恢复（rollback）步骤
#
#   代码：cd ~/talkfirst && git fetch origin && git log --oneline -5   # 找到要回退到的提交
#         git checkout <commit> -- .                                  # 或 git reset --hard <commit>（会丢本地改动）
#         然后 scripts/deploy-pull.sh
#   数据库：gunzip -c ~/talkfirst-backups/talkfirst-<时间>.sql.gz | psql "$DATABASE_URL"
#         （`psql` 会按 dump 里的 DROP/CREATE 重建对象；**先停 API 再恢复**更稳：
#          pm2 stop talkfirst-api && 恢复 && pm2 start talkfirst-api）
#
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."
ROOT_DIR=$(pwd)

KEEP=14
DEST="${HOME}/talkfirst-backups"

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=${2:?--keep 需要一个数字}; shift 2 ;;
    --dir)  DEST=${2:?--dir 需要一个路径};  shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

case "$KEEP" in
  ''|*[!0-9]*) echo "--keep 必须是非负整数，当前是 '$KEEP'" >&2; exit 2 ;;
esac

log()  { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die()  { printf '%s 错误: %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

[ -f .env ] || die "缺少 .env（本脚本从它读 DATABASE_URL）"

# 从 .env 读一个键，不 source 它（source 会执行任意代码）。
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env \
    | tail -n 1 \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    | tr -d '\r'
}

DB_URL=$(env_value DATABASE_URL)
[ -n "$DB_URL" ] || die "DATABASE_URL 不在 .env 里"

command -v pg_dump >/dev/null 2>&1 || die "找不到 pg_dump"
command -v gzip >/dev/null 2>&1 || die "找不到 gzip"

mkdir -p "$DEST"

# `?schema=public` 这类查询参数 psql/pg_dump 不认，去掉。
DB_URL=${DB_URL%%\?*}
STAMP=$(date '+%Y%m%d-%H%M')
OUT="$DEST/talkfirst-$STAMP.sql.gz"
TMP="$OUT.partial"

log "开始备份 → $OUT"
if ! pg_dump "$DB_URL" | gzip -9 > "$TMP"; then
  rm -f "$TMP"
  die "pg_dump 失败，未改动任何历史备份"
fi

# 校验：非空 + gzip 自检通过。任一不过就当作失败，保留历史。
if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  die "备份文件是空的，未改动任何历史备份"
fi
if ! gzip -t "$TMP" 2>/dev/null; then
  rm -f "$TMP"
  die "备份文件 gzip 自检不通过，未改动任何历史备份"
fi

mv "$TMP" "$OUT"
SIZE=$(du -h "$OUT" | cut -f1)
log "完成：$OUT（$SIZE）"

# 只有这次成功之后，才清理超出的旧份（文件名带时间戳，按名排序即按时间排序）。
mapfile -t OLD < <(ls -1t "$DEST"/talkfirst-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if [ "${#OLD[@]}" -gt 0 ]; then
  for f in "${OLD[@]}"; do
    rm -f "$f"
    log "清理旧备份：$f"
  done
else
  log "保留份数未超过 $KEEP，无需清理"
fi
