# TalkFirst 独立后台（Admin Console）

独立桌面端后台，端口 `3001`，与用户端 `3000` 完全隔离。

## 入口

```text
http://localhost:3001/login
```

登录后路由：

```text
/        仪表盘（用户/活跃/消息/连接/举报/管理员/封禁）
/users   用户搜索 + 状态筛选 + 分页 + 封禁/停用/解封 + 内部备注
/users/:id 用户详情（被举报/发起举报/备注）
/reports  举报审核（OPEN/REVIEWING/RESOLVED/REJECTED + 分页）
/audit   审计日志（所有封禁/审核/备注可追溯）
```

旧的手机端 `/admin`（3000 端口内）保留，仅做快捷跳转，不再新增功能。

## 开通管理员

```bash
set ADMIN_BOOTSTRAP_EMAIL=你的邮箱
npx tsx prisma/seed.ts
```

或直接 DB：

```bash
node -e "const {PrismaClient}=require('@prisma/client');(async()=>{const p=new PrismaClient();await p.user.update({where:{email:'你的邮箱'},data:{isAdmin:true,status:'ACTIVE'}});await p.\$disconnect()})()"
```

非 admin 登录会被 `/admin/me` 拦截并强制登出。

## 本地启动

```bat
start-local.bat
```

会启动：

```text
Postgres :5433
API :4000
Web :3000
Admin :3001
```

## Docker

```bash
set JWT_SECRET=xxx
set JWT_REFRESH_SECRET=yyy
docker compose up -d --build
```

新增 `talkfirst-admin` 服务，对外 `3001`。

## 后端变更（Phase 13）

- `GET /admin/me` 当前管理员档案
- `GET /admin/users?q=&status=&page=&pageSize=` 分页
- `GET /admin/reports?status=&page=&pageSize=` 分页
- `GET /admin/audit?page=&pageSize=` 审计日志
- `dashboard` 新增 `admins/banned`
- 所有 `user.ban/disable/activate/note`、`report.*` 写 `AdminAuditLog`
