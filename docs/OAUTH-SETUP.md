# Google 快捷登录 —— 配置与验收

> 面向部署与运维。代码结构见 `apps/api/src/auth/oauth/`。

---

## 1. 它是什么

Google 账号登录。**只支持 Google**：Apple 登录已明确放弃，手机号登录暂缓。

采用的是**授权码 + PKCE + 服务端回调**，不是前端 ID Token 直传：

- 浏览器被送到 Google，同意后回到**本 API** 的回调地址；
- API 用 `client_secret` 在服务端换取 `id_token`，浏览器从不接触令牌；
- 验签通过后再签发**本站自己的会话 Cookie** —— 与邮箱密码登录走同一套
  `SessionService`，因此 refresh token 轮换与重用检测（SEC-003B）同样生效。

---

## 2. 需要登记的回调地址

这是**唯一必须由人工在控制台完成**、且写错就会失败的一步。逐字符一致，多一个
斜杠都不行。

```
生产：https://<你的域名>/api/v1/auth/oauth/google/callback
本地：http://localhost:4000/api/v1/auth/oauth/google/callback
```

回调挂在 **API** 上（不是前端）。若前端与 API 同域（推荐，例如
`https://talkfirst.ccwu.cc` 反代 `/api` 到 API），则只有上面这一条生产地址。

> **为什么本地也能用**：Google 允许 `http` 仅限 loopback 地址，所以
> `http://localhost:4000` 无需证书即可联调。

---

## 3. 创建凭据（约 10 分钟，免费）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 新建或选择项目
2. **API 和服务 → OAuth 同意屏幕**
   - User Type：**External**
   - 填应用名、用户支持邮箱、开发者联系邮箱
   - **隐私政策 URL 必填**（Google 会校验可访问性）→ 指向本站 `/legal`
   - 范围只要三个：`openid`、`email`、`profile`
   - 发布状态：测试阶段只有「测试用户」能登录，需要时自行添加；要对外开放则点
     「发布应用」
3. **凭据 → 创建凭据 → OAuth 客户端 ID → 应用类型选「Web 应用」**
4. **已获授权的重定向 URI**：填入第 2 节的两条地址
5. 记下**客户端 ID** 与**客户端密钥**

参考资料：
[获取 Google API 客户端 ID](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)、
[OAuth 应用状态概览](https://developers.google.cn/identity/protocols/oauth2/production-readiness/overview)、
[验证要求](https://support.google.com/cloud/answer/13464321)

### 关于 Google 验证

`openid` / `email` / `profile` 属**非敏感范围**，**不需要**走敏感范围的验证审核。
但同意屏幕要发布为正式状态，需要填好应用名、Logo 与隐私政策链接。这些是控制台
里的资料，不是代码。

---

## 4. 环境变量

```bash
# 必填（两个都要，只配一个会拒绝启动）
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx

# 本 API 对公网可见的源。回调地址由它推导，生产必须 https。
# 不要填前端的 APP_URL。
API_PUBLIC_URL=https://talkfirst.ccwu.cc

# 可选：显式列出要开启的 provider。留空 = 「配了就开」。
OAUTH_PROVIDERS=
```

### 留空是合法状态

`GOOGLE_CLIENT_ID` / `_SECRET` 都留空 = **不提供 Google 登录**。登录页不会渲染
该按钮，直接访问 `/auth/oauth/google/start` 得到 `OAUTH_PROVIDER_DISABLED`。
这是配置状态，不是故障。

**只填一个**则启动失败。半配置的 provider 会让用户点到一个必然失败的按钮，比不
提供更糟。

### 启动期会拒绝的情况

`assertOAuthConfiguration()` 在 `main.ts` 里运行，以下任一情况**拒绝启动并说明原因**：

| 情况 | 为什么拦 |
|---|---|
| `OAUTH_PROVIDERS` 列了未配置的 provider | 否则表现为「按钮点了必然失败」 |
| 回调地址非 https 且非 loopback | Google 会拒绝，而错误信息不指向真因 |
| `OAUTH_DEV_PROVIDER=true` 出现在生产 | 那是本地假 provider，会签发假身份 |

---

## 5. 本地开发：无需任何凭据

打开假 provider 就能端到端跑通**真实**链路（真实 HTTP 跳转、真实建号、真实会话
Cookie），因为被替换的只有「Google 本身」，业务代码全是生产的：

```bash
OAUTH_DEV_PROVIDER=true
ALLOW_INSECURE_DEFAULTS=true   # 或 NODE_ENV=development
```

登录页会出现一个标着「本地开发登录（假）」的按钮，授权页会明确写出
**「这不是 Google」**。它提供三个账号，分别命中三条不同的账号解析分支：

| 账号 | 命中的分支 |
|---|---|
| `local.new@example.test` | 全新邮箱 → 建号（`passwordHash` 为 null） |
| `local.verified@example.test` | 同上，第二次登录会复用账号 |
| `local.unverified@example.test` | provider 报邮箱未验证 → **拒绝**，不建号 |

该 provider 会真实校验 PKCE：授权请求里的 `code_challenge` 与令牌端点的
`code_verifier` 不匹配就拒绝，所以流程里的 PKCE 接线是被真正检验过的。

---

## 6. 真实凭据到位后的验收清单

### 先跑预检脚本

```bash
node scripts/oauth-preflight.mjs --provider google
```

它会按顺序检查：环境是否完整、`client_secret` 是否被误填成了 ID（反之亦然）、
回调地址是否会被 Google 拒绝、生产环境是否误用了 loopback、授权链接是否只带三个
非敏感范围与 PKCE、以及**这台机器能否访问 Google 的 JWKS**（真实的出网问题，本地假
provider 永远暴露不出来）。

**它会直接打印出必须登记到控制台的那一行 URI** —— 复制粘贴，不要手打：

```bash
node scripts/oauth-preflight.mjs --provider google
# 📋 请把下面这一行原样登记到 Google Cloud Console 的「已获授权的重定向 URI」：
#    https://<你的域名>/api/v1/auth/oauth/google/callback
```

退出码 0 = 所有可自动检查的项都通过。

### 然后手工确认（脚本代替不了浏览器）

自签名的本地 provider 验不到的东西，必须用真实 Google 凭据过一遍：

- [ ] 点「使用 Google 登录」→ 看到 **Google 自己的**账号选择页（不是本地页）
- [ ] 同意屏幕上的应用名与隐私政策链接正确（这就是控制台里填的品牌信息）
- [ ] 首次用全新 Google 账号登录 → 进入资料完善引导；数据库里
      `User.passwordHash` 为 **NULL**、`emailVerified` 为 **true**、
      且有一行对应的 `OAuthIdentity`
- [ ] 用同一账号再登录一次 → **不重复建号**，`OAuthIdentity.lastLoginAt` 更新
- [ ] 用已存在的**邮箱密码账号**的同一邮箱走 Google 登录 → 提示「该邮箱已注册」，
      且**没有**自动关联（`OAuthIdentity` 不新增行）
- [ ] 在 Google 页面上点「取消」→ 回到登录页并显示中文提示，**没有**会话 Cookie
- [ ] 刷新页面 → 仍是登录状态（会话 Cookie 正常）
- [ ] 退出后再登录 → 正常
- [ ] 生产域名下整条流程走通（验证 `redirect_uri` 与 https 配置）

**本地 provider 验不到、只能靠真实凭据确认的三件事**：
Google 真实的 `iss`/`aud` 取值、同意屏幕的实际外观（应用名与隐私政策链接）、
以及被 Google 判定为未验证邮箱的真实案例。

---

## 7. 安全设计要点（供审查）

| 项 | 做法 |
|---|---|
| CSRF | `state` 每次随机，存 HttpOnly Cookie，常量时间比较，且**只从服务端签发的 token 读取**（从不接受请求参数） |
| 重放 | `nonce` 与 `id_token` 的 `nonce` 声明比对 |
| PKCE | `code_verifier` 只存服务端，授权请求里只出现其 SHA-256 |
| 算法 | 钉死 RS256，显式拒绝 `alg:none` 与 HMAC 混淆 |
| 令牌校验 | 验签 + `iss` + `aud` + `exp` + `nonce`，`aud` 不校验等于允许拿别的应用的令牌登录本站 |
| 邮箱信任 | `email_verified` **严格 `=== true`**，字符串 `"true"` / `1` 一律视为未验证 |
| 账号关联 | 已有邮箱账号**不自动关联**，需用户先自行登录后手动绑定 |
| 开放重定向 | 跳转目标只允许根相对路径或与 `APP_URL` **完全同源**的地址 |
| 会话 | 复用 `SessionService`，与密码登录同一套 refresh token 轮换 |
| 密钥 | `client_secret` 不下发浏览器、不进日志、不进审计、不出现在任何响应 |

### 已知的取舍

**邮箱已存在的账号不会自动关联。** 「邮箱控制权 ⇒ 账号控制权」这条隐含推理是账号
接管的常见来源：若某人的邮箱后来被回收或被盗，新持有者用 Google 登录就能直接进入
原账号。代价是一次转化率。若要改成自动关联，只需改
`oauth-account.service.ts` 一处，但必须重新评估这个权衡。

**通过 Google 建号时 `emailVerified` 直接为 true。** 这是 Google 已经证明了邮箱
控制权，与本站在邮件验证码里要求的证明同级。否则开启
`REQUIRE_EMAIL_VERIFICATION` 的部署会把所有 Google 新用户锁在门外。

---

## 8. 故障排查

| 现象 | 原因 |
|---|---|
| `redirect_uri_mismatch` | 控制台登记值与 `API_PUBLIC_URL` 推导出的不一致（注意 `/api/v1` 前缀与结尾斜杠）。用 `node scripts/oauth-preflight.mjs` 打印出正确的那一行。 |
| 同意页提示「未验证的应用」 | 同意屏幕仍是测试状态，或尚未填写品牌信息 |
| 回调后停在登录页且有 `oauth_error` | 看该参数值，对照登录页的中文提示 |
| `OAUTH_PROVIDER_DISABLED` | 该 provider 未配置，或 `OAUTH_PROVIDERS` 拼错 |
| 本地一切正常、生产失败 | 检查 `API_PUBLIC_URL` 是否为 https 且与登记值一致；预检脚本会直接报出来 |
| `invalid_client`（换码阶段） | `client_secret` 与 `client_id` 互换了。预检脚本会检查两者形状 |
