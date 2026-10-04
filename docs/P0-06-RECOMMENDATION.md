# P0-06 — Discover 推荐算法 V1：现状核对与差距（2026-10-04）

> 任务：实现一个简单、可解释、无机器学习的推荐；权重为
> **语言 30 / 兴趣 25 / 交友目的 20 / 国家文化 10 / 活跃度 10 / 资料完整度 5**；
> 排除自己 / Block / 已拒绝的关系 / 不可见 / 已删除 / 被封禁；高匹配优先并带新鲜度；
> 必须避免 N+1、避免"全表取出再在内存排序"、不得泄露 private 字段。

---

## 0. 结论（先说清楚）

**推荐算法已经存在，而且方向完全正确**：`apps/api/src/discover/discover.service.ts` 的
`getRecommendations()` + `scoreCandidate()`，有候选窗、有 5 个分量、有理由（reasons）、有隐私闸门。

**与 P0-06 规格的差距是 2 处数字 + 2 项缺失**，都在下面列明。**本轮没有改代码**。

---

## 1. 已经满足的（及其证据）

| P0-06 要求 | 现状 | 位置 |
|---|---|---|
| 简单、可解释、无 ML | 纯加权求和 + 人类可读理由（「语言互补」「共同兴趣：摄影」「近期活跃」…） | `scoreCandidate` 382-400 |
| 服务端计算 | 全部在 API | 同上 |
| **避免 N+1** | 候选一次 `findMany`，`languages`/`interests`/`purposes`/`preferredCountries`/`fieldVisibilities` 全部走 `include` | 184-199 |
| **避免全表取出内存排序** | 候选窗 `take: 200`，不是全表 | 198 |
| 排除自己 | `id: { not: userId }` | 186 |
| 排除已查看/当日配额 | `notIn: [...viewedIds, ...excluded]` | 186 |
| 排除 Block | 查询内排除 **+ 投影时二次校验**（注释写明这是 "Block > visibility" 不变量） | 186、205-206 |
| 排除不可见/已删除/被封禁 | `status: "ACTIVE"`（BANNED/DISABLED/SUSPENDED 全排除）；已删除即无行 | 187 |
| **不泄露 private 字段** | 两点做得很好：① 每条理由都要过 `canSee(...)`，所以 `languages` 隐藏时**连「语言互补」都不给**；② 分类筛选跑在**投影后**的卡上，所以"出现在某个分类 tab 里"本身不会泄露一个被隐藏的值 | 390-400、211-213 |
| 单元测试 | `discover-filter.spec.ts`、`discover-privacy.spec.ts`（7 例）、`discover-views.spec.ts`、`discover-categories.spec.ts` | — |

---

## 2. 差距（P0-06 规格 vs 实现）

| # | 项 | 规格 | 实现 | 差 |
|---|---|---|---|---|
| 1 | 国家/文化匹配 | 10 | **`COUNTRY_SCORE = 15`** | 高 5 |
| 2 | 资料完整度 | **5** | **不存在** | 缺 5 |
| 3 | 新鲜度 | 明确要求"避免永远只有同一批用户" | 排序 = `score desc, lastActiveAt desc`，**纯确定**，无轮换 | 缺 |
| 4 | 已明确拒绝的关系 | 要求排除（"如果当前模型支持"） | **未排除**；模型支持（`ConnectionRequest.status = REJECTED`） | 缺 |

现有权重（`discover.service.ts:11-15`）：`LANGUAGE 30 / INTEREST 25 / PURPOSE 20 / COUNTRY 15 / ACTIVITY 10 = 100`。
规格是 `30 / 25 / 20 / 10 / 10 / 5 = 100`。**总和不变**，只是把国家的 5 挪给资料完整度。

---

## 3. 可直接执行的修法（约 20 行，3 处）

**① 常量**（`discover.service.ts:11-15`）

```ts
const COUNTRY_SCORE = 10;      // was 15 — P0-06 puts the 5 on completeness instead
const COMPLETENESS_SCORE = 5;
```

**② `scoreCandidate` 里加分量并入总和**（约 386 行）

```ts
// 复用既有的完整度定义，不要在这里重算一遍：
// `apps/api/src/users/profile-completion.ts` 的 `isProfileComplete`。
const completenessScore = isProfileComplete(candidate) ? COMPLETENESS_SCORE : 0;
const score = Math.min(
  languageScore + interestScore + purposeScore + countryScore + activityScore + completenessScore,
  100,
);
// 理由：它是本地计算、与隐私无关（完整度不是被治理的字段），但**不要**为此暴露字段名，
// 只说「资料较完整」。
if (completenessScore) reasons.push("资料较完整");
```

**③ 新鲜度：把确定排序换成"当天稳定、跨天轮换"**

```ts
// 现在的第二键是 lastActiveAt，导致同一批高分用户长期霸占同一位置。
// 换成 (score, 当日轮换键)：同一天内稳定（分页不会跳），跨天自动换一批。
// 键只依赖 id 与当天日期，不引入新表、不引入随机数（随机会让分页抖动）。
const freshnessKey = (candidateId: string) =>
  sha256Hex(`${userId}:${candidateId}:${this.startOfToday().toISOString()}`);
...
.sort((a, b) => b.matchScore - a.matchScore || a.freshnessKey.localeCompare(b.freshnessKey))
```

**④ 排除已拒绝的关系**（`excludedCandidateIds`，301-340 行）
在既有的 blocked/自己 之外补一条：查出 `ConnectionRequest` 中
`status = REJECTED` 且与 `userId` 相关（两个方向都要）的对方 id 并入 `excluded`。
**注意**：这会让被拒绝过的人不再出现在推荐里 —— 这是 P0-06 要的行为，但产品上等于
"拒绝即消失"，值得在提交信息里写明，因为它与"Block 之后关系处理"是同一族语义。

---

## 4. 风险与未验证

- **改 COUNTRY 权重会改变现有排序结果**。`discover-filter.spec.ts` / `discover-privacy.spec.ts`
  我没有逐条确认是否有**依赖顺序**的断言（`discover-privacy.spec.ts:298` 只断言了响应里有
  `matchScore` 这个键名，没断言数值）。**执行时必须先跑这两个 spec。**
- 差距 4（排除已拒绝）会减少候选数量，可能让"今日剩余"看起来更少 —— 行为正确，但用户可感知。
- 新鲜度键用日期字符串参与哈希：跨零点会把当天已看过的人重新洗一遍顺序（配额仍按天算，不受影响）。
