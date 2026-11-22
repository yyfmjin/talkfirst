# 部署与服务器清单（2026-11-20）

> 这份文档存在的理由：2026-11-20 服务器整机不可达（EC2 实例疑似被关停），
> 当时要回答一个问题——**代码是全在本地/远端仓库里，还是有东西只活在服务器上？**
> 结论是：代码全在；但有四样东西只在那台机器上。这份清单把它们写下来，
> 下次不必再从对话里翻。

## 1. 拓扑

```
用户 / App
   │
   ├─ talkfirst.ccwu.cc      ─┐
   ├─ api.talkfirst.ccwu.cc  ─┼→ Cloudflare（DNS 在 CF，橙色云开启）→ 源站 18.216.101.31
   ├─ admin.talkfirst.ccwu.cc ─┤                                        (AWS EC2, us-east-2)
   └─ talkfirst.ccwu.cc/bazi/  ┘                                              │
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────────┘
   │  宿主机（Ubuntu, nvm node v22.23.3, pm2 管理）
   ├─ talkfirst-api    :4000   ← /home/ubuntu/talkfirst/apps/api/dist/main.js
   ├─ talkfirst-web    :3000   ← Next.js
   ├─ talkfirst-admin  :3001   ← Next.js
   ├─ bazi-app         容器，127.0.0.1:3100 → 3000  ← /opt/bazi（bun）
   └─ PostgreSQL       127.0.0.1:5432（数据库 talkfirst / 用户 talkfirst）
```

nginx：`/etc/nginx/sites-available/talkfirst.conf`（三个 server 块，均启用 HTTP/2），
`/etc/nginx/conf.d/cf-allow.conf`（只放行 Cloudflare 回源），
`gzip` 选项在 `/etc/nginx/nginx.conf`（需 `gzip_proxied any`，否则代理响应不压缩）。

## 2. 哪些东西**不在** git 里（重建时要注意）

| 东西 | 位置 | 丢了会怎样 | 恢复方式 |
|---|---|---|---|
| **起名网完整源码** | `/opt/bazi` | 本地 `apps/bazi/` 只有**我们改过的 7 个文件**（见其 README），整站无法重建 | 只能从服务器打包；或原始 `八字站源码包v2.zip` |
| **生产 `.env`** | `/home/ubuntu/talkfirst/.env` | JWT_SECRET / SMTP 密码 / `BAZI_SERVICE_SECRET` 全失效 | 重新生成（代价：所有人重新登录、邮件发不出、起名站后台断连） |
| **用户数据** | Postgres 数据目录；`apps/api/.local-data/uploads/`；`/home/ubuntu/bazi-data/app.db` | 头像/动态图/聊天记录/起名站账号 | 只能靠备份；**先确认这两个备份目录有没有在跑** |
| **nginx / pm2 / cron 配置** | `/etc/nginx/**`；`pm2 list` 的进程定义；`crontab -l` | 站点起不来、备份任务丢失 | 本文档第 1 节 + `scripts/deploy-pull.sh` 的重启逻辑 |

**在 git 里的**：三端全部源码、Prisma schema 与全部迁移、`docs/`、`scripts/`（含 `deploy-pull.sh`）。
发布 = `git push` + 服务器上跑 `deploy-pull.sh`（拉取→npm ci→构建→迁移→重启）。

## 3. 实例起来后的 15 分钟清单

```bash
# 0) 先确认 IP 没变（没绑弹性 IP 的话，重启就会换）
ssh ubuntu@<当前公网IP> 'hostname; uptime'

# 1) 服务状态
systemctl is-active nginx
export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH   # ← 非交互 shell 里没有 node
pm2 list                                                          # 期望 api/web/admin 三个 online
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/api/v1/health/ready   # 期望 200

# 2) 公网
curl -s -o /dev/null -w 'site=%{http_code}\n'  https://talkfirst.ccwu.cc/
curl -s -o /dev/null -w 'api=%{http_code}\n'   https://api.talkfirst.ccwu.cc/api/v1/health/ready
curl -s -o /dev/null -w 'admin=%{http_code}\n' https://admin.talkfirst.ccwu.cc/

# 3) 起名站容器
sudo docker ps --filter name=bazi-app
curl -s -o /dev/null -w 'bazi=%{http_code}\n' https://talkfirst.ccwu.cc/bazi/

# 4) 立刻把「只在这台机器上」的东西拉回本地（一旦再来一次就晚了）
tar czf /tmp/talkfirst-infra-$(date +%F).tar.gz \
    /home/ubuntu/talkfirst/.env /etc/nginx/sites-available/talkfirst.conf /etc/nginx/conf.d \
    /opt/bazi --exclude=/opt/bazi/node_modules
crontab -l > /tmp/cron.txt; pm2 jlist > /tmp/pm2.json
# 再把这几个文件 + bazi 数据卷快照 存到本地/私有存储
```

## 4. 坑（都踩过）

- **`pm2`/`node` 在非交互 SSH 里找不到**：node 在 nvm 下，部署前必须
  `export PATH=/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH`。
- **`deploy-pull.sh` 要求工作区干净**：服务器上直接改文件会让下次部署中止。
- **nginx 站点配置是 CRLF 行尾**：`sed` 里 `$` 锚点匹配不到行尾，模式里要带 `\r\?`。
- **`gzip_proxied` 默认是 off**：本站响应全走代理，不显式设成 `any` 等于没开压缩。
- **本地 Docker 与生产无关**：本地 compose 只跑 postgres/redis，API 用 `node dist/main.js`
  直接跑；容器内 `npm ci` 在没有代理时会 ECONNRESET（见 `docs/local-start.md`）。

## 5. 待补的洞

1. **起名网源码没有完整副本** —— 最高优先级。它整套只活在 `/opt/bazi`。
2. 生产 `.env` 没有离线备份（密钥类，不应进 git；建议放密码管理器）。
3. 数据库与上传目录的备份策略没验证过（有 `scripts/backup-db.sh`，但生产是否在跑未知）。
4. 实例没绑弹性 IP —— 重启换 IP 就会全站不可用，且 Cloudflare 指向空地址。
