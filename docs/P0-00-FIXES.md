# P0-00-FIXES — 基线缺陷修复批次

> 日期：2026-10-04
> 上游：`docs/P0-00-BASELINE.md`（只读基线检查，发现的问题编号沿用其中的 E.1 / E.2 / E.4 / G8 / G13）
> 范围：**只修工程件（检查器 / 测试配置 / 部署脚本 / 环境模板 / 本地启动脚本）**。未改任何业务代码、未改 Prisma schema、未建迁移、未动数据库。
> 状态：**未提交**（等你确认后提交）。

---

## 0. 为什么先修这些

P0-00 发现这一批的共性是：**它们都是「门禁本身坏了」，而不是「产品代码坏了」**。后果比一个普通 bug 严重——门禁坏了以后，后续每一次开发都无法判断自己有没有改错东西：

| 症状 | 后果 |
|---|---|
| 契约门实际是红的（220 + 254 条误报，其中一个检查器自检自己都失败） | 没人会去看它，等于没有契约门 |
| 从 workspace 调用契约脚本**必然**误报 | 后来者会去「修」一个根本不存在的 `tf/index.ts` 缺失 |
| API 全量测试并行时约 1/5 概率整片崩 | 训练出「红了就重跑一次」的习惯，真正的回归会被当成噪声 |
| Docker 环境模板缺 16 个键、部署脚本不校验两个启动关键密钥 | 部署会一路跑到「重启进程」才由 API 拒绝启动，而那时旧进程已被替换 |

所以先修这些，再谈继续开发。

---

## 1. 修复清单

### FIX-1 — `jsx-balance-check.mjs`：220 条误报 → 0

| 项 | 内容 |
|---|---|
| **症状** | 对一个 `next build` 能编译通过的代码树报 **220 条**「closing X does not match Y」，涉及 69 个文件 |
| **根因** | `scanTags()` 里有一条「排除比较式 `a < b`」的启发式：`if (!closing && /[);]\|&&\|\|\|/.test(attrs))` 就把整个标签**丢弃**。而 `onClick={() => …}` 必含 `)`，于是**每一个带箭头函数或函数调用的标签都从未入栈**；随后 `</button>` 只能与栈里恰好是 `<div>` 的祖先比对，报出「不匹配」 |
| **放大原因** | 紧随其后的第二条启发式 `!/[="']/.test(attrs)` 又把 `<Comp {...props}>` 这类「只有 spread 没有引号」的标签也丢掉了 |
| **修法** | 删掉两条「包含某字符就丢弃」的判断，改为按**形状**判断：新增 `looksLikeAttributes(region)`，逐字符扫描标签名与 `>` 之间的区域，整体跳过 `{…}`（含字符串、含嵌套花括号）与引号值，只接受 `name` / `name=value` / `{…}` / 空白。比较式会在遇到运算符时返回 false |
| **改动文件** | `scripts/jsx-balance-check.mjs` |
| **验证** | `--self-test` **14/14 通过**（其中 4 条是「必须能检出不闭合 / 不匹配 / 无对应开标签 / EOF 未闭合」的正向用例，所以检出能力没有被削弱）；对 `apps/web/src` 全量扫描 **0 findings** |

### FIX-2 — `tf-prop-check.mjs`：254 条误报 + 自检失败 → 0

这里其实是**两个**独立缺陷。

**FIX-2a：解构模式里的注释把 prop 吞掉了**

| 项 | 内容 |
|---|---|
| **症状** | `--self-test` 自检 9/9 通过后追加报 `TFBadge is missing parsed prop "dot" / "title"`，并打印 `THE CHECKER IS WRONG, not your code` |
| **根因** | `declaredProps()` 先 `split(",")` **再**剥离注释。`TFBadge` 的 `dot` / `title` 前面各有一段 JSDoc，而注释文本里含逗号 —— 于是注释被从中间切开，带着属性名的那一片以 ` active).` 之类的文本开头，过不了标识符校验，prop 被静默丢弃。**这两个恰好是仓库里唯一「文档注释里含逗号」的 props**，所以每个传 `dot` / `title` 的调用点都被报成「does not declare」 |
| **修法** | 先把整段解构体的注释（块注释 + 行注释）剥掉，再按逗号切分 |
| **改动文件** | `scripts/tf-prop-check.mjs` |

**FIX-2b：属性名正则把属性值里的散文当成了属性名**

| 项 | 内容 |
|---|---|
| **症状** | 修完 2a 后仍有 229 条，形如 `TFEmptyState does not declare "One" / "filter" / "that" / "can" / …`，以及 `"void"`、`"h-5"` |
| **根因** | `attributesOf()` 用的正则是 `/(?:^\|\s)([A-Za-z_][\w-]*)(?=\s*=\|(?=\s\|\/?>))/g`。它的 lookahead 实际退化成「后面是空白」，于是**标签区域内每一个单词**都算属性名，包括 `description="One filter that is…"` 这类字符串值里的词，以及 `{() => void f()}` 里的 `void` |
| **判据** | `npm run typecheck`（`tsc --noEmit`）在这棵树上全绿；而在封闭 prop 类型上传入未声明属性就是编译错误。**因此该脚本在本仓库报出的任何一条，按构造必然是误报** —— 它要是报出一条 `tsc` 接受的东西，错的是检查器 |
| **修法** | 重写 `attributesOf()`：逐字符走标签（新增 `skipBraces()` 辅助），跳过 `{…}` 与引号值整体，只把真正的 `name` / `name=value` 收进来 |
| **改动文件** | `scripts/tf-prop-check.mjs` |
| **验证** | `--self-test` **9/9 通过**；全量输出 **`OK — 22 tf/* components checked against their call sites; no undeclared props.`（0 findings）** |

### FIX-3 — 三个检查器改成与 cwd 无关（E.2）

| 项 | 内容 |
|---|---|
| **症状** | `npm run test:contracts -w @talkfirst/web` 必然报 `apps/web/src/components/tf/index.ts — tf/index.ts is missing`，而该文件实际存在（2880 字节） |
| **根因** | 三个脚本都用 `const ROOT = process.cwd()` 当仓库根。npm 运行 workspace 脚本时 cwd 是 `apps/web`，于是 `ROOT = …/apps/web`，`ROOT/apps/web/src` 解析成 `apps/web/apps/web/src` —— 一个不存在的目录 |
| **修法** | 三个脚本统一改为 `const ROOT = fileURLToPath(new URL("..", import.meta.url))`，即从**脚本自身位置**推导仓库根 |
| **改动文件** | `scripts/static-contract-check.mjs`、`scripts/jsx-balance-check.mjs`、`scripts/tf-prop-check.mjs` |
| **验证** | 从 `apps/web` 目录直接 `node ../../scripts/static-contract-check.mjs` → `OK — 79 source files, 93 theme colours, 102 E2E testids all satisfied.`；`npm run test:contracts -w @talkfirst/web` → **通过** |

### FIX-4 — API 全量测试改为确定性执行（E.4）

| 项 | 内容 |
|---|---|
| **症状** | `npx jest` 并行时约 **1/5** 概率整片崩：`oauth-flow-http.spec.ts` 的 **13 条全部失败**，该套件耗时从 11s 涨到 40.6s；同一条命令下一次运行就全绿（实测 5 次并行：1 次崩、4 次全绿） |
| **根因** | 这个套件会真的启动应用并用真实 HTTP 打真实 PostgreSQL —— 与另外 85 个套件**同一个数据库实例**。并行时互相争用连接，失败形态是 `beforeAll` 在负载下超时（所以是整套 13 条一起倒，而不是逐条断言失败） |
| **修法** | `apps/api/jest.config.cjs` 增加 `maxWorkers: 1`，并写明理由 |
| **代价** | 全量 1602 条从约 37s 变成约 34–57s。**这是测试隔离的局限，不是产品缺陷**；将来若给该套件独立数据库，可以撤回 |
| **改动文件** | `apps/api/jest.config.cjs` |
| **验证** | 修复后 `npx jest`：**86 suites / 1602 tests 全部通过，34.2s** |

### FIX-5 — 部署脚本补两个「启动关键」校验（G3 / G4 的工程侧）

| 项 | 内容 |
|---|---|
| **症状** | `scripts/deploy-pull.sh` 校验了 `NODE_ENV`、`ALLOW_INSECURE_DEFAULTS`、`TRUST_PROXY`、`SECURITY_DEVICE_SALT`、`NEXT_PUBLIC_API_BASE_URL`，但**没有**校验 `TOKEN_ENCRYPTION_KEY` 与 `API_PUBLIC_URL` —— 而这两个同样会让 API **拒绝启动** |
| **后果** | 脚本会一路跑完「构建 → 迁移 → 重启进程」，直到新进程自己报错退出才发现；而那时旧进程已经被替换掉了 |
| **修法** | 新增两条校验：① `TOKEN_ENCRYPTION_KEY` 为空 → `die`（附生成命令与「轮换会让已存 token 全部失效」的警告）；② `API_PUBLIC_URL` 是 loopback 且 `GOOGLE_CLIENT_ID` 已配置 → `die`（这正是 `assertOAuthConfiguration()` 会拒绝启动的组合）；loopback 但未配 Google → `warn` |
| **改动文件** | `scripts/deploy-pull.sh` |
| **验证** | `bash -n` 语法通过；新增代码块**原样抽出**做了 4 个隔离用例：缺 TOKEN_ENCRYPTION_KEY → 拦截；loopback + 配了 Google → 拦截；loopback + 未配 Google → 仅警告并放行；全部正确 → 放行。四条行为全部符合设计 |

> 说明：完整的端到端验证做不到 —— 该脚本的校验发生在 `git fetch` **之后**，离线环境走不到那一步。已如实记录为「隔离测试通过，未做端到端」。

### FIX-6 — Docker 环境模板补齐 16 个键（G8）+ 本地启动脚本不再跑过期 dist（G13）

| 项 | 内容 |
|---|---|
| **G8 症状** | `.env.docker.example` 相对 `.env.example` 缺 16 个键：`TOKEN_ENCRYPTION_KEY`、`API_PUBLIC_URL`、`OAUTH_PROVIDERS`、`OAUTH_DEV_PROVIDER`、`GOOGLE_CLIENT_ID/SECRET`、`DATABASE_URL`、`DIRECT_URL`、`PUBLIC_UPLOAD_BASE_URL`、`SOCIAL_SYNC_ENABLED`、`SOCIAL_SYNC_INTERVAL_MINUTES`、6 个 `VIDEO_*` |
| **G8 修法** | 全部补齐并逐条注释（含「缺了会让 API 拒绝启动」「生产必须不设 `OAUTH_DEV_PROVIDER`」「`VIDEO_MAX_UPLOAD_MB` 与 `VIDEO_TARGET_MAX_MB` 不可合并」等）。`DATABASE_URL`/`DIRECT_URL` 说明由 compose 注入，给出裸机部署的示例行 |
| **G13 症状** | `dist/` 已被 `.gitignore` 排除（不再入库），而 `start-local.bat` 直接 `node apps/api/dist/main.js` —— 全新克隆后**该脚本必然启动失败**；dist 存在时又可能是过期构建，导致「刚修好的 bug 依然复现」 |
| **G13 修法** | `start-local.bat` 在第 3 步加入 `npm run build -w @talkfirst/api`，构建失败即退出（并明确提示「什么都没启动，所以你看到的不是过期 dist」）；步骤号 5 → 6 |
| **改动文件** | `.env.docker.example`、`start-local.bat` |
| **验证** | 模板键集合与 `.env.example` 对齐（用 `comm` 复核）；`.bat` 为 CRLF 文本，改动为纯文本插入，未引入编码变化 |

---

## 1.5 FIX-7 — P0-01 的仓库侧加固：交付构建拒绝 loopback 基址

> 这是用户选定「先做 P0-01 的仓库侧加固」后的产物。P0-01 的决定性动作（改服务器 `.env`、
> 重新构建、部署）在服务器上，不在本仓库；**能在仓库侧根除的是「为什么这个问题以前能静默发生」**。

| 项 | 内容 |
|---|---|
| **根因** | `NEXT_PUBLIC_*` 是**构建期**注入的，而两个 Dockerfile 的 `ARG` 默认值就是 `http://localhost:4000/api/v1`。忘记传参不会报任何错，只会安静地生成一个「浏览器去连自己 localhost」的产物。源码树里根本没有那个 IP（实测出现 0 次），它只存在于**构建产物**里 |
| **为什么不用环境变量当开关** | `NODE_ENV=production` 区分不了：`next build` 无论本地还是交付都会设它，本机做生产模式自测时用 localhost 基址是正当的。所以开关是**谁来调用** —— 只有两个 Dockerfile 的构建阶段与 `deploy-pull.sh` 会调它 |
| **新增** | `scripts/check-build-env.mjs`：回环地址（`localhost`/`127.0.0.1`/`0.0.0.0`/`::1`）一律拒；非 `https://` 一律拒（Mixed Content）；同源相对路径（如 `/api/v1`）放行（它不可能回环也不会 mixed content）；逃生舱 `ALLOW_INSECURE_API_BASE_URL=true` 降级为警告 |
| **接线** | `apps/web/Dockerfile` 与 `apps/admin/Dockerfile` 的构建阶段（各加 `COPY scripts ./scripts` + 一条 `RUN`）；`scripts/deploy-pull.sh` 在 `npm ci` **之前**调用（早失败，省时间） |
| **顺带修掉一个同源缺口** | `deploy-pull.sh` 原本既**不读也不导出** `NEXT_PUBLIC_SOCKET_BASE_URL` —— 而 `chat-socket.ts` 的兜底值是 `http://localhost:4000`。也就是说裸机部署会拄一个同样烙进产物的坏 socket 地址，且从来没有任何地方提醒过 |
| **顺带改掉一个危险行为** | `deploy-pull.sh` 原来在 `NEXT_PUBLIC_API_BASE_URL` 缺失时**写入 `http://localhost:4000/api/v1` 并且只给一条警告**，等于默认生成坏产物。现在直接 `die` 并给出该写什么 |
| **改动文件** | `scripts/check-build-env.mjs`（新增）、`apps/web/Dockerfile`、`apps/admin/Dockerfile`、`scripts/deploy-pull.sh`、`.env.docker.example`（加提示注释） |
| **验证** | 9 个用例矩阵：两个都未设 / 都是 localhost / `127.0.0.1` / 对外但 http / 只 socket 回环 / https 双配 / 同源相对路径 / 逃生舱 / 畸形值 —— 行为全部符合设计（前 5 个与畸形值 exit=1，后 3 个 exit=0）。另：`npm run test:contracts -w @talkfirst/web` 仍全绿，**本地 `npm run build` 不经过该检查，行为一行未变**（实测两端都过） |
| **NOT VERIFIED** | **未实际构建 Docker 镜像**（需要 daemon 与数分钟构建）。Dockerfile 改动是纯插入（`COPY` + `RUN`），且 `docker compose --env-file .env.docker.example config` 解析通过；但「镜像构建会按预期失败/成功」未经运行验证 |

---

## 2. 完整验证结果（修复后，本轮实测）

| # | 检查 | 结果 |
|---|---|---|
| 1 | `static-contract-check --self-test` | ✅ 32/32 |
| 2 | `jsx-balance-check --self-test` | ✅ 14/14 |
| 3 | `tf-prop-check --self-test` | ✅ 9/9 |
| 4 | `static-contract-check`（仓库根） | ✅ 79 源文件 / 93 主题色 / 102 testids |
| 5 | `jsx-balance-check`（仓库根） | ✅ **0 findings**（修复前 220） |
| 6 | `tf-prop-check`（仓库根） | ✅ **0 findings**（修复前 254，且自检失败） |
| 7 | `npm run test:contracts -w @talkfirst/web` | ✅ 通过（修复前必然误报） |
| 8 | `npm run typecheck`（7 workspace） | ✅ 0 错误 |
| 9 | `npm run lint` | ✅ 0 error / 0 warning |
| 10 | `npm run test:static` | ✅ web 16/16、admin 28/28 |
| 11 | API 全量单测 `npx jest` | ✅ **86 suites / 1602 tests 全部通过**（34.2s） |
| 12 | `npm run build -w @talkfirst/api` | ✅ 通过 |
| 13 | `npm run build -w @talkfirst/web` | ✅ 通过 |
| 14 | `npm run build -w @talkfirst/admin` | ✅ 通过 |
| 15 | `docker compose --env-file .env.docker.example config` | ✅ 解析通过（新增 16 个键无引号/格式问题） |
| 16 | `scripts/check-build-env.mjs` 9 个用例矩阵 | ✅ 行为全部符合设计 |

**汇总：14 PASS / 1 信息性 FAIL。** 唯一那条 FAIL 是 `npm run test:contracts -w @talkfirst/admin`，原因是 **admin 没有这个脚本** —— 三个检查器的扫描根都是 `apps/web/src`，所以 admin 本就不该有。这不是缺陷、也不需要修，记录在此以免被误读为红灯。

**顺手确认的一条**：`npm run test:contracts -w @talkfirst/web` 现在真的会跑完三个检查（`static-contract-check && jsx-balance-check && tf-prop-check`）并且全绿 —— 修复前它在第一个就倒，后面两个从未被执行过。

---

## 3. 改动的文件（11 个）

```
.env.docker.example                 补 16 个键 + 前端基址的构建期警告注释
apps/api/jest.config.cjs            maxWorkers: 1 + 理由
apps/admin/Dockerfile               构建前调用 check-build-env.mjs
apps/web/Dockerfile                 同上（带 --socket）
scripts/check-build-env.mjs         新增：交付构建的基址守卫
scripts/deploy-pull.sh              补两个启动关键密钥校验；基址守卫；补 SOCKET 基址的读写
scripts/jsx-balance-check.mjs       ROOT 与 cwd 解耦；按形状判定替代两条错误启发式
scripts/static-contract-check.mjs   ROOT 与 cwd 解耦
scripts/tf-prop-check.mjs           ROOT 解耦；注释剥离顺序；属性名提取重写
start-local.bat                     启动前构建 API，失败即退出
docs/P0-00-FIXES.md                 本文档（新增）
```

**未改动**：任何业务代码（`apps/*/src/**` 一行未动）、Prisma schema、迁移、数据库、生产环境、`.env`。

---

## 4. 风险与残余

| 项 | 说明 |
|---|---|
| 检查器重写的风险 | 三个检查器的自检（32 + 14 + 9 条）全部覆盖「必须能检出真问题」的正向用例，且改动后仍全绿；`jsx-balance` 的 4 条检出用例即证明它没有变成「永远返回 OK」的哑巴 |
| `maxWorkers: 1` | 单测变慢约 0–60%；**代价换确定性**。真正的修法是给该套件独立数据库，已记在注释里 |
| `deploy-pull.sh` | 只做了语法检查 + 新增代码块的隔离用例测试，**未做端到端**（离线走不到校验段） |
| `start-local.bat` | 未在 Windows 上实际执行（会拉起本地 PostgreSQL 与三个服务，副作用较大）。改动是纯文本插入，风险低 |
| 本轮未碰 | G1（生产未部署）、G9（Nginx `client_max_body_size`）、G10（health 无 readiness）、G11（本地 `.env` 混用）、G12（AccessLog 0 行）—— 这些都是**服务器侧或需要单独决策**的项，见 P0-00 报告 §G |

---

## 5. 下一步

工程门禁现在是**真的绿了**，所以可以安全地进入开发计划：

1. **P0-01（修复生产环境 API HTTPS）** —— 现在有实测证据可直接定位：源码树里 `3.141.192.106` 出现 **0 次**，本机构建产物烘焙的是 `localhost:4000`（24 处），而两个 Dockerfile 的 `NEXT_PUBLIC_API_BASE_URL` ARG 默认值就是 `http://localhost:4000/api/v1`。**结论方向：问题在服务器构建时的环境变量，修完必须重新构建 web/admin。**
2. 部署前先按 P0-00 §H.1 补齐服务器 `.env`（现在 `deploy-pull.sh` 会替你挡住 `TOKEN_ENCRYPTION_KEY` 与 loopback `API_PUBLIC_URL`）。
3. 之后才是 P0-02 起的真实功能开发。

---

## 6. FIX-8 — G10 就绪探针（2026-10-05）

> 本节晚于上一节：上面那批修完之后，门禁已经真的绿了；这一节是回头把 §G 里
> 「需要单独决策」的一项落地。G 系列里 **G10** 是**代码侧**能解决的（其余 G1/G9/G11/G12
> 都在服务器上或需要先有真实流量），所以先做它。

| 项 | 内容 |
|---|---|
| **症状（G10）** | `/api/v1/health` 只固定返回 `ok`，不碰任何依赖 → 一个「数据库连不上、但进程还活着」的实例在编排眼里是健康的 |
| **为什么不能直接把 DB ping 塞进 `/health`** | `docker-compose.yml` 的 api healthcheck 探的就是它，而它撑着 `depends_on: condition: service_healthy` 的 web/admin。健康检查失败 = web/admin 永远不启动 + `docker ps` 显示 unhealthy —— **数据库抖一下就等于整栈被判死**。存活探针的语义只是「这个进程该不该重启」 |
| **修法** | 拆成两个语义不同的端点：`GET /api/v1/health`（存活，无依赖，不变）与 `GET /api/v1/health/ready`（就绪，真的 ping 一次 DB） |
| **就绪的判据** | `SELECT 1`；超时 `READY_TIMEOUT_MS = 2000`；不可用 → **503 + `error.code = "NOT_READY"`**（沿用仓库“用 `error.code` 说清发生了什么”的约定） |
| **不引 `@nestjs/terminus`** | 只需要一次 `SELECT 1`，而 terminus 会带来一棵新依赖树**以及它自己的响应形状**，那会让仓库既有的 `{success, data}` 封套出现第二种写法 |
| **凭据不外泄露** | 探活是外部（编排/监控，甚至公网）最可能打到的端点：失败时只记 `error.name`、只回固定文案。Prisma 的初始化错误里带连接目标（`DATABASE_URL` 是带凭据的 URL），所以它不能进响应、也不能进日志 |
| **探针改成就绪的消费方** | `docker-compose.yml` 的 api healthcheck、`apps/api/Dockerfile` 的 `HEALTHCHECK`、`scripts/deploy-pull.sh` 末尾的自检提示 |
| **改动的文件** | `apps/api/src/health/health.controller.ts`、`apps/api/src/health/health.controller.spec.ts`、`docker-compose.yml`、`apps/api/Dockerfile`、`scripts/deploy-pull.sh`、`docs/DOCKER-DEPLOY.md`、`docs/architecture/README.md` |
| **测试** | 4 条：存活不碰 DB（断言拿 `$queryRaw` 从未被调）；就绪成功给出时延；查询失败 → 503 且底层错误文本（含假凭据）**一个字都不出现在响应里**；不回应时在 `READY_TIMEOUT_MS` 后判不可用（假定时器推进，不真等 2s） |
| **端到端实测** | 构建后真起 API（`API_PORT=4100`）两种环境各打一次：<br>· 真库：`/health` → 200 `ok`；`/health/ready` → 200 `ready`（`database.up`，2ms）<br>· 不可达库：`/health` → **仍然 200**（存活不受影响 —— 这正是必须改 compose 探针的原因）；`/health/ready` → **503 `NOT_READY`，1898ms 返回**（被 2s 上限截住，不抱死） |
| **有意没改** | 两个 Playwright 配置的 `webServer.url` 仍指存活探针。改成就绪在语义上更对（E2E 本来就需要库），但那两套 E2E 的既知失败已按用户决定搁置，先不动它们的启动门 —— 这是另一个决定，记在这里而不是顺手改 |
| **顺带确认** | 全局限流是 120/min（`http-throttler.guard.ts`），而 compose 探活是 10s 一次（6/min），换成就绪后同一量级，无需给探针加 `@SkipThrottle` |

---

## 7. 同轮的其他核对（2026-10-05）：G12 / G11 / C13

这一轮除了 FIX-8，还把 §G / §C 里几项**能就地定性**的条目查清了。

### G12 —— AccessLog 写入链路：本机已实测（基线记为「未验证」）

基线当时测到本机 `AccessLog` 是 **0 行**，于是判定「写入链路在当前数据上未被验证」。
本轮重测：**14317 行**，且**刚刚那几次请求就在里面**——
`GET /api/v1/health/ready`、`GET /api/v1/health`（多条）都有行，时间戳与探测时刻逐毫秒对齐。

结论：**写入链路是通的**；基线那次看到 0 行，是因为当时这台机器上确实没有流量。
另外，新加的就绪端点也被同一条中间件正常记下了（不需要为它单独接线）。

（字段名是 `statusCode` 而不是 `status`；行里 `method` / `path` / `statusCode` / `durationMs` 均正常落库。）

### G11 —— 本机 `.env` 混用：属于**你侧的动作**，本轮不动

基线写的是：本机 `.env` 是「生产风格混用」——`NODE_ENV=development` 但含**真实 Gmail 应用密码与 Google 凭据**；
修法是「生产与本地环境文件分离」。
这需要**轮换/新建**你那边的真实凭据，不是代码改动；我不会去碰它们，列在这里作为待办。

### C13 —— `docs/AI_CONTEXT.md` 文档漂移：已校准（本轮补做）

三份文档（P0-00 §C、REPAIR §4.12、HANDOVER B11）都点名了同一处漂移。本轮逐条核实并改写：

| 位置 | 原声明 | 实测 |
|---|---|---|
| §3 目录树 / §5.1 | `schema.prisma` **771 行** | **1455 行** |
| §5.1 | **36 个 model**、**18 个 enum** | **47 / 25** |
| §5.1 | （未记迁移数） | 补上 **30** 个 |
| §8 表 Moments 行 | ⚠️ 部分：「无详情页、无回复、无分页、无删除、不可举报」 | ✅：详情页 `@Get(":id")` + `/moments/[id]`、回复 `parentId`、本人删评论（PC-2.4）均已在；仍缺**评论分页/评论举报**（C2） |
| §8 表 Production P0 行 | 指向「Production Readiness 审计」 | 该文件不存在。改为指向 `docs/P0-00-FIXES.md` 与 §G |
| §8.1 缺口清单 | 10 条「P1 核心功能缺失」 | 其中 **5 条已闭环**（1 帖子详情、2 回复/删除、5 邮箱验证/CSPRNG/真 SMTP、8 改密/找回、10 动态审核），**2 条部分闭环**（3 内容举报、4 通知），其余保留并挂上 §C 编号 |

改写原则按该文档自己的规则（「文档说 MISSING 但代码已有 → 以代码为准」），
并在 §8.1 顶部留了一条 **2026-10-05 校准** 说明，免得后来者以为这些结论是原作者的。
**未复核**的只剩第 6 条（社交平台同步的演示内容）——它没在本轮证据里，所以标了「保持原结论」而不是改掉。

---

## 8. FIX-9 — C5 通知去重：按**事件**判定，不按**窗口**（2026-10-05）

| 项 | 内容 |
|---|---|
| **基线原文** | C5「通知去重」→ 建议 `Notification(userId,type,targetId,window)` 唯一索引（§C） |
| **产品口径** | 用户 2026-10-05：「**每次点赞都提醒**」 |
| **为何原建议不能用** | ① `Notification` 表**没有 `targetId` 列**——目标只存在于 `data` 的 JSON 里，那个索引今天根本建不出来；② 更要紧的是：按 `(收件人, 类型, 目标)` 去重会把**同一条动态两个不同人的点赞合成一条**，与「每次点赞都提醒」直接冲突。去重键若真要建，必须把**点赞人**算进去 |
| **核实结论：没有可去重的重复** | 13 个生产者分两类，**都不产生重复投递**：<br>· **事件型**（点赞 / 评论 / 回复 / 消息 / 认识请求 / 交换请求 / 管理操作）：以**新建行**为触发，行本身唯一 → 一次事件恰好一条通知<br>· **状态型**（封禁到期释放 `user-status.scheduler.ts`）：单条 `updateMany` + **自消耗谓词**（释放后 `status` 不再是 `SUSPENDED`、`suspendedUntil` 为 `null`），第二次 tick 匹配 0 行；接受类迁移用**条件认领**（`connections.service.ts` 注释写明「行已被上面的认领翻转过」） |
| **因此本轮不建列、不建索引** | 建一列没有任何消费者会用的 `dedupeKey`，是给假想的将来加基础设施。**它是可加的**，触发条件是：出现以**状态**（而非事件）为触发、且可被重放的通知生产者 |
| **顺带发现（未修）** | `toggleLike` 是**切换语义**：同一请求被重放两次（双击/网络重试）时，第二次会被当成「取消赞」而删掉那个赞。这是**幂等性**问题（**不是**重复通知问题），修它要动 API 语义（拆成显式 like/unlike，或引入幂等键）——属单独的产品/接口决定 |
| **固化成契约** | 新增 `apps/api/src/moments/moments-like-notifications.spec.ts`（**4 条全过**）：两个不同人点赞 = **两条**通知（不折叠）· 取消赞不通知 · 取消后重新点赞 = **再提醒一次** · 自赞不提醒 |
| **改动文件** | `apps/api/src/moments/moments-like-notifications.spec.ts`（新增）、`docs/AI_CONTEXT.md`（§8.1 的 C5 行）、本文档 |

这条为什么不能只写在文档里：它很容易在后面的「通知太多了，折叠一下吧」里被无声改掉。
上面 4 条用例就是那个改动的第一道拦网 —— 它们红的时候，意思不是「通知坏了」，
而是「**你改了产品口径**」。

---

## 9. FIX-10 — C4 收藏（Bookmark）（2026-10-05）

| 项 | 内容 |
|---|---|
| **基线原文** | C4「收藏（Bookmark）」→「需新建 `MomentBookmark`」（§C） |
| **数据模型** | 新增 `MomentBookmark`（`id` 主键 + `@@unique([userId, momentId])` + `@@index([userId, createdAt])`，两侧 CASCADE）。**为什么不用 `MomentLike` 那种复合主键**：收藏列表按「最近收藏在前」分页，走的是全仓库共用的 `(createdAt, id)` keyset 游标；复合主键没有 `id` 可做同一毫秒的 tie-break，会逼出第二套游标形状 |
| **迁移** | `prisma/migrations/20261005120000_moment_bookmarks/`（只建表，不改既有列与行）。已 `migrate deploy` 应用到本机库；`migrate diff --from-schema-datasource --to-schema-datamodel` = **No difference detected** |
| **接口** | `GET /moments/bookmarks`（keyset 分页）· `POST /moments/:id/bookmark` · `DELETE /moments/:id/bookmark`。两个写方法**幂等**：收藏 `upsert`（`update: {}`，所以重复收藏不会把 createdAt 刷新、把这条挤到最前面），取消 `deleteMany`（删不存在的行不抛 P2025） |
| **权限模型** | 「能不能收藏」=「能不能看」：复用 `resolveMomentAccess` + 作者 ACTIVE。理由写在代码注释里 —— 收藏是**按用户持久化下来的读取通道**，允许收藏看不见的东西就等于绕过了拉黑与隐私。找不到与不可见**都回 404**（不用状态码区分，免得问出别人内容是否存在） |
| **投影** | `feed` / `userMoments` / `getMoment` / 收藏列表四处都多了 `bookmarked`，形状与既有的 `liked` 完全平行（一行 include + 一个布尔），所以卡片不需要额外请求 |
| **列表过滤** | 每次读取都重新判一遍可见性、拉黑、审核状态 —— 收藏是**会过期的快照**：收藏之后对方可能拉黑你、把可见性收紧成 private，或动态被置为 `PENDING`。拉黑与审核在 SQL 里判，可见性（private / connections）在 JS 里判 |
| **前端** | 卡片动作行新增收藏按钮（`aria-pressed` + 乐观翻转 + 失败回滚，与点赞完全同一套）；**收藏做成 `/moments` 的第四个标签，而不是新页面** —— 卡片 `MomentCard` 是页面内局部组件，P0-05 又要求「只有一套卡片」，所以复用同一个列表比复制（或先做一次大抽取）都对；收藏标签下平台筛选器**整个收起来**（它不看平台，留一个按下去没反应的筛选器比没有更困惑） |
| **测试** | 新增 `moments-bookmarks.spec.ts`：**13 条**（幂等两向 · 不可见/作者非 ACTIVE/不存在不得收藏且**零写操作** · 分页 `take=limit+1` 与游标取返回页最后一行 · 拉黑与审核的**查询形状** · private/connections 的**行为** · 投影 · 畸形游标）。用例里逐条标明了哪些是「查形状」哪些是「查行为」—— 因为桩件不执行 SQL |
| **撞到的既有断言** | `moments-detail.spec.ts` 有 5 条用例的 fixture 没有 `bookmarks`，投影处直接 TypeError。按仓库惯例（参见 `admin-user-detail.spec.ts` 的 B3 注释）**更新期望而不是删断言**：fixture 补 `bookmarks: []`，`toMatchObject` 里显式写上 `bookmarked: false` —— 下次它再变会被看到 |
| **验证** | API **90 套件 / 1671 用例全绿**（本套 13 条含在内）；`tsc --noEmit` 与 `eslint` 退出码 0；web typecheck/lint 干净、静态 16/0、契约三件套全 OK（80 源文件 / 93 主题色 / 102 testids / 69 tsx 平衡）；启动日志的映射顺序里 `/moments/bookmarks` 在 `/moments/:id` **之前**（字面量路由没被参数路由抢）；三条新路由未带凭证均回 401 |
| **前端（二）** | 动态详情页（`/moments/[id]`）也加了收藏按钮：那一页只有一个对象，所以**不做乐观更新** —— 失败时 `setError` 会把原因说清楚，回滚一份乐观状态在这页没有额外好处 |
| **未做（明确）** | 无。C4 的四件（模型 / 接口 / 列表 / 两处按钮）全部落地。**未跑**的只是浏览器级 E2E（按 `docs/KNOWN-E2E-ISSUES.md` 的决定保留） |

---

## 10. FIX-11 — C3 已读位置与未读数（2026-10-05）

| 项 | 内容 |
|---|---|
| **基线原文** | C3「已读回执 / 会话未读数 /「未读 ≤5」」→ 需 `ConversationMember.lastReadAt`（§C） |
| **核对：旧值根本不是「未读」** | `GET /conversations` 早就在返回 `unreadCount`，但它是 `take: 5` 的副产品 —— 数「最近 5 条消息里不是我发的」。两个后果都不报错、只一直错：① 从没打开过的会话最多也只显示 5；② **读完之后不会归零**（已读与未读在数据上没有任何区别） |
| **schema + 迁移** | `ConversationMember.lastReadAt DateTime?`。既有行**回填成迁移时刻** = 「此前全部已读」：另一种选法（留 NULL）会给每个老成员凭空刷出「历史全部未读」的数字，而那份「迁移前的未读」在迁移前**从未被记录过**，并没有真的丢掉什么 |
| **未读数** | 新私有方法 `unreadCountFor`：`message.count({ conversationId, deletedAt: null, senderId: { not: me }, type: { not: "SYSTEM" }, createdAt: { gt: lastReadAt } })`；`lastReadAt = null` 时不加时间下界。**逐会话一次 count**：每个会话阈值不同，一条 SQL 表达不了（`groupBy` 只能用共同下界，会多算读得晚的会话）；会话数量级在几十、`(conversationId, createdAt)` 上有索引。**上千会话时这里就是该改的地方**（改成每用户未读计数器） |
| **已读端点** | `POST /conversations/:id/read`：非成员 404（与消息列表同口径，不拿状态码漏存在性）；幂等（重复调用只是继续后推）；返回 `{ conversationId, lastReadAt, unreadCount: 0 }`。用 POST 而不把已读藏在「拉消息列表」里 —— 那样一来「看了一眼列表」与「读了这个会话」就再也分不开了，而红点恰恰依赖这个区别 |
| **发消息顺带已读** | 发送事务里补一条 `conversationMember.update({ lastReadAt: now })`：发消息意味着你正看着它。不做也不会漏（自己的消息本就不计未读），但做了之后你回复时对方之前那几条不会以「仍未读」留在列表上 |
| **顺带删掉另一个假「未读」** | 发送响应里的 `peerUnread` = `notification.count({ userId: peerId, readAt: null })`。三处都不对：名字说「对方未读消息」而算的是**未读通知**（两张毫不相干的表）；全仓库**零消费方**（只有那两行引用）；还把对方的计数透给了发送者。已删除，响应变为 `data: message` |
| **前端** | 列表与底部导航**本来就在读 `unreadCount`**（`messages/page.tsx:196`、`tab-bar.tsx:81` 把各会话求和并轮询），所以服务端一改这两处自动变真。唯一缺的是「打开会话即已读」：新增一个以**最新消息 id** 为触发键的 effect（既覆盖进入时，也覆盖人在页面上继续收到新消息；用 id 而非长度，因为翻历史也会改长度），失败静默 |
| **测试** | 新增 `social-unread-http.spec.ts`（**真路由 + 真控制器 + 真 DTO**，桩件只到 Prisma 层）**6 条全过**：未读数来自 count（用 `count → 7` 而窗口里只有 1 条来证明，实现退回窗口算法这条就会红）· `lastReadAt = null` 不加时间下界而其余三条排除仍在 · 打开会话写 `lastReadAt` 并回报未读归零 · 已读幂等 · 非成员 404 且一行不写 · 发消息在**同一事务**里推自己的 `lastReadAt` 且响应不再有 `peerUnread` |
| **验证** | API **91 套件 / 1677 用例全绿**；api typecheck/lint 退出码 0；web typecheck/lint 干净、静态 16/0、契约三件套全 OK；`migrate diff` 无漂移 |
| **未做** | ① 列表的 N+1（已注明触发条件）；② 「未读 ≤5」的**显示上限** —— 底部导航现在直接显示总数（`tab-bar.tsx`），要不要改成 `5+` 是产品决定，没有替它定 |

---

## 11. FIX-12 — C1 话题浏览：把 §2.22 点名缺的那个参数补上（2026-10-05）

| 项 | 内容 |
|---|---|
| **基线原文** | C1「搜索页 / 话题页」→「API 层不存在对应接口（`FUNCTIONAL-TEST-UI-UX.md` §2.22 已核对）」→「需产品先定数据契约」（§C） |
| **§2.22 真正说了什么** | 两个页面都没建，因为服务端没接口；同时留下两条**具体**证据：① 成员端全部 GET 路由里没有 `/search`；② `@Get("feed")` 的参数表只有 `tab/platform/limit/cursor` ——**没有 `topic`**。而话题的**数据早就存在**（动态带 `tags`，compose 有完整的话题选择/创建 UI），缺的只是「按 tag 查」 |
| **本轮范围（有意拆开）** | **先做话题**（数据、写入归一化、UI 入口都已就位，只缺一条查询）；**成员搜索另开一轮** —— 它缺的是**产品决定**（搜谁？按昵称/语言/兴趣？要不要配额？），而这些问题 §2.22 列出来就是等人回答的，不由我替它回答 |
| **归一化** | 查询端 `normalizeTopic` 与写入端（`publish`）**逐字同一套**：`trim → 去掉开头的 # → 小写 → 截 32`。两套「看上去一样」的规则会让 `#旅行` 与 `旅行` 互相查不到，而两边都不报错 |
| **API（一）** | `GET /moments/feed?topic=` —— 就是 §2.22 点名缺的那个参数。`tags: { has: topic }` 直接对应 Postgres 的数组包含，不需要新表或新索引 |
| **API（二）** | `GET /moments/topics` —— 标签 + 条数。**计数只在你看得见的动态里做**：一个 tag 的条数如果能被看不见它所属动态的人推出来，那它就是一个侧信道（「某个只被私密动态用过的话题有 3 条」本身就泄露了那 3 条的存在）。所以它用的是与 `feed` **同一个** `visibilityContext` 与同一组过滤条件 |
| **为何是「近期窗口」** | Prisma 不能 unnest 数组列（`tags` 是 `String[]`），全库计数只能靠原生 SQL 的 `unnest + GROUP BY` ——那会是本仓库除健康探针之外的第一处原生 SQL。所以取**最近 N 条可见动态**（默认 300、上限 1000）在 JS 里聚合：语义诚实（页面说的是「近期话题」而不是历史总数）· 只 select `tags`（payload 极小）· 不引入新查询方言。**真需要全量计数时就是该上话题表或原生 SQL 的时候** —— 这句判断写在代码里，不埋在实现里 |
| **顺手消掉的重复** | feed 与 C4 的收藏里各有一份**逐字相同**的「拉黑 + 连接」上下文；话题需要第三份。已抽成 `visibilityContext()`，三处共用 —— 否则「改了一处」就是默认结局 |
| **前端** | 话题做成**动态页里的第二排筛选 chip**（与平台并列），而不是新建 `/topics`：底部导航只有四个位置（加第五个是设计决定），而「按话题看动态」本来就是 feed 的一种视图。chip 带条数（与列表能翻到的条数一致），在「收藏」标签下不出现 |
| **测试** | 新增 `moments-topics.spec.ts` **12 条全过**：归一化与写入端一致（含 40 字符截 32）· 无 topic / 空串 / 只给 `#` 时**不加**条件（不能变成 `has: ""`）· 话题与拉黑/平台过滤**并存** · private 作者的标签不计入 · connections-only 未连接不计入而已连接计入 · 拉黑与审核的查询形状 · 排序（条数降序、同数按 tag 升序）· limit/window 与 `select` 只取 tags+userId |
| **验证** | API **92 套件 / 1698 用例全绿**；api 与 web 的 typecheck/lint 退出码均为 0；web 静态 16/0、契约三件套全 OK；本轮**没有新增迁移或模型**（话题复用现有表），所以 admin 静态测试里的迁移/模型 pin 无需变更 |
| **未做** | ① **成员搜索**（需产品决定，见上）；② 话题的**全量计数**（当前是近期窗口，边界已写在注释里）；③ 话题的浏览器级 E2E（按 `docs/KNOWN-E2E-ISSUES.md` 的约定保留） |

---

## 12. FIX-13 — C2 评论举报与审核侧的评论目标（2026-10-05）

| 项 | 内容 |
|---|---|
| **基线原文** | C2「admin 评论审核视图」→「`Report` 无 `commentId` 列；动态审核已做，评论未做」（§C） |
| **核对：评论分页其实已有** | PC-2.4 已经做过评论分页（顶层评论分页、回复内嵌，页边界不会劈开线程）。所以 C2 的实际缺口只有**评论举报**与**审核侧的评论目标** |
| **schema + 迁移** | `Report.commentId String? @db.Uuid` + `@@index([commentId])`。**无外键是有意的**：举报是**审核历史**，而评论是**硬删除**（`MomentComment` 没有 `deletedAt`）；加 `onDelete: Cascade` 会在评论被删时把管理员正要复核的那条线索一起删掉 |
| **举报侧** | `ReportDto.commentId`，目标从 2 个变 3 个，规则仍是**恰好一个**（`messageId` 不算目标，它是附在人举报上的证据）；新增 `resolveCommentTarget`：① 评论必须存在（硬删除 → 查不到即已删）；② 评论作者必须 ACTIVE；③ **举报人必须看得见那条动态**（与前几个端点同一个 `resolveMomentAccess` —— 没这道闸，任何人拿一个评论 id 就能让管理员读到一条自己无权看的内容里的原话，正是 audit P028 在消息上报过的同一个洞）；④ 被举报人 = 评论作者，服务端读 |
| **为何评论路径统一 404** | 不可见时回 404 `COMMENT_NOT_FOUND`，**故意**不同于动态路径的 403 `MOMENT_LOCKED`：后者是用户正在尝试打开一个页面，说「你看不了」不泄露新东西；而这里传进来的是一串不透明 id，回 403 就等于确认「这条评论存在，只是你看不了」 |
| **审核侧（API）** | `deriveTargetType` 3 态 → **4 态**（`MOMENT > COMMENT > MESSAGE > USER`）；`CONTENT_REPORT_TARGET` 加第三条 arm 并**每条 pin 住前面的指针**以保持分区（否则带多个指针的行会被算两次）；`buildReportWhere` 四个 arm 同步；`REPORT_DETAIL_SELECT` + `reportDetail` 加 `comment` 摘要（与 message/moment 同一两态契约：`available:false` 是普通状态，**绝不抛异常**）；新增 `commentSummary` |
| **管理端 UI** | `lib/report-target.ts` 四态标签/徽标（琥珀色，与蓝/紫/绿分得开）+ 筛选下拉加「评论」；详情页新增 `CommentSummary` 类型与「被举报的评论」区块（含「已删除 / 无关联」两态） |
| **用户端 UI** | 举报弹窗从「只报动态」扩成「动态 **或** 评论」：同理由列表、同失败语义，根 testid 按目标切换（`comment-report-dialog` / `moment-report-dialog`，两个字面量都在源码里，所以静态契约检查照旧通过），内部那几个 `moment-report-*` 是弹窗自己的部件、不因目标改名；评论动作菜单从「只有自己的评论」扩成**互斥**两种情形：自己的 → 编辑/删除，别人的 → 举报；**只读表面（动态卡片）不传 `onReport`**，因此依旧没有入口 |
| **撞到的既有断言（全部按惯例更新期望）** | ① `social-reports-http.spec.ts` 两处逐字比对 `report.create` 的 data → 补 `commentId: null`；② `admin-reports.spec.ts` 12e（三目标→四目标）/29/29b/29c + `ReportRow` 类型；③ `admin-integration.spec.ts` 39c（两条 arm → 三条，并新增 COMMENT 对照）；④ `admin-user-detail.spec.ts` 的 `CONTENT_ARM_LITERAL` 与 9e/9f（新增评论行用例）；⑤ **admin 静态测试的迁移/模型 pin** —— 本轮三个迁移与 `MomentBookmark` 必须**显式写进清单**，这正是那条 pin 存在的意义（它自己注释里写着「新增迁移必须在这里具名，而不是随着计数器滑进去」） |
| **测试** | 新增 6 条评论举报 HTTP 用例（目标解析 / 404 三态 / 自报 / 三目标互斥）+ 3 条审核详情用例（29d/e/f：标签与摘要 · 评论已删 · 从未指向评论）；另有 5 处既有期望按上表更新 |
| **验证** | API **91 套件 / 1686 用例全绿**；api / web / admin 三端 `tsc --noEmit` 与 lint 退出码 0；web 静态 16/0、admin 静态 **28/0**；web 契约三件套全 OK（80 源文件 / 93 主题色 / **102 testids** / 69 tsx 平衡）；`migrate diff` 无漂移 |
| **未做（明确）** | ① 评论举报的**浏览器级 E2E**（按 `docs/KNOWN-E2E-ISSUES.md` 的决定保留）；② ~~被举报评论审核完成后的**通知**（`REPORT_REVIEW` 类型已在契约里，但未接生产者）~~ —— **本条写错了，2026-10-06 更正**：`REPORT_REVIEW` 的生产者自 `f7c3b6d`（2026-09-20「complete notification event producers」）就已存在，`reviewReport` 在状态**真正变化**时通知 `reporterId`（提交之后发送、不带 `actorId`，见 `apps/api/src/admin/admin.service.ts`），并有用例 `admin-report-review-notification.spec.ts` 在跑。当时写成「未接生产者」，是没查这一步 —— C2 剩下的确实只有 E2E。 |

