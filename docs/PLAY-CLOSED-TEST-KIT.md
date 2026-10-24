# 封闭测试工具包（12 人 × 14 天）

> 适用：2023-11-13 之后注册的**个人**开发者账号。组织账号豁免，无需本流程。
> 规则来源：<https://support.google.com/googleplay/android-developer/answer/14151465>
>
> 官方原话：*"must run a closed test for their app with a minimum of 12 testers who have
> been opted in continuously for at least 14 days"*，满足后才能申请 production access。

---

## 一、时间线（最短 3 周）

| 天 | 动作 |
|---|---|
| D0 | 建应用 → 传 AAB 到**内部测试** → 自己装一遍 |
| D1 | 建**封闭测试**轨道 → 传同一个 AAB → 收 12 个测试者邮箱 → 发 opt-in 链接 |
| D1–D15 | 测试者保持 opt-in、**真的用**（登录/发动态/AI 对话/加好友） |
| D15 | 申请 production access，提交反馈总结 |
| D15–D22 | Google 审核（2–7 天） |
| 通过后 | 生产发布，建议分阶段 20% |

**关键点**：14 天是**连续**的。有人中途 opt-out，人数掉到 12 以下，连续期就会受影响。

---

## 二、找测试者

优先顺序（按「愿意真的用」排序）：

1. 团队/朋友里用 Android 的人（6–8 人，最容易配合）
2. 现有语言交换用户（如果有，微信/Telegram 群里问）
3. 语言学习社群（小红书/Discord/Reddit 的 language exchange 板块）

### 邀请话术（中文，可直接粘）

```
我们在做一个语言交换 App「TalkFirst」，先聊天再决定要不要加好友，
有个 AI 陪练可以随时练口语。现在要上 Google Play，需要 12 个人帮我做
封闭测试（Google 的硬性要求）。

要做的事：
1. 点这个链接加入测试：<opt-in 链接>
2. 从 Google Play 装上（约 1 分钟）
3. 接下来两周**偶尔打开用一下**（发条动态、聊两句就行）
4. 有问题随时告诉我，哪怕是「登录有点慢」这种

要求：Android 手机 + 你自己的 Google 账号。
时间：两周内保持装着别卸载就行。
```

### English version

```
We're launching "TalkFirst" — a language-exchange app where you talk first and
decide about friendship later, with an AI practice partner. Google requires a
closed test with 12 real testers before we can publish.

What you'd do:
1. Join here: <opt-in link>
2. Install from Google Play (~1 min)
3. Open it now and then over the next two weeks (post a moment, chat a bit)
4. Tell me anything that feels off — even "login is slow"

Needs: an Android phone and your own Google account. Please keep it installed
for the two weeks.
```

---

## 三、测试者那边的操作（发给他们）

1. 点链接 → 页面提示「成为测试人员」→ 点接受
2. 等 1–5 分钟，出现「在 Google Play 上下载」按钮 → 安装
3. 打开 App → 注册（邮箱验证码）→ 勾选 18+ 与条款
4. 随便做 2–3 件事：发一条动态、和 AI 聊一句、进发现页点一个人

**常见卡点**：点了「接受」但 Play 里还显示旧版本 → 关掉 Play 重开；或链接和账号不是同一个 Google 账号。

---

## 四、反馈记录表（申请时要用）

把这张表填满，申请 production access 时需要总结。

| # | 日期 | 测试者 | 场景 | 问题/建议 | 严重度 | 处理 | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | | | 注册 | | 高/中/低 | | 已修/已解释/待办 |
| 2 | | | 发动态 | | | | |
| 3 | | | AI 陪练 | | | | |
| 4 | | | 聊天 | | | | |
| 5 | | | 界面/文案 | | | | |

**严重度口径**：高 = 挡住了主流程；中 = 能用但别扭；低 = 文案/视觉。

### 空白模板（CSV，可粘进表格软件）

```csv
日期,测试者,场景,问题或建议,严重度,处理,状态
,,,,,,
```

---

## 五、production access 申请问卷（草稿）

申请时 Play Console 会问几类问题。下面是**按 TalkFirst 实际情况写好的答案**，按需微调。

### Q1：这个应用是做什么的？目标用户是谁？

> TalkFirst 是一个语言交换应用：用户按母语和想学的语言匹配，先用文字聊几句，
> 聊得来再决定是否交换联系方式。另有一个 AI 陪练，找不到真人时可以随时练。
> 目标用户是 18 岁以上、正在学外语、但不适应「看照片滑卡」这类社交产品的成年人。

### Q2：你的封闭测试是怎么做的？测试者从哪来？

> 封闭测试从 <日期> 开始，共 <N> 名测试者，全部通过 Google 账号 opt-in 加入，
> 连续保持 opt-in 超过 14 天。测试者来自我们自己的社交圈和语言学习社群，
> 都是真实用户，覆盖 <机型/系统版本>。
> 测试期间我们要求他们至少完成：注册并验证邮箱、发一条动态、和 AI 对话一次、
> 与另一位测试者建立会话。

### Q3：收到了哪些反馈？怎么处理的？

> 共收到 <N> 条反馈，主要集中在 <两类>：
> 1. <问题> → <怎么修的>（已修复，版本 <x>）
> 2. <问题> → <怎么处理的>
> 未修复的 <N> 条已记录在案，原因分别是 <…>。
> 详情见下表：<贴第四节表格>

### Q4：应用上线准备度如何？

> - 崩溃：测试期 <N> 次崩溃，均已定位修复；发版前做了 <机型> 真机回归
> - 后端：API 与 Web 端已稳定运行 <x> 个月，可用性 <…>
> - 合规：隐私政策、账号删除（应用内 + 网页）、举报与拉黑、18+ 门槛均已上线
> - 内容治理：有举报处理流程，<x> 小时内响应

### Q5：有没有需要说明的敏感点？

> 应用包含用户之间的一对一聊天与用户生成的图文/视频内容，因此我们：
> - 注册前强制勾选 18+ 与条款
> - 提供一键举报与拉黑，举报有处理结果
> - 不提供精确位置共享，不做第三方广告
> - 与 AI 陪练的对话会发送给 Google（Gemini）生成回复，已在隐私政策 §5 披露

---

## 六、红线

- **不要买测试号**。Google 会看安装来源、设备指纹、活跃模式；判为刷量的后果是
  **开发者账号直接封禁**，$25 和应用一起没了。
- **不要 12 个人装上就再也不打开**。官方明确把 `insufficient tester engagement`
  列为拒绝理由。
- **不要在测试期改包名或换签名**。测试者装的版本会和后续版本对不上。
