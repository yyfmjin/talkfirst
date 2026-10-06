#!/usr/bin/env bash
#
# rotate-secrets.sh — 轮换会话类密钥，并保证「换完还能用」。
#
#   scripts/rotate-secrets.sh                 # 轮换默认那三个键
#   scripts/rotate-secrets.sh --keys JWT_SECRET
#   scripts/rotate-secrets.sh --dry-run      # 只打印会做什么，不写任何文件
#
# 服务器 cron（每周日 03:45）：
#   45 3 * * 0 bash /home/ubuntu/talkfirst/scripts/rotate-secrets.sh >> /home/ubuntu/talkfirst-ops/rotate.log 2>&1
#
# ## 轮换哪些、各自的后果
#
# | 键 | 轮换后果 | 在默认列表里 |
# |---|---|---|
# | `JWT_SECRET` | 所有访问令牌立即失效 → 用户需要重新登录 | 是 |
# | `JWT_REFRESH_SECRET` | 所有刷新令牌失效 → 同上 | 是 |
# | `SECURITY_DEVICE_SALT` | 设备指纹重算：**同一台设备下周会得到不同的 deviceHash**，跨周无法再把它认成同一台设备（设备关联/多账号同设备的排查会只看到一周的窗口） | 是 |
# | `TOKEN_ENCRYPTION_KEY` | **已保存的第三方 token 会全部解不开**（AES-256-GCM，无恢复路径）。生产目前还没启用社交同步，所以现在换是安全的；但一旦启用，**必须先有 key ring（新密钥加密 + 旧密钥只解密）** 才能继续定期轮换 | **否**（见下） |
#
# 所以默认只轮三个；`TOKEN_ENCRYPTION_KEY` 要显式指定 `--keys TOKEN_ENCRYPTION_KEY` 才会动人，
# 并且脚本会在动它之前把「已启用社交同步的话会怎样」再喊一次。
#
# ## 为什么必须同时刷新 pm2 的进程环境
#
# 这个仓库踩过一次：pm2 的进程环境里存着启动时的旧值，而 dotenv **不覆盖已存在的环境变量**。
# 只改 `.env` 然后 `pm2 reload`，进程里仍旧是旧密钥 —— 看起来换了，其实没有。
# 所以这里把新值显式传给 `pm2 restart --update-env`。
#
# ## 自动回滚
#
# 换完立刻验证 `health/ready`。20 秒内不恢复就**自动把 `.env` 与进程环境都退回旧值**并重启，
# 以非零退出。无人值守的每周任务最怕的就是「换完起不来，而且没人知道」。
#
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."
ROOT_DIR=$(pwd)

DEFAULT_KEYS="JWT_SECRET JWT_REFRESH_SECRET SECURITY_DEVICE_SALT"
KEYS="$DEFAULT_KEYS"
DRY_RUN=0
API_PORT=${API_PORT:-4000}

while [ $# -gt 0 ]; do
  case "$1" in
    --keys) KEYS=${2:?--keys 需要一个以空格分隔的键名列表}; shift 2 ;;
    --keys=*) KEYS=${1#*=}; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '%s 错误: %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

[ -f .env ] || die "缺少 .env"

env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env \
    | tail -n 1 \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    | tr -d '\r'
}

healthy() {
  curl -fsS -m 5 "http://127.0.0.1:${API_PORT}/api/v1/health/ready" >/dev/null 2>&1
}

# 0. 换之前必须是健康的。健康时换坏了能看出是这次换的；不健康时换就没法判断谁的责任。
if ! healthy; then
  die "轮换前 API 就不是 ready —— 先处理现有问题，别在故障期间换密钥"
fi
log "轮换前检查：health/ready 正常"

# 1. 生成新值（长度与原值一致：JWT 用 48 字节 base64，设备盐用 32 字节 hex）。
new_value_for() {
  case "$1" in
    SECURITY_DEVICE_SALT) openssl rand -hex 32 ;;
    *) openssl rand -base64 48 | tr -d '\n' ;;
  esac
}

# 2. dry-run 先于任何写入 —— 包括先于备份（否则每周的 dry-run 会积一堆没用的副本）。
if [ "$DRY_RUN" -eq 1 ]; then
  for k in $KEYS; do
    [ -n "$(env_value "$k")" ] && log "dry-run：会轮换 $k" || log "dry-run：$k 不存在于 .env，将跳过"
  done
  exit 0
fi

# 3. 备份 .env（放仓库外，避免弄脏工作区导致部署被拦）。
STAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP="${HOME}/.env.before-rotate-${STAMP}"
cp .env "$BACKUP"
log "已备份 .env → $BACKUP"

# 4. 逐键替换（用 awk 就地改，只碰目标键的行）。
ROTATED=""
OLD_VALUES_FILE=$(mktemp)
NEW_VALUES_FILE=$(mktemp)
trap 'rm -f "$OLD_VALUES_FILE" "$NEW_VALUES_FILE"' EXIT

for k in $KEYS; do
  if [ "$k" = "TOKEN_ENCRYPTION_KEY" ]; then
    log "注意：正在动 TOKEN_ENCRYPTION_KEY —— 若已启用社交同步，已保存的第三方 token 会全部失效"
  fi
  old=$(env_value "$k")
  if [ -z "$old" ]; then
    log "跳过 $k（不在 .env 里）"
    continue
  fi
  new=$(new_value_for "$k")
  printf '%s=%s\n' "$k" "$old" >> "$OLD_VALUES_FILE"
  printf '%s=%s\n' "$k" "$new" >> "$NEW_VALUES_FILE"

  # 用临时文件 + mv 保证写入是原子的：中途失败不会留下半个 .env。
  awk -v key="$k" -v val="$new" '
    BEGIN { done = 0 }
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" { print key "=" val; done = 1; next }
    { print }
    END { if (!done) print key "=" val }
  ' .env > .env.rotate.tmp
  mv .env.rotate.tmp .env
  chmod 600 .env
  ROTATED="${ROTATED}${ROTATED:+, }${k}"
done

[ -n "$ROTATED" ] || die "没有任何键被轮换（--keys 里的键都不在 .env 里）"
log "已轮换（值不打印）：$ROTATED"

# 4. 让进程真正拿到新值：显式带值 restart --update-env（见文件头那一段）。
# shellcheck disable=SC2046
export $(cat "$NEW_VALUES_FILE" | xargs -d '\n') 2>/dev/null || true
pm2 restart talkfirst-api --update-env >/dev/null 2>&1 || {
  log "pm2 restart 失败，正在回滚"
  cp "$BACKUP" .env
  die "已回滚 .env，请人工检查 pm2"
}

# 5. 验证；不通过就自动回滚（.env + 进程环境都退回）。
for i in $(seq 1 10); do
  sleep 2
  if healthy; then
    log "验证通过：health/ready 正常（第 ${i} 次探测）"
    log "轮换完成：$ROTATED"
    exit 0
  fi
done

log "20 秒内 API 未恢复 ready —— 自动回滚"
cp "$BACKUP" .env
chmod 600 .env
# shellcheck disable=SC2046
export $(cat "$OLD_VALUES_FILE" | xargs -d '\n') 2>/dev/null || true
pm2 restart talkfirst-api --update-env >/dev/null 2>&1 || true
sleep 5
if healthy; then
  die "已回滚到旧密钥且服务正常。轮换失败原因需人工排查（pm2 logs talkfirst-api）"
else
  die "回滚后仍不健康 —— 需要立即人工介入（pm2 logs talkfirst-api；旧 .env 在 $BACKUP）"
fi
