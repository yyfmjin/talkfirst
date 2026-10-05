# TalkFirst 本地 Docker 部署指南

一条命令拉起完整栈：PostgreSQL + Redis + API + Web + Admin，全部构建自本地源码。

## 前置要求

- Docker Desktop（Windows / macOS / Linux 均可）
- 宿主机端口 `3000` `3001` `4000` `5432` `6379` 未被占用
- 首次构建需拉取 `node:22-alpine`、`postgres:16-alpine`、`redis:7-alpine`

## 快速开始

```bash
cd "D:/文件/网站/TalkFirst"

# 1. 创建 Docker 环境变量文件（已生成随机密钥；如需自定义见下节）
#    .env.docker 已随仓库提供，直接使用即可

# 2. 构建并启动全部服务
docker compose --env-file .env.docker up -d --build

# 3. 查看状态，等 5 个服务都变成 healthy
docker compose --env-file .env.docker ps
```

等价的 npm 快捷命令：

```bash
npm run docker:up      # 构建并启动
npm run docker:ps      # 查看状态
npm run docker:logs    # 跟踪日志
npm run docker:down    # 停止（保留数据）
npm run docker:reset   # 停止并删除数据卷
```

> **`.env.docker` 与 `.env` 是两个不同的文件。** `.env` 供本地 Node 开发使用
> （`DATABASE_URL` 指向宿主机 `5433`）；`.env.docker` 供 Compose 使用，其中的
> `DATABASE_URL` 由 compose 内部拼成 `postgres:5432`。改错文件是这套栈最常见的失败原因。

## 访问地址

| 服务 | 地址 |
|---|---|
| Web 前台 | http://localhost:3000 |
| Admin 后台 | http://localhost:3001 |
| API | http://localhost:4000/api/v1 |
| API 就绪自检 | http://localhost:4000/api/v1/health/ready （带 DB ping；503 = 还没就绪） |
| API 存活自检 | http://localhost:4000/api/v1/health （只看进程在不在，不碰 DB） |

## 环境变量说明

`.env.docker` 里的关键项：

| 变量 | 作用 |
|---|---|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 签发 token 的密钥。**compose 会强制校验**，缺失直接报错退出。仓库内已生成随机值，对外部署请替换 |
| `POSTGRES_PASSWORD` | 数据库密码，同时用于拼 `DATABASE_URL` |
| `SEED_ON_BOOT=1` | 首次启动写入字典数据（兴趣/目的/语言/国家）。**幂等**，重复启动不会重复插入 |
| `ADMIN_BOOTSTRAP_EMAIL` | 该邮箱在 seed 时被提权为管理员。需**先注册该用户**再生效 |
| `NEXT_PUBLIC_API_BASE_URL` | **构建期参数**，会被烧进前端产物。改动后必须加 `--build` 重新构建，仅重启容器无效 |
| `WEB_PORT` / `ADMIN_PORT` / `API_PORT` | 宿主机端口，冲突时改这里 |

## 端口冲突

修改 `.env.docker` 后重建：

```env
WEB_PORT=3002
ADMIN_PORT=3003
API_PORT=4001
POSTGRES_PORT=5433
REDIS_PORT=6380
```

```bash
docker compose --env-file .env.docker down
docker compose --env-file .env.docker up -d --build
```

## 数据持久化

- PostgreSQL → 具名卷 `talkfirst_postgres_data`
- Redis → 具名卷 `talkfirst_redis_data`
- 删除容器不影响数据；`docker compose down -v` 才会清空

## 架构

```
                    ┌──────────────┐
   浏览器 ─────────▶│   Web :3000  │  Next.js 15（standalone）
                    └──────┬───────┘
                    ┌──────┴───────┐
   浏览器 ─────────▶│  Admin :3001 │  Next.js 15（standalone）
                    └──────┬───────┘
                           │ 浏览器直连，CORS 放行
                    ┌──────┴───────┐
   浏览器 ─────────▶│   API :4000  │  NestJS 12
                    └──┬────────┬──┘
                       │        │
              ┌────────┴──┐  ┌──┴────────┐
              │PostgreSQL │  │  Redis    │
              │   :5432   │  │  :6379    │
              └───────────┘  └───────────┘
                 （仅容器内网可达）
```

启动顺序由 `depends_on` + healthcheck 串起来：
`postgres/redis` 健康 → `api` 跑 `prisma migrate deploy` → `api` 健康 → `web`/`admin` 启动。

## 实测镜像体积

| 镜像 | 体积 |
|---|---|
| `talkfirst-api` | ~1.8 GB |
| `talkfirst-web` | ~385 MB |
| `talkfirst-admin` | ~383 MB |

前端两个镜像走 Next.js `output: "standalone"`，运行层不含 `node_modules`，
所以只有 385MB 左右。

## 故障排查

### API 反复重启：`exec ./scripts/docker-entrypoint-api.sh: no such file or directory`

脚本明明存在却报找不到，是 **CRLF 行尾**导致 shebang 变成 `#!/bin/sh\r`。
仓库已在 Dockerfile 里用 `sed -i 's/\r$//'` 归一化，若仍遇到请确认
`scripts/docker-entrypoint-api.sh` 是 LF 行尾。

### API 启动报 `MODULE_NOT_FOUND: @prisma/debug`

`apps/api/Dockerfile` 的裁剪列表误删了 `@prisma/debug`。它不能被删 ——
`prisma` CLI 通过 `@prisma/engines` 间接依赖它。

### admin 构建报 `Parameter 'u' implicitly has an 'any' type`

`apps/admin/test/fixtures/admin-roles.ts` 会被 `next build` 类型检查，它 import 了
`PrismaClient`。构建阶段必须先 `npx prisma generate`，否则 Prisma 类型解析不出来。
admin 的 Dockerfile 已包含这一步。

### 前端页面是旧的 / 改了 API 地址没生效

`NEXT_PUBLIC_*` 是构建期注入，必须 `--build` 重建，重启容器没用。

### 构建卡很久

`apps/api/Dockerfile` 的运行时阶段在同一个 `RUN` 里做 `npm ci` + `rm -rf` 前端依赖，
要先写再删约 1GB 文件。这是刻意的 —— 拆成两个 `RUN` 的话删除只会产生白化层，
镜像体积不会下降。首次构建慢，之后有缓存。

### 数据库连接错误

确认 postgres 已 healthy，且用的是 `.env.docker` 而不是 `.env`：

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs postgres
```

### 彻底重来

```bash
docker compose --env-file .env.docker down -v
docker compose --env-file .env.docker up -d --build
```
