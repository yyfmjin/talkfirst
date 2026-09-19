# TalkFirst 先聊

先聊聊，再成为朋友。  
Talk First. Connect Later.

当前进度：**Phase 2/3 完成（数据库 + 认证 + Onboarding API）**。前端注册/登录/验证码/资料填写已接入真实后端。Discover/聊天仍在后续阶段。

## 技术栈

- 前端：Next.js + React + TypeScript + Tailwind CSS
- 后端：NestJS + TypeScript + JWT（Access + Refresh Token，HttpOnly Cookie）
- 数据库：PostgreSQL + Prisma
- 缓存：Redis（后续阶段使用）
- 本地依赖：Docker Compose（或本机 PostgreSQL）

## 环境要求

- Node.js 20+
- Docker Desktop（用于 Postgres 与 Redis），或本机已安装 PostgreSQL

## 本地启动

### 方式 A：Docker 一键部署（推荐，无需本机装 Node / PostgreSQL）

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps   # 等 5 个服务都 healthy
```

- Web：http://localhost:3000
- Admin：http://localhost:3001
- API：http://localhost:4000/api/v1

详见 [`docs/DOCKER-DEPLOY.md`](docs/DOCKER-DEPLOY.md)。

> 注意 `.env.docker`（Compose 用）与 `.env`（本机 Node 开发用）是两个文件，
> 数据库地址不同，不要混用。

### 方式 B：本机 Node 开发

在项目根目录打开终端，依次执行：

```bash
copy .env.example .env
npm install
docker compose up -d postgres redis
npx prisma generate
npx prisma migrate dev --name init
npx tsx prisma/seed.ts
```

> 如果不使用 Docker，而是本机安装了 PostgreSQL，请修改 `.env` 中的
> `DATABASE_URL` / `DIRECT_URL` 指向你的实例（用户名/密码/端口），然后建库：
>
> ```sql
> CREATE USER talkfirst WITH PASSWORD 'talkfirst' CREATEDB;
> CREATE DATABASE talkfirst OWNER talkfirst;
> ```

然后分别启动前后端（两个终端）：

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web：http://localhost:3000
- API 健康检查：http://localhost:4000/api/v1/health

## 已实现的 API（Phase 2/3）

### Auth

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | 邮箱 + 密码注册，返回用户并种下 HttpOnly Cookie 会话 |
| POST | `/api/v1/auth/login` | 登录，种 Cookie |
| POST | `/api/v1/auth/refresh` | 用 Refresh Token 轮换会话 |
| POST | `/api/v1/auth/logout` | 撤销 Refresh Token 并清 Cookie |
| GET | `/api/v1/auth/me` | 当前登录用户（JWT 保护） |
| POST | `/api/v1/auth/send-verification-code` | 发送 6 位邮箱验证码（开发模式直接返回 `devCode`） |
| POST | `/api/v1/auth/verify-email` | 校验验证码并标记邮箱已验证 |

### Users（JWT 保护）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/users/me` | 完整社交名片（语言/兴趣/目的/想认识的国家） |
| PATCH | `/api/v1/users/me` | 更新昵称、生日、国家、城市、性别、简介 |
| DELETE | `/api/v1/users/me` | 注销账号 |
| PUT | `/api/v1/users/me/avatar` | 设置头像 URL（对象存储在 Phase 10 接入） |
| PUT | `/api/v1/users/me/languages` | 覆盖式保存母语 + 学习语言 |
| PUT | `/api/v1/users/me/interests` | 覆盖式保存兴趣（至少 3 个） |
| PUT | `/api/v1/users/me/purposes` | 覆盖式保存交友目的 |
| PUT | `/api/v1/users/me/preferred-countries` | 覆盖式保存想认识的国家 |

### Meta（公开字典）

- GET `/api/v1/meta/interests`
- GET `/api/v1/meta/purposes`
- GET `/api/v1/meta/languages`
- GET `/api/v1/meta/countries`

## 检查命令

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## 目录

```
apps/web      用户端（已接真实 API）
apps/api      后端（auth / users / meta / health）
apps/admin    管理后台占位（Phase 10）
packages      共享类型 / 配置 / 校验
prisma        数据库 schema + migration + seed
```

产品总规格仍在根目录的 `readme` 文件中。

## 下一阶段

- Phase 4：Discover + 推荐算法（语言互补 30% + 兴趣 25% + 目的 20% + 国家 15% + 活跃 10%）
- Phase 5：Say Hello + Connection
- Phase 6：Chat + WebSocket
