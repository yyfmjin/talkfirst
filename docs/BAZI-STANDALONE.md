# 星座八字匹配（独立版）—— 部署记录（2026-11-08）

> 来源：`八字站源码包v2.zip`（上游是 Muse 全栈 artifact `xing-zuo-ba-zi-pi-pei`）。
> App 里的入口：`我的 → 按生日起中文名`（`apps/mobile/src/screens/BaziScreen.tsx`，WebView 打开）。

---

## 0. 结论

| 项 | 值 |
|---|---|
| 公网地址 | `https://talkfirst.ccwu.cc/bazi/` |
| 运行方式 | Docker 容器 `bazi-app`，镜像 `bazi-app:20261108`，`127.0.0.1:3100 → 3000` |
| 源码位置 | 服务器 `/opt/bazi` |
| 数据 | `/home/ubuntu/bazi-data/app.db`（SQLite 单文件，挂进容器 `/data`） |
| 备份 | 每日 03:30 cron → `/home/ubuntu/bazi-backups/`，保留 14 份 |
| 反向代理 | `/etc/nginx/sites-available/talkfirst.conf` 里的 `location /bazi/` |

## 1. 为什么挂在主域的 `/bazi/` 而不是子域

`bazi.ccwu.cc` 的 DNS **确实存在**（通配 `*.ccwu.cc`），但它指向另一台源站：
请求不会到这台机器的 nginx（`/var/log/nginx/access.log` 里没有任何该 Host 的记录），
而改 DNS 需要 Cloudflare 权限。

这个 SPA 的资源与接口都是**相对路径**（`./assets/…`、`./actions`），天然支持挂在子路径下，
所以选了路径部署。以后子域指到这台机器时：删掉 `location /bazi/` 那一段、启用
`/etc/nginx/sites-enabled/bazi.conf` 即可（该文件已写好，只是当前收不到流量）。

**结尾斜杠是契约**：`/bazi` 会 301 到 `/bazi/`，少了斜杠 `./actions` 会解析到站点根。

## 2. 发布 / 更新

```bash
# 1) 本机打包上传（源码包解压后）
tar czf bazi-app.tar.gz -C <解压目录> .
scp bazi-app.tar.gz ubuntu@18.216.101.31:/home/ubuntu/

# 2) 服务器上替换源码并重建镜像
sudo tar xzf /home/ubuntu/bazi-app.tar.gz -C /opt/bazi
cd /opt/bazi && sudo docker build -t bazi-app:<日期> .
sudo docker rm -f bazi-app
sudo docker run -d --name bazi-app --restart unless-stopped \
  -p 127.0.0.1:3100:3000 -v /home/ubuntu/bazi-data:/data bazi-app:<日期>
```

**不要**把 `app.db` 放进容器可写层：删容器就会丢全部用户数据。数据库只认 `/data` 这个卷。

## 3. 备份

`/home/ubuntu/bazi-backup.sh`：用 `VACUUM INTO` 在容器内生成一致性快照，再拷到
`~/bazi-backups/bazi-YYYYmmdd-HHMM.db`，保留最近 14 份。

为什么不是 `cp`：数据库正在被容器写入时，直接复制可能拿到写到一半的页。

## 4. 已知差异（来自源码包 README）

- `ctx.inference.complete` 没接推理服务；AI 命理助手走确定性兜底文案，不崩但不会真的「推理」。
- `ctx.invalidateQueries` 是 no-op（单进程 SQLite，没有跨客户端失效需要）。

## 4.1 与 TalkFirst 的集成（2026-11-08）

**登录（SSO）**

App 打开 `…/bazi/#tf=<TalkFirst access token>`，页面把 token 交给 `loginWithTalkFirst`，
起名站拿它向 `GET /api/v1/users/me` 校验身份，按 `users.talkfirst_id` 找本地账号（没有就自动建），
换发自己的 30 天会话后**立即从地址栏抹掉 token**。fragment 不会发给服务器，不进访问日志。

**后台管理**

TalkFirst 后台新增 `/bazi` 页（`apps/admin/src/app/bazi/page.tsx`），通过
`GET/PATCH /api/v1/admin/bazi/{overview,users,settings}` 读写起名站数据。
TalkFirst API 侧是 `AdminBaziController`，带 `BAZI_SERVICE_SECRET` 调起名站的
`serviceAdmin` 动作；后者只放行白名单（概览 / 用户列表 / 读设置 / 存设置），
校验通过后临时借一个管理员会话执行、用完即删 —— 不绕过它自己的 `requireAdmin`。

两个环境变量：

| 变量 | 所在位置 | 说明 |
|---|---|---|
| `BAZI_BASE_URL` | TalkFirst `.env` | 默认 `http://127.0.0.1:3100` |
| `BAZI_SERVICE_SECRET` | 两边都要 | 共享密钥；起名站以容器 `-e` 传入 |

**日期选择器**

`<input type="date">` 在 Android WebView 里命中区偏移一行（点 2 号选到下面的数），
已换成三个原生下拉（年/月/日）。缺日/月时表单仍然提示「请选择出生日期」，不会默默补 1 月 1 日。

## 5. 验证清单

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://talkfirst.ccwu.cc/bazi/          # 200
curl -s -X POST https://talkfirst.ccwu.cc/bazi/actions \
  -H 'content-type: application/json' -d '{"action":"getSiteSettings","args":{}}'  # JSON，不是 HTML
sudo docker ps --filter name=bazi-app                                             # Up
```

2026-11-08 首次部署实测：HTML 200、两个静态资源 200、`getSiteSettings` 返回站点设置 JSON、
容器 `Up` 且 `RestartPolicy=unless-stopped`、主站与 API 未受影响。
