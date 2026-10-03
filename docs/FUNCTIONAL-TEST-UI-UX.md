# TalkFirst UI/UX 重构 — 功能测试文档

> 用途：**给你手工做功能测试**。每条用例都写了「怎么到那里 / 点哪里 / 期望看到什么」，
> 以及「如果失败，最可能是我改错了哪一行」。
>
> 版本：Phase A + B + D(Feed) 完成，Phase C 已开始（验证码 / 头像 / 社交账号 / 登录 / 注册）。
> 最后更新：本轮（goal round 5）。

---

## 0. 先说清楚本轮的验证状态（请先读）

**`pwsh` 在本机依然不可用**（每次调用返回 `3221225794` / `0xC0000142`）。我已把 DSH 的 shell 从坏掉的 `pwsh` 切换到 Git Bash（改了 `~/.dsh/profiles/desktop/cordis.patch.yml`），但**该配置需要重启 DSH 才生效**，本轮会话里没有生效。

因此本轮所有改动：

| 手段 | 状态 |
|---|---|
| 文件通读、括号/JSX 配平、import 完整性、跨文件契约 grep 核对 | ✅ 已做 |
| **构建产物取证**（见 §0.1） | ✅ 已做，推翻了我原先最大的一个担心 |
| **P0 安全修复的端到端静态复核**（见 §0.2） | ✅ 通过 |
| **`tf/*` 原语 prop 面全站核对**（见 §0.3） | ✅ 已做，累计抓出并修掉 **5 个编译错误** |
| `tsc --noEmit` / `next build` / `eslint` / Jest / Playwright | ❌ **一次都没跑过** |
| 浏览器实际渲染 | ❌ **完全没有** |

### 0.1 构建产物取证：我原先最担心的那件事，其实不会发生

我一直在说「最大风险是 Tailwind 解析不了 `tailwind.config.ts` 里 `content`/`border`/`surface` 三个嵌套色对象」。**这个担心可以排除了。**

`apps/web/.next/` 里存在一次**成功的**构建，它发生在 Phase A 的 `tailwind.config.ts` 落地**之后**（证据：编译出的 CSS 里 `font-family` 是 `PingFang SC,Hiragino Sans GB,Noto Sans SC,…` —— 这正是 Phase A `tokens.ts` 的字体栈，旧配置里没有），但它**早于 Phase B**（证据：预渲染的 `/moments` HTML 里仍是 `body class="… bg-[#EEF3FF] text-ink"`、`sm:rounded-[32px]`，这些是我 Phase B 才改掉的旧类名）。

**结论：Tailwind 主题（含三个带 `DEFAULT` 的嵌套色对象）能被 `next build` 正常解析。** Phase A 的配置部分已被真实构建证明。

**但 Phase A 的原语与 Phase B 的改动仍未被构建过** —— `.next` 里**没有** `TFToastProvider`、`TFAvatar`、`TFChip`，也**没有** `tf-sheet-up` 这个 keyframe。所以 §1 的冒烟测试仍然必须做。

### 0.2 P0 安全修复复核（本轮完成）

审计里的 P0「JWT 密钥 fail-open」修复，我做了端到端静态验证：

| 检查 | 结果 |
|---|---|
| `change-me-in-development` 这个字面量还有没有残留在代码里 | ✅ 只剩 4 处，**全部是文档注释 + `INSECURE_JWT_FALLBACK` 常量定义**。没有任何调用点还在兜底到这个值 |
| `auth.service.ts` / `jwt.strategy.ts` / `chat-auth.service.ts`（原来三处硬编码兜底）现在用什么 | ✅ 三处都改用 `jwtSecretOrDevFallback()`，未配置时**抛错而不是静默签名** |
| 验证码泄露（`devCode`） | ✅ 改由 `mayExposeVerificationCode()` 决定，不再看 `NODE_ENV !== "production"` |
| 本地会不会因此起不来（fail-closed 误伤） | ✅ 不会。`.env` 里 `NODE_ENV=development` → `allowsInsecureDefaults()` 返回 true → 守卫直接返回。且 `main.ts` 的 `loadEnvironment()` 先加载 `.env`，`dotenv` 不覆盖已有变量，所以 Docker/真实环境优先 |
| `THROTTLE_MULTIPLIER=100` 会不会误伤本地 | ✅ 不会。本地是 development 所以放行；生产环境该值 >1 会**拒绝启动**（这正是设计意图：100 等于关闭限流） |

### 0.3 `tf/*` 原语 prop 面核对（5 处编译错误，已修）

这是我给自己找的**最高价值静态检查**，因为它对应一类编译器能一眼看出、而我只能靠人工逐处比对的错误：**页面往原语上挂了未声明的属性。**

已发现并修掉 **5 处同类缺陷**（都在原语侧）：

| # | 缺陷 | 后果 | 修法 |
|---|---|---|---|
| 1 | `TFAvatar` 把 `alt` 展开到 `<span>` 上 | 类型错误；而它是最常用的原语 | 拆成 img / 带标签 / 装饰三个显式分支 |
| 2 | `TFBadge` 未声明 `title` | 动态 Feed 的「示例」徽章传了 `title` → 类型错误 | 显式声明并透传 |
| 3 | `TFCard` 未声明 `data-testid` | `/me/visibility` 靠它定位 `visibility-row-*` → 类型错误 | 显式声明并透传 |
| 4 | `TFChip` 未声明 `title` | 交换面板的平台 chip 传了 `title` → 类型错误 | 显式声明并透传 |
| 5 | `TFBadge` 未声明 `data-testid` | `/me/attributes` 的 `attribute-count-{kind}` 挂在徽章上 → 类型错误 | 显式声明并透传 |

**第 4、5 处说明了同一件事**：我一开始扫的是 `data-testid` 一个属性名，所以只找到 `TFCard`；**正确的扫法是「所有原语 × 所有调用点 × 所有属性名」**。换成这个扫法之后第 4 处立刻出来；本轮给 `/me/attributes` 加 `TFBadge data-testid` 时又踩到第 5 处 —— 同一个根因，两次。

这也是我写 `scripts/tf-prop-check.mjs`（见 §6.5）的直接动机：**把「逐个原语逐个调用点人工比对」变成一条命令。**

#### 无 shell 时期的人工全量 prop 核对（已做完，结果：0 新增问题）

在写不出「跑一次 `tf-prop-check`」的条件下，我把**全部 21 个原语的调用点**逐个对着声明读了一遍：

| 原语 | 声明面 | 调用点 | 结果 |
|---|---|---|---|
| `TFDialog` | `open` `onClose` `title` `description` `children` `footer` `wide` | `/moments` L475、`/moments/settings` L363（含 `footer` 里的 `data-testid`） | ✅ 只用了声明的 |
| `TFEmptyState` | `icon` `title` `description` `action` `className` | discover / connections / moments / moments[id] / moments/user[id] / me/social | ✅ |
| `TFTabs` | `items` `value` `onChange` `variant` `label` `scrollable` `className` | `/moments` L324 | ✅ |
| `TFSearch` | `value` `onValueChange` `placeholder` `label` `onClear` `className` + `InputHTMLAttributes` | interests / languages / countries | ✅ |
| `TFTextarea` | `TextareaHTMLAttributes`（`maxLength`/`rows`/`id` 合法） | me/edit、connect-panel、safety-actions | ✅ |
| `TFListRow` | `icon` `title` `subtitle` `trailing` `onClick` `href` `tone` `className` | `/me` L263/280/283/287 | ✅ |
| `TFSectionHeader` | `title` + … | `/me` L257/278 | ✅ |
| `TFCard` | `tone` `flush` `elevated` `as` `data-testid` `className` | `/me/social` L102 用了 `flush` | ✅ 已声明 |

**结论：没有第 6 处。** 不过要说清楚这个结论的强度 —— 这是人工核对，**不是 `tf-prop-check` 的输出**。它的覆盖取决于我有没有把调用点找全；脚本会枚举，我不会。


**全站核对结果**（按原语逐个 × 全部调用点）：
- `data-testid` 共 **69 处**，只有 `TFCard` 一处挂在原语上（已修）。
- `TFChip` 共 **11 个调用点**，逐个核对属性名 → 只有上面第 4 处。
- `TFAvatar` 7 个调用点，`size` 取值全部在 `xs|sm|md|lg|xl` 之内。
- `TFDialog` / `TFTabs` / `TFListRow` / `TFTextarea` / `TFSearch` 调用点属性名与声明一致。

**本轮没能抓到新错误**（诚实记录）：
- 我一度怀疑 `TFTabs` 声明了 `scrollable` 却没用 —— **核对后是误判**，它确实实现在外框上（`nav.tsx` 第 110 行）。**差点基于误读去"修"一段本来正确的代码。**

**这条通道的极限**：人工核对能找到「属性名不存在」这类**局部**错误，但找不到类型不匹配、泛型推断失败、JSX 嵌套错误、以及原语之间的相互引用问题。**`tsc` 做这件事需要 20 秒。**

### 0.4 阶段完成度 ≠ 功能已接通
核对原语调用点时发现：**有 4 个已导出的原语，调用点是 0**。

| 原语 | 调用点 | 说明 |
|---|---|---|
| `TFSheet` | **0** | 只在 `phone-shell.tsx` 的注释里被提到 |
| `TFMenu` | **0** | 无 |
| `TFField` | **0** | 无（迁移表单时我都是直接用 `TFInput` + 手写 `<label for>`） |
| `useToast` | ~~0~~ → **1** | 已接通 |

**这件事必须说清楚**：`TFToastProvider` 挂在 `layout.tsx` 里，provider 是真的存在，但**在此之前没有任何地方调用 `useToast()`**，所以那套浮层 UI 从来没渲染过。**「Phase A 交付了 22 个原语」这句话里，有 4 个是没人用的。**

这不是纯粹的浪费 —— 原语库本来就该先于调用方存在 —— 但它意味着**「这个组件写好了」和「这个功能能用了」是两件事**，我不该让前者读起来像后者。

### 0.5 我自己反复犯的一个编辑错误（记录在案）
在本文档里插新章节时，我**至少 4 次用「替换现有标题」代替「在标题前插入」**，每次都把原来的小节标题吃掉，导致 `§2.13`–`§2.18` 反复错位。每次我都发现了并修好，但它已经成为一个稳定复现的失误模式。

**根因**：我把「插入」写成了 `edit(anchor → anchor + new)`，一旦 new 里包含了本该保留的 anchor 的替代文本，anchor 就丢了。

**正确做法**：插入时 `old_string` 用**唯一的后继锚点**（例如下一个标题），`new_string` = 新内容 + 那个锚点原样。这样锚点不可能被吃掉。

**为什么记在这里**：这和我在 TSX 里反复出现的「属性名未声明」是同一类问题 —— **一个局部看起来正确、但破坏了更大结构的编辑**。Markdown 里代价是标题错位；在 TSX 里代价是 JSX 嵌套错误或类型错误，而**这两者我都无法执行检查**。这是我坚持需要 `tsc` 的具体理由，不是抽象的谨慎。



**所以这份文档是"请你帮我做的第一次真实验证"，不是"我已验证通过的功能清单"。**
下面的用例按「最可能出问题」排序，请优先跑 §1。

### 0.6 ⚠️ 我在这份文档里写错过「我做了什么」，并已更正

**这是本会话里最严重的一类问题**，因为它不是代码 bug，而是**我对自己工作量的陈述不实**。

我说过若干次「文件 X 已迁移到设计系统」。核查方式是 `grep 'from "@/components/tf"'` —— 如果一个文件声称迁移完却**从未 import 过设计系统原语**，那它顶多是改了配色，不是迁移。结果：

| 文件 | 文档原先的说法 | 实际 | 处理 |
|---|---|---|---|
| `components/moment-comments.tsx` | 「已迁移（§2.11）」 | **19 处**旧声明；**从未 import `@/components/tf`** | ✅ 已真正迁移（21 个 testid 全保留） |
| `components/moment-report-dialog.tsx` | 「已迁移」 | 还有 3 处 | ✅ 已修 |
| `components/attribute-tags.tsx` | **从未提到** | 3 处旧紫 hex | ✅ 已修 |

**根因**：我审计原语 prop 面时的教训是「要扫**所有**原语 × 所有调用点」，但我**没有把同一条原则用到"哪些文件真的迁移了"这个统计上** —— 那边我一直在凭记忆列清单（§9.2 里那串 5→4→3 的错误数字是同一个根因）。

**修正后的做法**：迁移状态一律以 `grep` 的真实输出为准，不再凭记忆。本文档里每一处"已完成"都应当能对应到一条 grep。**§0.7 就是这条规则第一次被真正执行的结果，它又抓出 7 个文件。**

### 0.7 迁移状态全量复查（本轮）与「活跃文件已清零」

§0.6 的教训是：**迁移状态必须来自 grep，不能来自记忆。** 本轮把那条规则真正执行了一遍 —— 用一套旧声明特征串扫**全部** TSX：

```
border-line | bg-[#6572D8] | text-[#6572D8] | text-[#3D4663] |
bg-[#E4E8FF] | bg-[#F8FAFF] | bg-[#F4F1FF] | text-[#B26A00] | bg-[#F1F3FF]
```

结果（这一遍扫出的**新**问题，都不是我上轮以为的那两个）：

| 文件 | 上一轮状态 | 本轮发现 | 处理 |
|---|---|---|---|
| `app/me/interests/page.tsx` | 文档写「✅ 完成」 | **3 个 section 仍是 `rounded-3xl border-line bg-white`**，骨架屏还是 `bg-indigo-50` | ✅ 已修 |
| `app/me/attributes/page.tsx` | 文档写「✅ 完成」 | 分段控件旧紫、▲▼ 按钮 `rounded bg-white text-[10px]`、编辑面板**两个裸 input** | ✅ 已修（改用 `TFInput`） |
| `app/onboarding/countries/page.tsx` | 文档写「✅ 完成」 | 裸 input + 裸 button；**同组的 languages/interests 两步已经用 `TFSearch`，只有它没用** | ✅ 已修（统一为 `TFSearch`） |
| `components/moment-report-dialog.tsx` | 上一轮发现 3 处 | 另有理由按钮 `rounded-2xl text-[12px]` | ✅ 已修 |
| `components/attribute-tags.tsx` | **从未提及** | 旧紫/旧靛两套 hex | ✅ 已修（改用 `brand-*` / `accent-*` token） |
| `app/messages/[id]/page.tsx` | 文档写「✅ 完成」 | **收到的消息气泡仍是 `bg-[#F1F3FF]`**、撤回/翻译按钮旧紫、图片圆角 | ✅ 已修 |
| `app/admin/page.tsx` | 从未提及 | 旧 hex + 裸 `<a>` | ✅ 已修 |

**为什么会出现"文档写完成、实际没完成"**：我在 Phase 里逐个组件迁移（按钮、输入框、卡片），但**页面外壳和某些分区**是在更早的轮次手写的，之后再没回头看。逐组件迁移会漏掉"不属于任何组件"的散装样式。

#### 剩下的旧声明（有意保留）

| 位置 | 数量 | 为什么留 |
|---|---|---|
| `app/moments/compose/page.tsx` | ~24 处类名 + 1 个 `GradientButton` | **设计基准页，按你的要求冻结**（见下） |
| `components/ui.tsx` | 3 | 唯一调用方就是上面的 `GradientButton`。两处一起改，或一起留 |
| `components/tf/display.tsx` `tf/button.tsx` `components/screen-header.tsx` | 3 | **只是注释里提到旧类名**，不是真实用法 |

**活跃页面与组件里的旧声明：0。**

##### 关于 `compose` 的那一个 `GradientButton`（本轮把事实核清了，之前是凭印象说的）

我前几轮说过"compose 的 CTA 还是紫色渐变、和设计系统冲突"。**本轮逐字核对了源码，这个说法不准确：**

```css
/* globals.css — Phase A 已经把它改成品牌蓝 */
.tf-gradient { background-image: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); }
```

所以 compose 的 CTA **现在渲染出来就是品牌蓝渐变**，不是紫色。真正剩下的差异只有两条：

| | `GradientButton` 现在 | `TFButton variant="primary"` |
|---|---|---|
| 背景 | 渐变 `brand-500 → brand-600` | 实心 `brand-500` |
| 阴影 | `shadow-md shadow-indigo-200`（**靛蓝**） | `shadow-brand`（品牌蓝，更浅） |
| 高度 | `min-h-[3rem]` = 48px | `size="lg"` = 48px（**一致**） |

**我没有改它，理由有两条：**

1. **你明确要求 compose 冻结。** 它是我做其余所有页面的参照物；改掉参照物，我后面做的页面就失去了基准。
2. **"改"和"不改"各有代价，而我现在无法看到结果。** 唯一确定的视觉差异是那个**靛蓝阴影**（`shadow-indigo-200`）—— 它确实是设计系统要消灭的"第二品牌色"之一，但它就在基准页上。

**如果你想收尾，改动是一行**（`compose/page.tsx` L663）：把 `<GradientButton …>` 换成 `<TFButton variant="primary" size="lg" fullWidth …>`，然后 `GradientButton`／`OutlineButton`／`SmallButton` 全部零调用点，`components/ui.tsx` 可以整个删掉。**这一步我没有替你做**，因为它会改变你手上的设计基准。


### 0.8 主题类名全量核对（本轮，手工执行了 `static-contract-check.mjs` 的第 2 项）

Tailwind 对**拼错的类名是静默丢弃**的：`bg-brand-550` 不会报错，只会让元素没有背景色。这是我在本会话里最难自查的一类问题，因为它既不是类型错误也不是构建错误。所以本轮把 `static-contract-check.mjs` 的**颜色检查**手工跑了一遍 —— 把我写过的所有主题类名去 `design/tokens.ts` / `tailwind.config.ts` 里逐个核对。

我核对的是**实际用到的每一个色阶**（而不是假设它们存在）：

| 类名前缀 | 用到的色阶 | 是否存在于 token |
|---|---|---|
| `brand` | 50 100 200 300 400 500 600 700 | ✅ 全部定义 |
| `accent` | 50 100 300 500 600 | ✅ |
| `neutral` | 0 25 50 100 200 300 400 500 600 700 800 900 | ✅ 连续无缺口 |
| `success` | 50 100 500 600 700 | ✅ |
| `warning` | 50 100 200 500 600 800 | ✅ |
| `danger` | 50 100 200 500 600 700 | ✅ |
| `info` | 50 100 500 700 | ✅ |
| `surface` | DEFAULT canvas sunken brand scrim | ✅ |
| `content` | DEFAULT muted subtle inverse brand accent | ✅ |
| `border` | DEFAULT strong brand | ✅ |
| 字号 | display title heading body ui caption overline | ✅ 全部定义（且各有 lineHeight） |
| 圆角 | control row card sheet frame | ✅ |

**一个反直觉但重要的点：`neutral-*` 必须是连续的。** 上面那张表里唯一真正危险的是**缺档**——例如我在某处写了 `bg-neutral-150`，而 scale 从 100 直接跳到 200。这种"刻度缝隙"是静默失败最典型的来源。核对结果是**没有缺口**。

> 诚实的边界：我核对的是**类名是否存在**，不是**颜色在视觉上是否正确**。如果我把一个该用 `neutral-200` 的地方写成了 `neutral-100`，这个检查看不出来，只有你看截图才能发现。这类"用错了但存在"的问题，本轮无法覆盖。

### 0.9 路由可达性全量核对（本轮，第三项手工静态检查）

Phase B 里我改过底部导航（5 个槽位），而在更早的审计中**已经因为这次改动产生过一个孤儿路由**：`/connections` 当时不再有任何入口（`grep 'href="/connections"'` 零命中）。孤儿路由的症状是"页面存在、构建通过、但用户永远走不到" —— 也是编译器看不见的一类问题。

所以本轮把**每一个页面的入站链接**核了一遍。

**站点共 36 个路由**（`glob` `apps/web/src/app/**/page.tsx`）。三个入口来源：字面量 `href="…"`（31 处）、模板串 `` href={`/…`} ``（7 处）、`router.push/replace("…")`（30 处）。

| 分组 | 路由 | 入站来源 |
|---|---|---|
| 启动 | `/` | 登录失效时 `router.replace("/")` |
| 认证 | `/login` `/register` `/reset` `/verify` `/legal` `/register/success` | 互相链接 + `/verify` → `/legal` 的同意流程 |
| Onboarding（8 步） | `/onboarding/{avatar,profile,interests,languages,purposes,countries,social,complete}` | **完整链条**：`/register/success` → `avatar` → `profile` → `interests` → `languages` → `purposes` → `countries` → `social` → `complete` → `/discover`。每一步都有 `router.push` 到下一步 |
| 主区 | `/moments` `/discover` `/messages` `/me` | `TabBar`（4 个 tab + 中间 ＋） |
| 动态 | `/moments/compose` `/moments/[id]` `/moments/user/[id]` `/moments/settings` | tab-bar 的 ＋、Feed 行、`/me`、`/me/social` |
| 消息 | `/messages/[id]` `/messages/[id]/connect` `/connections` | 会话行、`/connections` 的交换按钮 |
| 我的 | `/me/edit` `/me/password` `/me/visibility` `/me/interests` `/me/attributes` `/me/social` `/me/safety` `/admin` | **全部来自 `/me` 的 `ENTRY_GROUPS`**（`/me/page.tsx` L74–90）+ `profile-preview-card` |
| 他人资料 | `/profile/[id]` | 头像/昵称点击、资料卡 |

**结论：36 个路由全部有入站链接，0 个孤儿。** 这是本轮唯一一项**完整**的静态证明（不是抽样）。

> **一个必须说明的坑**：如果只 grep `href="/me/interests"` 会得出"孤儿"的错误结论 —— 因为 `/me` 的入口表是**数据结构**（`ENTRY_GROUPS[].href`），不是字面量属性。链接既可能写在 JSX 属性里，也可能写在数组里。**"grep 字面量"这种检查方法本身会漏，认识到这一点比得到一个 0 更重要。** 我核了两遍（字面量 + 数据结构 + `router.push`）才敢下"0 孤儿"的结论。

### 0.10 测试断言与源码的一致性核对（本轮）—— 抓到一个**真实的测试失败**

`apps/web/test/*.mjs` 这层单测**不 import TS 代码**，而是 `readFileSync` 把源码当**文本**再 `assert.match`。这意味着：**一条注释就能让测试失败**，而这是一种我完全没检查过的失败模式。

本轮把 `smoke.test.mjs` / `email-verification.test.mjs` 的每一条断言都对着当前源码核了一遍。

#### 抓到的真实缺陷（我造成的）

```js
// smoke.test.mjs:21
assert.doesNotMatch(source, /"use client"/);
```

而我在 `src/app/page.tsx` 的 docblock 里写了：

```
 * No `"use client"`, so the hero is real HTML in the first byte instead of a
```

**正则匹配的是带双引号的字面量 `"use client"`，注释里的也算。** 于是这条 `doesNotMatch` 会**失败** —— 一个纯粹由"写了一段解释性注释"引起的测试失败。已改为 `No client directive, so the hero is real HTML in the first byte instead of a`。

**这类错误的特征**：源码功能完全正确，页面渲染完全正常，但测试挂。而且它只在**跑测试**时暴露 —— 正是我 33 轮都无法做到的那一步。

#### 其余断言的核对结果（全部通过）

| 断言 | 目标 | 结果 |
|---|---|---|
| `/Wordmark/`、`/仅限 18 岁以上使用/`、`/先聊聊/`、`/再成为朋友/` | `app/page.tsx` | ✅ |
| `doesNotMatch /"use client"/` | `app/page.tsx` | ❌→✅ **本轮修掉** |
| `/TalkFirst/`、`/Talk First\. Connect Later\./` | `components/brand.tsx` | ✅ |
| `/欢迎回来/`、`/邮箱/` | `app/login/page.tsx` | ✅ |
| `apiFetch<SessionUser>\("\/auth\/login"` 等 | login / register | ✅ |
| `/\/users\/me\/interests/` | `onboarding/interests` | ✅ |
| `/\/moments\/feed\?tab=/`、`/\/moments\/compose/`、`/\/moments\/settings/` | `moments/page.tsx` | ✅ |
| `/apiFetch\("\/moments"/` | `moments/compose` | ✅ |
| `/\/moments\/bindings/` | `moments/settings` | ✅ |
| `/\/moments\/user\//` | `moments/user/[id]` | ✅ |
| `doesNotMatch /P2025\|Prisma\|SMTP\|SecurityEvent/` | `login/page.tsx` | ✅（我核对过 7 处匹配都不含这些词） |
| `/EMAIL_NOT_VERIFIED/`、`/邮箱尚未验证/`、`/重新发送验证邮件/`、`/我已完成验证，重新检查/` | `login/page.tsx` | ✅ |
| `doesNotMatch /emailVerified\s*:\s*true/` | `onboarding/social`、`verify` | ✅（只有一处注释提到 `emailVerified`，不匹配该正则） |
| `/验证码/` | `verify/page.tsx` | ✅ |

**教训**：`doesNotMatch` 断言比 `assert.match` 更危险 —— 前者可以被**任何**新写的注释触发，而写注释的动机恰恰是"解释这里为什么没有 X"。**"解释为什么不用 X"会引入字面量 X。** 这是我第一次遇到"写好注释反而弄坏测试"，值得记下来。

#### 后续：本轮更正了上一轮的处理方式（**修错了地方**）

上一轮我的处理是**把源码里的注释改掉**（删掉 `"use client"` 那几个字）。**这是反的** —— 为了让一条脆弱的测试通过而去削弱文档。

本轮核对 admin 套件时发现，**这个问题在 `apps/admin/test/smoke.test.mjs` 里已经被明确解决过**，而且写了原因：

```
// No moderation endpoint is ever *called*. Matched against a call/import
// position rather than a bare substring, because both files explain in prose
// that no such endpoint exists — and that explanation would match a loose
// pattern, failing the test for documenting the very rule it enforces.
```

**也就是说：这个坑在本仓库里已经有先例、有注释、有正确做法。我既没沿用那个做法，也没在踩坑后去对照它 —— 而是直接改了源码。** 这和 §0.6 是同一类问题的另一种形态：**"查一遍再说"这个动作，我又跳过了。**

本轮把 web 的断言改成与 admin 一致的口径：

```js
// 之前：匹配裸子串，注释里的也算
assert.doesNotMatch(source, /"use client"/);

// 现在：只匹配真正的「指令」——独占一行、带引号、行内无其他内容
assert.doesNotMatch(source, /^\s*["']use client["']\s*;?\s*$/m, "must stay a Server Component");
```

改完把源码注释**恢复成原来那句更完整的说明**（`No `"use client"`, so the hero is real HTML…`）。核对过：该文件第 30 行以 ` *` 开头，不匹配锚定后的正则。

**这条比"修好一个测试"更值得记**：一个仓库里已经写明的教训，如果没有被"在下判断前先搜一遍"这个习惯接住，它就只是一段没人读的文字。**admin 的测试写对了、web 的写错了，而我在两边之间来回走了 30 多轮都没注意到。**







**这是本会话里最严重的一类问题**，因为它不是代码 bug，而是**我对自己工作量的陈述不实**。

我说过若干次「文件 X 已迁移到设计系统」。核查方式是 `grep 'from "@/components/tf"'` —— 如果一个文件声称迁移完却**从未 import 过设计系统原语**，那它顶多是改了配色，不是迁移。结果：

| 文件 | 文档原先的说法 | 实际 | 本轮处理 |
|---|---|---|---|
| `components/moment-comments.tsx` | 「已迁移（§2.11）」，并写明"我只改了外层两处颜色" | **19 处**旧声明（旧紫 `#6572D8` 按钮、`border-line`、`bg-white`、`text-[12px]`）；**从未 import `@/components/tf`** | ✅ 本轮真正迁移完（21 个 testid 全保留） |
| `components/moment-report-dialog.tsx` | 「已迁移」 | **还有 3 处**（`border-line` / `bg-[#F8FAFF]` / `bg-[#6572D8]` / `#3D4663`） | ⬜ 待做 |
| `components/attribute-tags.tsx` | **从未提到** | 3 处旧紫 hex | ⬜ 待做 |

**根因**：我审计原语 prop 面时的教训是「要扫**所有**原语 × 所有调用点」，但我**没有把同一条原则用到"哪些文件真的迁移了"这个统计上** —— 那边我一直在凭记忆列清单（§9.2 里那串 5→4→3 的错误数字是同一个根因）。

**修正后的做法**：迁移状态一律以 `grep` 的真实输出为准，不再凭记忆。本文档里每一处"已完成"都应当能对应到一条 grep。

---

## 1. 冒烟测试（先跑这 6 条，任何一条失败就先停下来看第 §7 节）

| # | 操作 | 期望 | 失败时最可能的原因 |
|---|---|---|---|
| S1 | 启动 API + Web（见 §6），打开 `http://localhost:3000/` | 看到品牌蓝的对话气泡 Logo + 「先聊聊，再成为朋友」大标题 + 一个蓝色「开始」按钮 + 一个文字按钮「我还没有账号，去注册」 | **构建失败**。最大风险：`tailwind.config.ts` 从 `src/design/tokens.ts` 引入的 `content`/`border`/`surface` 是**嵌套色对象**，Tailwind 可能解析不了。若 `next build` 报错，把错误原文发我 |
| S2 | 点「开始」→ 登录页 | 登录表单能输入、能提交、能进 `/discover` | — |
| S3 | 看底部导航 | **5 个位置**：首页 / 发现 / **中间蓝色圆形 ＋** / 消息 / 我的。当前所在 tab 是**蓝色**，其余灰色 | 若中间 ＋ 没凸出来或位置不对，是我在 `tab-bar.tsx` 的 5 栏网格写错了 |
| S4 | 点中间 ＋ | 打开「发布动态」页（`/moments/compose`） | — |
| S5 | 依次点 首页 / 发现 / 消息 / 我的 | 每点一次都能正确切换，且**没有整页刷新**（不闪白） | 若闪白，说明有 `<a href>` 漏了（H 阶段的已知旧问题） |
| S6 | 打开浏览器控制台 | **没有红色报错**（尤其没有 `Cannot read properties of undefined`） | 把报错原文发我 |

---

## 2. 回归风险最高的改动（请重点看）

这几处是我改动**语义**而不是只改样式的地方，最容易打破既有功能。

### 2.1 「连接」入口搬家了 ⚠️

**背景**：底部导航从 5 个目的地（发现/动态/消息/**连接**/我的）改成 brief 要求的 5 个槽位（首页/发现/**＋**/消息/我的）。**「连接」不再是一个 tab。**

**它现在在哪**：`我的` → 「关系」分组 → 「我的连接」。

| # | 操作 | 期望 |
|---|---|---|
| N1 | 「我的」页 → 找到「关系」分组 → 点「我的连接」 | 进入 `/connections`，能看到连接列表（或空状态） |
| N2 | 在 `/connections` 时看底部导航 | 「消息」tab 高亮（我把 `/connections` 归到了消息 tab 下） |

> **如果 `连接` 找不到，那是我的错，不是设计**：在我改之前 `/connections` 已经是**孤儿路由**（全站 `grep 'href="/connections"'` 零命中，底部 tab 是唯一的入口，而 tab 当时已被改成没有它）。我把它接到了 `/me`。请务必确认 N1 通过。

### 2.2 「动态」页标题改成了「首页」

| # | 操作 | 期望 |
|---|---|---|
| N3 | 点底部「首页」tab | 页面顶部大标题是 **「首页」**（原来是「动态」） |
| N4 | 页内 tab 行 | 推荐 / 关注 / 我的 三个 tab **可点、有下划线指示、能用左右方向键切换** |

### 2.3 弹窗从「糊满整个窗口」改成「限制在手机壳内」

**背景**：删除评论确认框和举报框原来是 `fixed inset-0`，在桌面浏览器上会覆盖**整个窗口**（1440px 屏上一个 320px 弹窗飘在屏幕正中，和手机壳完全脱节）。我改成了 `absolute`，让它们被限制在 390px 手机壳内。

| # | 操作 | 期望（**窗口宽度 > 640px 时测**） |
|---|---|---|
| N5 | 打开一条一/二级评论 → 点删除 | 确认框出现在**手机壳内部**居中，**不是**浏览器窗口正中 || N6 | 动态详情 → 举报 | 同上：举报框在手机壳内 |

### 2.4 `/me` 页整页重写（改动最大）

`/me` 从「Logo + 6 个一模一样的蓝色大按钮」改成「头像 + 分组列表」。**所有入口都要还在**：

| # | 操作 | 期望 |
|---|---|---|
| N7 | 「我的」页 | 顶部是**我的头像**（不是 Logo）+ 昵称 + 地区 + 兴趣徽章 |
| N8 | 依次点「内容」组三项 | 编辑基本资料 / 语言·兴趣·交友目的 / 交友属性，**三个都能进** |
| N9 | 依次点「关系」组两项 | 我的连接 / 管理社交账号，**都能进** |
| N10 | 依次点「隐私与安全」组两项 | 资料可见范围 / 安全中心，**都能进** |
| N11 | 「账号」组 | 修改密码可进；普通账号看到的是**灰的**「管理后台」行（不可点） |
| N12 | 点「退出登录」 | 按钮变「正在退出…」→ 跳回登录页 |
| N13 | 点「注销账号」 | 弹确认框，**必须输入「注销」两字**确认按钮才可点；取消可关闭 |
| N14 | 在 N13 的输入框里按 Esc | 弹窗关闭（这是新能力：焦点陷阱 + Esc，原来 8 个浮层只有 1 个支持） |

### 2.5 头像变了

| # | 操作 | 期望 |
|---|---|---|
| N15 | 看 Feed 里每条动态的作者头像 | 有头像的显示头像；**没头像的显示首字母 + 淡色圆底**，不是紫色渐变 |
| N16 | 同一个人出现在评论区 / Feed / 连接列表 | 三处头像**颜色一致**（按 id 哈希，同一个人永远同色） |

其余小修：`lib/moments.tsx` 里已无人调用的 `avatarColor()` 已删除（头像着色现在由 `TFAvatar` 统一负责）。

### 2.6 三个功能缺陷已修复（请重点验证）

这三处不是"样式调整"，是**功能真的坏了**，而且都在用户必经路径上。

#### (a) 验证码页在 320px 宽度下最后一个格子点不到 ⚠️

**原缺陷**：6 个格子在 `px-8` 容器里各 `w-12` + `gap-2` → 内容宽 `6×48 + 5×8 = 328px`，而可用宽度只有 `320 − 64 = 256px`。溢出 72px，而 `body` 上有 `overflow-x: hidden`，所以**第 6 个格子永远够不到**。

| # | 操作 | 期望 |
|---|---|---|
| V1 | 把窗口缩到 **320px** 宽，打开 `/verify` | 6 个格子**全部可见**，不出现横向滚动 |
| V2 | 320px 下逐个点 6 个格子填数字 | 每个都能点到，最后一个不越界 |
| V3 | 390px 下看 | 格子约为最大宽度（48px 封顶），居中整齐 |
| V4 | 可访问性 | 每格有「验证码第 N 位」的可访问名 |

#### (b) 头像页的颜色选择器是假的 ⚠️

**原缺陷**：`/onboarding/avatar` 有 4 个颜色预设，点一下会高亮，但 `handleNext()` **从来没有读过 `selected`** —— 选中的颜色既不上传也不保存，**没有任何字段能存它**。看起来能设置，实际点完就丢。

| # | 操作 | 期望 |
|---|---|---|
| V5 | 打开 `/onboarding/avatar` | 不再有 4 个颜色圆点（它们已移除） |
| V6 | 点头像 | 直接打开系统选图对话框（整个头像是一个点击区域） |
| V7 | 选一张图 | 预览显示在圆里；出现「移除这张图片」 |
| V8 | 点「下一步」 | 上传成功 → 进入 `/onboarding/profile` |
| V9 | 不上传，直接点「稍后再说」 | 也能进入下一步（跳过是合法选择，不是错误） |
| V10 | 断网时点「下一步」 | 显示错误**且保留已选图片**（不用重新选） |
| V11 | 确认已无「或粘贴 https://…」输入框 | 该字段已移除 —— 「发布动态」是媒体输入的标准，它**刻意没有 URL 输入框**，这个页面对齐了它 |
| V12 | 选超过 5MB 的图 | 提示「图片不能超过 5MB。」 |
| V13 | 选 .gif | 提示「只支持 jpg / png / webp 格式的图片。」 |

> **为什么移除而不是实现持久化**：没有对应字段，而我的约束是**不改数据库 schema 和 API 契约**。而且 `TFAvatar` 现在按用户 id 哈希出稳定色调，没上传头像的人本来就有**每个人固定且全站一致**的底色 —— 比手选预设更好（预设的颜色可能在不同页面不一致）。

#### (c) 「社交账号」是一个死胡同 ⚠️

**原缺陷**：`/me/social` 只渲染一句话「管理已并入个人动态同步设置，请前往动态设置绑定平台」，**然后没有任何链接**。它告诉你该去哪，却不给你去的路。

| # | 操作 | 期望 |
|---|---|---|
| V14 | 「我的」→「关系」→「管理社交账号」 | 打开后能看到**平台列表**（Instagram / Telegram / …） |
| V15 | 看每个平台行 | 显示「未绑定」或「@你的账号」+ 「同步中 / 已暂停」徽章 |
| V16 | 点底部「去绑定或管理」 | **能进 `/moments/settings`**（这就是原来缺的那条路） |
| V17 | 该页面上随便点点 | **没有任何写操作**（这页是只读状态视图，绑定只在动态设置里做） |

### 2.7 登录 / 注册页（Phase C 第一批）

| # | 操作 | 期望 |
|---|---|---|
| L1 | 打开 `/login` | 蓝色 Logo + 「欢迎回来」+ **邮箱地址** / **密码** 两个带标签的输入框 + 蓝色「登录」按钮 |
| L2 | **在邮箱框按 Enter** | 直接提交表单（原来就能，现在仍是） |
| L3 | 用密码管理器 / 浏览器自动填充 | **能识别这是登录表单**（新增 `autoComplete="username"` / `current-password`）—— 这是之前缺的 |
| L4 | 打开 `/register` | 「创建账号」+ **邮箱地址** / **密码** 两个输入框 |
| L5 | 注册页密码框用浏览器生成密码 | 浏览器会提示**生成新密码**（`autoComplete="new-password"`） |
| L6 | 看两个页面的 Google / Apple 按钮 | **明显是禁用状态**（灰底灰字），下面直接写着「第三方登录即将上线，暂用邮箱登录」 |
| L7 | 鼠标悬停在该按钮上 | 有 tooltip 说明（禁用按钮无法聚焦，所以键盘用户靠这行常驻文案） |
| L8 | 故意留空点「登录」 | 提示「请填写邮箱和密码。」，两个输入框**边框变红**（`aria-invalid`） |
| L9 | 填一个格式错的邮箱 | 提示「请输入有效的邮箱地址。」 |
| L10 | 填正确邮箱但密码错 | 提示来自服务端；同样边框变红 |
| L11 | 用一个未验证邮箱登录 | 提示「邮箱尚未验证，请先完成邮箱验证。」+ 出现「重新发送验证邮件」/「我已完成验证，重新检查」两个按钮 |
| L12 | 读屏 / DOM 检查 | 输入框的错误提示通过 `aria-describedby` 关联；错误文本 `role="alert"` |

> ⚠️ **一个我差点踩进去的坑，记录下来**：登录页邮箱框的标签**必须**是「**邮箱地址**」，不能简写成「邮箱」。原因：`test/fixtures/browser.ts` 用 `page.getByLabel("邮箱地址")` 登录，而**几乎所有已登录的 E2E 用例都走这个 helper**。我一度把它改成「邮箱」，那会让整套 E2E 在"登录"这一步全线失败。已改回，并在源码里写了注释说明为什么不能动它。
>
> 另外 `test/smoke.test.mjs` 用 `/邮箱/` 匹配源码文本（子串），所以「邮箱地址」同时满足两处。

### 2.8 协议确认页 + 两个"完成"页 + 引导里的社交账号步骤 + 忘记密码页

#### (a) `/legal` —— 协议确认页曾经要求你同意两份打不开的文件 ⚠️

**原缺陷**：页面要求同意《用户协议》和《隐私政策》，而**这两份文档在整个代码库里根本不存在**。中文的 `《》` 书名号在用户眼里就是"可点开的文件"，所以这个界面在暗示两个从来不存在、也点不开的页面。让用户在无法阅读的前提下"同意"，在欧盟直接构成 GDPR 第 7 条的问题。

**我没有做的事**：**我没有替你编一份隐私政策或用户协议。** 那是一份法律文件，它声明的是运营方**实际**如何处理个人数据；我编一段看起来合理的话，比留占位符更糟 —— 它会变成一份没人真正同意过的、看起来有约束力的承诺。撰写它们是**你的决定**（见 §9 的待办）。

**我做的事**：把界面改成说真话 —— 两份文档存在、完整文本会在注册流程中提供、继续即表示接受。误导性的链接观感去掉了。

| # | 操作 | 期望 |
|---|---|---|
| G1 | 打开 `/legal` | 两个**带说明文字**的勾选项（不是两个光秃秃的复选框） |
| G2 | 看两个复选框 | 尺寸 20px，**整行可点**（不是只有 13px 的小方块能点） |
| G3 | 不勾选任何一项 | 「同意并继续」**禁用**，下面提示「请先勾选以上两项」 |
| G4 | 只勾第一项 | 按钮仍然禁用 |
| G5 | 两项都勾 | 按钮可点 → 进入 `/register/success` |
| G6 | 键盘操作 | Tab 能到复选框，空格键能切换 |
| G7 | 读屏 | 每个复选框会连它的**说明文字**一起被读出来 |

#### (b) `/register/success` 和 `/onboarding/complete` 重做

| # | 操作 | 期望 |
|---|---|---|
| G8 | 注册成功后 | 看到**品牌蓝的对话气泡 Logo**（不是渐变圆里的 ✓ 字符）+「注册成功」+ 三步清单 + 一个「去创建名片」 |
| G9 | 完成引导后（`/onboarding/complete`） | 气泡图形 +「名片创建完成」+ 三行说明（会被推荐给谁 / 由你先开口 / 联系方式需双方同意）+「去发现新朋友」 |
| G10 | 两个页面 | **各只有一个**实心蓝色按钮；第二个是文字按钮 |
| G11 | 这两个页面 | 都是**服务端组件**（无 `"use client"`），首屏直接有内容，不是骨架 |

#### (c) `/reset`（忘记密码）迁移到设计系统

| # | 操作 | 期望 |
|---|---|---|
| G16 | 打开 `/reset` | 「重置密码」+ 4 个**带标签**的输入框（注册邮箱 / 邮箱验证码 / 新密码 / 确认新密码） |
| G17 | 邮箱框 | 有 `autoComplete="username"`，密码管理器能识别 |
| G18 | 验证码框 | 手机上能**从邮件通知直接取码**（`autoComplete="one-time-code"`） |
| G19 | 不填邮箱点「发送验证码」 | 提示「请输入有效的邮箱地址。」 |
| G20 | 填对邮箱点「发送验证码」 | 按钮变「发送中…」→ 60 秒倒计时；提示文案是"**如果**该邮箱已注册…"（**不能**暗示这个邮箱存在 —— 那会变成账号枚举漏洞） |
| G21 | 两次新密码不一致 | 提示「两次输入的新密码不一致。」 |
| G22 | 重置成功 | 显示「密码已重置」，提示其他设备已退出 → 点「前往登录」回到 `/login` |
| G23 | 验证码错太多次 | 提示「验证码尝试次数过多，请重新发送验证码。」 |

#### (d) `/onboarding/social` —— 空转步骤已改成有用的步骤

**原缺陷**：6 行全是「未绑定」的静态列表，**没有任何绑定的途径**，然后一个「完成」按钮。它改变不了任何状态，只是让用户多点一次。

**我怎么处理的**：两个诚实的选项 —— 删掉这一步，或给它一个职责。**我保留了它并给了职责**，因为原来那段话（"社交账号默认对陌生人隐藏，只有双方同意交换后才展示"）是**产品最核心的隐私承诺**，而整个注册流程里只有这里说过。这段话值得留。

那 6 行假状态列表删掉了，换成了：一句"可以绑定的平台"清单 + 一行"未绑定的平台不会出现在你的名片上"。

| # | 操作 | 期望 |
|---|---|---|
| G12 | 打开 `/onboarding/social` | 顶部一段说明 + 一个「默认对陌生人隐藏」的浅蓝卡片 |
| G13 | 看「可以绑定的平台」 | 是**文字清单**，不再有 6 行假的「未绑定」状态行 |
| G14 | 点「完成」 | 进入 `/onboarding/complete` |
| G15 | 确认**没有**「现在去绑定」按钮 | 这是**有意为之**：`/moments/settings` 的返回键指向 `/me`，如果在这里点进去绑定，用户回来后会被带到个人中心，**再也走不到 `/onboarding/complete`**，流程就断了。所以绑定放到引导**之后**，页面末尾写了「之后可以在「我的 → 管理社交账号」里绑定」 |

### 2.9 引导流程的 5 个表单步骤全部迁移完成

`/onboarding/{profile,interests,languages,purposes,countries}` 现在都用设计系统组件。**整个引导流程已经没有任何页面还在用旧组件**（`grep components/ui` 在 `app/onboarding/` 下零命中）。

顺带修掉的问题：

| 问题 | 位置 | 修法 |
|---|---|---|
| 出生日期、城市、国家**没有程序化标签** | `/onboarding/profile` | 旧 `Field` 用 `<span>` 当标签；现在每个字段都是真的 `<label for>` + `aria-describedby` |
| 国家下拉同时有**两种**标签机制（外层 `<label>` 包裹 + `aria-label`） | 同上 | 统一成 `<label for>` + `id` |
| 性别选项**只靠颜色**区分选中 | 同上 | 改用 `TFChip`（自带 `aria-pressed`），并包进 `<fieldset>`+`<legend>` |
| 性别、交友目的、国家、兴趣的选中态用了**渐变填充** | 4 个页面 | 改成 `border-brand-500 bg-brand-50`（选中态是状态，不该长得像主按钮） |
| 兴趣页的「清空」按钮语义不清 | `/onboarding/interests` | 搜索框改用 `TFSearch`（自带 ✕ 清空**查询**），另外单独提供「清空**选择**」 |
| 已选兴趣是白底小卡片 | 同上 | 改成浅底区域 + 可点移除的 pill（带 `aria-label="移除 X"`） |
| 骨架屏是 3 个灰色方块 | 4 个页面 | 改用 `TFLoadingRegion` + `TFRowSkeleton`（可访问的加载态 + 统一的脉冲动效） |
| 出生日期的年龄提示不明确 | `/onboarding/profile` | 未成年的提示改为「需要年满 18 岁才能使用 TalkFirst」，并把该字段标红（`aria-invalid`） |

| # | 操作 | 期望 |
|---|---|---|
| O1 | 走一遍完整注册流程 | `/register` → `/verify` → `/legal` → `/register/success` → `/onboarding/avatar` → `profile` → `interests` → `languages` → `purposes` → `countries` → `social` → `complete`，**每一步都能进下一步** |
| O2 | `/onboarding/profile` 昵称留空/1 个字 | 提示「昵称至少 2 个字符。」，昵称框变红 |
| O3 | 出生日期填一个未满 18 岁的日期 | 提示「需要年满 18 岁才能使用 TalkFirst」，该字段变红 |
| O4 | 不选国家点下一步 | 提示「请选择所在国家。」 |
| O5 | 性别四个选项 | 用键盘 Tab 能到，选中时有**蓝色边框 + 浅蓝底**（不是渐变），读屏会播报选中状态 |
| O6 | `/onboarding/languages` 搜索框输入「中」 | 列表过滤；**点搜索框右侧的 ✕** 清空输入 |
| O7 | 母语选「中文」后看「正在学习」列表 | 「中文」**不在**学习列表里（母语不能同时是正在学的语言） |
| O8 | `/onboarding/interests` 选 3 个以上 | 顶部出现「已选 N 个」+ 可点移除的 pill；点「清空选择」全部取消 |
| O9 | 兴趣/目的/国家的选中项 | 右侧是**实心蓝圆 + 白勾**（旧版是渐变圆） |
| O10 | 加载中 | 看到**骨架行**（头像圆 + 文字条），不是灰方块 |

### 2.10 Discover 发现页 + 资料卡（气泡墙的动画契约必须保持）

`/discover` 和资料卡已迁移到设计系统。这一页有**全站最脆弱的 E2E 契约**，所以我先说清楚**哪些东西我一个字都没动**：

| 契约 | 为什么不能碰 |
|---|---|
| `discover-bubble` 的 `data-testid` 和它**固定不变的点击区域** | 测试断言「气泡在漂浮，但点击区域的 bounding box 每一帧都完全相同」（`expect(second).toEqual(first)`）。漂浮动画挂在**内部的 orb** 上，不能挂到外层按钮上 |
| `discover-bubble-orb` 的 `data-testid` | 测试用 `getComputedStyle(orb).animationName` 断言它等于 `"tf-bubble-float"` |
| `tf-bubble-float` 这个 keyframe 名字和 `.tf-bubble-orb` 的 CSS | 名字被测试直接断言；`@media (prefers-reduced-motion: reduce)` 里必须是 `animation: none`，因为测试会模拟 reducedMotion 再断言 `"none"` |
| `.tf-bubble:hover / :focus-within / :active` 里的 `animation: none` | 测试断言「指针停在气泡上时漂浮暂停」，用的是 `expect.poll(...).toBe("none")` |
| `discover-bubble-field` / `discover-bubble-skeleton` 的 `data-testid` | 加载态与墙体都被断言 |

**我只改了这些（都是外观，不影响上面任何一条）**：

| 改动 | 之前 | 现在 |
|---|---|---|
| 配额徽章 | 手写 pill | `TFBadge` |
| 进度条 | `bg-indigo-100` + 渐变填充 | `neutral-200` 轨道 + `brand-500` 填充，并补上 `role="progressbar"` + `aria-valuenow` |
| 筛选 tab | 选中态是**渐变填充** | `border-brand-300 bg-brand-50 text-brand-600`（筛选是状态，不该长得像主按钮）。**没有换成 `TFTabs`**，因为它是不换行的等宽布局，而这行在 390px 下要能横向滚动 |
| 错误态 | 红框 + 文字 | `TFErrorState`（含「重试」） |
| 空状态 | 虚线框 + 🌎 emoji | `TFEmptyState`，CTA 按"哪个动作真能解决问题"分支：筛选太窄→「看全部」，已经是全部→「重新加载」，配额用完→**不给按钮**（那是等待，不是重试） |
| 气泡骨架 | Tailwind `animate-pulse` + `bg-indigo-100` | `animate-pulse-soft`（reduced-motion 下会被全局兜底关掉）+ `neutral` 色阶。**几何完全保留**（`w-[96px]`、错位 `marginTop`、相同 gap），否则加载完成时布局会跳 |
| 资料卡 | 手写浮层 + 旧按钮 | `absolute` + `bg-surface-scrim`（与其它浮层统一）+ `TFAvatar`/`TFBadge`/`TFButton`/`TFErrorState`/`TFSkeleton` |
| 气泡文字 | `text-[12px]` / `text-[11px]` | `text-caption` / `text-overline` |
| 气泡焦点环 | `ring-indigo-300` | `ring-brand-300` |

| # | 操作 | 期望 |
|---|---|---|
| D5 | `/discover` 顶部 | 「发现」+ 副标题 + 「今日剩余 N」徽章 + 进度条 |
| D6 | 用完配额后再看 | 进度条填满；空状态**没有**「重新加载」按钮（配额用完是等待，不是失败） |
| D7 | 筛一个没有人的条件 | 空状态给「看全部」+「重新加载」两个按钮，「看全部」是主按钮 |
| D8 | 点气泡 | 打开资料卡，卡里有「打招呼」和「查看完整资料」 |
| D9 | 点资料卡外部灰色区域 | 卡片关闭 |
| D10 | 系统开「减少动效」 | 气泡**完全静止**（有专门的自动化用例断言） |
| D11 | 鼠标悬停在气泡上 | 漂浮**暂停**，移开恢复 |
| D12 | `discover-bubble-skeleton` | 加载时出现，加载完成消失 |

### 2.11 动态详情 + 某人动态（Phase D 收尾）

`/moments/<id>` 是**全站 E2E 覆盖最密的一页**（`moment-detail.spec.ts` 约 1000 行）。所以先说清楚**哪些 `data-testid` 我原样保留**：

`moment-detail`（在 `<article>` 上，不在卡片外层）· `moment-menu` · `moment-report-open` · `moment-report-notice` · `moment-report-dialog` · `moment-report-reasons` · `moment-report-reason`（含 `data-reason`）· `moment-report-description` · `moment-report-cancel` · `moment-report-submit` · `moment-report-error` · `moment-comments` · `comment-list` · `comment-item` · `comment-count` · `comment-send` · `comment-menu` · `comment-delete` · `comment-delete-confirm` · `comment-delete-cancel` · `comment-delete-error` · `comment-load-more` · `comment-no-more` · `comment-empty` · `reply-toggle` · `reply-composer` · `reply-send` · `reply-cancel` · `reply-list` · `reply-item` · `reply-menu` · `reply-error` · `写评论`（`aria-label`）

**这些一个都没动**（`comment-*` / `reply-*` 全在 `moment-comments.tsx` 里）。另外 `moment-report-notice` 的文案「举报已提交，我们会尽快审核。」也没变。

> ### ⚠️ 更正：这一条我之前写错了
>
> 我原来在这里写「`comment-*` / `reply-*` 全在 `moment-comments.tsx` 里，**我只改了它外层两处颜色**」。
>
> **这句话把"我做了多少"说少了，也就等于把"还剩多少"说没了。** 实际核对（`grep 'border-line|bg-white|text-muted|\[#……\]'`）发现那个文件当时还有 **19 处**旧声明：评论/回复输入框、发送按钮、头像底色仍在用 `bg-[#6572D8]`（旧紫）、`border-line`、`bg-white`、`text-3D4663`。
>
> 我**只迁移了它的遮罩层**（`fixed` → `absolute` + `scrim`/`sheet` token），却把整个文件记成了"已完成"。这正是审计要抓的那类**文档与事实不符**，只不过出在我自己的文档上。本轮已把它真正迁移完（见下），并保留了全部 21 个 `data-testid`。


改动：

| 改动 | 之前 | 现在 |
|---|---|---|
| 详情页头部 | 36px 返回键 + 手写 `⋯` | 44px 返回键；菜单按钮加 `aria-expanded`；`⋯` 放进 `aria-hidden` 的 span，不再让字形充当可访问名 |
| 作者头像 | 手写 img/首字母 | `TFAvatar` |
| 「示例」标记 | 手写黄底 pill | `TFBadge tone="warning"` |
| 正文 | `text-[14px]` | `text-body`（15px）——这是页面的主体内容，和 Feed 统一 |
| 点赞按钮 | 无 `aria-pressed`、16px 图标、无 hit area | `aria-pressed` + 36px 圆形点击区 + `text-danger-500` |
| 「评论数」 | 是一个 `aria-label` 的 `<span>` | 保留为只读读数（评论区就在正下方，做成按钮等于给两个"点了没用"的入口） |
| 锁定 / 已删除 / 出错 | 三个手写色块 | `TFCard tone="quiet"`（锁定不是错误，是用户自己设的可见范围）/ `TFEmptyState` / `TFErrorState` |
| 举报成功提示 | 紫底紫框 | `brand-50` + `brand-200` |
| 某人动态页 | 卡片列表 | 与 Feed 一致的**分割线行**（不再每条一个边框卡片） |
| 某人动态页评论输入 | 手写 `rounded-full` input + 紫色按钮 | `TFInput`（保留 `aria-label="写评论"`）+ `TFButton` |
| 某人动态页平台筛选 | 手写 pill | `TFChip`（保留 `max-w` + `truncate`，因为 `@handle · 12` 可能很长） |
| **评论区本体**（本轮补做） | 旧紫 `#6572D8` 发送按钮 / `border-line` 输入框 / `#3D4663` 文字 / `text-[12px]` | `brand-500` + `border-border` + `content-muted` + `text-caption`；头像底色改 `brand-100`/`brand-600`。**输入框和按钮的 `h-9`、`flex-1`、间距一律未动**，因为 `moment-detail.spec.ts` 会用 `boundingBox()` 量 `reply-cancel` / `reply-send` / `comment-send` 的相对位置 |

| # | 操作 | 期望 |
|---|---|---|
| M1 | 从 Feed 点进一条动态 | 详情页正常打开，标题「动态详情」 |
| M2 | 点右上「⋯」 | 弹出「举报这条动态」；再点一次收起 |
| M3 | 点赞 | 心形变红、数字 +1、按钮是 36px 圆形可点区域 |
| M4 | 评论区 | 「评论 · N」计数、列表、发送、删除、回复、加载更多**功能全部照旧**；发送按钮现在是品牌蓝（原来是旧紫 `#6572D8`） |
| M5 | 仅连接可见的动态（陌生人打开） | 显示「这条动态暂时无法查看」，**不是**红色错误样式 |
| M6 | 打开一条已被删除的动态 | 显示「这条动态不存在或已被删除」+「回动态广场」 |
| M7 | 点作者头像/昵称 | 打开资料卡 |
| M8 | `/moments/user/<id>` | 头部「个人动态」+ 分享按钮；筛选是 `TFChip` 样式 |
| M9 | 某人动态里的动态 | 用**分割线**分隔，不是一条一个卡片 |
| M10 | 某人动态 → 点「评论」 | 展开评论输入；`aria-label="写评论"` 仍在，Enter 可发送 |

### 2.12 消息 / 聊天 / 连接（Phase E 主体）

`/messages/<id>` 的**聊天输入栏有像素级断言**（`chat-composer.spec.ts`），所以先说清楚这是什么、以及为什么它必须精确：

```
输入框宽度 > 发送按钮宽度 × 3
发送按钮和附件按钮都必须是 44 × 44（四舍五入后精确相等）
输入框高度 >= 44
横向顺序必须是：附件 < 输入框 < 发送
```

**我保持了 `h-11 w-11`（=44px）、`min-h-11 min-w-0 flex-1` 和 DOM 顺序不变。** 只换了配色：`border-line/70` → `border-border`、`bg-[#F8FAFF]` → `bg-surface-sunken`、紫色的发送按钮 → `bg-brand-500`，并去掉了发送键下面那个 `shadow-indigo-200`（品牌色控件配靛蓝阴影）。**没有**改用 `TFIconButton`，因为它强制 36/44 两档并自带 `rounded-full` 尺寸策略 —— 那会和我需要的精确 44×44 打架。

`chat-socket.spec.ts` 断言的四个字符串**一字未改**：`实时连接` · `连接断开，正在重连…` · `连接失败` · `对方在线` / `对方离线`。

其余改动：

| 页面 | 改动 |
|---|---|
| `/messages/<id>` | 连接状态 pill：`emerald/amber` → `success/warning` token；「交换联系方式」从紫底紫字 → `brand-50`/`brand-600`；加载骨架从 3 个灰条 → **左右交错的气泡形状**（并加 `TFLoadingRegion` 让读屏能播报）；页面级错误 → `TFErrorState`；「加载更早的消息」按钮尺寸补齐 |
| `/messages` | 认识请求卡片 → `TFCard` + `TFAvatar` + `TFButton`（`aria-label="拒绝 X"` 保留）；会话列表从「一条一个边框卡片」→ **分割线行**；空状态文案与「通知中心」入口的 `data-testid` 保留 |
| `/connections` | 标题从「连接」→「我的连接」（与「我的」页里的入口名一致）；手写头像 → `TFAvatar`；兴趣 chip → `TFBadge`；空状态 → `TFEmptyState`；交换状态条的三句文案保留原样 |

| # | 操作 | 期望 |
|---|---|---|
| E1 | 打开一个聊天 | 输入栏：左边图片按钮、中间输入框、右边发送按钮，**两个圆按钮都是 44×44** |
| E2 | 输入长文本 | 输入框**变高但不横向溢出**；超过上限后内部滚动 |
| E3 | 空输入 | 发送按钮**禁用**；输入后可用；发送后清空并变回禁用 |
| E4 | 看状态 pill | 已连接时是**绿色**，断线时是**琥珀色**；文案仍是「实时连接」/「连接断开，正在重连…」 |
| E5 | 点「交换联系方式」 | 进入交换面板（`/messages/<id>/connect`） |
| E6 | 点「加载更早的消息」 | 追加更早的消息，不替换现有内容 |
| E7 | 消息页列表 | 会话是**分割线行**（不是一条一个卡片）；未读数显示为蓝色「（N 未读）」 |
| E8 | `/connections` 标题 | 是「**我的连接**」（与「我的 → 关系」里的入口名一致） |
| E9 | `/connections` 空状态 | 有图标 + 一句话 +「去发现」按钮 |
| E10 | 连接行里的交换状态 | 三句文案仍是「✅ 已交换 …」/「🔗 交换申请待处理」/「🔒 社交账号隐藏」，右侧「查看交换」可点 |

### 2.13 交换联系方式面板 + 聊天安全菜单（Phase E 收尾）

这两个是 **Phase E 剩下的最后两个组件**，也是安全相关的两个。

#### `connect-panel.tsx`（交换联系方式）—— 门槛逻辑一行未动

这是"加好友"的门槛所在，所以判断条件我**一行没动**：

```ts
disabled={selected.length === 0 || acting || !state.eligible}
```

这一行是审计修过的 bug：原来 `disabled` 漏了 `!state.eligible`，所以一个写着「还需 N 条消息」的按钮**其实可以点**，只在一次往返之后才失败。标签和禁用状态现在一致。**迁移时我原样保留了这个表达式**，只把按钮换成 `TFButton`。

| 改动 | 之前 | 现在 |
|---|---|---|
| 平台选择 chip | 选中态是**渐变填充** | `TFChip`（带 `aria-pressed`）+ `border-brand-500 bg-brand-50` |
| 留言输入框 | 手写 textarea | `TFTextarea`（补齐 `htmlFor`/`id` 标签关联） |
| 「撤回我发起的请求」 | 11px 裸文字按钮 | `TFButton variant="ghost"` + 加载态 |
| 已交换的联系方式卡片 | `rounded-2xl border-line` | token 化；`select-all` **保留**（这是全屏唯一需要被复制到别处的字符串） |
| 加载态 | 两个灰块 | `TFLoadingRegion` + `TFRowSkeleton` |

#### `safety-actions.tsx`（聊天安全菜单）—— 拉黑 / 举报

| 改动 | 说明 |
|---|---|
| 浮层定位 | 将 `fixed` 改为 `absolute`（保持在手机壳内），加 `scrim` token 和 `aria-label` |
| 举报原因 | 补上 `data-testid="chat-report-reason"` + `data-reason={item}`，**与动态举报弹窗的契约对齐** |
| 举报原因必选 | 新增：没选原因时「提交举报」**禁用**并提示「请先选择一个举报原因」（原来可以直接提交空原因） |
| `aria-pressed` | 举报原因是可选项，原来只靠边框颜色区分 |
| 拉黑按钮 | 改用 `variant="danger"`（破坏性操作用 danger 色） |

| # | 操作 | 期望 |
|---|---|---|
| E11 | 进聊天 →「🔗 交换联系方式」 | 面板打开，顶部说明「需要先聊天至少 N 条消息」 |
| E12 | 消息不够时 | 主按钮显示「还需 N 条消息」**且不可点**（审计修过的 bug，重点确认） |
| E13 | 选平台 | 选中的 chip 是**蓝色浅底 + 边框**；未绑定的显示「· 未绑定」且半透明 |
| E14 | 不选平台 | 按钮禁用；选一个后可点 |
| E15 | 看对方发来的交换请求 | 有「拒绝」+「接受并交换」 |
| E16 | 看**自己**发出的交换请求 | 只有「撤回我发起的请求」，**没有**接受/拒绝（方向判断是审计修过的 bug） |
| E17 | 聊天页「⋯」安全菜单 | 打开底部面板，有「举报用户」「拉黑」「取消」 |
| E18 | 「举报用户」→ 不选原因 | 「提交举报」**禁用**，下方提示「请先选择一个举报原因」 |
| E19 | 选一个原因 | 按钮可用；提交后出现结果提示 |
| E20 | 「拉黑」→「确认拉黑」 | 按钮是**红色**，点击后生效 |

### 2.14 `/me/edit` 与 `/me/password`（Phase F）

#### (a) `/me/edit` —— 六个标签文本是**测试契约**，不能改

`profile.spec.ts` 用这些方式读这一页，其中**三个是前缀匹配**：

```ts
getByLabel("昵称")        getByLabel("出生日期")      getByLabel("所在国家")
getByLabel(/^地区/)       getByLabel(/^城市/)         getByLabel(/^简介/)
```

所以「地区 / 省 / 州（可选，最多 N 字）」「城市（可选，最多 N 字）」「简介（最多 N 字）」这三个标签的**开头文字被我原样保留**（没有缩短、没有加前缀）。改这一页时最容易犯的错就是把「地区 / 省 / 州」简化成「地区」，那样 `^地区` 仍然匹配，但把「城市（可选…）」改成「所在地」就会**静默地让测试找不到输入框**。

| 改动 | 之前 | 现在 |
|---|---|---|
| 六个字段的标签 | `Field` 用 `<span>`，**无 `htmlFor`** → 输入框没有程序化标签 | 全部改成真 `<label for>` + `id` |
| 自动填充 | 无 | `nickname` / `bday` / `country` / `address-level1` / `address-level2` / `photo` |
| 性别选项 | 有 `aria-pressed` 但**没有分组标签** | `TFChip` 放进 `<fieldset>` + `<legend>` |
| 该字段年龄提示 | 「需要年满 18 岁」灰/红混用 | 未成年时用 `text-danger-600` 并写明「才能使用 TalkFirst」 |
| 底部三个跳转链接 | 白卡 + 阴影 + `shadow-sm` | 分割行 + `brand-600` |

#### (b) `/me/password`

| 改动 | 说明 |
|---|---|
| 外面包了 `<form>` | 原来只有 `onClick`，**按 Enter 不提交**。改密码是最需要 Enter 的地方 |
| 三个字段的标签 | 同上，`<span>` → `<label for>` |
| 自动填充 | 当前密码 `current-password`；两个新密码 `new-password`（让密码管理器提示**生成**，而不是把旧密码填进新密码框） |
| 提示文案 | 新增「密码长度 8-72 个字符…」并用 `aria-describedby` 关联到两个新密码框 |
| 成功提示 | 原来 `{success}` 渲染的是**布尔值**（React 会渲染成空），现在明确写「密码已修改。」 |

| # | 操作 | 期望 |
|---|---|---|
| F1 | `/me/edit` 打开 | 六个字段都有**可见标签**，值已从服务器预填 |
| F2 | 用浏览器自动填充 | 昵称/生日/国家/地区/城市**都能被识别** |
| F3 | 出生日期填未成年日期 | 提示「需要年满 18 岁才能使用 TalkFirst」并变红 |
| F4 | 性别 | 读屏会播报「性别（可选）」分组名 + 每项选中状态 |
| F5 | 改昵称 → 保存 | 出现「已保存」提示；刷新后仍是新值 |
| F6 | `/me/password` | 三个字段都有标签 |
| F7 | 在任一密码框按 **Enter** | **直接提交**（原来不能） |
| F8 | 两次新密码不一致 | 提示「两次输入的新密码不一致。」 |
| F9 | 修改成功 | 显示「**密码已修改。**」（原来这里是空的） |
| F10 | 用密码管理器 | 两个新密码框会提示**生成新密码** |

### 2.15 `/profile/[id]` 资料详情页（Phase F）

这一页有**一整套隐私断言**，迁移时必须逐条保住。

| 测试断言 | 代码里对应什么 | 迁移时怎么处理 |
|---|---|---|
| `getByText("关于 TA")` 可见 | `<p>关于 TA</p>` | **文案一字未改** |
| `getByTestId("profile-looking")` 可见 | `<section data-testid="profile-looking">` | testid 保留 |
| `getByText(ALICE_PUBLIC_ATTRIBUTE, { exact: true })` | `AttributeTagList` 的渲染结果 | 组件调用未动 |
| `getByText("语言交换", { exact: true })` | 兴趣/目的的文本 | 未动 |
| **`getByText("暂无")` 必须为 0 个** | `aboutVisible` / `lookingVisible` 是**整段**渲染开关 | **保持「要么整段渲染，要么什么都不渲染」**，绝不能加占位符 |
| **`getByText(/Tokyo/)` 必须为 0 个**，`/Kanto/` 可见 | `place` 由 city/region/country 拼接，隐藏的字段不参与拼接 | 拼接逻辑未动 |

| 改动 | 之前 | 现在 |
|---|---|---|
| 头像 | 手写 img / 渐变 div | `TFAvatar`（`ring` + `border-4 border-white`） |
| 语言 / 兴趣 / 交友目的 / 想认识的国家 | 4 组手写 `rounded-full` span，其中「想认识的国家」是硬编码的 `#EAFBF1`/`#0E9F6E`（不在 token 里） | 全部 `TFBadge`（brand / warning / success） |
| 「打招呼」「查看动态」等 4 个按钮 | 旧组件 | `TFButton`，`aria-label="打招呼"` 保留 |
| 报错 + 重试 | 红框 + 旧按钮 | `TFErrorState` |
| 加载态 | 两个灰块 | `TFLoadingRegion` + `TFSkeleton` |

| # | 操作 | 期望 |
|---|---|---|
| F11 | 用**陌生人**账号打开 `/profile/<他人 id>` | 看到「关于 TA」；**看不到**「暂无」任何字样（隐藏的分区完全不渲染） |
| F12 | 陌生人看该页 | 只显示城市/地区中**可见**的那部分（隐藏的城市不出现在地点行里） |
| F13 | 用**已连接**账号打开同一页 | 能看到简介与连接可见的属性；**仍然看不到**仅自己可见的内容 |
| F14 | 用**本人**账号打开 | 能看到全部字段，包括仅自己可见 |
| F15 | 点「打招呼」 | 按钮变「已打招呼」或进入发送中 |
| F16 | 点「查看动态」 | 进入 `/moments/user/<id>` |
| F17 | 各标签（语言/兴趣/目的/想认识的国家） | 都是**浅底徽章**样式，颜色按类别区分（蓝/琥珀/绿） |

### 2.16 `/me/visibility` 逐字段可见范围（Phase F）

这一页的控件有**精确选择器契约**：

```ts
row.getByRole("radio", { name: "仅自己", exact: true }).click();
```

所以三件事必须原样保留：`role="radio"` + 外层 `role="radiogroup"`、选项文字来自 `VISIBILITY_SHORT_LABELS`（「公开」「仅连接」「仅自己」）、以及 `aria-checked`。**`exact: true` 意味着选项文字哪怕加一个后缀都会失配。**

另外整行必须包含当前层级的措辞：测试先读「仅好友/连接可见」，改完刷新后读「仅自己可见」——两句都来自 `VISIBILITY_LABELS`，未改动。

| 改动 | 之前 | 现在 |
|---|---|---|
| 每个字段一张卡 | 手写 `rounded-3xl border-line` | `TFCard`（`data-testid` 透传，见下） |
| 三档选择器选中态 | **渐变填充**（状态穿上了主按钮的衣服） | `border-brand-500 bg-brand-50 text-brand-600` |
| 错误重试 | 红框 + `SmallButton` | `TFErrorState` |
| 加载态 | 两个灰块 | `TFLoadingRegion` + `TFSkeleton` |
| 返回按钮 | `OutlineButton` | `TFButton variant="secondary"` |

#### ⚠️ 顺带发现并修掉一个**编译错误**

`TFCard` 原来**不接受 `data-testid`**。`TFCardProps` 是显式对象类型而不是 `HTMLAttributes` 的交叉类型，所以传 `data-testid` 是类型错误 —— 而 `visibility-row-bio` 正是测试用来定位这一行的东西。

修法：在 `TFCardProps` 里显式声明 `"data-testid"?: string` 并透传。**这和之前 `TFBadge` 缺 `title`、`TFAvatar` 把 `alt` 展开到 `<span>` 是同一类问题** —— 只要页面往 `tf/*` 原语上挂未声明的属性，就会编译不过。

为此我做了一次全站排查：`grep '^\s+data-testid='` 找到 **69 处**，逐一确认它们挂在哪 —— 结论是**只有这一处挂在 `tf/*` 原语上**（其余都在原生元素，或 `TFButton`/`TFInput`/`TFTextarea` 这类已经 `{...rest}` 透传的原语上，已加注释标明这是有意的）。

| # | 操作 | 期望 |
|---|---|---|
| F18 | 打开 `/me/visibility` | 每个字段一张卡，显示「当前：…」当前层级 |
| F19 | 看三档选择器 | 选中档是**蓝色边框 + 浅蓝底**（不是渐变填充） |
| F20 | 点「仅自己」 | 出现「「个人简介」已设为仅自己可见。」之类的确认；刷新后仍是仅自己可见 |
| F21 | 键盘 Tab | 三档都能聚焦，有可见焦点环 |
| F22 | 读屏 | 每档被播报为一个 radio，当前档为已选中，并有分组名 |

### 2.17 `/me/interests`（Phase F）

三段设置（语言 / 兴趣 / 交友目的 / 想认识的国家）全部从手写按钮迁到 `TFChip` + `TFBadge` + `TFButton`。

**保留的契约**：`data-testid="native-languages"` / `learning-languages` / `country-options`，以及每个保存按钮的 `aria-label`（「保存语言」「保存兴趣」「保存交友目的」「保存想认识的国家地区」）。`TFSearch` 保留了可访问名「搜索兴趣」。

| 改动 | 之前 | 现在 |
|---|---|---|
| 四组选择 chip | 手写 `rounded-full` + 选中态**渐变填充** | `TFChip`（带 `aria-pressed`）+ `brand` 选中态 |
| 三个计数器（`N / MAX`） | 手写紫底 pill | `TFBadge tone="brand"` |
| 四个保存按钮 | `SmallButton variant="gradient"` | `TFButton`（`size="lg"`，带加载态） |
| 已选兴趣列表 | 白底小卡片 + `shadow-sm` | 浅底区域 + 可点移除的 pill（`aria-label="移除 X"` 保留） |
| 搜索框 | 手写 input | `TFSearch`（自带 ✕ 清空） |
| 错误态 | 红框 + 重试 | `TFErrorState` |
| 已达上限提示 | `text-[#B26A00]` 硬编码 | `text-warning-800` token |

**一处需要说明的细节**：国家/地区那段是**两列网格**而不是自动换行，所以那里的 chip 加了 `w-full justify-start`（否则 chip 会收缩成各自宽度，网格出现参差的列宽）。

| # | 操作 | 期望 |
|---|---|---|
| F29 | 打开 `/me/interests` | 四段设置依次是：语言 / 兴趣 / 交友目的 / 想认识的国家 |
| F30 | 选一门母语 | 该 chip 变蓝；它**自动从「正在学习」里消失** |
| F31 | 搜索框输入再点 ✕ | 列表被过滤；✕ 清空搜索词 |
| F32 | 兴趣选到上限 | 提示「已达上限 N 个，请先移除再添加。」 |
| F33 | 国家/地区那一段 | 两列网格，每格**等宽**、文字过长时省略号 |
| F34 | 任一段点保存 | 按钮进入加载态并显示「保存中…」，成功后出现确认文案 |
| F35 | 每段的计数 | 右上角 `N / MAX` 徽章随选择实时更新 |

### 2.18 `/me/attributes`（Phase F）

`/me/attributes` 的契约最密，**15 个 `data-testid` + 6 个精确 `aria-label`**，全部保留：

`attribute-section-{kind}` · `attribute-count-{kind}` · `attribute-row-{id}` · `system-picker` · `custom-picker`，以及 `添加到我的介绍` / `添加到交友需求` / `自定义` / `关闭面板` / `自定义标签名称` / `自定义标签补充说明` / `添加自定义标签` / `保存标签` / `确认删除标签`。

| 改动 | 之前 | 现在 |
|---|---|---|
| 计数徽章 | 手写 pill，满额时换成硬编码 `#FFF4E5`/`#B26A00` | `TFBadge`（`tone={full ? "warning" : "brand"}`），`data-testid` 保留 |
| 「自定义」/「已停用」小标记 | 手写白底 pill | `TFBadge` |
| 系统标签 chip | 手写 `rounded-full border-line` | `TFChip` |
| 自定义标签两个输入框 | 手写 input（标签是 `<span>`） | `TFInput` + 真 `<label for>`，`aria-label` 保留 |
| sheet 外壳 | `rounded-t-[28px] bg-white` | `rounded-t-sheet bg-surface` + `rounded-sheet` |
| 删除标签 | 再次确认的两颗旧按钮 | `TFButton`（确认那颗用 `variant="danger"`） |

**一处刻意的设计决定**：删除标签的二次确认**仍然留在 sheet 内部**，没有换成 `TFDialog`。原因：sheet 本身已经占满屏幕并持有焦点陷阱，**再叠一层被陷阱的浮层正是让键盘用户卡住的做法**。这和 `/me` 注销用 `TFDialog`（那一页没有 sheet）不矛盾。

| # | 操作 | 期望 |
|---|---|---|
| F36 | 打开 `/me/attributes` | 两栏「我的介绍 / 交友需求」，各带 `N / 10` 徽章 |
| F37 | 点「+ 添加」 | 打开选择面板：系统标签（按分类，chip 形）+「自定义」 |
| F38 | 点「自定义」 | 出现两个带**可见标签**的输入框；名称留空点添加 → 有错误提示 |
| F39 | 添加自定义标签 | 面板关闭，标签出现在列表里，计数 +1 |
| F40 | 把某栏加到 10 个 | 计数徽章**变琥珀色**，「+ 添加」变成「已达上限 10 个」且不可点 |
| F41 | 点某个标签 | 打开编辑面板；改可见范围后保存 |
| F42 | 编辑面板里点「删除这个标签」 | **在面板内**出现「确定删除…？」，有「再想想」和红色「确认删除」 |
| F43 | 键盘操作 | 编辑面板打开时 Tab 不会跑到背后的页面上（焦点被陷阱在面板内） |

### 2.19 `/moments/settings` 动态设置（Phase F 收尾）

**这是成员端最后一处 `window.confirm`。** 解绑平台原来用浏览器原生确认框，而 `/moments` 的删除动态已经用自绘 `TFDialog` —— 两个同等级别的操作两套确认方式。现在统一：

| 改动 | 之前 | 现在 |
|---|---|---|
| 解绑确认 | `window.confirm("确定解绑该平台吗？…")` | `TFDialog`，**文案一字未改**（「已展示的动态会保留」是用户会依赖的承诺） |
| 弹窗内容 | 无 | 显示**将要解绑的平台名和账号**，避免解绑错 |
| 隐私三选一 | 普通按钮 + 底色变化 | 真 `role="radiogroup"` + `role="radio"` + `aria-checked` |
| 开关（`Toggle`） | `left-[22px]` / `left-0.5` 硬切位置 | `translate-x`（走合成层，`motion-reduce` 下不动画） |
| 「示例内容说明」 | 硬编码 `#FFE0B2`/`#FFF8EC`/`#8A5A00` | `warning` token（这是必须显眼的一段话） |
| 平台账号输入框 + 绑定按钮 | 手写 input + 紫色按钮 | `TFInput`（`aria-label="{平台}账号"` 保留）+ `TFButton` |
| 骨架屏 | 三个灰块 | `TFLoadingRegion` + `TFSkeleton` |

**仍然保留的浏览器原生确认框：0 处。** 成员端已无 `window.confirm`（三处引用都只是注释）。

| # | 操作 | 期望 |
|---|---|---|
| F44 | 打开 `/moments/settings` | 顶部是琥珀色的「示例内容说明」（明确说明**还没接入真实平台**） |
| F45 | 解绑一个已绑定的平台 | 弹出**自绘**弹窗，里面显示要解绑的**平台名和账号** |
| F46 | 点「取消」 | 弹窗关闭，平台仍处于绑定状态 |
| F47 | 点「确认解绑」 | 按钮变「解绑中…」→ 该平台回到「未绑定」，顶部出现「已保存」 |
| F48 | 点隐私三选一 | 选中的一项变蓝；读屏会播报为一个 radiogroup，当前项已选中 |
| F49 | 拨动任一开关 | 旋钮平滑滑动（开启系统「减少动效」后**不动画**，直接跳到位） |
| F50 | 在「未绑定」平台填账号后按 Enter | 直接发起绑定（不必点按钮） |

### 2.20 通知中心（Phase G）

`notification.spec.ts` 是第二大套件，它的契约里有一条**必须原样保留的实现选择**：

```ts
await page.getByTestId("notification-filter").selectOption("MOMENT_REPLY");
await page.getByTestId("notification-filter").locator("option").allTextContents();
```

它驱动的是一个**真正的 `<select>`**。所以我没有把它换成自绘列表控件 —— 换成自绘的会立刻打断这个套件，同时白丢平台自带的选择器（手机上是原生滚轮）。**只换了配色。**

保留的 12 个 testid：`notification-filter` · `notification-mark-all` · `notification-unread-count` · `notification-loading` · `notification-error` · `notification-empty` · `notification-mark-all-error` · `notification-action-error` · `notification-more-error` · `notification-load-more` · `notification-item`（带 `data-notification-type` / `data-unread`）· `notification-unread`

| 改动 | 之前 | 现在 |
|---|---|---|
| 「全部已读」 | 紫色下划线文字 | `brand-600` + 圆角 hover 底 |
| 筛选 `<select>` | `border-line bg-white text-ink` | token 化，**仍是原生 select** |
| 加载态 | `animate-pulse` 灰块 | `TFLoadingRegion` + `TFSkeleton`（`notification-loading` 测试 id 移到了内层列表上，因为它必须"存在于请求进行中"） |
| 错误 / 空态 / 加载更多 | 手写 | `TFButton` + token 化 |
| 通知条目：**未读只靠边框颜色** | `border-indigo-100` + 阴影 | `brand-200` 边框 + 浅蓝底 + 图标着色 + 标题加粗 —— **同时用了颜色、字重和图形三路信号**，并保留 `data-unread` |
| 通知条目圆角/文字 | `rounded-3xl` / `text-[13px]` | `rounded-card` / `text-ui` |

**一处我改回去的地方**：我一度把列表容器改成 `divide-y`（和 Feed 一致），但发现 `NotificationItem` **自己就是一张带边框的卡片** —— 它必须如此，因为同一个组件在消息页里是独立出现的。在卡片之间再加分割线就是"双边框"。已改回 `space-y-2` 并在源码里写明原因。

| # | 操作 | 期望 |
|---|---|---|
| G1 | 打开 `/notifications` | 顶部「通知」+ 右上「全部已读」；下面一行是**类型下拉框** + 「未读 N」 |
| G2 | 用下拉框筛一个类型 | 列表实时过滤；**未读数不变**（筛选不改未读） |
| G3 | 点「全部已读」 | 未读数归零，按钮变为禁用 |
| G4 | 看未读通知 | **三种信号同时出现**：浅蓝底 + 蓝色图标 + 标题加粗，右侧还有蓝点 |
| G5 | 点一条未读通知 | 标记已读并跳转到对应目标 |
| G6 | 加载中 | 出现 3 条骨架（`notification-loading` 存在） |
| G7 | 加载失败 | 显示错误 + 「重试」 |
| G8 | 没有通知时 | 显示「暂无通知」 |
| G9 | 键盘 | 每条通知可 Tab 到、可回车激活，有可见焦点环 |

### 2.21 安全中心 `/me/safety`（Phase H）

| 改动 | 之前 | 现在 |
|---|---|---|
| 说明条 | `bg-[#F7F9FF]` 硬编码 | `bg-surface-sunken` |
| 拉黑列表 | 一条一个 `rounded-2xl` 卡片 | **分割线行**，和消息/通知一致 |
| 「解除」按钮 | `OutlineButton`，每行文字都是光秃秃的「解除」 | `TFButton`，并给每行加上 `aria-label="解除对 {昵称} 的拉黑"` —— 一排同名按钮对读屏是不可用的 |
| 举报状态 | **直接把英文枚举打给用户看**（`PENDING` / `REVIEWED`） | 映射成中文（待审核 / 已审核…），**未识别的状态回退显示原值**，这样后端新增状态时至少还有内容而不是空白 |
| 加载态 | 两个灰块 | `TFLoadingRegion` + `TFSkeleton` |

| # | 操作 | 期望 |
|---|---|---|
| H1 | 打开 `/me/safety` | 顶部说明 + 「已拉黑（N）」+「我的举报（N）」两段 |
| H2 | 有拉黑记录时 | 每条是分割线行，右侧「解除」可点，点击后该行消失 |
| H3 | 举报记录的状态 | 显示**中文**（如「待审核」），不是 `PENDING` |
| H4 | 读屏逐行浏览「解除」按钮 | 每个按钮的可访问名里**包含被拉黑者的昵称** |
| H5 | 点「管理社交账号可见性」 | 进入 `/me/social` |

### 2.22 搜索页与话题页：**确认无法实现**（Phase G 的剩余部分）

原计划在 Phase G 新建 `/search` 和 `/topics`。**在动手前我核对了 API，结论是这两个页面没有对应的服务端接口：**

| 我找的东西 | 实际找到的 |
|---|---|
| 面向成员的 `/search` | **不存在**。全站 `search` 相关代码都在 `admin/` 里（`AdminService.searchUsers`），那是**管理后台的用户检索**，语义、权限、返回结构都不同 |
| 话题 / 标签浏览 | **不存在**。`/meta/interests` 是**兴趣字典**（给选择器用的静态列表），不是话题 |
| 成员端全部 GET 路由 | `auth/me`、`users/me*`、`users/:id`、`discover/recommendations`、`moments/{platforms,feed,user/:id,bindings,settings,:id,:id/comments}`、`notifications`、`conversations*`、`exchange/*`、`connections/*`、`blocks`、`reports/mine`、`meta/*`、`presence/online`、`translate/languages`、`health` |

**所以我没有建这两个页面。** 建出来只有两种可能：写死假数据（那就是在 UI 里撒谎，而且违反"不改 API 契约"的约束——我需要新增接口才能真正实现它），或者做一个空壳。

#### 本轮的第二条独立证据：`/moments/feed` 的参数表

`moments.controller.ts` L153–160 的签名就是**全部**可用筛选：

```ts
@Get("feed")
async feed(
  @CurrentUser() user: AuthUser,
  @Query("tab") tab?: string,
  @Query("platform") platform?: string,
  @Query("limit") limit?: string,
  @Query("cursor") cursor?: string,
)
```

**没有 `topic`。** 所以"按话题看动态列表"这条路在服务端确实不通 —— 这不再是"我没找到"，而是"参数表里没有"。

**但话题的数据是存在的**：`/moments/compose` 有完整的话题选择/创建 UI（`moment-topic-toggle` / `-panel` / `-option` / `-input` / `-create` / `moment-tag`），说明动态**带 tags**。缺的只是"按 tag 聚合浏览"的查询接口。

这是一个**需要你决定的产品问题**，已记入 §9.1：

- 如果要做成员搜索，需要后端先提供接口（搜谁？按昵称/语言/兴趣？是否遵守可见性？命中是否需要配额？）
- 如果要的话题就是**兴趣 + 标签**的聚合浏览，可以基于已有的 `/meta/interests` 和动态里的 `tags` 做，**但仍然需要一个"按 tag 查动态"的接口** —— 现有 `/moments/feed` 没有这个参数

**替代方案**：`/discover` 的筛选、`/moments` 的平台筛选、以及 `/me/interests` 的兴趣选择，已经是现有的三条"发现内容"的路径。搜索在数据模型层面缺的是索引与权限设计，不是界面。

### 2.23 Admin 后台：把「单一真源」这句话变成事实（Phase I）

Admin 的 `tailwind.config.ts` 里有一句 docblock 写着：

> *"A single source of truth for the console's palette… **so a screen never invents its own hex value**"*

**我数了一下：18 个文件里有 63 处任意 hex。** 这句话和事实不符，而这个不符本身就是审计在找的**规范漂移**——只不过发生在管理端。

**我做了什么**：把这 63 处里**会重复**的那些提升为命名 token，并把调用点迁移过去。不是重新设计后台（它的视觉语言是对的：密集、扁平、几乎无阴影），而是**把它自己声明的规范执行到底**。

#### 我一开始对后台的判断是不完整的（先纠正自己）

我最初把后台描述成"全是散落的 hex、没有组件层"。**这不准确。** 后台其实有它自己的设计系统，在 `globals.css` 的 `@layer components` 里：

| admin 的类 | 成员端的对应物 |
|---|---|
| `.tf-btn` / `.tf-btn-primary` / `.tf-btn-danger` / `.tf-btn-ghost` / `.tf-btn-sm` | `TFButton` 的 variant/size |
| `.tf-input` / `.tf-label` | `TFInput` / 标签约定 |
| `.tf-panel` / `.tf-meta` | `TFCard` / 说明文案 |

**所以后台的架构和成员端是对称的**：一边是 `@layer components` 的 CSS 类，一边是 React 原语。这比我原先说的更健康。

真正的问题是两层：**这 63 处 hex 是绕过 `.tf-*` 的"屏幕自造样式"**，而且 `.tf-*` 自己的 `@apply` 里也藏着 4 个 hex（`hover:bg-[#F3F4F6]`、`hover:bg-[#4338CA]`、`hover:bg-[#B91C1C]`）—— 连"规范层"本身都没有完全用名字。

#### 本轮新增的 admin token

| token | 值 | 用途 |
|---|---|---|
| `surface` | `#FBFCFE` | 卡片内的凹槽面板（日志条目、详情块）——替换 **8 处** |
| `subtle` | `#F3F4F6` | 行 hover、中性 chip |
| `accent` | `#EEF2FF` | 图标底、导航激活行、强调 chip |
| `body` | `#374151` | 导航文字、次级正文 |
| `primary-ink` | `#16213A` | **填充按钮的深蓝**——在 **6 个不同页面**上重复出现 |
| `{success,warning,danger,info}-{wash,ink}` | | 状态徽章 |
| `neutral-wash` / `neutral-ink` | `#EDEFF3` / `#5A6472` | 「已取消/已移除」态。**注意它不等于 `subtle`**（`#F3F4F6` 更暖） |
| `system-wash` / `system-ink` | `#E4EAF7` / `#4A5A7A` | 「系统 · 自动」参与者徽章 |

#### 两个我特意**没有**合并的东西

1. **`success` / `warning` / `danger` 三个扁平 token 必须保留。** 我一度想用嵌套色阶（`success: { wash, ink }`）替换它们，然后发现 `stat-card.tsx` 用 `text-success`、`bg-success/10`，`error-state.tsx` / `shell.tsx` 用 `text-danger` —— 而 Tailwind **没有内置 `danger`**，所以这些类名一旦失去定义就会静默变成默认文字色。改用扁平键（`success-wash` / `success-ink`），现有类名全部照旧解析。
2. **`status-badge.tsx` 的 success/warning/danger 保持字面量。** 它们用的是 `#ECFDF5` / `#FFFBEB` / `#FEF2F2`（Tailwind `*-50` 那一族），**和其他页面的 `#DCFCE7` / `#FEF3C7` / `#FEE2E2` 不是同一族**。把它们改名到"最接近的 token"会改变每一个徽章的颜色，**没有编译错误、也没人会注意到** —— 静默的视觉回归比留一个字面量更糟。这个判断写进了源码注释。

#### 结果

`grep '\[#[0-9A-Fa-f]\{6\}\]' apps/admin/src`（含 `.css`）：**63 → 10 处**。

- `globals.css` 现在是 **0 处** —— `.tf-btn` 的 hover 全部改用 `subtle` / `primary-hover` / `danger-hover` 三个新 token。
- 剩下 10 处里，**6 处集中在 `status-badge.tsx` 的 ring 色**，另外 4 处是 `error-state` 的边框、`audit-timeline` 的两种圆点色、`dashboard` 的一个 hover 边框色。这些都是**每个 tonal 只出现一次**的值，我没有为它们造 token —— 命名一个只用一次的颜色，只是把 hex 搬到另一个文件里而已。

#### 为什么没有和成员端共用一套 token（原计划 Phase I 想抽 `packages/design-tokens`）

| | 成员端 | Admin |
|---|---|---|
| 主色 | `brand-500` `#3B82F6` | `primary` `#4F46E5` |
| 圆角 | `rounded-control` 18px | `rounded-xl` 10px |
| 定位 | 消费级、软、呼吸感 | 运维工具、密集、信息优先 |

**这两套值不应该统一** —— 强行共用会让后台变得像消费级 App，而它的密集度是有意的（配置里写明"16px 的卡片读起来像消费级气泡，不像运维台"）。所以 Phase I 的正确目标不是"共用 token"，而是**各自内部收敛**。抽包的提议我建议放弃，理由记在 §9.1。

**这一整轮我没有任何办法验证。** 特别是 `primary-ink` 那个替换：如果新 token 没被 Tailwind 正确解析，6 个页面的主按钮会**变成透明/无色**，而不是报错。

### 2.24 动态删除改为自绘弹窗 + 首次接通 toast（Phase D 补强）

| # | 操作 | 期望 |
|---|---|---|
| F23 | 在 Feed 里点自己动态的「删除动态」 | 弹出**自绘**弹窗（不是浏览器原生 `确定/取消`），标题「删除这条动态？」 |
| F24 | 看弹窗内容 | 显示**这条动态的正文摘要**（最多 3 行）；纯图片动态显示「（这条动态只有图片）」 |
| F25 | 点「取消」或按 Esc | 弹窗关闭，**动态仍在** |
| F26 | 点「确认删除」 | 按钮变「删除中…」→ 动态从列表消失 → 出现 **「动态已删除」的浮层提示**（约 2.6 秒后自动消失） |
| F27 | 删除失败时（可断网模拟） | 错误显示**在弹窗内**，弹窗不关闭，可直接再点「确认删除」重试 |
| F28 | 弹窗打开时 | 背景不滚动；Tab 焦点被限制在弹窗内 |



这一页有**一整套隐私断言**，迁移时必须逐条保住。

| 测试断言 | 代码里对应什么 | 迁移时怎么处理 |
|---|---|---|
| `getByText("关于 TA")` 可见 | `<p>关于 TA</p>` | **文案一字未改** |
| `getByTestId("profile-looking")` 可见 | `<section data-testid="profile-looking">` | testid 保留 |
| `getByText(ALICE_PUBLIC_ATTRIBUTE, { exact: true })` | `AttributeTagList` 的渲染结果 | 组件调用未动 |
| `getByText("语言交换", { exact: true })` | 兴趣/目的的文本 | 未动 |
| **`getByText("暂无")` 必须为 0 个** | `aboutVisible` / `lookingVisible` 是**整段**渲染开关 | **保持「要么整段渲染，要么什么都不渲染」**，绝不能加占位符 |
| **`getByText(/Tokyo/)` 必须为 0 个**，`/Kanto/` 可见 | `place` 由 city/region/country 拼接，隐藏的字段不参与拼接 | 拼接逻辑未动 |

| 改动 | 之前 | 现在 |
|---|---|---|
| 头像 | 手写 img / 渐变 div | `TFAvatar`（`ring` + `border-4 border-white`） |
| 语言 / 兴趣 / 交友目的 / 想认识的国家 | 4 组手写 `rounded-full` span，其中「想认识的国家」是硬编码的 `#EAFBF1`/`#0E9F6E`（不在 token 里） | 全部 `TFBadge`（brand / warning / success） |
| 「打招呼」「查看动态」等 4 个按钮 | 旧组件 | `TFButton`，`aria-label="打招呼"` 保留 |
| 报错 + 重试 | 红框 + 旧按钮 | `TFErrorState` |
| 加载态 | 两个灰块 | `TFLoadingRegion` + `TFSkeleton` |

| # | 操作 | 期望 |
|---|---|---|
| F11 | 用**陌生人**账号打开 `/profile/<他人 id>` | 看到「关于 TA」；**看不到**「暂无」任何字样（隐藏的分区完全不渲染） |
| F12 | 陌生人看该页 | 只显示城市/地区中**可见**的那部分（隐藏的城市不出现在地点行里） |
| F13 | 用**已连接**账号打开同一页 | 能看到简介与连接可见的属性；**仍然看不到**仅自己可见的内容 |
| F14 | 用**本人**账号打开 | 能看到全部字段，包括仅自己可见 |
| F15 | 点「打招呼」 | 按钮变「已打招呼」或进入发送中 |
| F16 | 点「查看动态」 | 进入 `/moments/user/<id>` |
| F17 | 各标签（语言/兴趣/目的/想认识的国家） | 都是**浅底徽章**样式，颜色按类别区分（蓝/琥珀/绿） |

**`connect-panel.tsx`（交换联系方式）** —— 这是"加好友"的门槛所在，所以门槛逻辑我**一行没动**：
```ts
disabled={selected.length === 0 || acting || !state.eligible}
```

这一行是审计修过的 bug：原来 `disabled` 漏了 `!state.eligible`，所以一个写着「还需 N 条消息」的按钮**其实可以点**，只在一次往返之后才失败。标签和禁用状态现在一致。**迁移时我原样保留了这个表达式**，只把按钮换成 `TFButton`。

| 改动 | 之前 | 现在 |
|---|---|---|
| 平台选择 chip | 选中态是**渐变填充** | `TFChip`（带 `aria-pressed`）+ `border-brand-500 bg-brand-50` |
| 留言输入框 | 手写 textarea | `TFTextarea`（补齐 `htmlFor`/`id` 标签关联） |
| 「撤回我发起的请求」 | 11px 裸文字按钮 | `TFButton variant="ghost"` + 加载态 |
| 已交换的联系方式卡片 | `rounded-2xl border-line` | token 化；`select-all` **保留**（这是全屏唯一需要被复制到别处的字符串） |
| 加载态 | 两个灰块 | `TFLoadingRegion` + `TFRowSkeleton` |

**`safety-actions.tsx`（聊天安全菜单）** —— 拉黑 / 举报：

| 改动 | 说明 |
|---|---|
| 浮层定位 | 将 `fixed` 改为 `absolute`（保持在手机壳内），加 `scrim` token 和 `aria-label` |
| 举报原因 | 补上 `data-testid="chat-report-reason"` + `data-reason={item}`，**与动态举报弹窗的契约对齐**（测试用 `[data-testid="moment-report-reason"][data-reason="Spam"]` 选择） |
| 举报原因必选 | 新增：没选原因时「提交举报」**禁用**并提示「请先选择一个举报原因」（原来可以直接提交空原因） |
| `aria-pressed` | 举报原因是可选项，原来只靠边框颜色区分 |
| 拉黑按钮 | 改用 `variant="danger"`（破坏性操作用 danger 色，不再和普通主按钮同色） |

| # | 操作 | 期望 |
|---|---|---|
| E11 | 进聊天 →「🔗 交换联系方式」 | 面板打开，顶部说明「需要先聊天至少 N 条消息」 |
| E12 | 消息不够时 | 主按钮显示「还需 N 条消息」**且不可点**（这是审计修过的 bug，重点确认） |
| E13 | 选平台 | 选中的 chip 是**蓝色浅底 + 边框**（不是渐变填充）；未绑定的平台显示「· 未绑定」且半透明 |
| E14 | 不选平台 | 按钮禁用；选一个后可点 |
| E15 | 看对方发来的交换请求 | 有「拒绝」+「接受并交换」两个按钮 |
| E16 | 看**自己**发出的交换请求 | 只有「撤回我发起的请求」，**没有**接受/拒绝（方向判断是审计修过的 bug） |
| E17 | 聊天页「⋯」安全菜单 | 打开底部面板，有「举报用户」「拉黑」「取消」 |
| E18 | 「举报用户」→ 不选原因 | 「提交举报」**禁用**，下方提示「请先选择一个举报原因」 |
| E19 | 选一个原因 | 按钮可用；提交后出现结果提示 |
| E20 | 「拉黑」→「确认拉黑」 | 按钮是**红色**（破坏性操作），点击后生效 |


---

## 3. 视觉验收（brief §39 的 12 条）

打开以下页面，逐个对照。**375 / 390 / 430 三档宽度都要看，再看一次桌面（≥1024）**。

要检查的页面：`/`、`/login`、`/discover`、`/moments`、`/moments/<id>`、`/messages`、`/connections`、`/me`

| 检查项 | 判据 |
|---|---|
| 1. 第一眼层级 | 一眼能看出这一页最重要的是什么 |
| 2. Primary CTA 唯一 | 每屏**只有一个**实心蓝色按钮 |
| 3. 下一步清楚 | 不需要猜「我现在该干什么」 |
| 4. 无多余 UI | 没有纯装饰、占了位置又不提供信息的元素 |
| 5. 无重复按钮 | 同一件事只有一个入口（feed 页的「＋」和底部「＋」是**有意保留**的冗余，见 `moments/page.tsx` 注释） |
| 6. 卡片不过多 | Feed 里每条动态**不是**一张带边框阴影的卡片，而是用**细分割线**分开 |
| 7. 无视觉噪音 | 没有满屏渐变 / 厚重阴影 |
| 8. 符合 TalkFirst | 轻 / 净 / 软 / 自然 / 有社交感 |
| 9-11. 375 / 390 / 430 | **无横向滚动** |
| 12. 桌面 | 内容列 390px 居中，背景是 `#F7F9FC` 浅灰蓝，手机壳有淡阴影 |

### 3.1 横向滚动自检（最快的方法）

在每一页的浏览器控制台里贴这一行：

```js
[document.body.scrollWidth, document.body.clientWidth, document.documentElement.scrollWidth]
```

**前两个数必须相等**。如果 `scrollWidth > clientWidth`，把页面名和这三个数发我。

### 3.2 颜色一致性检查

- 全局**只有一个品牌蓝体系**（`#3B82F6` / `#2563EB`）。旧的紫色 `#6B7CFF`、`#6572D8` 应该**只在尚未迁移的页面**里残留。
- 发现残留就是在 `C–I` 阶段要清的。**如果你看到某个页面里紫色和蓝色混在一起，请告诉我是哪一页**，那说明我漏了一个 caller。
- 已知本阶段仍保留紫色的页面（**预期内，不算 bug**）：登录/注册/验证码/Onboarding 全部、Discover 的筛选 tab、动态详情、聊天、Profile、通知。这些是 Phase C/D/E/F/G 的范围。

---

## 4. 逐页功能用例

### 4.1 启动页 `/`

| # | 操作 | 期望 |
|---|---|---|
| P1 | 打开 `/` | 气泡 motif（两个浅蓝圆角方块）+ 品牌蓝 Logo + TalkFirst + tagline |
| P2 | 未登录时刷新 | **不重定向**到 `/login`（这是公开页） |
| P3 | 缩放窗口到 320px 宽 | 「开始」按钮**在首屏可见**（旧版 hero 高 430px，在 320×568 上把按钮推到折叠线下了，我已删掉那个 hero） |
| P4 | 隔一秒再打开一次 | **没有入场动画**（brief 要求不要复杂动画；只有按钮有按下反馈） |

### 4.2 底部导航（每一页都要看）

| # | 操作 | 期望 |
|---|---|---|
| T1 | 在 `/moments/compose` | 中间 ＋ 高亮（`aria-current="page"`） |
| T2 | 有未读消息时 | 「消息」图标右上角有**浅蓝色**小数字徽章（不是红色；红=错误，未读消息不是错误） |
| T3 | 未读数 > 99 | 显示 `99+` |
| T4 | 用键盘 Tab 遍历 | 每个 tab 都有**可见焦点环** |
| T5 | 用读屏（或看 DOM） | 每个 tab 有可访问名称；有未读时名称含「N 条未读」 |
| T6 | 进任意二级页 → 点底部 tab | 能正常切换（客户端路由，不整页刷新） |

### 4.3 Feeds：`/moments`

| # | 操作 | 期望 |
|---|---|---|
| F1 | 打开 | 顶部「首页」+ 副标题 + 右侧两个圆形按钮（设置 / 蓝色 ＋） |
| F2 | 点「设置」 | 进 `/moments/settings` |
| F3 | 点蓝色 ＋ | 进 `/moments/compose` |
| F4 | 切「我的」tab | 只看到自己的动态；没有则显示空状态 |
| F5 | 空状态 | 有图标 + 一句话 + **一个** CTA「去发布」 |
| F6 | 切「关注」tab 且无数据 | 空状态文案变成关注相关 + CTA「去发现」 |
| F7 | 点平台筛选 chip | 选中态是**蓝色浅底 + 边框**（不是整块蓝渐变填充）；可再点一次取消 |
| F8 | 点某条动态的图片/正文 | 进 `/moments/<id>` 详情 |
| F9 | 点赞 | 心形变红、数字 +1、**有 aria-pressed** |
| F10 | 点赞时断网 | 顶部出现**可关闭的红色提示条**，**feed 不会消失**（这是之前修过的 bug，重点确认） |
| F11 | 点「评论」 | 展开评论区；再点收起 |
| F12 | 自己的动态 → 删除 | 弹 `window.confirm`（**注意：这里仍是浏览器原生 confirm**，统一成自绘弹窗排在后面阶段） |
| F13 | 分享 | 复制链接，按钮旁出现「已复制」 |
| F14 | 「加载更多」 | 出现时点击追加下一页；点完变「加载中…」并禁用 |
| F15 | 加载失败（可停 API 模拟） | 出现「加载失败」+ 「重试」，重试能恢复 |
| F16 | 首次加载中 | 看到**骨架屏**（头像圆 + 文字条 + 图片块），不是空白 |

### 4.4 Discover `/discover`（本阶段未重做，做基础回归即可）

| # | 操作 | 期望 |
|---|---|---|
| D1 | 打开 | 气泡墙正常渲染、能点 |
| D2 | 点某气泡 | 打开资料卡 |
| D3 | 关闭资料卡 | 能关闭 |
| D4 | 注意「今日剩余 N」 | 每点开一个资料卡，N **减 1**（这是我上一轮补的功能，之前两个客户端都不调用那个接口） |

### 4.5 登录以后的所有页面（都要能进）

| 路由 | 期望 |
|---|---|
| `/discover` | 正常 |
| `/moments` | 正常 |
| `/moments/compose` | 正常（**这是设计基准，不应被改动**） |
| `/messages` | 正常 |
| `/connections` | 正常 |
| `/notifications` | 正常 |
| `/me` | 正常（重点，见 §2.4） |
| `/me/edit`、`/me/interests`、`/me/attributes`、`/me/visibility`、`/me/password`、`/me/social`、`/me/safety` | 都能进 |
| `/profile/<某用户id>` | 正常 |

**任何 404 或白屏都请记下来。**

---

## 5. 键盘 / 无障碍快速检查

| # | 操作 | 期望 |
|---|---|---|
| A1 | 只用 Tab 键走一遍登录页 | 每一步都有**清晰的蓝色焦点环**（这是本轮新加的全局 `:focus-visible`） |
| A2 | 鼠标点击按钮 | **不**留下焦点环（`:focus:not(:focus-visible)` 生效） |
| A3 | 在 `/me` 的注销弹窗里 | 焦点被**限制在弹窗内**；Esc 可关；关闭后焦点**回到触发按钮** |
| A4 | 弹窗打开时滚动页面 | 背景**不滚动**（滚动锁定） |
| A5 | 系统开启「减少动效」 | 骨架屏**不再脉冲**、过渡基本消失（这是本轮新加的全局兜底） |
| A6 | 底部导航 | 每个 tab 都有 `aria-label`；图标是 `aria-hidden` |
| A7 | 图片 | 装饰性头像 `alt=""`；内容图片有描述性 alt |

---

## 6. 怎么把项目跑起来

### 6.0 ⚠️ 一条命令跑完全部验证（**先看这里**）

```bat
cd /d "D:\文件\网站\TalkFirst"
scripts\verify.bat
```

它会按**最快失败优先**的顺序跑完整道闸门，把全部输出写进 `scripts\verify-report.txt`，最后打印一个汇总。**每一步失败都不会跳过后续步骤** —— 所以跑一遍就能看到所有坏掉的地方，而不是一次一个。

顺序：

| # | 步骤 | 为什么在这个位置 |
|---|---|---|
| 1a | **检查器自测**（`test:contracts:selftest`） | 这三个检查器**从来没有被执行过**。自测用已知正确 / 已知错误的代码片段喂给它们，先证明**检查器本身能用**。这一步失败 = 我的脚本错了，不是你的代码错了 |
| 1b | **静态契约**（`test:contracts`） | 查 `tsc` 和 `next build` **查不到**的东西（见 §6.5）。跑得最快，所以排在最前：如果它报错，后面的输出多半是噪音 |
| 2 | `typecheck`（全部 workspace） | |
| 3 | `lint`（全部 workspace） | |
| 4 | `test:static`（API jest + web/admin 冒烟） | **注意是 `test:static` 不是 `test`**，原因见下 |
| 5–7 | build web / build api / build admin | |
| 8 | E2E（**可选**） | 需要 API + Postgres + Playwright 浏览器 |

#### 默认步骤**不需要数据库**（这一点我核实过，不是假设）

`scripts\verify.bat` 的 1a–7 全部**不连数据库**：

| 步骤 | 为什么不连库 |
|---|---|
| 1a / 1b 静态契约 | 纯读源码文本 |
| typecheck / lint | 纯静态分析 |
| `test:static` | **`grep "new PrismaClient" apps/api` 零命中** —— 整个 API 测试套件跑的是**mock 的 Prisma**；web/admin 的 `node:test` 只读源码字符串 |
| build web / api / admin | Next 的静态生成与 `nest build` 都不开数据库连接 |

**只有第 8 步（E2E）需要 Postgres**，因为 Playwright 的 fixture 会直接连 `localhost:5433`。

> ⚠️ **注意 5432 / 5433 的分工**（这是仓库的既有设计，不是 bug）：`.env` 里 `DATABASE_URL` 指向 **5433** —— 那是 `start-local-dev.bat` 管理的**项目本地** PostgreSQL（数据在 `.local-data/pgdata`）。Docker Compose 默认映射 **5432**。`.env.example` 写 5432、`.env` 写 5433，两者的差异在 `.env` 第 22 行有注释说明，`docs/AUDIT-2026-09-17.md` 也记录过。**如果你要跑 E2E，先跑 `start-local-dev.bat` 把 5433 起起来。**


要把 E2E 也带上：

```bat
set VERIFY_E2E=1 && scripts\verify.bat
```

#### ⚠️ `npm run test` 会意外地需要数据库（本轮修掉的一个坑）

`apps/admin/package.json` 的 `test` 脚本把 `playwright test` **串在了冒烟测试后面**：

```json
"test": "node --test ./test/smoke.test.mjs ... && playwright test"
```

所以根目录的 `npm run test`（`--workspaces`）会去跑 admin 的 Playwright —— **需要浏览器和一套活的 API + Postgres**。在一个只想跑单测的人手里，它会以一个和本次改动毫无关系的理由失败。

本轮的处理：
- 给 web / api / admin 各加了一个 **`test:static`**（只跑不依赖数据库的那一层），根目录也加了聚合的 `test:static`
- `verify.bat` 改用 `test:static`
- `test` / `test:e2e` 保持原样（不动既有行为）

### 6.1 先重启 DSH（重要）

本会话结束时 shell 仍是坏的。**重启 DSH 后新开会话**，我才能构建/测试。如果重启后我仍然没有 shell，请把下面这条命令的输出发我：

```bat
pwsh -Command "echo ok"
```

### 6.2 本地直跑（推荐，最快）

```bat
cd /d "D:\文件\网站\TalkFirst"
start-local-dev.bat
```

这个脚本会**先构建 API** 再启动（原来的 `start-local.bat` 直接跑 `node dist/main.js`，而 `dist/` 是提交进仓库的旧构建产物 —— 这就是"修好了但重启后还在"的原因）。

三个地址：Web `http://localhost:3000/`、Admin `http://localhost:3001/login`、API 健康检查 `http://localhost:4000/api/v1/health`。

### 6.3 Docker（你提到有 Docker）

```bat
cd /d "D:\文件\网站\TalkFirst"
scripts\docker-up-local.bat
```

**注意**：默认的 `.env.docker.example` 会让容器**崩溃循环**（`NODE_ENV=production` + `MAIL_PROVIDER=console` → 邮件配置校验失败）。我新加的 `.env.docker.local` 修好了这一对配置，脚本会自动用它生成 `.env.docker`。

### 6.4 一键验证

```bat
cd /d "D:\文件\网站\TalkFirst"
scripts\verify.bat
```

它一次跑完 typecheck → lint → test → build（**任何一步失败也继续跑完**），结果写到 `scripts\verify-report.txt`。**把这个文件发我**，我就能定位所有问题。

### 6.5 静态契约检查（1 秒，建议在 E2E 之前跑）

```bat
npm run test:contracts -w @talkfirst/web
```

这个命令跑**两个**脚本。

#### (a) `scripts/static-contract-check.mjs` —— 选择器与主题契约

专查**类型检查和打包都发现不了、但界面真的坏了**的问题：

| 检查 | 为什么必须单独查 |
|---|---|
| **E2E 用到的每一个 `data-testid` 在 src 里是否还存在** | 这是 UI 重构最容易静默打破的契约。构建通过、页面能开，但 Playwright 点不到按钮。它会列出「哪个 spec 要哪个 testid，而没有任何组件渲染它」 |
| **`@/components/tf` 的 import 是否都在 `index.ts` 里导出** | 漏一个导出就是运行时报 undefined |
| **每个 `bg-*` / `text-*` / `rounded-*` / `shadow-*` 是否真的存在于主题里** | `bg-brand-550` 这种拼错 Tailwind 会**静默丢弃**，界面变成灰的，构建完全正常 |
| **是否又有 `fixed inset-0` 浮层逃出手机壳** | 见 §2.3。桌面宽度下会糊满整个窗口 |
| **每个 `page.tsx` 是否还有 default export** | 漏掉就是该路由 500 |

单独跑：`npm run test:contracts:selectors -w @talkfirst/web`

#### (b) `scripts/jsx-balance-check.mjs` —— JSX 标签配平

**这是我为自己反复犯的一个错误写的工具。** 我在编辑时多次出现「一个标签打开了没关」或「关错标签」——在 Markdown 里代价是标题错位（见 §0.5），在 TSX 里代价是 **React 19 下该路由直接运行时崩溃**，而构建阶段不一定会报。

它做的事：跳过字符串 / 模板字符串 / 注释之后，用一个栈逐个文件跟踪 JSX 标签，报告：

- 关闭标签没有对应的开启标签
- 关闭标签与最内层开启标签**名字不匹配**（并指出是哪一行开的）
- 文件结束时还有标签没关
- 箭头函数 `=> (` 被当成标签（**这个我特意排除了**）

**它是故意保守的**：凡是它无法确定的地方（泛型 `useState<Foo>(`、字符串里的 HTML、Fragment）一律跳过而不是猜。**宁可漏报也不误报** —— 一个假的"标签不平衡"会让人学会忽略这个工具。

单独跑：`npm run test:contracts:jsx -w @talkfirst/web`

#### (c) `scripts/tf-prop-check.mjs` —— 原语未声明的 prop

**这是为「4 处编译错误」写的那把钥匙。** 有四次，某个页面往 `tf/*` 原语上传了一个该原语**根本没声明**的属性——因为原语的 props 是**封闭对象类型**而不是 `HTMLAttributes`：

| # | 原语 | 缺的属性 |
|---|---|---|
| 1 | `TFAvatar` | `alt` 被展开到 `<span>` 上 |
| 2 | `TFBadge` | `title` |
| 3 | `TFCard` | `data-testid` |
| 4 | `TFChip` | `title` |

`tsc` 一次就能把这类错误全列出来。没有编译器时，我只能**一轮找一个**。这个脚本把这一步自动化：它从 `components/tf/*.tsx` 读出每个原语声明的 prop 名，再检查 `src/` 里每一个 `<TF…>` 调用点传的属性。

**它诚实的局限**（我写进了脚本头部注释）：
- 原语的 props 有两种写法：内联对象（`button.tsx` / `display.tsx`）和 `{…} & Omit<HTMLAttributes<…>>`（`button.tsx` / `field.tsx`）。第二种意味着真实可用属性 = 声明的键 **+ 整个 DOM 属性集**，而脚本读不到 `lib.dom.d.ts`。所以它对一批 DOM 属性名（`DOM_ATTRIBUTES`）直接放行。
- 结果是**它是收窄工具，不是证明**：像 `classNam` 这种拼错的伪 DOM 名它会漏掉。它的作用是抓「原语压根没这个属性」这一类——也就是真的发生过四次的那一类。

单独跑：`npm run test:contracts:props -w @talkfirst/web`

#### 三个脚本一起

```bat
npm run test:contracts -w @talkfirst/web
```

也都接进了 `npm run test:all -w @talkfirst/web`（先契约后单测）。

#### (d) `--self-test`：检查器自测（**这三个脚本从来没跑过，所以这一步是必要的**）

```bat
npm run test:contracts:selftest -w @talkfirst/web
```

三个检查器**在本会话中一次也没有被执行过**。在它们从未运行的前提下，"检查通过"和"检查器什么都没检查"是分不清的。所以每个脚本现在都有一个 `--self-test`：用**已知正确**和**已知错误**的代码片段喂给它的核心函数，断言它该报的报、该放过的放过。

自测覆盖的都是**真实踩过的坑**，不是一个玩具集合。例如：

| 自测项 | 为什么必须有 |
|---|---|
| `=> (` 不被当成标签 | 这是我在写扫描器时第一个误报。不修，全站每个箭头函数都会被报错，这个工具就会被人忽略 |
| `a < b` 不被当成标签 | 同上 |
| `useState<Record<string, string>>` 不被当成标签 | 泛型 |
| `bg-[#EFF6FF]` 不被当成未知颜色 | 任意值是 Tailwind 原样输出的，不该报 |
| `shadow-brand` 不被当成颜色 | `brand` 既是颜色刻度又是阴影名，两者冲突 |
| `outline-none` / `border-2` / `divide-x` 不被当成颜色 | 和颜色族共用前缀的非颜色工具类 |
| **检测**「标签没关」 | 真实错误类：React 19 下该路由运行时崩溃 |
| **检测**「关闭标签不匹配」 | 同上 |
| **检测**「原语未声明的属性」 | 真实错误类：5 个编译错误都属于这一类 |
| **检测**「拼错的属性名」 | 同上 |

**自测失败时脚本会明确说**：`THE CHECKER IS WRONG, not your code.` 并退出 1。这样你永远不会把"我的解析器坏了"误读成"我的代码有 42 个问题"。

> 写自测的过程本身抓到了我一个错误：我最初断言 `checkColourUtility("shadow-brand")` 应该返回 `null`，但**阴影是在调用方拦掉的**（`shadow-*` 先被匹配并 `continue`，根本不会走到那个函数）。我的断言期望一个这个函数并不提供的保证。已改为在正确的位置测试阴影守卫，并在源码里写明原因。

> 诚实说明：**这三个脚本我都没有运行过**（我的 shell 是坏的）。它们经过静态复核，并针对性修掉了已知会误报的缺陷：
> - `static-contract-check`：`shadow-*` 被当成颜色、`outline-none` 被当成颜色、解析颜色刻度时只认 `:` 不认 `=` 导致检查静默失效
> - `jsx-balance-check`：`=> (` 被当成标签、比较运算符 `<` 被当成标签开头
> - `tf-prop-check`：DOM 属性放行清单（见上）、以及把 `tone = "default"` 这类默认值正确解析成属性名
>
> **如果它们报出一堆明显不对的东西，那是我的解析器有问题，不是你的代码有问题** —— 把输出发我，我先修脚本。反过来，如果它们**什么都没报**而 `next build` 失败，说明我的检查覆盖不到那个错误类别，也请告诉我。



---

## 7. 出问题时请这样反馈

按这个格式给我，我能直接定位：

```text
页面: /me
操作: 点击「我的连接」
期望: 进入 /connections
实际: 白屏 / 控制台报 xxx
控制台错误: <原文粘贴>
宽度: 390px
```

**特别有用**的三样东西：

1. `scripts\verify-report.txt`（构建/测试结果）
2. 浏览器的**红色控制台报错原文**
3. 白屏页面的**网络面板**里失败请求的 URL + 状态码

---

## 8. §2.4 之外我改过但你可能想知道的细节

| 改动 | 位置 | 为什么 |
|---|---|---|
| 全局品牌色从紫 `#6B8CFF` 改成蓝 `#3B82F6` | `globals.css` 的 `.tf-gradient` | 34 个 caller 共用这一个类。留着紫色的话，手机壳和底部导航变蓝了而按钮还是紫的，会出现**两个互相竞争的品牌色** |
| **19 处硬编码紫色**改成品牌蓝 | 见下表 | `.tf-gradient` 改不到它们；不改就会蓝紫并排 |
| 滚动条颜色改蓝 | `globals.css` `.tf-scroll` | 同上 |
| `Wordmark` 不再渲染 `<h1>` | `components/brand.tsx` | 它原来是启动页唯一的标题，导致可访问名是三行不同字号的拼接。现在启动页自己的 `<h1>` 承载 slogan |
| `ScreenHeader` 返回键 36px → **44px** | `components/screen-header.tsx` | 全站最高频的控件，36px 在手机上必然点空（拇指底线 44px） |
| 页面标题字号 16px → 17px + 半粗 | 同上 | 原来和正文一样大，没有层级 |
| `PhoneShell` 圆角 32px → `rounded-frame`(32px)，底色 → `surface-canvas` | `components/phone-shell.tsx` | 几何**未变**，9 个路由的滚动依赖它 |
| Feed 每条动态：去掉边框/阴影/圆角 | `app/moments/page.tsx` | brief 明确要求「不要每条动态都放厚重卡片」 |
| Feed 正文 13px → **15px** | 同上 | 这是整个产品存在的理由（内容），却和周边 meta 同字号 |
| 点赞按钮加 `aria-pressed` | 同上 | 它是 toggle，读屏原来无法知道当前状态 |
| 评论「加载失败」不再伪装成「还没有评论」 | `app/moments/page.tsx`、`app/moments/user/[id]/page.tsx` | 上一轮修的 bug |
| `moment-comments` / `moment-report-dialog` 的 `fixed inset-0` → `absolute` | 两个组件 | 见 §2.3 |

### 8.1 被改成蓝色的 19 处（请重点看这些页面，确认没有"半蓝半紫"）

| 页面 / 组件 | 改了什么 |
|---|---|
| 聊天页 `/messages/<id>` | **发出的消息气泡**：紫渐变 → 蓝渐变（这是最显眼的一处） |
| 动态详情 `/moments/<id>`、某人动态 `/moments/user/<id>` | 无头像时的**头像底色**：紫渐变 → 纯品牌蓝 |
| 验证码 `/verify` | 已填数字的格子**边框**：紫 → 蓝 |
| 登录 / 注册 / 忘记密码 | 「忘记密码？」「立即登录」「返回登录」三个链接：紫 → 蓝 |
| 通知中心 | **未读圆点**：紫 → 蓝 |
| 发现页 `/discover` | 「今日剩余 N」徽章：淡紫底+紫字 → 淡蓝底+蓝字 |
| Onboarding 语言 / 国家 / 交友目的 | **选中态**（边框+底色+加粗）：紫 → 蓝 |
| `/me/interests` | 学习中语言的**选中态**：紫 → 蓝 |
| 举报弹窗（动态与聊天两处） | **选中理由**的边框底色：紫 → 蓝 |
| 发布动态页的可见范围选择 | **选中项**的边框底色：紫 → 蓝 |

> **有意保留的紫色**：Onboarding 头像页的 6 个颜色预设、`avatarColor()` 的 6 色调色板（这是**用户可选的颜色本身**，不是品牌色）、以及各社交平台的品牌色。看到这些是正常的。
>
> **仍未迁移的浅紫**（`#6572D8`、`#F1F3FF` 等，约 60 处）属于后续阶段：Feed 里点进详情、通知、聊天、Profile 等页面时，**浅紫底 + 紫字**的组合仍会出现。这是**已知的、计划内的**，不是 bug。判断标准：**如果同一屏里出现了饱和的旧紫（渐变紫、`#6B8CFF`）和品牌蓝并排，那是 bug；如果只是浅紫底配紫字，那是待迁移。**

---

## 9. 还没做的（后续阶段范围，测试时可以忽略）

| 阶段 | 范围 | 现状 |
|---|---|---|
| C | Auth + Onboarding | ✅ **基本完成**：`/login`、`/register`、`/verify`、`/reset`、`/legal`、`/register/success`、`/onboarding/*`（全部 8 步）、`/me/social` 都已重做。整个 `app/onboarding/` 已零引用旧组件 |
| D 剩余 | Discover 页重做（气泡墙保留）、动态详情、某人动态 | ✅ **全部完成**（§2.10 + §2.11）。Phase D 收尾 |
| E | 消息列表 / 聊天 / 连接 / 交换联系方式 | ✅ **完成**（§2.12 + §2.13）：`/messages`、`/messages/<id>`、`/connections`、`panels.tsx`、`connect-panel.tsx`、`safety-actions.tsx` 全部迁移 |
| F | Profile / Me 其余子页 / Settings | ✅ **完成**：`/me`、`/me/edit`、`/me/password`（§2.14）、`/profile/[id]`（§2.15）、`/me/visibility`（§2.16）、`/me/interests`（§2.17）、`/me/attributes`（§2.18）、`/moments/settings`（§2.19）全部迁移。Phase H 的 `/me/safety` 另计 |
| G | 通知 / 搜索 / 话题 | 🔶 **通知中心已完成**（§2.20）。**搜索与话题确认无法实现** —— API 层不存在对应接口（见 §2.22），需要你先做产品决定 |
| H | 安全中心 / 举报 / 拉黑 | ✅ **完成**：`/me/safety`（§2.21）+ 聊天内安全菜单（§2.13） |
| I | Admin 后台 | 🔶 **token 收敛完成**（§2.23，63 → 10 处 hex）。逐页视觉迁移**刻意未做**，理由见该节。**唯一未收尾项**：`compose` 的 1 个 `GradientButton` → 需你决定是否改动设计基准页（§0.7） |
| — | 验证基建 | ✅ **已补齐**：`scripts\verify.bat` 先跑检查器自测、再跑静态契约，然后 typecheck/lint/test:static/build×3，E2E 可选（§6.0） |
| — | 静态核对（无 shell 时代替方案） | ✅ **已手工执行四项**：旧声明全量扫描（§0.7，活跃文件 0 处）· 主题类名存在性核对（§0.8，无缺口）· 路由可达性核对（§0.9，36 路由 0 孤儿）· **测试断言一致性核对（§0.10，抓到并修掉 1 个真实测试失败）**。**仍未被执行的是编译与测试** |

### 9.1 需要你决定的产品问题（我不能替你决定）

1. **法律文件缺失（优先级最高）**。`/legal` 现在诚实地说明了这点，但**《用户协议》和《隐私政策》的正文在代码库里不存在**。一个收集语言、国籍、性别、生日、位置和私人聊天记录的产品，没有隐私政策，在欧盟/英国/加州都是实质合规风险。需要你（或法务）提供正文，我可以在拿到内容后做成 `/terms` 和 `/privacy` 两个路由，并把 `/legal` 的勾选项接上真实链接。
2. **社区规则 / 关于我们 / 搜索 / 话题页都不存在**。`/register` 写了「注册即表示同意社区规则」，同样没有正文。
3. **`/onboarding/social` 要不要真的能绑定**。我把它改成了"说明 + 完成"，绑定放在引导之后。如果你希望引导里就能绑定，需要先决定"绑定后回到哪一步"（现在是 `/moments/settings` → 返回 `/me`，会把用户带出引导流程）。

### 9.2 已知且**有意保留**的旧实现（不算 bug）

- Feed 删除动态仍用 `window.confirm`（应统一成 `TFDialog`）
- 评论区有 3 处仍未迁移的 `rounded-full` 手写输入框
- `components/ui.tsx` 的 `Field` 仍被 `/me/edit`、`/me/password` 使用。它用 `<span>` 当标签（无 `htmlFor`），所以那 2 个页面的输入框仍然没有程序化标签 —— 迁移它们时一并换成 `TFInput`
- `components/ui.tsx` 现在**只剩 1 个文件**在用：`app/moments/compose/page.tsx`（一个 `GradientButton`，**设计基准页，刻意保持不动**）。`Field` / `SmallButton` / `OutlineButton` 均已零调用点，**Phase I 之后可以整体删除这个文件**。

  > **一个我要更正的数字**：前几轮我报过「还剩 3 个 / 4 个 / 5 个文件」，那一串数字里 `notification-center.tsx` 被算了两次（它早就迁走了，我没核对就照抄了上一次的清单）。教训和 §0.3 那 5 个编译错误同源：**我没有把"数一遍"当成一次需要证据的动作。** 现在这条结论来自 `grep 'from "@/components/ui"'` 的**原始输出**，不是记忆。
- 已迁移完的区域：`app/onboarding/`（全部 8 步）、`app/login`、`app/register`、`app/reset`、`app/register/success`、`app/legal`、`app/verify`、`app/page.tsx`、`app/me/`（`page`/`edit`/`password`/`visibility`/`interests`/`social`）、`app/profile/[id]`、`app/moments/page.tsx`、`app/moments/[id]`、`app/moments/user/[id]`、`app/discover`、`app/messages/`（全部）、`app/connections`、`components/{tab-bar,phone-shell,screen-header,brand,discover-avatar-bubble,discover-bubble-field,profile-preview-card,moment-comments,moment-report-dialog,notification-item,visibility-select}`

**已修掉、不再是遗留问题**：
- 验证码页 320px 溢出、头像页假颜色选择器、`/me/social` 死胡同 —— 见 §2.6
- 登录/注册页输入框缺少 `autoComplete`（密码管理器无法填充）、第三方登录按钮"看着能点其实不能" —— 见 §2.7
- 协议页要求同意两份点不开的文件、两个"完成"页的装饰与文案、`/onboarding/social` 的 6 行假状态、忘记密码页缺程序化标签 —— 见 §2.8
- 引导流程 5 个表单页缺程序化标签 / 选中态只靠颜色 / 性别选项无 `aria-pressed` / 骨架屏不可访问 —— 见 §2.9
- Discover 的配额条无语义角色、筛选选中态用渐变、气泡骨架不响应 reduced-motion —— 见 §2.10
- 动态详情点赞无 `aria-pressed`、头部返回键只有 36px、锁定态被画成错误色 —— 见 §2.11
- 聊天页连接状态用 `emerald/amber` 原色、加载骨架不可访问、消息页会话一条一个边框卡片 —— 见 §2.12
- 交换面板的门槛逻辑（`disabled` 漏了 `!state.eligible` 导致「还需 N 条」可点）与举报无原因可提交 —— 见 §2.13
- `/me/edit` 六个字段无程序化标签、性别选项无分组名；`/me/password` **按 Enter 不提交**、成功提示渲染布尔值（显示为空）—— 见 §2.14
- `/profile/[id]` 头像与 4 组标签是手写实现，其中「想认识的国家」用了**不在 token 里的硬编码色** `#EAFBF1`/`#0E9F6E` —— 见 §2.15
- `/me/visibility` 三档选择器选中态用渐变填充；**`TFCard` 不接受 `data-testid`**（会编译不过，已修）—— 见 §2.16
