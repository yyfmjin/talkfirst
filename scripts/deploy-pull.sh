#!/usr/bin/env bash
#
# deploy-pull.sh — 服务器端「拉取代码并重新部署」脚本。
#
# 用法：
#   scripts/deploy-pull.sh                     # 拉取 → 校验 → 安装 → 构建 → 迁移 → 重启
#   scripts/deploy-pull.sh --no-restart        # 只更新到代码就绪，不动进程
#   scripts/deploy-pull.sh --skip-install      # 依赖没变时省掉 npm ci
#   scripts/deploy-pull.sh --branch main       # 拉别的分支
#
# 它在做什么（按顺序，任一步失败立即中止，绝不半途留下坏状态）：
#   1. 确认在 git 仓库里，且工作区干净 —— 有未提交改动就直接退出，不 stash
#   2. git fetch + 快进合并到 origin/<branch>（--ff-only，永不产生合并提交）
#   3. 校验生产环境变量（下面每个校验都对应一个真实的静默失败）
#   4. npm ci → prisma generate → 构建 api / web / admin → prisma migrate deploy
#   5. 重启进程（pm2 或 systemd）
#
# 为什么第 3 步的校验一个都不能省：
#   NEXT_PUBLIC_API_BASE_URL  是**构建期**注入前端产物的。指向 localhost 的产物
#                             部署后浏览器会去连自己的机器，管理员后台整个打不开。
#   TRUST_PROXY               API 在生产缺失会**拒绝启动**；且它没有安全默认值
#                             （默认信任 1 跳，无代理时访客 IP 可被 X-Forwarded-For 伪造）。
#   SECURITY_DEVICE_SALT      API 在生产缺失会**拒绝启动**（否则设备指纹恒为空）。
#   NODE_ENV / ALLOW_INSECURE_DEFAULTS
#                             必须是 production 且不允许不安全默认值，否则上面两条
#                             校验会被直接绕过。

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/.."
ROOT_DIR=$(pwd)

BRANCH=master
RUN_INSTALL=1
RUN_BUILD=1
RUN_MIGRATE=1
RUN_RESTART=1

while [ $# -gt 0 ]; do
  case "$1" in
    --branch)      BRANCH=${2:?--branch 需要一个分支名}; shift 2 ;;
    --branch=*)    BRANCH=${1#*=}; shift ;;
    --skip-install) RUN_INSTALL=0; shift ;;
    --skip-build)   RUN_BUILD=0; shift ;;
    --skip-migrate) RUN_MIGRATE=0; shift ;;
    --no-restart)   RUN_RESTART=0; shift ;;
    -h|--help)     sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

case "$BRANCH" in
  *[!A-Za-z0-9._/-]*) echo "分支名含非法字符: $BRANCH" >&2; exit 2 ;;
esac

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m警告: %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m错误: %s\033[0m\n' "$*" >&2; exit 1; }

# 从 .env 读一个键，不 source 它（source 会执行任意代码，且值是原样字面量）。
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env \
    | tail -n 1 \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    | tr -d '\r'
}

# .env 缺的键用 shell 环境补齐，写成 .env 供服务读取（.env 在 .gitignore 里）。
upsert_env() {
  key=$1; value=$2
  if grep -qE "^[[:space:]]*${key}[[:space:]]*=" .env 2>/dev/null; then
    return 0
  fi
  printf '\n# 由 scripts/deploy-pull.sh 从 shell 环境补齐\n%s=%s\n' "$key" "$value" >> .env
  warn "已把 $key 写入 .env（它不在 .env 里，但当前 shell 环境有）"
}

# ---------------------------------------------------------------- 0. 前置检查
log "检查运行环境"
command -v git >/dev/null 2>&1 || die "找不到 git"
command -v node >/dev/null 2>&1 || die "找不到 node"
command -v npm  >/dev/null 2>&1 || die "找不到 npm"
[ -d .git ] || die "$ROOT_DIR 不是 git 仓库根目录"

log "检查工作区是否干净"
if [ -n "$(git status --porcelain)" ]; then
  echo "" >&2
  git status --short >&2
  die "工作区有未提交改动。请先人工处理（提交 / 还原 / 移走），脚本不会替你 stash 或覆盖。"
fi
echo "  工作区干净"

# ---------------------------------------------------------------- 1. 拉取代码
log "拉取 origin/$BRANCH"
git fetch origin "$BRANCH"
BEFORE=$(git rev-parse HEAD)
git merge --ff-only "origin/$BRANCH"
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  已是最新（$AFTER），没有新提交"
else
  echo "  $BEFORE -> $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
fi

# ---------------------------------------------------------------- 2. 生产校验
log "校验生产环境配置"
[ -f .env ] || die "缺少 .env（可从 .env.example 或 .env.docker.example 复制后再改）"

NODE_ENV_V=$(env_value NODE_ENV)
[ "$NODE_ENV_V" = "production" ] || die "NODE_ENV 必须是 production，当前是 '${NODE_ENV_V:-<空>}'"

INSECURE_V=$(env_value ALLOW_INSECURE_DEFAULTS)
case "$INSECURE_V" in
  true|TRUE|True|1) die "ALLOW_INSECURE_DEFAULTS=$INSECURE_V 会让 API 以开发默认值运行，生产必须关掉" ;;
esac

TRUST_PROXY_V=$(env_value TRUST_PROXY)
[ -n "$TRUST_PROXY_V" ] || die "TRUST_PROXY 未设置。API 在生产缺它会拒绝启动，且它没有安全默认值：
  0 = 直接暴露（无代理）  1 = 一层反向代理  2 = CDN + 反向代理"
case "$TRUST_PROXY_V" in
  ''|*[!0-9]*) die "TRUST_PROXY 必须是非负整数（跳数），当前是 '$TRUST_PROXY_V'" ;;
esac
echo "  TRUST_PROXY=$TRUST_PROXY_V"

DEVICE_SALT_V=$(env_value SECURITY_DEVICE_SALT)
[ -n "$DEVICE_SALT_V" ] || die "SECURITY_DEVICE_SALT 未设置。API 在生产缺它会拒绝启动（设备指纹会恒为空）。
  生成：node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""

# FIX (2026-10-04): 这两项在下面原本没有校验，但它们同样会让 API 拒绝启动。
# 漏掉它们的后果比漏掉上面两项更隐蔽：部署脚本会一路跑到「重启进程」才由 API 自己
# 报错退出，而那时新版代码已经替换掉了正在运行的旧进程。
TOKEN_KEY_V=$(env_value TOKEN_ENCRYPTION_KEY)
[ -n "$TOKEN_KEY_V" ] || die "TOKEN_ENCRYPTION_KEY 未设置。API 在生产缺它会拒绝启动 —— 它加密库里保存的第三方社交 token（AES-256-GCM），故意没有默认值。
  生成：openssl rand -base64 48
  警告：轮换它会让已保存的第三方 token 全部无法解密，用户需重新绑定（没有恢复路径）。"

API_PUBLIC_V=$(env_value API_PUBLIC_URL)
GOOGLE_ID_V=$(env_value GOOGLE_CLIENT_ID)
case "$API_PUBLIC_V" in
  *localhost*|*127.0.0.1*)
    if [ -n "$GOOGLE_ID_V" ]; then
      die "API_PUBLIC_URL=$API_PUBLIC_V 是本机地址，而 GOOGLE_CLIENT_ID 已配置：
  API 启动时会在 assertOAuthConfiguration 处以「生产部署不允许 loopback 回调地址」为由拒绝启动。
  请设为对外 https 源（例如 https://api.talkfirst.ccwu.cc）—— Google 回调地址由它派生。"
    fi
    warn "API_PUBLIC_URL=$API_PUBLIC_V 指向本机。当前未配置 Google 登录，不影响启动；
      但一旦配上 GOOGLE_CLIENT_ID，生产下的 loopback 地址会让 API 拒绝启动。" ;;
esac
echo "  API_PUBLIC_URL=${API_PUBLIC_V:-<未设置，代码默认 http://localhost:4000>}"

# FIX (2026-10-04): 这两个值都是**构建期**注入前端产物的 —— 改完不重建无效，
# 而缺失或指向本机时，产物里的兜底值是 http://localhost:4000，也就是访客自己的机器。
# 原来的行为是「缺失就写入 localhost 并只给一条警告」，等于默认生成一个坏产物；
# 现在直接中止，且规则（回环一律拒、非 https 一律拒、相对路径允许）集中在
# scripts/check-build-env.mjs，和两个 Dockerfile 的构建阶段用同一份实现。
API_BASE_V=$(env_value NEXT_PUBLIC_API_BASE_URL)
[ -n "$API_BASE_V" ] || API_BASE_V=${NEXT_PUBLIC_API_BASE_URL:-}
SOCKET_BASE_V=$(env_value NEXT_PUBLIC_SOCKET_BASE_URL)
[ -n "$SOCKET_BASE_V" ] || SOCKET_BASE_V=${NEXT_PUBLIC_SOCKET_BASE_URL:-}

if [ -n "$API_BASE_V" ]; then upsert_env NEXT_PUBLIC_API_BASE_URL "$API_BASE_V"; fi
if [ -n "$SOCKET_BASE_V" ]; then upsert_env NEXT_PUBLIC_SOCKET_BASE_URL "$SOCKET_BASE_V"; fi
export NEXT_PUBLIC_API_BASE_URL="$API_BASE_V"
export NEXT_PUBLIC_SOCKET_BASE_URL="$SOCKET_BASE_V"

log "校验交付构建的前端基址"
node scripts/check-build-env.mjs --socket || die "前端基址不能用于交付（原因见上）。改成对外 https 地址后重跑；
  确实要在内网 http 下交付时才用 ALLOW_INSECURE_API_BASE_URL=true 降级为警告。"

# ---------------------------------------------------------------- 3. 依赖与构建
if [ "$RUN_INSTALL" -eq 1 ]; then
  log "安装依赖（npm ci）"
  if [ -f package-lock.json ]; then
    npm ci
  else
    warn "缺少 package-lock.json，退化为 npm install（版本不可复现，建议补上 lockfile）"
    npm install
  fi
else
  log "跳过依赖安装（--skip-install）"
fi

# 根 package.json 没有 postinstall，npm ci 之后 Prisma Client 是不存在的；
# 不生成它，下面的 api 构建会直接失败。
log "生成 Prisma Client"
npx prisma generate --schema prisma/schema.prisma

if [ "$RUN_BUILD" -eq 1 ]; then
  log "构建 API"
  npm run build -w @talkfirst/api

  log "构建 Web（注入 NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL）"
  npm run build -w @talkfirst/web

  log "构建 Admin（注入 NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL）"
  npm run build -w @talkfirst/admin

  log "校验构建产物"
  [ -f apps/api/dist/main.js ]                    || die "缺少 apps/api/dist/main.js，API 构建不完整"
  [ -f apps/web/.next/BUILD_ID ]                  || die "缺少 apps/web/.next/BUILD_ID，Web 构建不完整"
  [ -f apps/admin/.next/BUILD_ID ]                || die "缺少 apps/admin/.next/BUILD_ID，Admin 构建不完整"
  echo "  api / web / admin 产物齐全"
else
  log "跳过构建（--skip-build）"
fi

# ---------------------------------------------------------------- 4. 数据库迁移
if [ "$RUN_MIGRATE" -eq 1 ]; then
  log "应用数据库迁移"
  npx prisma migrate deploy --schema prisma/schema.prisma
else
  log "跳过数据库迁移（--skip-migrate）"
fi

# ---------------------------------------------------------------- 5. 重启进程
if [ "$RUN_RESTART" -eq 0 ]; then
  log "完成（--no-restart：已更新到代码就绪，进程未重启）"
  exit 0
fi

log "重启进程"
if command -v pm2 >/dev/null 2>&1 && pm2 pid >/dev/null 2>&1; then
  echo "  检测到 pm2，执行 pm2 reload all"
  # reload 优先于 restart：cluster 模式下它是零停机的。
  pm2 reload all
  pm2 save >/dev/null 2>&1 || true
elif command -v systemctl >/dev/null 2>&1; then
  UNIT=${DEPLOY_SYSTEMD_UNIT:-}
  if [ -z "$UNIT" ]; then
    UNIT=$(systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null \
      | awk '{print $1}' | grep -iE 'talkfirst' | head -n 1 | sed 's/\.service$//' || true)
  fi
  if [ -n "$UNIT" ]; then
    echo "  检测到 systemd 单元 $UNIT，执行 systemctl restart"
    if systemctl restart "$UNIT" 2>/dev/null; then
      :
    else
      warn "systemctl restart $UNIT 失败，尝试用户级 systemctl"
      systemctl --user restart "$UNIT"
    fi
  else
    warn "检测到 systemd，但找不到本项目对应的单元。请手动重启，或设 DEPLOY_SYSTEMD_UNIT=<单元名> 后重跑 --no-restart 只想更新代码时用。"
  fi
else
  warn "既没有 pm2 也没有 systemd，无法自动重启。请手动重启 API / Web / Admin。"
fi

log "完成"
echo "  分支 : $BRANCH"
echo "  提交 : $AFTER"
echo "  就绪自检: curl -fsS http://localhost:${API_PORT:-4000}/api/v1/health/ready   # G10：带 DB ping，503 就是还没就绪"
echo "  存活自检: curl -fsS http://localhost:${API_PORT:-4000}/api/v1/health         # 只看进程在不在"
