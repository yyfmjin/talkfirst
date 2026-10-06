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

---

## 访问日志的「渠道」分流（2026-10-06）

运营方的要求：**后台自己的操作、服务器自身的探活/运维，单独记录，不要混进访问日志**。

所以 `AccessLog` 新增一列 `channel`，只有三个取值：

| 值 | 什么算 | 怎么判 |
|---|---|---|
| `USER` | 普通成员流量 | 剩下的都算它（**默认视图**） |
| `ADMIN` | 命中后台路由的请求 | `isAdminPath()`（按路径判，不做每次请求的角色查询） |
| `OPS` | 服务器自身 / 环回地址 | 环回三种写法 + `OPS_IPS` 里列的来源 |

**优先级是 `OPS > ADMIN > USER`**：用 curl 打后台接口是运维操作，
记成 `ADMIN` 会让人以为有人登录了后台。分类函数在 `apps/api/src/security/access-channel.ts`，
两个写入点（访问日志中间件、限流器）共用它。

页面上多了一个「**渠道**」下拉（默认「成员」），接口参数是 `channel=USER|ADMIN|OPS|ALL`：

- 不传 = 默认只看成员；
- `ALL` = 不过滤渠道（三类一起看）。

默认值放在**共用**的 `accessLogWhere()` 里，而不是控制器里 —— 列表与统计都从它出 `where`，
两处各给一个默认值早晚会出现「列表的条数和数字说的不是同一批数据」。

历史行也回填了（先 `OPS`、再 `ADMIN`，剩下的 `USER`）：
不填的话，此前那些噪音会永远留在默认视图里。回填在迁移 `20261006180000_access_log_channel` 里，
口径与运行时的分类函数一致。`OPS_IPS` 用来补上**这台服务器自己的公网 IP**（见 `.env.example`），
环回地址不需要配置。
