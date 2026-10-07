# CI — C9（2026-10-05）

> 上游：`docs/P0-00-BASELINE.md` §C 的 **C9「CI：仓库无任何 CI 配置」**，
> 以及 §H.3 的第 1 条建议。`docs/P0-00-FIXES.md` 把门禁修到**真的绿了**，
> 但那天之后，这套门禁仍然只在有人想起来敲命令时才跑。
> 本文记录把门禁固化下来的那份工作流：`.github/workflows/ci.yml`。

## 0. 为什么是现在

P0-00-FIXES 的结论是「工程门禁现在是真的绿了，所以可以安全地进入开发计划」。
**这句话有一个前提没被满足**：门禁是绿的，但没有任何东西**强制**它绿。
本文补的就是这个前提 —— 之后每次 push / PR 都会自动跑一遍。

不引入任何新工具、新依赖、新脚本：跑的就是仓库里已有的那几条命令。

---

## 1. 两个作业

| 作业 | 内容 | 需要真库 |
|---|---|---|
| `checks` | typecheck（全部 workspace）· lint（全部 workspace）· web 静态测试 · admin 静态测试 · 静态契约三件套 | 否 |
| `api-tests` | `npm test -w @talkfirst/api`（整套单测，串行） | **是**（PostgreSQL 16） |

触发：`push` 到 `master`、任何 `pull_request`、以及手动 `workflow_dispatch`。
同一分支的新推送会取消上一次（`concurrency`）。

---

## 2. 六条不是随便写的决定

| # | 决定 | 理由（都是踩过或查过的） |
|---|---|---|
| 1 | 两个作业都先 `npm run prisma:generate` | 仓库**没有** postinstall 钩子，而生成的 client 落在 `node_modules/.prisma/client` —— `npm ci` 会把它清掉。少了这一步，`@prisma/client` 只剩空壳，测试在运行期炸 |
| 2 | 静态测试**点名** `-w @talkfirst/web` / `-w @talkfirst/admin` | 根上的 `test:static` 会 `--workspaces` 连带跑 api，而 **api 的 `test:static` 就是 `jest`**（整套单测）。不点名，「静态测试」会变成 40s 的单测 |
| 3 | admin 用 `test:static`，不用 `test` | `apps/admin` 的 `test` = 静态测试 **&&** `playwright test`（P0-00 §E.3 记过）。CI 里不要 Playwright |
| 4 | 契约检查只对 web | 三个检查器的扫描根都是 `apps/web/src`，admin 本就没有这个脚本。P0-00-FIXES §2 已把这条记录成「不是红灯」 |
| 5 | api 作业用 `postgres:16-alpine` service + 健康检查 | `src/auth/oauth/oauth-flow-http.spec.ts` **真的启动应用并用真实 HTTP 打真实 PostgreSQL**。mock 不了 |
| 6 | `migrate deploy` 兼作**库就绪判据** | 实测：库不可达时那套件**挂住不退出**（本机给一个不存在的库地址跑，900s 未返回、无失败输出）。`migrate deploy` 连不上会立刻报错，于是作业在秒级失败，而不是耗到 `timeout-minutes` |

另外两处沿用既有决定，工作流里只写了指针：

- **串行**由 `apps/api/jest.config.cjs` 的 `maxWorkers: 1` 保证（P0-00-FIXES FIX-4）；
  工作流不重复传 `--runInBand`，免得两处各执一说。
- **不配密钥**：Jest 会设 `JEST_WORKER_ID`，`src/common/security-config.ts` 的
  `allowsInsecureDefaults()` 据此把进程判定为测试运行。所以 `TOKEN_ENCRYPTION_KEY`
  这类不需要真值 —— 也不需要任何 GitHub secret（fork 的 PR 因此同样能跑）。

`NODE_ENV=test`、Node `22.x`（仓库 `engines: node >= 20`，本机 22.14）、
`timeout-minutes` 15 / 20。

---

## 3. 本地实测（不是推测）

`checks` 作业的命令，逐条在本机跑过：

| 检查 | 命令 | 实测 |
|---|---|---|
| 类型检查 | `npm run typecheck` | **exit 0**，输出中 `error` 命中 0 |
| lint | `npm run lint` | **exit 0** |
| web 静态测试 | `npm run test:static -w @talkfirst/web` | **16 pass / 0 fail** |
| admin 静态测试 | `npm run test:static -w @talkfirst/admin` | **28 pass / 0 fail** |
| 静态契约 | `npm run test:contracts -w @talkfirst/web` | 80 源文件 / 93 主题色 / 102 testids 满足；69 个 tsx 标签平衡；22 个 tf 组件无未声明 props |

`api-tests` 作业的形状，用一个**一次性探针库**验证过（不碰你的开发库，跑完即删）：

| 步骤 | 实测 |
|---|---|
| `CREATE DATABASE talkfirst_ci_probe` | 成功 |
| `prisma migrate deploy`（空库） | **全部 30 个迁移应用成功** |
| `npx tsx prisma/seed.ts` | `SEED_OK phase=11-hardening admins=0` |
| 在全新库上跑**整套** `jest` | **88 suites / 1651 tests 全绿（36.4s）** |
| 探针库 `User` 行数 | **3 行** —— 这同时证明 jest 用的是环境变量里的库地址，而不是 `.env`（否则探针库会是空的） |

最后一条是本轮最重要的一个旁证：**全新库 + migrate + seed 就足够让整套单测通过**，
不存在「某些套件依赖开发库里积累的数据」这种隐性前提。

---

## 4. 没验证的部分

| 项 | 说明 |
|---|---|
| **没在真实 GitHub runner 上跑过** | 本机没有 runner。已做的是：YAML 用 `js-yaml` 解析通过并逐项核对结构（2 个作业、9 / 7 个步骤、service 与 env 键），命令逐条本机实测。**首次真实运行的结果见 §6 —— 两个作业连第一步都没进，所以「runner 环境差异」这一项至今仍未被暴露，仍然未知** |
| `npm ci` 在 runner 上对 `apps/mobile` | 该 workspace 带 expo 依赖，安装耗时与是否成功未在 runner 上验证（本机 node_modules 是既有的） |
| 无 `.env` 时的环境变量完整性 | CI 里 job `env` 是唯一来源。本机所有实验都在「有 `.env`」的前提下做的，所以「还缺哪个键」这类问题只能由首次运行暴露。若红，先看是哪一步、哪个套件 |

**首次运行若 `api-tests` 红，按这个顺序看**：① 挂在哪一步（migrate 就红 = service 没起来；
jest 阶段红 = 环境变量或库状态）；② 是哪个套件（`FAIL` 行有名字）；③
把那个套件在本机用同样的 `DATABASE_URL` 形式跑一次。

---

## 5. 故意没放进去的

- **Playwright**：web 有 4 条稳定失败、admin 有 10 条选择器歧义失败，全部记录在
  `docs/KNOWN-E2E-ISSUES.md`，且那份记录的结论是「保留记录、不作为门禁」。
  它们还需要已构建的 API 与 3000/3001 端口。等那些清掉之后再单独加一份工作流，
  并且先非阻塞跑一段时间 —— 现在把它们放进 CI 只会训练出「红了就重跑」的习惯。
- **`apps/mobile`**：该 workspace 自述「no automated behavioural tests exist yet」（C10），
  没有可跑的东西。它的 `typecheck` / `lint` 如果有脚本，会被 `--if-present` 自动带上。
- **doc-only 的 push 跳过 CI**：考虑过（`paths-ignore: docs/**`），没做。
  这个仓库文档提交很频繁，但**先让它跑起来**比省那点 CI 分钟更重要。

---

## 6. 首次真实运行（2026-10-05）：工作流认得，作业起不来 —— 原因在账号

推上去之后，GitHub 侧的状态是**核实过的**（仓库是 public，所以下面这些都能匿名读）：

| 事实 | 证据 |
|---|---|
| 工作流已被 GitHub 认到 | `actions/workflows` 里有 `id 375330121` / `name CI` / `path .github/workflows/ci.yml` / **`state: active`** |
| 远端文件与本机一致 | 提交 `d2e33fb` 上的远端 `ci.yml` 与本地 `diff` 为空（同为 4719 字节）—— **不是「本地改了没推」** |
| 运行 A（push `d2e33fb`） | run `37300805528`（`run_number 1`），`2026-10-05T11:06:32Z`，`conclusion = startup_failure`（运行根本没起来） |
| 运行 B（手动 `workflow_dispatch`，`d2e33fb`） | run `37361032602`（`run_number 1`），`2026-10-05T19:06:47Z`，`conclusion = failure`；两个作业 `checks`（id `111935404816`，**7 秒**）与 `api-tests`（id `111935404724`，**11 秒**）的 `steps` 都是**空数组** |
| 运行 C（push `e546005`，即本文档那次提交） | run `37362348075`（`run_number 2`），`2026-10-05T19:17:28Z`；作业 `api-tests`（id `111939718259`）7 秒失败、`steps` 同样为空。**因此这不是偶发**：与运行 B 隔着 11 分钟、另一种触发方式、另一个提交，注释一字不变 |
| 失败原因（check-run 注释原文） | `The job was not started because your account is locked due to a billing issue.` |

**关键读法：一个步骤都没跑。** 7 / 11 秒连 `npm ci` 都装不完，`steps: []` 也说明事情发生在下发 runner **之前**。
所以这次红**不是** YAML 的问题、**不是**命令的问题、也**不是**「runner 环境差异」——
是**账号被账单问题锁住，GitHub 拒绝为它启动任何作业**。工作流本身不需要改。

恢复要做的都在账号侧（需要你本人操作）：

1. GitHub → Settings → **Billing and plans**：结清未付账单 / 更新支付方式。
   GitHub Free 本身不收费，所以这多半是历史欠款或已失效的支付方式，而不是「免费额度用超了」。
2. 解锁后**不需要动任何代码**：在 Actions 页面 **Re-run all jobs**，或再触发一次
   `workflow_dispatch`，就能拿到第一次「真的跑过」的结果。
3. 在此之前，§4 里剩下的两条（runner 上 `npm ci` 对 `apps/mobile`、无 `.env` 时的环境变量完整性）
   **仍然无法验证** —— 它们只能由第一次真正执行来暴露。

另外两条附带信息，都来自 GitHub 自己：

- 两个 check-run 各带一条 notice：`The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026.`
  （`actions/runner-images#14748`）。这不是失败，但 2026-10-19 之后这条工作流的 runner 镜像会换代，
  届时值得回头看一次「首次真跑」的结果。
- 作业日志接口（`/actions/jobs/{id}/logs`）**匿名取不到**，返回
  `403 Must have admin rights to Repository`。所以上面那条结论是从 check-run 的 **annotations** 拿到的，
  不是推测。以后再查同类问题，走 `commits/{sha}/check-runs` → `check-runs/{id}/annotations`。

### 6.1 2026-10-07 复核：**仍在锁中 —— CI 至今一次都没真跑过**

把整个运行历史翻完（`actions/runs?per_page=30`，`total_count = 36`）：**36 次运行全部 `failure`**，
最早能追到 2026-10-05。不是偶发，也不是某次改动弄坏的。

| 事实 | 证据 |
|---|---|
| 最新一次运行（本次 app 落地的提交） | run `37662866636`（commit `734de51`，`2026-10-07T17:55:44Z`）；两个作业 `checks` 与 `api-tests` 都是 `conclusion = failure`，**`steps` 仍然是空数组**（`steps: 0`） |
| 失败原因与 §6 一字不变 | 运行页原文：`The job was not started because your account is locked due to a billing issue.` |
| 推算 | 作业都在秒级失败且没有任何步骤，`npm ci` 都不可能在那么短内跑完 —— 和 §6 同一个结论：事情发生在下发 runner **之前** |

**因此请把「CI 是红的」与「代码是红的」彻底分开读**：在这个仓库里，CI 的红至今不携带任何
关于代码的信息；真正把关的是本机 `npm run gate`（§7）。

两个附带观察（同一天、同一个账号）：

- 2026-10-07 早些时候，`git push` 被 GitHub 接收端连续以 **500** 拒收（多次、不同时间、
  仓库并未禁用、状态页正常）；当晚同一分支再推 **成功**了。push 被拒与 Actions 起不来，
  看起来是账号层同一件事的两张脸 —— 排查时不要只盯仓库设置。
- 解锁之后**不需要改任何代码**：Actions 页面 **Re-run all jobs**，或再触发一次
  `workflow_dispatch` 即可。那时才第一次能看到真实结果，§4 里剩下的两条（runner 上 `npm ci` 对
  `apps/mobile`、无 `.env` 时的环境变量完整性）也才第一次有机会被验证。

### 6.2 结论（2026-10-07）：**跳过 GitHub Actions，门禁以本机为准**

用户侧的制约：绑定不了支付方式，账号解不开。既然解锁这件事在本人手里走不通，就不把它当成待办挂着。

本仓库从今天起的口径：

| 项 | 状态 |
|---|---|
| `.github/workflows/ci.yml` | **保留、不改、不删**（账号解锁后它能立即跑，无需改一行） |
| Actions 的红 | 当作**噪声**：它不携带任何关于代码的信息（见 §6.1） |
| 真实门禁 | 本机 `npm run gate`（§7）；推送前跑一次 |
| 第二道防线 | 部署脚本自身会 `npm ci` + 构建三个 app，任何一步失败就在 **reload 之前中止**（线上继续跑旧版） |
| §4 两条「只有真跑才能验」的项 | 随 CI 一起挂起；若将来换 CI 平台（或换账号）再验 |

一个仍然会被重复问的问题，先写好答案：**“那 CI 是不是可以删了？”**不要删。
保留它的成本是零（不跑就不耗时间），而删掉之后，将来任何人接手都会以为“这个仓库根本没有门禁”——
比一个解释清楚的红灯差得多。

---

## 7. 唯一的门禁：本机 `npm run gate`（§6.2 之后，这不是「临时替代」）

GitHub Actions 这条路已决定跳过（§6.2），所以门禁就落在本机：
**同样的那几步已经收进根 `package.json` 的 `gate` 脚本**，顺序与工作流一致
（typecheck → lint → web 静态 → admin 静态 → 契约 → api 单测）。

```
npm run gate
```

跑的就是 CI 里那几条命令，只少两步 —— 不做 `npm ci`、不做 `prisma:generate`。
理由是那两步的存在前提在 CI（`npm ci` 会清掉生成的 client），本机 `node_modules` 一直是现成的。
**这两个步骤因此仍然只在 CI 里验证**，见 §4 最后两条。

| 步骤 | 命令 | 实测（2026-10-06 本机） |
|---|---|---|
| 类型检查 | `npm run typecheck`（7 个 workspace） | exit 0 |
| lint | `npm run lint` | exit 0 |
| web 静态测试 | `npm run test:static -w @talkfirst/web` | **16 pass / 0 fail** |
| admin 静态测试 | `npm run test:static -w @talkfirst/admin` | **28 pass / 0 fail** |
| 静态契约 | `npm run test:contracts -w @talkfirst/web` | 80 源文件 / 93 主题色 / 102 testids；22 个 tf 组件无未声明 props |
| api 全量单测 | `npm test -w @talkfirst/api` | **92 suites / 1698 tests 全绿（62.4s）** |

整条命令 **exit 0**。（§3 记的是探针库上的 88 套件 / 1651 用例，数字变大是那之后又补了用例。）

三条随时会踩的：

- **api 那一步要真库**（`.env` 的 `DATABASE_URL`，本机 `localhost:5433`）。库没起时它**挂住不退出**，
  与 §2 第 6 条是同一个坑 —— 先 `npx prisma migrate status` 确认 schema up to date 再跑。
- **本机 5433 是谁在提供**：是 Windows 服务 `postgresql-x64-18`（原生 PostgreSQL 18，开机自启），
  **不是** compose 容器 —— `docker info` 连不上 `dockerDesktopLinuxEngine`，而整套单测照样全绿。
  但 `docker-compose.yml` 的 postgres 用的是**同一个** `POSTGRES_PORT=5433`，**两者互斥**：
  Docker 一启动再 `npm run db:up` 就会撞端口。所以**本地跑 gate 不需要 Docker**；
  若以后要改成「容器提供测试库」，得先把其中一个端口挪开（属于环境决定，不在这套检查的范围内）。
- 日志里会出现 `database is down`、`audit table is gone` 这类 **ERROR**，那是**故意构造失败场景的用例在打日志**，
  不是失败在发生。判据只有两个：最后一行 `Tests: ... passed` 和整条命令的退出码。

仓库里还有**另一个更早的总检查**，别把两者弄混：

| | `npm run gate`（本文） | `node scripts/verify.mjs`（2026-10-02） |
|---|---|---|
| 范围 | 与 `.github/workflows/ci.yml` 逐条对应 | 在 gate 的重叠部分之外**多跑三个 build** |
| 失败行为 | `&&` 串联，**第一步红就停** | 不提前停，一次看完所有坏掉的东西 |
| 产出 | 只有 stdout | 另写 `scripts/verify-report.txt` 与 `verify-status.txt` |

两者**都**需要数据库：`verify.mjs` 的 `tests` 步就是 `npm run test:static`，而 api 的 `test:static`
就是整套 jest（含真打库的 HTTP 套件）。它注释里原写的「默认步骤不需要数据库」已于 2026-10-06 更正 ——
那句话是从 `grep "new PrismaClient" apps/api` 无命中推出来的，而那条指令至今仍无命中（PrismaService 在应用内部构造 client，不由 spec 直调）。
