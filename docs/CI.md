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
| **没在真实 GitHub runner 上跑过** | 本机没有 runner。已做的是：YAML 用 `js-yaml` 解析通过并逐项核对结构（2 个作业、9 / 7 个步骤、service 与 env 键），命令逐条本机实测。**首次推上去仍可能因 runner 环境差异而红** |
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
