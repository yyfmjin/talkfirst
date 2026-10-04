# P0-02 — 账户名（username）作为登录标识

> 日期：2026-10-04
> 需求（用户原话）：「username 应该是预留的账户名也就是用来登录的账号的，目前是用邮箱登录……可以用邮箱注册登录，也可以是用户名注册登录，然后未填写的老用户随机生成，用户名支持数字+字母，可以是纯数字或者纯字母，最低 8 位，然后过滤掉包含管理员 admin,root 等敏感字符。nickname 属于昵称，就是用户社交用的名字。」
> 状态：**已实现、已测试、未提交**。

---

## 1. 做了什么

| # | 交付 | 位置 |
|---|---|---|
| 1 | `User.username`：NOT NULL + UNIQUE，`VarChar(30)` | `prisma/schema.prisma` |
| 2 | 迁移 + **老账号随机回填**（13 个已有账号实测已回填） | `prisma/migrations/20261004120000_username_login_identifier/` |
| 3 | 规则与生成器（唯一一处） | `apps/api/src/common/username.ts` |
| 4 | 注册：可选填账户名；不填则生成 | `auth.service.ts` `register` + `createAccount` |
| 5 | 登录：邮箱 **或** 账户名 | `auth.service.ts` `login` |
| 6 | 暴力破解预算按**账户**归并（安全关键，见 §3） | `auth.service.ts` + `login-attempt.service.ts` |
| 7 | 会话载荷带上 `username`（仅本人可见） | `auth/public-user.ts` |
| 8 | 注册页新增可选「账户名」字段；登录页改「邮箱或用户名」 | `apps/web/src/app/{register,login}/page.tsx` |
| 9 | `/me` 账号区显示 `@账户名` | `apps/web/src/app/me/page.tsx` |
| 10 | 测试：46 条新用例（校验器 25 + 登录/注册 21） | `common/username.spec.ts`、`auth/auth-username.spec.ts` |
| 11 | 文档 | 本文档 |

---

## 2. 规则（与需求逐条对应）

| 需求 | 实现 | 证据 |
|---|---|---|
| 数字+字母，可纯数字或纯字母 | `^[a-z0-9]{8,30}$`（归一化后） | `username.spec.ts`「纯字母、纯数字、字母数字混合都接受」 |
| 最低 8 位 | 下限 8、上限 **30**（需求未给上限，见 §5 决策） | 「下限 8 位：7 位拒绝、8 位接受」 |
| 过滤含 admin/root 等敏感词 | 两段式清单，见下 | 「包含 admin / root 等敏感词的都拒绝」 |
| 未填写的老用户随机生成 | 迁移里的 PL/pgSQL 回填 | 13 个账号实测全部合规 |
| nickname 是昵称 | 未改动 `nickname` 语义；`username` 只用于登录与账户区展示 | `public-user.ts` 注释 |

### 2.1 为什么保留字清单是**两段式**

- **子串匹配**（`RESERVED_SUBSTRINGS`）：`admin`、`root`、`moderator`、`superuser`、`staff`、`support`、`official`、`security`、`talkfirst`… 每个都足够长，子串匹配不会误伤真实名字（`badminton` 不含 `admin`）。
- **整名匹配**（`RESERVED_EXACT`）：`api`、`www`、`help`、`me`、`bot`… 这些短词若按子串匹配会连带杀掉 `capital`、`rapid`、`therapist` —— 三个完全正常的名字。所以它们只在**整个名字就是它**时拒绝。

### 2.2 一个被测试抓出来的实现缺陷（已修）

保留字检查原本排在格式检查**之后**。由于 8 位下限，`api` / `www` / `help` / `me` 这些**短于 8 位**的整名保留字永远走不到保留字分支 —— 只会报「格式不对」，把人引向 `api12345`（它同样被拒，只是换个理由）。现在保留字**先判**，并有一条测试专门钉住这个顺序（`username.spec.ts`「同时既走格式又含保留词时，报保留字」）。

### 2.3 生成器

字母表 `23456789abcdefghjkmnpqrstuvwxyz`（31 符号，**去掉 0/1/l/i/o** —— 账户名会被念出来、手打出来），长度 10，约 4.9e14 组合。生成值再走一次保留字检查（当前字母表其实拼不出任何保留字，但这条不变量是**断言**出来的而不是推断的）。

---

## 3. 安全：登录限流必须按「账户」归并

这是本次唯一一处会**悄悄削弱**现有防护的地方，所以单独说明。

`LoginAttemptService` 原本以「提交的邮箱」为桶键。若直接改成「提交的字符串」，同一个账户就会有两个独立预算：攻击者用邮箱试 5 次、再用账户名试 5 次 —— 一个密码，两次预算。

处理方式：

- `submittedKey` —— 提交值（邮箱即邮箱；账户名加前缀 `username:`）。它保留**查库前**的快速拒绝，并且「不存在的标识符」与真实的一样计数，所以锁定状态本身不泄露账号是否存在。
- `accountKey` —— **决定性的桶**。账户一旦查出来，键就是该账户的**邮箱**，也就是邮箱登录一直用的那一个键。于是：**同一个账户，无论用哪种标识符登录，共用一个预算**。
- 登录成功时两个桶都清空（否则几次手误会留一个桶把用户挡在门外）。

配套改动：`SecurityEvent` 的失败详情按标识符类型分流 —— 账户名走 `usernameMasked`/`usernameHash`，不再被塞进 `emailMasked`（`security/prisma.ts` 新增 `maskUsername`/`hashUsername`）。

---

## 4. 兼容性（不破坏已有客户端）

| 客户端 | 现状 | 结论 |
|---|---|---|
| web 登录页 | 改为 `{ identifier, password }` | 已改 |
| admin 控制台 | 仍发 `{ email, password }` | **未改，继续可用**（`LoginDto.email` 保留且仍校验邮箱格式） |
| mobile | 仍发 `{ email, password }` | **未改，继续可用** |
| 邮箱路径行为 | 桶键与计数与改动前**完全一致** | 现有 `auth-login-attempt.spec.ts` 5 条锁定用例未改一行，仍全绿 |

`邮箱或用户名` 的判别用 `@`：账户名按规则不可能含 `@`，所以这不是启发式而是确定的。输入开头的 `@` 会先被剥掉（人会那样写：`@alice`）。

---

## 5. 有意决定的边界

| 项 | 决定 | 理由 |
|---|---|---|
| 上限 30 位 | 需求只给了下限 | 需要一个列宽；30 足够宽松 |
| 大小写 | 一律小写存 | `Alice`/`alice` 并存是冒名向量，且两者在多数字体里一模一样。用规范化而非函数唯一索引，是为了让约束由列本身保证 |
| **不能改账户名** | 本轮不做 | 改绑登录标识是一件事：要唯一性、保留字、限流、以及「已签发的会话怎么办」。不夹带进「加一个字段」里 |
| **不在他人资料页展示** | 本轮不做 | 账户名同时是登录标识；把它暴露给其他会员是另一套威胁模型（定向猜密码），需要单独决策 |
| 无数据库默认值 | 试过又撤掉 | `dbgenerated` 表达式会被 PostgreSQL 重新渲染（加括号），导致 `migrate diff` 永久报漂移、后续 `migrate dev` 反复生成无意义迁移。理由写在 schema 注释里 |

---

## 6. 老账号回填（迁移实测）

迁移用 PL/pgSQL 逐行生成并重试，实测结果：

```
账号数：13
格式/唯一/保留字/易混字符 全部合规：是
  yuki.demo@talkfirst.local    -> edkuczvumh
  alex.demo@talkfirst.local    -> 9whkq5rsgz
  mika.demo@talkfirst.local    -> mdwhpfwrex
```

迁移里的生成器是**复刻**的，不 import 应用代码：迁移一旦应用就冻结，它必须在从旧备份恢复的库上产出同样的结果。两边必须同步的地方（字母表 / 长度 / 保留字）在文件注释里逐条写明了。

（顺带：`prisma/seed.ts` 的三个演示账号改用可读名字 `yukidemo` / `alexdemo` / `mikademo` —— 种子数据也是文档，随机名字没法在测试里引用。）

---

## 7. 验证

| 检查 | 结果 |
|---|---|
| 新增用例 | 校验器 25 条 + 登录/注册 21 条 = **46 条全通过** |
| API 全量 | **88 套件 / 1648 用例全通过**（改前 86 / 1602） |
| typecheck / lint | 0 错误 / 0 警告 |
| 静态测试 | web 16/16、admin 28/28 |
| 契约检查 | 三项全 OK；ui-copy 0 findings |
| 三个构建 | api / web / admin 全部通过 |
| 迁移 | `migrate deploy` 应用成功；`migrate diff` = **No difference detected** |
| 回填 | 13 个账号全部合规（上表） |

**测试改了 4 处既有断言/夹具，都是「新增必填列」的必然结果，不是放宽标准**：`oauth-account.service.spec.ts` 的建号断言改为按规则匹配（值本就是随机的）、`oauth-flow-http.spec.ts` 与 8 个 E2E 夹具补上 `username`、`test/fixtures/browser.ts` 的登录标签随字段改名一起更新。

---

## 8. 未验证 / 未做

- **Playwright 未重跑**。登录标签改名会影响所有走 `submitLogin` 的用例；夹具已同步改好，但**没有真跑过浏览器**。这是本轮最大的未验证点，建议下一次跑 E2E 时优先确认。
- 未做「修改账户名」、未在他人资料页展示账户名（见 §5）。
- Google 快捷登录本轮**只是核实，没有改动**：它早已实现（9 个路由 + `OAuthButtons` + 预检脚本），`node scripts/oauth-preflight.mjs --provider google` 实测 **11/11 通过**（含 Google JWKS 真实可达）。剩余的三件事只有账号持有人能做：在 Google Console 登记回调地址、把 6 个环境变量配到服务器、浏览器里人工过一遍同意屏。
