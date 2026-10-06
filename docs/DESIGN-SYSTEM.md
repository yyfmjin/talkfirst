# TalkFirst Design System & 全站 UI/UX 重构计划

> 状态:**Phase A 已实施**。Phase B-I 待执行。
> 本轮范围:Design System(tokens + 原语)+ 页面地图 + PC-3.6 视觉规范提取。
> **未改动任何现有页面**--Phase A 的可验证性依赖于"页面上一个像素都没变"。

---

## 0. 唯一的设计基准:PC-3.6「发布动态」

`apps/web/src/app/moments/compose/page.tsx`(913 行)是全站视觉与交互的参考标准。它之所以成为基准,是因为它把"一个页面只做一件事"落到了结构上:

| 结构 | 做法 | 反面(其他页面的现状) |
|---|---|---|
| 身份 + 可见范围 | 一行,头像 44px + 昵称 + 一枚可点的可见范围 chip | 三张卡片,字段散落 |
| 正文 | **无边框** textarea,`text-[15px] leading-7`,随内容长高,滚动越过 220px 上限 | 包在边框盒子里 |
| 媒体 | 直接选文件(禁止 URL 输入),1/2/3/4/5+ 自动网格,每格带 上传中/成功/失败+重试 覆盖层 | 一个裸 URL 输入框 |
| 附加信息 | 话题 / 位置 都是 **pill 按钮**,点了开 sheet | 常驻表单区 |
| CTA | 底部 sticky 单按钮,`env(safe-area-inset-bottom)`,内容区独立滚动 | 页面底部跟着滚的按钮 |
| 放弃保护 | 有未发布内容才拦截返回(`beforeunload` + 自绘 dialog) | 无保护 |

**这四条是它的精髓,也是全站要复用的东西:**
1. **一条连续纵列**,不是卡片叠卡片。
2. **边框 + 背景分层** 代替 阴影分层。
3. **次要操作收进 sheet / pill**,不在页面上常驻。
4. **一个 sticky 主 CTA**,全屏只有它一个 primary。

---

## 1. 当前页面地图

### 1.1 用户端(`apps/web`)- 35 个路由

| 分组 | 路由 | 文件 | 现状 | 目标 Phase |
|---|---|---|---|---|
| **启动** | `/` | `app/page.tsx` | 渐变 hero + SVG 山形 + 一个开始按钮 | B |
| **认证** | `/login` | `app/login/page.tsx` | 邮箱密码 + Google/Apple 占位 | C |
| | `/register` | `app/register/page.tsx` | 同结构 | C |
| | `/register/success` | `app/register/success/page.tsx` | 成功页 | C |
| | `/verify` | `app/verify/page.tsx` | 6 格 OTP(320px 下会溢出) | C |
| | `/reset` | `app/reset/page.tsx` | 忘记密码(本轮新增) | C |
| | `/legal` | `app/legal/page.tsx` | 两个 checkbox(条款文本不可点开) | C |
| **Onboarding** | `/onboarding/avatar` | `app/onboarding/avatar/page.tsx` | 颜色预设**不落库** | C |
| | `/onboarding/profile` | `app/onboarding/profile/page.tsx` | 昵称/生日/国家/城市/性别 | C |
| | `/onboarding/interests` | `app/onboarding/interests/page.tsx` | chip 选择 | C |
| | `/onboarding/languages` | `app/onboarding/languages/page.tsx` | 母语 + 学习中 | C |
| | `/onboarding/purposes` | `app/onboarding/purposes/page.tsx` | 多选 | C |
| | `/onboarding/countries` | `app/onboarding/countries/page.tsx` | 多选 | C |
| | `/onboarding/social` | `app/onboarding/social/page.tsx` | **空转步骤**(6 个静态行) | C |
| | `/onboarding/complete` | `app/onboarding/complete/page.tsx` | 完成页 | C |
| **核心循环** | `/discover` | `app/discover/page.tsx` | **Avatar Bubble Wall**(保留)+ filter tabs + 配额 | D |
| | `/profile/[id]` | `app/profile/[id]/page.tsx` | 完整资料(5 个 `rounded-3xl` section) | F |
| | `/connections` | `app/connections/page.tsx` | 连接列表 | E |
| **动态** | `/moments` | `app/moments/page.tsx` | Feed(tab + 平台 pill + 每卡 `rounded-3xl`) | D |
| | `/moments/[id]` | `app/moments/[id]/page.tsx` | **动态详情**(已含评论/回复/分页/举报) | D |
| | `/moments/user/[id]` | `app/moments/user/[id]/page.tsx` | 某人动态 | D |
| | `/moments/compose` | `app/moments/compose/page.tsx` | **设计基准,不回滚** | - |
| | `/moments/settings` | `app/moments/settings/page.tsx` | 平台绑定 + 隐私开关 | F |
| **消息** | `/messages` | `app/messages/page.tsx` | 请求 + 通知预览 + 会话 | E |
| | `/messages/[id]` | `app/messages/[id]/page.tsx` | 聊天(含"加载更早的消息") | E |
| | `/messages/[id]/connect` | `app/messages/[id]/connect/connect-panel.tsx` | **联系方式交换** | E |
| | `/notifications` | `app/notifications/page.tsx` | 通知中心(全部/互动/系统) | G |
| **我的** | `/me` | `app/me/page.tsx` | 资料卡 + 8 个入口(含登出/注销) | F |
| | `/me/edit` | `app/me/edit/page.tsx` | 8 字段表单 | F |
| | `/me/attributes` | `app/me/attributes/page.tsx` | 交友属性(sheet + picker) | F |
| | `/me/interests` | `app/me/interests/page.tsx` | 4 段设置 | F |
| | `/me/visibility` | `app/me/visibility/page.tsx` | 13 行逐字段可见性 | F |
| | `/me/password` | `app/me/password/page.tsx` | 改密 | F |
| | `/me/social` | `app/me/social/page.tsx` | **死胡同**(无链接) | F |
| | `/me/safety` | `app/me/safety/page.tsx` | 拉黑 + 我的举报 | H |
| **其他** | `/admin` | `app/admin/page.tsx` | 跳转说明页(唯一无滚动容器) | - |

**缺失的页面(不存在)**:Search、Topics、Settings 二级页、Community Guidelines、About。

### 1.2 Admin(`apps/admin`)- 16 个路由

`/login`、`/dashboard`、`/users`、`/users/[id]`、`/reports`、`/reports/[id]`、`/moderation`、`/moderation/[id]`、`/risk`、`/connections`、`/connections/[id]`、`/exchanges`、`/exchanges/[id]`、`/blocks`、`/blocks/[blockerId]/[blockedId]`

Admin **不使用 PhoneShell**,保持 SaaS 布局(Sidebar → Header → Content),Phase I 处理。它已有一套自己的 token(`admin/tailwind.config.ts`,10 色 + 5 圆角 + 3 阴影),但**与用户端同名不同值**(`ink` `#171A1F` vs `#1C2740`,`rounded-2xl` 12px vs 16px)。Phase I 的目标不是把它改成 PhoneShell,而是让两者共用同一份 token。

### 1.3 组件清单

**现有共享组件**(`apps/web/src/components/`,19 个)

| 文件 | 作用 | Phase A 去向 |
|---|---|---|
| `ui.tsx` | `GradientButton` / `OutlineButton` / `SmallButton` / `Field` | → `TFButton` / `TFField`+`TFInput`,逐页替换 |
| `screen-header.tsx` | 页面头(返回 + 标题 + 右侧 action) | 保留,改用新 token |
| `phone-shell.tsx` | 手机壳(`sm:w-[390px]`) | 保留,圆角改 `frame` |
| `tab-bar.tsx` | 底部 5 tab 导航 | 保留结构,改 token + 未读点为"轻蓝点" |
| `brand.tsx` | `LogoMark` / `Wordmark` | 保留 |
| `attribute-tags.tsx` | 属性 chip 列表 | → `TFChip` |
| `visibility-select.tsx` | 三档可见性 | → `TFTabs`/`TFChip` |
| `notification-item.tsx` / `notification-center.tsx` | 通知 | → `TFListRow` + `TFBadge` |
| `moment-comments.tsx` | 评论线程(含删除确认) | → `TFTextarea` + `TFDialog` |
| `moment-report-dialog.tsx` | 举报 | → `TFSheet` + `TFChip` |
| `profile-preview-card.tsx` | 资料卡(底部 sheet) | → `TFSheet` + `TFAvatar` |
| `discover-avatar-bubble.tsx` / `discover-bubble-field.tsx` | 气泡墙 | **保留自有动画**,改 token |
| `admin-entry.tsx` | 后台入口 | → `TFBadge` |
| **新增** `tf/*` | 14 个原语(Phase A) | ← 本阶段交付 |

---

## 2. PC-3.6 视觉规范提取 → Design Tokens

### 2.1 颜色

```text
品牌蓝(只用于 Primary CTA / active / link / selected)
  brand-50  #F5F9FF    brand-100 #EAF3FF    brand-200 #D6E6FF
  brand-300 #B3D1FE    brand-400 #7BAAF9
  brand-500 #3B82F6  ← 主色(CTA)
  brand-600 #2563EB  ← hover/pressed
  brand-700 #1D4ED8

社交层紫(连接/交换/动态强调--让"已连接"和"主要操作"能用颜色区分)
  accent-50 #F4F2FF    accent-100 #EBE7FF    accent-300 #B9AEF7
  accent-500 #7C6CE5   accent-600 #6A58D8

状态
  success 50/100/500/600/700    #ECFDF3 #DCFCE7 #22C55E #16A34A #15803D
  warning 50/100/200/500/600/800 #FFFBEB #FFF4E5 #FFE0B2 #F59E0B #D97706 #B26A00
  danger  50/100/200/500/600/700 #FEF2F2 #FEE2E2 #FECACA #EF4444 #DC2626 #B91C1C
  info    50/100/500/700         #EFF6FF #DBEAFE #3B82F6 #1D4ED8

中性(正文 / 次级 / 画布 / 分割)
  neutral 0...900   正文 #172033   次级 #68738A   画布 #F7F9FC   分割 #E9EDF4
```

**角色别名**(写代码时用这些,不要用 `neutral-500`):
`surface` / `surface-canvas` / `surface-sunken` / `surface-brand` / `surface-scrim`、
`content` / `content-muted` / `content-subtle` / `content-inverse` / `content-brand` / `content-accent`、
`border` / `border-strong` / `border-brand`。

### 2.2 圆角、阴影、字号、动效

```text
圆角(只有 5 档 + full)
  control 18px  → 按钮 / 输入框
  row     20px  → 列表行
  card    24px  → 卡片 / 分组
  sheet   28px  → 底部 sheet / 弹窗
  frame   32px  → 手机壳(仅此一处)

阴影(只有 3 档 + 2 个特例)
  shadow-card     极浅(1px)
  shadow-raised   浮起(sticky CTA / 下拉)
  shadow-overlay  模态
  shadow-brand    Primary CTA 的品牌光晕
  shadow-phone    手机壳(保留原值)

字号(17 种任意字号 → 7 档,全部带行高)
  display  28/36   title  22/30   heading 17/24
  body     15/23   ui     14/20   caption 12/17   overline 11/15
  字重只用 regular / medium / semibold

动效(只有 4 个时长、2 条缓动、4 个 keyframe)
  duration-instant 120ms  fast 180ms  base 240ms  slow 320ms
  ease-out / ease-in-out
  animate-fade-in / slide-up / sheet-up / pulse-soft
  全局 prefers-reduced-motion 兜底(globals.css)
```

### 2.3 控件尺寸

```text
图标按钮 44×44(拇指底线)  sm 36 仅用于行内次要操作
输入框   h-11 (44)          主要 CTA h-12 (48)
chip     最小高度 36
```

---

## 3. Phase A 交付内容

| 交付物 | 文件 | 说明 |
|---|---|---|
| Tokens | `apps/web/src/design/tokens.ts` | 颜色 / 圆角 / 阴影 / 字号 / 动效 / 布局,含 `LEGACY_MIGRATION` 与 `HEX_MIGRATION` 映射表 |
| Tailwind 主题 | `apps/web/tailwind.config.ts` | 从 tokens 读取;**新增** 命名色阶、`rounded-control/row/card/sheet/frame`、`shadow-card/raised/overlay/brand`、`text-display...overline`、`duration-*`、`ease-*`、4 个 `animate-*`;**保留** `ink/muted/cloud/line/phone` 原值。**不扩展 spacing**:安全区写成单一 `pb-[calc(...)]`,避免同一元素上出现两条 `padding-bottom` 声明(谁生效取决于 Tailwind 内部排序,组件不该依赖它) |
| 全局基线 | `apps/web/src/app/globals.css` | 焦点环改用 brand token;**全局** `prefers-reduced-motion` 兜底;`.flex > * / .grid > * { min-width: 0 }` 解决横向溢出根因;长 token 允许换行 |
| 组件原语 | `apps/web/src/components/tf/*`(7 文件) | `TFButton` `TFIconButton` `TFField` `TFInput` `TFTextarea` `TFSearch` `TFCard` `TFAvatar` `TFBadge` `TFChip` `TFSheet` `TFDialog` `TFMenu` `TFTabs` `TFSkeleton` `TFRowSkeleton` `TFLoadingRegion` `TFEmptyState` `TFErrorState` `TFToast` `TFListRow` `TFSectionHeader` |

### 3.1 为什么 Phase A 对页面是"实质零变化"

- 新增的类名(`bg-brand-500`、`rounded-card`、`text-body`...)**以前不存在**,所以没有任何现有 class 的语义被改变。`grep` 已确认:这些新类名**只出现在 `components/tf/*` 里**,现有页面一处都没有。
- `ink` / `muted` / `cloud` / `line` / `shadow-phone` **保留原值**,全站约 500 个调用点渲染结果完全相同。
- `tf/*` **没有任何页面 import**(已 grep 确认 `components/tf` 零引用),所以不参与任何页面的构建产物。
- 因此 Phase A 之后,Playwright 全套应当与之前完全一致。

**但有三处 base CSS 确实变了,必须诚实列出:**

| 改动 | 触发条件 | 影响 |
|---|---|---|
| 焦点环颜色 `#6572d8` → `#3b82f6` | 键盘 focus | 只有键盘用户可见;这是**有意的**(焦点属 active 语义,归 brand) |
| 全局 `prefers-reduced-motion` 兜底 | 用户开启了"减少动效" | 骨架屏不再脉冲、过渡不再播放、平滑滚动关闭--**这正是需求** |
| `.flex > * / .grid > * { min-width: 0 }` + 长词换行 | 布局 | 唯一可能影响常规渲染的改动,验收时专项检查(见 §6.3) |

除这三项外,Phase A 的视觉与交互与之前逐像素一致。


### 3.2 Phase A 未做(有意)

- **未迁移任何页面**(brief 明确要求)。
- **未删除任何旧 token**:`ink/muted/cloud/line` 要等最后一个调用点迁移完才删。删除顺序见 §5。
- **未抽出独立 npm 包**:本该放进新 workspace `packages/design-tokens`,但新增 workspace 需要改 `package-lock.json`,而本环境**无法运行 `npm install`**。放在 `apps/web/src/design/` 里同样能消除重复值,Phase I 再抽包并让 admin 消费。
- **未做 Admin token**(Phase I)。

---

## 4. 分阶段重构计划

每个 Phase 的开始都要先声明"改哪些文件、不改哪些文件",结束后必须 typecheck → lint → build → E2E,再独立 commit。

> ⚠️ **本环境的限制**:`pwsh` 完全不可用(`3221225794`),因此**每个 Phase 的 typecheck / lint / build / E2E 目前都无法执行**。Phase A 的改动经过静态复核(文件通读、括号配平、import 完整性、Tailwind class→token 逐条核对),但**未经验证**。在能跑命令的环境里,第一件事就是执行 §6 的验证清单;在它通过之前不应继续 Phase B。

| Phase | 范围 | 主要文件 | Commit |
|---|---|---|---|
| **A** ✅ | Design System | `design/tokens.ts`、`tailwind.config.ts`、`globals.css`、`components/tf/*`、本文档 | `feat(web): add design tokens and UI primitives` |
| **B** ✅ | 启动页 + Shell + Bottom Nav + ScreenHeader + `/me` 入口分层 | `app/page.tsx`、`app/layout.tsx`、`components/{tab-bar,phone-shell,screen-header,brand}.tsx`、`app/globals.css`、`app/me/page.tsx` | `feat(web): redesign shell, launch and bottom navigation` |
| **D** 🔶 | Discover + Feed + 动态详情 | `app/moments/page.tsx` 已完成;`app/discover`、`moments/[id]`、`moments/user/[id]`、`discover-*`、`moment-comments`、`moment-report-dialog` 待做 | `feat(web): redesign discover and feed UI` |
| **C** ⬜ | Auth + Onboarding(8 步) | `app/login`、`register*`、`verify`、`reset`、`legal`、`onboarding/*` | `feat(web): redesign auth and onboarding UI` |
| **E** ⬜ | Messages + Chat + Connections + Exchange | `app/messages*`、`app/connections`、`connect-panel` | `feat(web): redesign messages and connections UI` |
| **F** 🔶 | Profile + Me + Settings | `app/me/page.tsx` 已完成;`app/profile/[id]`、`app/me/*` 子页、`profile-preview-card` 待做 | `feat(web): redesign profile and settings UI` |
| **G** ⬜ | Notifications + Search + Topics | `app/notifications`、`components/notification-*`、新增 `app/search`、`app/topics` | `feat(web): redesign notifications and add search` |
| **H** ⬜ | Safety / Reports | `app/me/safety`、`safety-actions.tsx` | `feat(web): redesign safety UI` |
| **I** ⬜ | Admin(SaaS 风格 + 共用 token) | `apps/admin/**`、抽出 `packages/design-tokens` | `feat(admin): adopt shared design tokens` |

### 4.1 Phase B 的意外发现(已修)

**`/connections` 曾经是孤儿路由。** 底部导航是它唯一的入口,而当 tab 列表被改成不含「连接」时,全站 `grep 'href="/connections"'` 变成**零命中** -- 连接列表、以及通往联系方式交换的入口,**整个不可达**。Phase B 把它接到了 `/me` 的「关系」分组,并让「消息」tab 在 `/connections` 时保持高亮。

**「消息」tab 现在承载 `/connections` 的导航语义。** brief 只给了五个槽位(首页/发现/+/消息/我的),而关系列表不是每十分钟要看一次的东西,所以它降级为二级页;但它的可达性由 `/me` 明确保证,且 `TFListRow` 的辅助文本写明「双方同意后才会交换社交账号」。

### 4.2 Phase B 的跨页面连带改动:品牌紫 → 品牌蓝

`.tf-gradient` 一改成蓝色,**34 个调用点同时变蓝**。这立刻暴露出三类「改不到」的紫色,它们不会自动跟随,留着就会和蓝色**并排出现两个品牌色**--正是设计系统要消灭的漂移。因此本阶段把这三类一并处理了(这不违反「一阶段只改一个区域」,因为它们都是**颜色 token 迁移**,不是页面重做):

| 类别 | 处数 | 原值 | 现值 | 文件 |
|---|---|---|---|---|
| 硬编码紫色渐变 | 3 | `from-[#7B86FF] to-[#A47BFF]` / `to-[#9B7BFF]` | `bg-brand-500` / `from-brand-500 to-brand-600` | `moments/[id]`、`moments/user/[id]`、`messages/[id]`(发出气泡) |
| 选中态(chip / radio / OTP 格) | 8 | `border-[#8B6CFF] bg-[#F4F1FF]` | `border-brand-500 bg-brand-50` | `onboarding/{languages,countries,purposes}`、`me/interests`、`moment-report-dialog`、`messages/[id]/safety-actions`、`moments/compose`(可见范围) |
| 紫色文字链接 / 未读点 | 4 | `text-[#6B7CFF]`、`bg-[#6B7CFF]` | `text-brand-600`、`bg-brand-500` | `login`、`register`、`reset`、`notification-item` |
| 未知平台兜底色 / 发现页配额 chip | 2 | `#6B7CFF`、`bg-indigo-50 text-[#6B7CFF]` | `#3B82F6`、`bg-brand-50 text-brand-600` | `lib/moments.tsx`、`discover` |

**有意保留的紫色**(是数据不是 token,不应迁移):
- `onboarding/avatar` 的 6 个头像底色预设(紫/粉/青/黄/蓝/淡紫)--这是**用户可选的颜色本身**。
- `lib/moments.tsx` 的 `avatarColor()` 6 色调色板--同上。
- 各社交平台的品牌色(Instagram 渐变、TikTok 黑、WeChat 绿...)--第三方品牌色,不能改。

**仍未迁移的紫色**(属于后续阶段,不是遗留 bug):`#6572D8`(约 60 处,浅紫,主要用作浅底上的文字与图标)、`#F1F3FF` / `#E4E8FF`(浅紫底)、`#3D4663`(深灰蓝文字)。这些是**逐页迁移**的对象,映射表在 `tokens.ts` 的 `HEX_MIGRATION` 里。



### Phase B-H 的每页验收清单(§39)

1. 第一眼层级是否清楚 2. Primary CTA 是否唯一且明确 3. 用户是否知道下一步
4. 是否有多余 UI 5. 是否有重复按钮 6. 是否卡片过多 7. 是否有视觉噪音
8. 是否符合 TalkFirst(轻/净/软/自然/真实/安全/年轻/国际化)
9. 375px 10. 390px 11. 430px 12. desktop

---

## 5. 旧 token 清理顺序

`ink` / `muted` / `cloud` / `line` 只在**最后一个引用消失后**才能删。建议顺序:

1. Phase B 完成后删 `cloud`(当前 0 引用,随时可删)。
2. Phase E 完成后删 `line`(消费大户是会话/聊天)。
3. Phase F 完成后删 `ink`(消费大户是 `me/*`)。
4. Phase G 完成后删 `muted`。
5. 每删一个,`tailwind.config.ts` 里对应的 legacy 块删一行,`tokens.ts` 的 `LEGACY_MIGRATION` 删一条。

`HEX_MIGRATION` 里的 48 个 hex 是逐页迁移的查表依据;Phase H 结束时它应当只剩 avatar 预设色。

---

## 6. Phase A 验证清单(在可用环境里执行)

```bash
cd apps/web
npx tsc --noEmit                 # tokens.ts 的类型契约
npm run lint
npm run build                    # 关键:Tailwind 是否会因主题形状报错
npm run test                     # 4 个 node:test(含 ui-copy)
npm run test:e2e                 # 9 个 Playwright spec × desktop/phone

# 视觉零回归(Phase A 的核心断言)
# 构建前后截同一组页面:/、/login、/discover、/moments、/moments/<id>、/messages、/me
# 期望:像素级一致
```

**必须人工确认的三件事**

1. **Tailwind 主题可解析**:`tailwind.config.ts` 现在从 `src/design/tokens.ts` 读取。若 `content` / `border` / `surface` 这三个**嵌套色对象**(带 `DEFAULT`)形状有问题,build 会报错--这是 Phase A 最可能失败的点。
2. **`text-*` 命名冲突**:新增了 `text-body` / `text-ui` / `text-title`... 这些名字与 Tailwind 的 `text-{color}` 共用一个命名空间。若某处写过 `text-body` 期待别的含义,或未来给颜色起名 `ui`,会冲突。当前代码里**没有** `text-body`/`text-ui`/`text-title`/`text-display`/`text-heading`/`text-caption`/`text-overline` 的任何使用(已 grep 确认),所以是安全的。
3. **`.flex > * .grid > * { min-width: 0 }` 的副作用**:这条 base 规则会让所有 flex/grid 子项可收缩。已核查:现有 `min-w-[2.25rem]`(ScreenHeader)等 `min-w-*` 工具类位于 utilities 层、优先级更高,不会被覆盖;气泡墙的固定 `w-[96px]` 也不受影响。但它仍是本阶段**唯一**可能影响常规渲染的改动,验收时要专门看:Discover 气泡墙、底部导航、聊天输入行、媒体网格、资料卡底部按钮行。

**另外两点需要知道**

- **`fontFamily.sans` 覆盖了 Tailwind 默认字体栈**。实际字体仍由 `globals.css` 的 `body { font-family }` 决定(它不在 `@layer` 内,优先级更高),所以**当前无视觉影响**。新 token 的字体栈以 `PingFang SC` 开头(中文优先),Phase B 把 `globals.css` 迁到它时才会生效--那时是一次**有意的**字体变化,需要视觉验收。
- **`font-normal` / `font-medium` / `font-semibold` 仍然是 Tailwind 默认值**,未重新定义(避免覆盖内置语义)。token 里的 `fontWeight` 只额外提供 `font-regular` 别名。

### 6.1 Git

本环境**没有可用的 shell**(`pwsh` 返回 `3221225794`),因此**无法执行 `git add` / `git commit`**。Phase A 的文件清单如下,请在可用环境里按它提交,**不要用 `git add .`**:

```
apps/web/src/design/tokens.ts
apps/web/tailwind.config.ts
apps/web/src/app/globals.css
apps/web/src/components/tf/button.tsx
apps/web/src/components/tf/field.tsx
apps/web/src/components/tf/display.tsx
apps/web/src/components/tf/overlay.tsx
apps/web/src/components/tf/feedback.tsx
apps/web/src/components/tf/nav.tsx
apps/web/src/components/tf/index.ts
docs/DESIGN-SYSTEM.md
```

commit message:`feat(web): add design tokens and UI primitives`


---

## 7. 副产品的两个已知取舍

1. **`TFToast` 需要 provider**:要真正用起来,`app/layout.tsx` 里得包一层 `<TFToastProvider>`。Phase B 做 shell 时一起加--现在加会让所有页面多一层 DOM,属于"Phase A 只加不改"的例外,所以留到 B。
2. **`TFSheet` / `TFDialog` 用 `absolute` 定位**：这样它们被限制在 390px 手机壳内（修掉“桌面端弹窗糊满整个窗口”的缺陷）。代价是**调用方必须处在有 `position: relative` 的祖先里**——`PhoneShell` 的内层 div 恰好是 `relative`，所以任何 PhoneShell 页面都满足。

---

## 8. 管理后台向设计体系对齐（B 方案，2026-10-06）

在此之前，同一个产品里有两套视觉语言：成员端主色是 TalkFirst Blue `#3B82F6`，
后台是 indigo `#4F46E5`；中性灰、字体栈也各写各的。本节记录把后台接到同一套值上的结果。

### 8.1 做法

- 新增 `apps/admin/src/design/tokens.ts`：后台的 token 单一真源，结构与成员端的
  `apps/web/src/design/tokens.ts` 一致（品牌、状态、中性、形状、字体、动效）。
- `apps/admin/tailwind.config.ts` 不再写死色值，改为消费该文件（`consoleColors`）。
- `apps/admin/src/app/globals.css`：字体栈换成成员端那一套（**去掉 `Inter`**，CJK 优先），
  页标题 `h1` 从 20/28 调到 `title` 步长 22/30，组件层写死的字号换成 `text-ui` / `text-caption`。

| 角色 | 成员端 token | 值 | 后台原来 |
|---|---|---|---|
| 主色 / 链接 / 激活 | `brand-500` | `#3B82F6` | `#4F46E5` indigo |
| 主色悬停 | `brand-600` | `#2563EB` | `#4338CA` |
| 正文 | `neutral-800` | `#172033` | `#171A1F` |
| 次要文字 | `neutral-500` | `#68738A` | `#6B7280` |
| 发丝边框 | `neutral-200` | `#E9EDF4` | `#E8EBEF` |
| 画布 / 凹槽 / 悬停行 | `neutral-50/25/100` | `#F7F9FC` / `#FBFCFE` / `#F1F4F9` | `#F7F8FA` / `#FBFCFE` / `#F3F4F6` |

### 8.2 两处**刻意不对齐**，都有实测理由

1. **半径保持控制台密度**（8/10/12/14），不用成员端的 18/20/24/28/32。
   后台是密集表格工具，不是消费页；“16px 卡片读起来像气泡”这条早先的判断依然成立。
   要对齐只需改 `tokens.ts` 里 `radius` 一处（文件内已注明）。
2. **`warningInk` 用 `#92400E`，不是成员端的 `warning-800`（`#B26A00`）**：
   `#B26A00` 在白底只有 **4.24**、在 `warning-100` 桃底只有 **3.90**，而徽标是 11–12px 小字，
   不适用「大字 3.0」的宽松阈值。改用深一档的 `#92400E`：桃底 **6.52**、旧黄底 **6.37**。

### 8.3 对比度审计（WCAG，本机计算，非推测）

WCAG 相对亮度公式逐对算过，**当前后台 15 组全部达到 AA（正文 4.5）**：

| 组合 | 比值 |
|---|---|
| 正文 `#172033` / 卡片白、画布 | 16.27 / 15.42 |
| 次要 `#68738A` / 卡片、凹槽 | 4.76 / 4.64 |
| 次级正文 `#4A5468` / 卡片 | 7.61 |
| 白字 / `primary-hover`（按钮底）、`primary-active`、`primary-ink` | 5.17 / 6.70 / 16.27 |
| 白字 / `danger` | 4.83 |
| 状态 ink / wash：success·warning·danger·info | 4.57 / 6.52 / 5.30 / 5.49 |
| neutral·system ink / wash | 6.90 / 4.75 |

**审计抓到并已处理的两处：**

- `warning-ink` 原用成员端 `#B26A00` → 3.90 ✘ （后台四个页面的「待处理」徽标在用）。已按 §8.2 处理。
- `.tf-btn-primary` 原本用 `bg-primary`（`#3B82F6`）+ 白字 = **3.68** ✘。该 class 当时**只定义、无页面使用**，
  但既然是现成词表，改为 `bg-primary-hover`（5.17）+ 按下 `primary-active`（6.70）。

### 8.4 审计发现、但**属于成员端、本次未改**的两处

| 位置 | 组合 | 比值 |
|---|---|---|
| `apps/web/src/components/tf/button.tsx:48`（primary 实心按钮） | 白字 / `brand-500` | **3.68** ✘ |
| `apps/web/src/components/tf/display.tsx:213`（warning 徽标） | `warning-800` / `warning-100` | **3.90** ✘ |

同一个修法：按钮底换成 `brand-600`（5.17 ✓），徽标 ink 换成 `#92400E`（6.52 ✓）。
这属于**品牌色的改动会对整个成员端可见**，所以留给运营方定，而不是在本次后台对齐里顺手改掉。

### 8.5 验证方式与它的边界

- **已验**：admin 构建通过；产物 CSS 里 `#3B82F6` / `#2563EB` / `#92400E` / `#172033` 均已就位，
  旧的 `#4F46E5` / `#6B7280` / `#E8EBEF` / `#B26A00` **全部消失**；字体栈已是成员端那一套（无 `Inter`）；
  对比度 15/15 合格；admin `tsc --noEmit` exit 0、静态测试 28/0；web 静态 16/0；契约三件套 OK。
- **边界**：本机**没有能渲染已登录后台的环境**（登录需要真实 API），所以「页面看起来对不对」
  只能由你在线上用眼睛过一遍 —— 色彩、字体、页标题字号的变化都在这里，
  半径与表格密度**没有改**。

### 8.6 还没做的（B 的下一段）

页面级写死的字号与圆角还没扫：`apps/admin/src` 里仍有多处 `text-[13px]` / `text-[12px]` /
`rounded-[…]` 这类字面量。它们要么换成 `text-ui` / `text-caption`（14/12px，**会有 1px 变化**），
要么保留并在页面上注明理由 —— 需要一次逐页清扫，建议在上面的眼睛验收之后再做。
