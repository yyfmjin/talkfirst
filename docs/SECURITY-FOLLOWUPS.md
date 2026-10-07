# 安全待办与已处理（2026-10-07）

> 起因：上线自查（对照「AI 项目被勒索」的常见成因）。已处理的三项在下面标 ✅，
> 需要你做的标 🟡，可以等/可选的标 ⚪。

## ✅ 已处理

### 1. 源站只允许 Cloudflare 访问
实测过「把域名指到源站 IP 能直接拿 200」= WAF/限流/DDoS 防护可整个跳过，而源站 IP
写在公开仓库里。已在 nginx 加放行清单（Cloudflare 官方 IP 段）+ `deny all`。
**详细步骤、实测结果、每月刷新 IP 段的方法、回滚步骤：`docs/OPS-ORIGIN-LOCKDOWN.md`。**

### 2. 验证码发信的全局闸门
`POST /auth/send-verification-code` **不需要登录**，而两道既有上限都按**地址**计数
（换地址就重置），且每一封都真的经 Gmail 发出 → 换地址刷 = 打满账号额度 / 被判定为
垃圾邮件发送源。已加全局窗口：**每小时 200 封真外发**（对一条未过期验证码的重发不占额度）。

### 3. 数据库密码已轮换（2026-10-07）
旧密码曾出现在对话里。现已换成 32 位随机值（URL 安全字符集），只写在服务器
`/home/ubuntu/talkfirst/.env` 的 `DATABASE_URL` 与 `DIRECT_URL` 两处。

**你不需要记这个密码**：它只存在于服务器的 `.env` 里；备份脚本 `scripts/backup-db.sh`
与 prisma 都从那儿读。旧的 `.env` 快照在 `~/talkfirst-env-backups/.env.bak-*`（含旧值，
仅用于回滚，机器被拿下时它一并失效 —— 见下面「备份挪离本机」）。

> ⚠️ **这次轮换中途把 API 打了约 5 分钟的 `NOT_READY`**，原因是我的操作顺序反了：
> 先改了 `.env`、而 `ALTER USER` 因为**漏去掉连接串上的 `?schema=public`**（psql 不认这个
> 查询参数）而失败。**正确顺序**：① `ALTER USER` → ② 用新连接串验证 → ③ 再改 `.env` → ④ 导出+reload。
> 另：给 `psql` 的连接串必须先 `sed 's/?.*$//'`。

## 🟡 需要你做（我做不了）

### Gmail 应用专用密码轮换（暂缓，你说回头再弄）
它曾出现在对话里，任何人都能用它从任何地方以你的名义发信。步骤在下面，
**新密码不要贴进任何对话**（上次就是这么泄的）：

```bash
# ① Google 账号 → 安全性 → 应用专用密码 → 删掉旧的 → 生成新的（只显示一次）
# ② 登录服务器，在服务器上改（不要发给我）：
cd /home/ubuntu/talkfirst
cp .env ~/talkfirst-env-backups/.env.bak-$(date +%Y%m%d-%H%M)
nano .env                       # 只改 SMTP_PASSWORD= 那一行
export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH
bash scripts/deploy-pull.sh --skip-install --skip-build --skip-migrate
# ③ 回注册页点一次「发送验证码」，能收到就对了
```

## ⚪ 建议做，但不紧急

| 项 | 为什么 | 谁做 |
|---|---|---|
| **备份挪离本机** | 现在数据库 dump 与 **含 SMTP 密码的 `.env` 快照**都在同一台机器上 —— 机器被拿下，数据与密钥一起丢 | 需要你的 S3/R2 凭据；脚本我可以写 |
| **账单与额度告警** | AWS 账单、Cloudflare 用量、Gmail 日额度都没有阈值 —— 被刷时不会第一时间知道 | 你的云控制台；步骤我可以写 |
| **公开文档里的源站 IP** | `docs/P0-01-DEPLOY.md` 里有 `18.216.101.31`。源站已只放行 Cloudflare，暴露危害大幅降低，但仍是公开信息 | 你定：留着方便运维，还是我抹掉 |
| **admin 后台加 2FA** | 目前只有密码，且对公网开放 | 产品决定 + 实现 |
| **fail2ban** | SSH 已只允许密钥（风险低），但 nginx/应用层的爆破只能靠应用自己的限流 | 我可做（装 + 配 jail） |
| **Cloudflare 侧规则** | 对 `send-verification-code` 这类「不需登录 + 有真实副作用」的端点加 Bot Fight / 速率规则 | 你的 Cloudflare 控制台 |

## 已知仍未修的依赖问题（与安全无关，但会挡 app）

`@nestjs/cli` 在根级（11）与 api（12）各一份，api 那份嵌套子树的传递依赖很脆弱：
一旦重新生成锁文件，`@sindresorhus/is`、`stdin-discarder` 这类会掉出来，`nest build` 直接失败。
**修法不是简单对齐版本**（试过 ✗）：需要钉住整串并在**临时克隆**里验证
「全新 `npm ci` → `nest build` → api 用例」全过，再动 master。app 的代码在 `ce4015f` 里等这一步。
