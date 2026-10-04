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
