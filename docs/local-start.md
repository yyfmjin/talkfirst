# TalkFirst 本地启动

## Windows 一键启动（当前开发机）

```bat
start-local.bat
```

会依次启动：

```text
Postgres localhost:5433（项目本地 .local-data/pgdata）
Prisma migrate deploy + seed
API http://localhost:4000（apps/api/dist/main.js）
Web http://localhost:3000（生产构建 next start）
```

验证：

```bash
curl http://localhost:4000/api/v1/health
curl -o NUL -w "%{http_code}" http://localhost:3000/
node scripts/db-check.cjs
```

## Docker 启动（网络可用时）

```bash
docker compose up -d --build
docker compose logs -f api web
```

服务：

```text
Postgres :5432
Redis :6379
API :4000
Web :3000
```

生产密钥：

```bash
set JWT_SECRET=your-secret
set JWT_REFRESH_SECRET=your-refresh-secret
docker compose up -d --build
```

### 这台机器上的三个坑（2026-11-17 实测）

**1. 构建时 `npm ci` 报 ECONNRESET。**

本机出网走 `127.0.0.1:7897`（Clash 的混合口），容器里没有代理，
`docker build` 拉 npm 包会随机重置（大包尤其容易）。构建前把代理传进去：

```bash
HTTP_PROXY=http://host.docker.internal:7897 \
HTTPS_PROXY=http://host.docker.internal:7897 \
NO_PROXY=localhost,127.0.0.1,postgres,redis,web,admin \
  docker compose build api
```

`host.docker.internal` 在 Docker Desktop 的 Linux 容器里指向宿主机。
`NO_PROXY` 必须写上服务名（postgres/redis/web/admin），否则容器之间的调用
也会被塞进代理，反而连不上。

**2. 宿主机连 5433 报密码错，但 `docker exec … psql` 一切正常。**

容器内的 loopback 连接走 `trust`（不校验密码），只有从宿主机
（192.168.65.254）进来才真正校验。数据卷是很久以前初始化的，里面的密码和
当前 `.env` 的 `DATABASE_URL` 早就不一致 —— 于是 `prisma migrate` 报
**P1000 Authentication failed**，而容器里 `psql` 又明明是通的，很容易误判成
Prisma 的问题。对齐一次即可（不动数据）：

```bash
docker exec -e PW="$(grep '^DATABASE_URL=' .env | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')" \
  talkfirst-postgres sh -c 'psql -U talkfirst -d talkfirst \
  -c "ALTER USER talkfirst WITH PASSWORD '\''$PW'\''"'
```

**3. `packages/` 目录不在仓库里。**

根 `package.json` 声明了 `packages/*` workspace，三个 Dockerfile 也都有
`COPY packages ./packages`，但目录本身没有 —— 缺了它 `docker build` 在 COPY
这一步直接失败（`failed to compute cache key: "/packages": not found`），
本地就再也构不出镜像。仓库里已经放了一个 `packages/.gitkeep` 把这两处声明
补成自洽。

## 冒烟脚本

```bash
node scripts/phase5-smoke.cjs
node scripts/phase6-smoke.cjs
node scripts/phase7-smoke.cjs
node scripts/phase8-smoke.cjs
node scripts/phase9-smoke.cjs
node scripts/phase10-smoke.cjs
```
