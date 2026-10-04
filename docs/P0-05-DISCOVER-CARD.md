# P0-05 — Discover 用户卡片：现状核对（2026-10-04）

> 任务：完善 Discover 用户卡片，让人 3 秒内看懂一个陌生人是谁、为什么值得认识；卡片至少显示
> avatar / nickname / country / city（若允许）/ 母语 / 学习中语言 / **语言等级** / bio 摘要 /
> interests / personality / friendship needs / **matching highlights**；底部两个动作
> [查看资料] [Say Hello]。
>
> **结论：统一的卡片组件已存在且被全站复用，数据面已齐全；渲染面差三处。** 本轮只盘点，
> 没有改代码（预算用于前几轮的修复与 P0-02/03）。

---

## 1. 已经满足的部分

**只有一套卡**（P0-05 明确要求「不要复制出第二套 Profile Card」）：`components/profile-preview-card.tsx`
（309 行）被 Discover、动态列表、动态详情、评论区、连接列表共用，且 E2E 有断言钉住这一点
（`profile.spec.ts:403/418/431/446`「统一资料卡」四条）。

**数据面齐全**：卡片只读一个入口 `GET /users/:id`（`profile-preview-card.tsx:52`），返回
`PublicProfile`，其中包含 P0-05 列举的**全部**字段：

```
id, nickname, avatarUrl, age, countryCode, countryName, countryFlag,
city, region, gender, bio,
languages[{ code, name, nativeName, type, level }],   ← level 在其中
interests[{ slug, name, nameZh, category }],
purposes[…], preferredCountries[…], attributes{ aboutMe, lookingFor },
relationship{ isSelf, isConnected }
```

**卡片现在渲染**：头像、昵称、国家名+国旗、城市、地区、年龄、bio、语言（带「母语 / 学习中」）、
兴趣、交友目的、属性（性格 / 想认识 / 自定义标签）、「打招呼」按钮、已打招呼态、自己的「管理标签」。

**P0-05 的几条硬要求，逐条已经在满足**：

| 要求 | 依据 |
|---|---|
| 严格遵守 Profile Privacy | 只读 `GET /users/:id`，而该接口是服务端逐字段过滤的唯一入口（见 `docs/P0-04-PRIVACY.md`） |
| 不显示 private 字段 | 同上；`gender` / `age` / `city` 在无权时得到 `null` 而不是原值 |
| **不显示外部社交账号** | 卡片只消费 `PublicProfile`，社交 handle 属于 `SharedSocialAccount`，只有双方完成交换后才授权，**根本不在这条投影里** |
| 移动端优先 | 手机上是底部弹层、桌面居中，有 E2E 断言（`profile.spec.ts:559`） |
| 不破坏现有 Discover API | 卡片是纯消费方，本轮未改任何接口 |
| 优先修改现有组件 | 已有一套，不需要新建 |

---

## 2. 三处真实的差距（未做）

| # | 差距 | 说明 | 成本 |
|---|---|---|---|
| 1 | **语言等级没有渲染** | `languages[].level` 服务端已经给出，卡片只显示了「母语 / 学习中」。P0-05 的清单里点名要 level | 小：纯渲染，数据已到 |
| 2 | **没有「查看资料」入口** | 卡片上有「打招呼」和（自己的）「管理标签」，但没有通往 `/profile/[id]` 的链接，而那个页面早就存在 | 小到中：加一个动作，但要处理「自己的卡片显示编辑入口、不显示打招呼」那条既有断言（`profile.spec.ts:459`） |
| 3 | **没有 matching highlights（共同兴趣）** | API **不返回**「共同」部分——它是相对**当前浏览者**计算的，属于 Discover 的推荐逻辑而非资料投影 | 中：需要新增一处「共同点」计算（Discover 已有匹配算法的输入，可复用） |

差距 3 是本轮真正需要设计的那个：`PublicProfile` 是**与浏览者无关**的形状（除 `relationship` 外），
而「共同兴趣」天然与浏览者相关。把它塞进 `PublicProfile` 会让缓存与语义都变差；
更合适的位置是 Discover 卡片数据里显式带一组 `sharedWithViewer`，且**必须复用同一套隐私判定**
（否则会用「你们有共同兴趣」这条理由泄露一个 private 字段的存在 —— `discover-privacy.spec.ts:261`
已经为「不泄露为什么被隐藏」立过先例，language 那条就是这么处理的）。

---

## 3. 建议顺序

1. 渲染语言等级（差距 1）——最小、零风险。
2. 加「查看资料」入口（差距 2），同时把 `profile.spec.ts:459` 那条断言的语义确认一遍。
3. 差距 3 需要先定形状：`sharedWithViewer` 放在哪、如何复用 `canViewField`、以及当某字段为
   PRIVATE 时「共同」条目也必须消失。**这一步要设计，不能顺手做。**

截图/页面级验收（P0-05 要求）本轮未做：Playwright 的既知问题还没清（见 `docs/KNOWN-E2E-ISSUES.md`），
而用它来做视觉验收会把「已知会漂的失败」混进结论里。
