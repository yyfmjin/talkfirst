# 源站加固：只允许 Cloudflare 访问（2026-10-07）

## 为什么做

上线自查时实测发现：**把域名指到源站 IP 就能直接拿到 200** ——
也就是说 Cloudflare 的 WAF、限流、DDoS 防护**可以被整个跳过**，
而源站 IP 恰好写在**公开仓库**的 `docs/P0-01-DEPLOY.md` 里。

这类暴露的典型后果（也是「上线项目被搞」里最常见的一种）：攻击者绕开 CDN
直打源站，把它当免费的带宽与 CPU 用，账单和可用性一起出事。

## 做了什么

1. 从 Cloudflare 官方抓 IP 段，生成 `/etc/nginx/conf.d/cf-allow.conf`
   （每行一条 `allow <cidr>;`，IPv4 + IPv6）。
2. 在三个站点（web / api / admin）的 `location /` 里加两行：

   ```nginx
   location / {
       include /etc/nginx/conf.d/cf-allow.conf;
       deny all;
   ```

   `allow` 列表之外一律 **403**。用 `allow/deny` 而不是 `if`：前者是 nginx
   在 location 块里明确定义的语义，不踩 `if is evil` 那些坑。
3. `nginx -t` 通过后才 reload；配置原件备份在 `/root/nginx-site-backup-*.conf`。

## 实测（reload 之后）

| 路径 | 结果 |
|---|---|
| 经 Cloudflare：`talkfirst.ccwu.cc` / `api.…/health/ready` / `admin.…/login` | **200 / 200 / 200** |
| 非 Cloudflare 来源（本机回环 + Host 头，等价于任意直连） | **403** |
| 本机 `http://localhost:4000/api/v1/health/ready`（部署自检走这条，不过 nginx） | **200** |

第三行是特意验的：`scripts/deploy-pull.sh` 重启后自检的是**本机直连 4000**，
不经过 nginx —— 所以这个加固不会让部署自检变红。

## 要记住的两件事

1. **Cloudflare 的 IP 段会变**。段列表变了而这里没更新，表现是**站点突然
   大面积 403**。建议每月（或发现异常时）刷一次：

   ```bash
   sudo bash -c 'curl -sS https://www.cloudflare.com/ips-v4 | sed "s/^/allow /;s/\$/;/" > /etc/nginx/conf.d/cf-allow.conf'
   sudo bash -c 'curl -sS https://www.cloudflare.com/ips-v6 | sed "s/^/allow /;s/\$/;/" >> /etc/nginx/conf.d/cf-allow.conf'
   sudo nginx -t && sudo systemctl reload nginx
   ```

2. **回滚**：把 `/root/nginx-site-backup-*.conf` 覆盖回
   `/etc/nginx/sites-enabled/talkfirst.conf`，`nginx -t` 后 reload 即可。
   或者只删掉两份 `include …cf-allow.conf;` / `deny all;`。

## 还该做的（需要 Cloudflare / AWS 控制台权限）

- 源站 IP 从公开文档里撤掉（本仓库的 `docs/P0-01-DEPLOY.md` 里还有）；
- AWS 侧把安全组的 80/443 也限制到 Cloudflare 段（双保险）；
- 在 Cloudflare 上开 Bot Fight / 对 `/api/v1/auth/send-verification-code`
  这类**不需要登录且有真实副作用**的端点加规则。
