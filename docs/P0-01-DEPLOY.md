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

## 4. 仍未验证（只能由真服务器暴露）

- `npm ci` 在服务器上的耗时与结果（本机 `node_modules` 是既有的，`apps/mobile` 还带 expo 依赖）。
- 三个构建（`api` / `web` / `admin`）在 Linux 上的结果 —— 本机只跑过 typecheck 与单测。
- `prisma migrate deploy` 与 `seed` 在服务器库上的结果。
- 重启路径：`pm2 reload` / `systemctl restart`（脚本会自己探测，但没在真机上跑过）。
- nginx / TLS / 域名 / 对外可达性。
- 备份与回滚（这一条目前仓库里连脚本都没有）。

---

## 5. 首次上线的顺序（给拿到连接信息之后）

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
