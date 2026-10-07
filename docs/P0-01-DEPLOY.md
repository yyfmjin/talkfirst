# P0-01 — 服务器侧部署（2026-10-06）

> 上游：`docs/P0-00-BASELINE.md` §G1「生产未部署」（🔴）与
> `docs/HANDOVER-2026-10-04-dsh-takeover.md` §4.A1「服务器没有拉取」。
> 本文记录**不需要服务器凭据就能做完**的那一半，以及剩下的那一步需要你给什么。

---

## 0. 本轮做了什么、没做什么

| | 内容 |
|---|---|
| **没做** | 真的连上服务器部署 —— 缺连接信息（见 §1）。 |
| **做了** | 在**临时克隆**里把 `scripts/deploy-pull.sh` 的「拉取 + 生产校验」两段**真的跑了一遍**。此前它只做过「语法检查 + 新增代码块的隔离用例」，并明确记为**未做端到端**（`docs/P0-00-FIXES.md`）。 |
| **顺手修掉** | 一个实测出来的、**会改写仓库文件**的陷阱（见 §3）。 |

临时克隆指的是：`git clone` 出一份干净副本，用完即删 —— 你的开发库、你的工作区、你的 `.env` 全程没被碰过。

---

## 1. 现在只差这一步：服务器连接信息

下面这些我无法自己获得。给齐之后，部署本身是**一条命令**。

| 需要你提供 | 用来做什么 | 说明 |
|---|---|---|
| 主机地址 + SSH 端口 | 连上去 | 例：`1.2.3.4:22` |
| 登录方式 | 登录 | 密钥文件，或临时密码。**建议新建一把只用于部署的密钥**，用完可撤 |
| 有没有 `sudo` | 装依赖 / 重启服务 / 装 nginx | 有 / 没有 |
| 仓库在服务器上的位置 | 决定是 `clone` 还是 `pull` | 例：`/srv/talkfirst`；不确定就直说 |
| 数据库在哪 | `prisma migrate deploy` 要连它 | 同机 / 外部托管，以及对应连接串 |
| 对外域名 | **构建期**注入前端产物 | 例：`api.xxx.cc`、`www.xxx.cc`。写错 → 整个后台打不开 |
| 有没有 nginx / CDN | 决定 `TRUST_PROXY` 填几 | 直连=0；一层 nginx=1；CDN+nginx=2 |
| 要不要 HTTPS | 决定是否配证书 | 不配就只能先内网 http 访问 |

> 我不会去动你的凭据本身：不新建、不修改、不落盘到仓库里的任何文件。

---

## 2. 已在临时克隆上实测的校验矩阵

`deploy-pull.sh` 的第 3 步（生产校验）逐项跑过。**每一项都对应一个真实的静默失败**，所以这里记的是「它到底会不会拦住」。

| 用例 | 结果 | 实际输出 |
|---|---|---|
| 一份合法生产 `.env` | ✅ 走通 | 一路到「完成（--no-restart…）」 |
| `NODE_ENV=development` / `staging` | ⛔ 拦下 | `NODE_ENV 必须是 production，当前是 'staging'` |
| `ALLOW_INSECURE_DEFAULTS=true` | ⛔ 拦下 | 说明它会以开发默认值运行 |
| `TRUST_PROXY` 缺失 | ⛔ 拦下 | 并解释 0/1/2 各是什么 |
| `SECURITY_DEVICE_SALT` 缺失 | ⛔ 拦下 | 并给出生成命令 |
| `TOKEN_ENCRYPTION_KEY` 缺失 | ⛔ 拦下 | 并警告轮换会让已保存的第三方 token 全部失效 |
| `API_PUBLIC_URL` 是本机地址 **且** 配了 `GOOGLE_CLIENT_ID` | ⛔ 拦下 | 指明生产不允许 loopback 回调 |
| `API_PUBLIC_URL` 是本机地址、未配 Google | ⚠️ 仅警告后继续 | 如上，这与脚本注释一致 |
| `NEXT_PUBLIC_API_BASE_URL` 指向 `http://localhost` | ⛔ 拦下 | 由 `scripts/check-build-env.mjs` 判 |
| `NEXT_PUBLIC_API_BASE_URL` 为相对路径（`/api/v1`） | ✅ 放行 | 与脚本注释「相对路径允许」一致 |
| 工作区有未提交改动 | ⛔ 拦下 | 明确「不 stash、不覆盖」 |

**注意**：最后两条里，「相对路径」这一格第一次测是失败的，原因是 Git Bash 会把 `/api/v1` 自动转换成 `D:/Program Files/Git/api/v1` —— 是**测试环境的路径转换**，不是脚本的问题；用 `MSYS_NO_PATHCONV=1` 重测即通过。

---

## 3. 本轮修掉的陷阱（实测，不是推测）

### 3.1 现象

在**没有 `node_modules`** 的目录上跑 `deploy-pull.sh --skip-install`，会连续踩两个坑：

1. `npx prisma` 去「自己解决」依赖，抓到的大版本**不稳定**：
   一次是 **7.10.0**、另一次是 **6.19.3**。抓到 7.x 就糟了 ——
   Prisma 7 已移除 schema 里的 `directUrl`，报错因此指向 `prisma/schema.prisma`，
   **看起来像「schema 写错了」**，而真实原因是「这台机器没装依赖」。
2. 更要紧的：不管抓到哪个版本，npm 都会把依赖**装进这个仓库**，并**就地改写两个受版本控制的文件**。

### 3.2 实测证据（`package.json` 的 diff）

```diff
   "devDependencies": {
-    "prisma": "^6.6.0",
+    "prisma": "^6.19.3",
   "dependencies": {
-    "@prisma/client": "^6.6.0",
+    "@prisma/client": "^6.19.3",
```

`package-lock.json` 同步被改。**抓到 7.x 时就会写成 `^7.10.0`。**
也就是说：一次「只想看看环境配得对不对」的部署调用，会悄悄改掉两个进仓库的文件。

### 3.3 处置

`scripts/deploy-pull.sh` 在**本地没有 prisma 可执行文件**时**直接停下**，并说明原因与下一步
（不要在没装依赖的目录上用 `--skip-install`；先跑一次完整部署即 `npm ci`）。

**验收**：用哈希确认探针里跑的确实是改后的脚本（`sha256` 与工作区一致），
再跑该场景 → `exit=1` + 那条说明 + **工作区保持干净（`git status --porcelain` 为空）**；
同时原有的 6 项环境校验与「工作区必须干净」检查全部照旧生效。

---

## 4. 本节写于部署之前 —— 其中大部分已在 2026-10-06 的真机部署中得到验证（见 §7）

- `npm ci` 在服务器上的耗时与结果 —— **已验（§7）**。
- 三个构建（`api` / `web` / `admin`）在 Linux 上的结果 —— **已验（§7）**。
- `prisma migrate deploy` 在服务器库上的结果 —— **已验（§7）**；`seed` 仍未在服务器跑过。
- 重启路径 `pm2 reload` —— **已验（§7）**；`systemctl restart` 那条分支仍未跑过。
- nginx / TLS / 域名 / 对外可达性 —— **已验（§7，含公网 https）**。
- 备份与回滚 —— **仍无自动化**：本次部署前是**手工** `pg_dump`（路径见 §7），回滚仍没有脚本。

---

## 5. 首次上线的顺序（2026-10-06 已按此执行完毕；保留给下次 / 新机器）

```bash
# 1. 服务器装好：git、node 20+、npm、postgres（或让它指向已有的库）
# 2. 克隆（或进到已有目录）
git clone https://github.com/yyfmjin/talkfirst.git /srv/talkfirst && cd /srv/talkfirst

# 3. 生成 .env（模板：.env.docker.example / .env.example），填 §1 那几项
#    必须包含：NODE_ENV=production、TRUST_PROXY、SECURITY_DEVICE_SALT、
#    TOKEN_ENCRYPTION_KEY、API_PUBLIC_URL、NEXT_PUBLIC_API_BASE_URL、
#    NEXT_PUBLIC_SOCKET_BASE_URL、DATABASE_URL、DIRECT_URL

# 4. 先只校验，不动代码、不装依赖、不构建、不迁移
scripts/deploy-pull.sh --no-restart --skip-build --skip-migrate
#    → 应看到「完成（--no-restart：已更新到代码就绪，进程未重启）」

# 5. 正式部署（拉取 → 校验 → npm ci → prisma generate → 三个构建 → migrate deploy → 重启）
scripts/deploy-pull.sh

# 6. 验收：就绪探针（带 DB ping，503 就是还没就绪）
curl -fsS http://localhost:4000/api/v1/health/ready
curl -fsS http://localhost:4000/api/v1/health
```

第 4 步在**没有 `node_modules`** 时会停在「生成 Prisma Client」之前 —— 那是 §3.3 的守卫在起作用，
不是失败：先跑第 5 步（它会执行 `npm ci`），之后第 4 步那种「只校验」的用法才有意义。

---

## 6. 一句话给后来者

`deploy-pull.sh --skip-install` 的前提是**依赖已经装好**。
在没有 `node_modules` 的目录上跑它，不但没意义，还会让 npm 顺手改写 `package.json` ——
所以脚本现在会直接拦下。

---

## 7. 首次真实部署（2026-10-06）

真机：AWS EC2 / Ubuntu，`ubuntu@18.216.101.31`，项目在 `/home/ubuntu/talkfirst`，
pm2 跑三个进程（api `4000` / web `3000` / admin `3001`），nginx 在前（80/443），
域名 `talkfirst.ccwu.cc` / `api.talkfirst.ccwu.cc` / `admin.talkfirst.ccwu.cc`。

### 7.1 动手前发现的四件事（每一件都会挡住部署）

| # | 现象 | 处置 |
|---|---|---|
| 1 | 服务器代码停在 `0a64afd`（**落后 22 个提交**），连 `scripts/deploy-pull.sh` 都还没有 —— 它本身是 10-04 才加的 | 先手工 `git fetch` + `git merge --ff-only`（= 脚本的第 1 步），脚本到位后再跑它（此时它自己的 fetch 变成 no-op） |
| 2 | `git fetch` 报 `git@github.com: Permission denied (publickey)` —— 服务器那把 SSH 密钥没被 GitHub 授权 | **origin 改用 HTTPS**（公开仓库匿名可读）。要恢复成 SSH 的话：往仓库加 deploy key，再改回 `git@github-talkfirst:...` |
| 3 | `.env` 里**没有** `TOKEN_ENCRYPTION_KEY`（脚本会拒绝部署，上游代码在生产也会拒绝启动） | 生成并追加（**值不落任何文档或日志**）；写前备份 `.env` → `~/backup-env-pre-deploy.bak`。当时库里**还没有 `SocialSyncAccount` 表**，所以不存在「已加密的 token 会解不开」的问题 |
| 4 | 工作区脏：`apps/admin/src/app/login/page.tsx` 有 1 行未提交改动（登录页文案把 `http://localhost:3001` 换成了真实域名）；另有 2 个未跟踪的 `apps/*/.env.production.local` | 那行改动**并进了仓库**，改成与 web 端同一写法（`NEXT_PUBLIC_ADMIN_URL ?? localhost:3001`），服务器那份随之 checkout 掉；两个 env 文件写进服务器的 `.git/info/exclude`（本机级忽略，不动任何受版本控制的文件），仓库 `.gitignore` 也补了 `.env.production.local` |

### 7.2 部署与验收（全部实跑）

```bash
pg_dump ... > ~/backup-talkfirst-<时间>.sql      # 696K，迁移前的安全网
git fetch origin master && git merge --ff-only    # 0a64afd -> 501f04d（22 个提交）
bash scripts/deploy-pull.sh                       # 后台执行并写日志，约 4 分钟
```

| 验收项 | 结果 |
|---|---|
| 脚本自身校验 | 工作区干净 ✓ · `TRUST_PROXY=1` ✓ · 前端基址校验 OK ✓ |
| `npm ci` | 成功（只有传递依赖的 deprecation warn，无 error） |
| 三个构建 | `apps/api/dist/main.js`、`apps/web/.next/BUILD_ID`、`apps/admin/.next/BUILD_ID` 均已生成 ✓ |
| `prisma migrate deploy` | **9 个迁移全部应用成功**（含 `moment_bookmarks` / `conversation_member_last_read` / `report_comment_target`） |
| 重启 | 检测到 pm2，`pm2 reload all` → 三个进程全部 online、`restarts=1` ✓ |
| 就绪探针（服务器内） | `/health/ready` → **200**，`{"status":"ready","database":{"status":"up","latencyMs":1}}`；`/health` → 200 |
| 就绪探针（公网 https） | `https://api.talkfirst.ccwu.cc/api/v1/health/ready` → **200** 且 `database: up` |
| 用户端 / 后台 | `https://talkfirst.ccwu.cc` → 200；`https://admin.talkfirst.ccwu.cc/login` → 200 |
| 那行文案 | 后台登录页 HTML 里 `admin.talkfirst.ccwu.cc` 出现、`localhost:3001` **0 次** —— env 化改写真的生效 |

**新的就绪探针返回 200 本身就是「新代码在跑」的证据**：部署前那个端点在旧代码里不存在，实测 **404**。

### 7.3 仍然是缺的

- ~~回滚：没有脚本~~ —— **已补写步骤**（在 `scripts/backup-db.sh` 的文件头，含恢复命令与「先停 API 再恢复」的提醒）；仍是**手工**执行，没有自动化。
- ~~备份自动化：没有 cron、没有保留策略~~ —— **已做**（2026-10-06）：`scripts/backup-db.sh` + 服务器 crontab 每天 03:15，保留 14 份。详见 §9。
- **`seed`** 未在服务器跑过（生产库只有 2 个用户、0 条动态，本来也不需要）。
- **服务器那把 GitHub deploy key 仍未配**（当前靠 HTTPS 拉取），要恢复 SSH 方式得往仓库加公钥。
- CI 仍被 GitHub 账号的账单锁挡着（与服务器无关，见 `docs/CI.md` §6）。

---

## 8. 上线后发现的拓扑事故：Cloudflare 在前，而 `TRUST_PROXY=1`（2026-10-06 已修）

### 8.1 怎么发现的

验证新上线的法律页时，发现邮箱被换成了 `[email protected]` —— 那是 **Cloudflare 的邮箱混淆**
（`/cdn-cgi/l/email-protection` + `data-cfemail`，客户端解码后才显示）。也就是说：
**站点在 Cloudflare 后面**（`Server: cloudflare`、`CF-RAY` 都在）。

顺着这条线查「应用到底把谁当访客」，得到一对对不上的证据：

| 位置 | 看到的 IP |
|---|---|
| nginx access log（一次外部探测） | `162.158.167.105` —— **Cloudflare 边缘**，不是访客 |
| 应用的 `AccessLog`（同一次探测） | **同一个** `162.158.167.105` |

### 8.2 为什么这件事要紧

访客 IP 是**限流与 IP 封禁的键**。把它记成 Cloudflare 边缘 IP，后果不是“日志难看”：

- 一个边缘后面挂着大量真实用户，所以「封一个滥用者的 IP」会**连带封掉同一边缘上的所有人**；
- 限流变成“整个边缘共用一个桶”，无辜用户容易被误伤；
- 安全事件的审计记录里，IP 不再指向当事人。

正确值是 **2**（`deploy-pull.sh` 自己的注释就是：「CDN + 反向代理 = 2」），而 `.env` 当时是 **1**。

### 8.3 一个真会坑人的细节：`.env` 不是唯一真源

改完 `.env` 后，实测**没有任何变化**。原因不在代码：

```bash
pm2 env 0 | grep TRUST_PROXY     # → TRUST_PROXY: 1   （pm2 进程环境里有一份陈旧的）
# dotenv 默认**不覆盖**已存在的环境变量，所以 .env 里的新值永远轮不到
pm2 restart talkfirst-api --update-env   # 也没用：--update-env 是**合并**，不清旧值
TRUST_PROXY=2 pm2 restart talkfirst-api --update-env   # 这才写进去
```

### 8.4 验收（实跑）

| 检查 | 修复前 | 修复后 |
|---|---|---|
| `pm2 env 0` 里的 `TRUST_PROXY` | `1` | `2` |
| 同一次外部探测在 `AccessLog` 里记的 IP | `162.158.167.105`（边缘） | **`104.28.166.44`（访客自己的出口 IP）** |
| `/api/v1/health/ready` | 200 | 200 |

`.env` 已备份为 `~/.env.pre-trustproxy.bak`（服务器上）。

> **给后来者的两条**：① 只要站点在 Cloudflare（或其他 CDN）后面，`TRUST_PROXY` 就绝不是 1，
> 而且**每次换拓扑都要重新数跳数**；② 在 pm2 下跑的变量，改完 `.env` 后先 `pm2 env <id>`
> 看一眼有没有同名陈旧值，否则会白改。

---

## 9. 数据库备份与回滚（2026-10-06 起备份自动化）

### 9.1 备份

| 项 | 值 |
|---|---|
| 脚本 | `scripts/backup-db.sh`（在仓库里，随部署同步） |
| 由谁调用 | 服务器 crontab：`15 3 * * * bash /home/ubuntu/talkfirst/scripts/backup-db.sh >> /home/ubuntu/talkfirst-backups/backup.log 2>&1` |
| 输出 | `~/talkfirst-backups/talkfirst-YYYYmmdd-HHMM.sql.gz` |
| 保留 | 最近 **14** 份（`--keep N` 可改） |
| 为什么用 `bash` 显式调用 | 仓库里的文件没有可执行位（Windows 上提交的），显式 `bash` 才不依赖它 |
| 为什么写在仓库**外** | `deploy-pull.sh` 要求工作区干净；备份落在仓库里会让每次部署被自己拦下 |

**两个顺序要点**（脚本里也写着）：先校验（非空 + `gzip -t`）**再**清理旧份 ——
今天这次没成功就不动历史；dump 中途被中断时，留一个能看出是坏的 `.gz`
好过留一个看不出坏在哪的 `.sql`。

**实测**（2026-10-06）：装好后立即跑一次（120K，`gzip -t` 通过）；又造到 4 份后用
`--keep 2` 再跑一次 —— 保留最新两份、删掉最旧一份，余下两份完整性均通过。

**停用**：`crontab -e` 删掉那一行即可（这台机器目前 crontab 里只有这一条）。

### 9.2 回滚

- **代码**：`git fetch origin && git log --oneline -5` 找准目标提交 →
  `git checkout <commit> -- .`（或 `git reset --hard <commit>`，后者会丢本地改动）→
  再跑 `scripts/deploy-pull.sh`。
- **数据库**：先 `pm2 stop talkfirst-api`，然后
  `gunzip -c ~/talkfirst-backups/talkfirst-<时间>.sql.gz | psql "$DATABASE_URL"`，
  最后 `pm2 start talkfirst-api`。
  （先停 API 是因为 dump 里有 DROP/CREATE，跑到一半时应用还在写会打架。）

这两段步骤与 `scripts/backup-db.sh` 的文件头写的是同一套：
放在两处是因为**部署时**最先看到的往往是本文档，而**真要恢复时**最先看到的会是那个脚本。

## 10. 后续部署记录

每次部署在这里加一节 —— 只记**可核对的事实**（提交 / 迁移 / 探针结果），不记过程。

### 10.1 送花（虚拟礼物），2026-10-06

| 项 | 值 |
|---|---|
| 提交 | `f45cc84 → c6ac2cc`（1 个提交：`feat(gifts)`） |
| 迁移前备份 | `~/talkfirst-backups/talkfirst-20261006-1714.sql.gz`（136K） |
| 部署方式 | 服务器后台 `bash scripts/deploy-pull.sh`，日志 `~/deploy-gifts.log`，约 4 分钟 |
| 迁移 | `20261006190000_user_flowers` 应用成功（纯加法：新表 + `User.flowerCount` 默认 0） |
| 重启 | pm2 `reload all` → talkfirst-api / -web / -admin 全部 online |
| 就绪探针 | 本机 `/health/ready` → **200**（`database: up`，2ms）；公网 → **200** |
| 新端点 | `POST /api/v1/users/<uuid>/flowers` 未登录 → **401**（对照：不存在的路由 → **404**） |
| 既有页面 | `talkfirst.ccwu.cc` → 200；`admin.talkfirst.ccwu.cc/login` → 200 |

**两个坑（这次踩到的，下次直接省掉）**：

1. 服务器上 **`pm2` 不在非交互式 ssh 的 PATH 里** —— 它在
   `~/.nvm/versions/node/v22.23.3/bin/`。后台跑 `deploy-pull.sh` 前要
   `export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH`，
   否则脚本第 5 步找不到 pm2（会走到它自己的降级分支）。
2. 本机 `~/.ssh/talkfirst_ed25519` 的公钥注释是 `github-talkfirst`（为 GitHub 准备的），
   **不是服务器登录密钥**；登服务器用默认的 `~/.ssh/id_ed25519`（`ubuntu@18.216.101.31`）。

### 10.2 pm2 进程环境会盖过 `.env` —— 改完不生效时先重建进程

（同一天第二次踩到，这次是邮件。上一个同类事故是 `TRUST_PROXY`。）

**现象**：把 `.env` 的 `MAIL_PROVIDER` 从 `console` 改成 `smtp` 并补齐 `SMTP_*` 之后
跑 `pm2 reload all`，接口**仍然按 console 工作**（日志仍是
`EMAIL VERIFICATION SENT (console) …`），验证码依旧只进日志。

**原因**：`main.ts` 用 dotenv 读 `.env`，而 **dotenv 不覆盖已存在的进程变量**。
这个进程的 pm2 环境里存着一份**启动时**的快照（`MAIL_PROVIDER=console`、
`ENFORCE_EMAIL_VERIFICATION=false`、`SMTP_*` 全空），于是 `.env` 的新值全被无视；
`pm2 reload` 会连这份快照一起沿用 —— 所以改 `.env` 对它无效。

**怎么确认**（注意 `pm2 env` 输出是 `KEY: value`，用 `^KEY=` 去 grep 会永远搜不到，
我因此误判过一次）：

```bash
PID=$(pm2 pid talkfirst-api)
tr '\0' '\n' < /proc/$PID/environ | grep -iE '^(MAIL_PROVIDER|SMTP_|ENFORCE_EMAIL)'
```

**怎么修**（让进程环境回到干净状态，配置只由 `.env` 决定）：

```bash
cd /home/ubuntu/talkfirst
# 先确认「只在进程里、不在 .env 里」的键不会丢：
PID=$(pm2 pid talkfirst-api)
tr '\0' '\n' < /proc/$PID/environ | grep -E '^[A-Z_]+=' | cut -d= -f1 | sort -u > /tmp/penv.keys
grep -oE '^[A-Z_]+=' .env | cut -d= -f1 | sort -u > /tmp/env.keys
comm -23 /tmp/penv.keys /tmp/env.keys | grep -vE '^(PATH|HOME|PM2_|NODE_|npm_|_)'
pm2 delete talkfirst-api
pm2 start npm --name talkfirst-api -- run start:prod -w @talkfirst/api
pm2 save
curl -fsS http://localhost:4000/api/v1/health/ready   # 200 才算回来了
```

**给后来者的规则**：`.env` 是唯一真源，pm2 环境里不该出现应用变量。往 `.env`
新增变量后发现不生效，先怀疑进程环境，而不是代码。

**已经在脚本里修掉**（2026-10-06 晚）：`scripts/deploy-pull.sh` 的重启段现在会在
重载**之前**把 `.env` 里的键值逐个导出（用现有的 `env_value` 安全解析，
**不** `source .env` —— 那等于把配置文件当 shell 脚本执行），然后
`pm2 reload all --update-env`，最后自检一次 `/health/ready`。于是进程拿到的就是
`.env` 的当前值。上面那段手工步骤只给「旧版脚本」或「不想完整部署」的场合用。

#### 一个被当场验证的教训：不要用 `pm2 delete` + `pm2 start` 做这件事

我第一版写成「按名字重建三个进程」（以为这样能让环境回到干净状态），结果：

- `pm2 start "$@" --name "$name"` 里的 `--name` 写在了 `--` **之后** —— 那是传给
  npm 的参数，不是 pm2 的选项。进程没被正确登记。
- 而 `delete` 已经执行过了，脚本又 `set -e`，于是中途停住：
  **pm2 列表空了，站点 502**。恢复方式就是手工把三个进程按正确语法拉起来：

```bash
cd /home/ubuntu/talkfirst && export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH
pm2 start npm --name talkfirst-api   -- run start:prod -w @talkfirst/api
pm2 start npm --name talkfirst-web   -- run start -w @talkfirst/web
pm2 start npm --name talkfirst-admin -- run start -w @talkfirst/admin
pm2 save
```

教训有两条，都写在这里免得再犯：

1. **删除型操作不要出现在部署脚本的必经路径上** —— `reload` 不会注销进程，
   删除会，而“删了没起来”的窗口就是一次真实停机。要改环境用 `--update-env`。
2. **`--name` 必须在 `--` 之前**（`pm2 start npm --name X -- run start`）。
   这是 pm2 的命令行约定，写反了不会报错，只是静默地没登记进程。

### 10.3 服务器上的系统级依赖：ffmpeg

（2026-10-06 补装。同一件事在两个部署路径上都漏了。）

**现象**：API 日志每次启动都有一条 ERROR：

```
[UploadsModule] FFmpeg is required for video processing: neither `ffmpeg` nor `ffprobe`
could be run. Video uploads will fail with FFMPEG_NOT_INSTALLED until it is installed
```

含义：**上传视频这个功能在线上是坏的**（上传图片不受影响）。`UploadsModule` 故意在
启动时报，而不是等到第一次上传才失败。

**修法（裸机 / 这台服务器）**：

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
pm2 restart talkfirst-api        # 重启后日志应变成
# [UploadsModule] ffmpeg/ffprobe detected — video uploads will be transcoded
```

**修法（容器）**：`apps/api/Dockerfile` 的 runtime 阶段已加上 `ffmpeg`
（`apk add --no-cache wget ffmpeg`）—— 两个路径要一致，否则「裸机能发视频、
容器不能」会成为一个很难查的差异。
