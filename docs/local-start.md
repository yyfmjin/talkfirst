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

## 冒烟脚本

```bash
node scripts/phase5-smoke.cjs
node scripts/phase6-smoke.cjs
node scripts/phase7-smoke.cjs
node scripts/phase8-smoke.cjs
node scripts/phase9-smoke.cjs
node scripts/phase10-smoke.cjs
```
