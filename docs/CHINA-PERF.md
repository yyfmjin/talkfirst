# 国内访问速度（2026-11-18）

> 起因：用户反馈「国内访问变慢了」。这份记录写清楚**慢在哪、已经改了什么、还差什么**，
> 免得下次又要从头量一遍。

## 1. 链路现状

```
国内用户 → Cloudflare 边缘（实测落在 SJC 圣何塞） → 源站 18.216.101.31（AWS 俄亥俄）
```

从国内实测（2026-11-18，经 CF）：

| 指标 | 实测 |
|---|---|
| TLS 握手 | ~1.0 s |
| TTFB（首页） | 1.8 – 8.9 s，抖动极大（丢包特征） |
| HTML（gzip 前 / 后） | 47 KB → **8.8 KB** |
| 首页 JS/CSS（gzip 后，11 个文件） | ~212 KB |
| 头像（改前） | **1.9 MB / 2.6 MB** |

**结论**：源站本身极快（本机 HTML TTFB 3–5 ms、API 2–15 ms），慢 100% 在跨洋链路上，
而且**字节数**和**往返次数**都在放大它。所以优化只做两件事：少搬字节、少往返。

## 2. 已经改了什么（都在源站侧，不需要额外账号）

### 2.1 上传的图片先缩再落盘

`apps/api/src/uploads/uploads.service.ts` → `saveImage()`

- 头像 512px 封顶、动态图 1600px 长边封顶，JPEG q82（mozjpeg）
- EXIF 摆正、透明底转白
- 压完更大就存原图；异常一律退回原图（不能因为优化把上传弄失败）

实测（生产）：上传 3.87 MB 照片 → 落盘 **56 KB**；线上历史图就地重压：
`1.87 MB → 45 KB`、`2.61 MB → 21 KB`。
头像目录总体积 4.5 MB → **124 KB**。

### 2.2 nginx：压缩 + HTTP/2 + TLS 会话复用

- `gzip` 原本是 Debian 默认：只压 `text/html`，且 `gzip_proxied` 为 **off** ——
  本站所有响应都是代理来的，等于没压。已补齐 `gzip_proxied any`、`gzip_types…`、`gzip_vary`。
- 三个 443 server 加 `http2 on;`（已验证 ALPN 协商到 h2）。
- `ssl_session_cache / ssl_session_timeout / ssl_session_tickets`：回访不再完整握手。

改动文件：`/etc/nginx/nginx.conf`、`/etc/nginx/sites-available/talkfirst.conf`。
两处都留了 `*.bak-<时间戳>` 备份。

**注意**：站点配置文件是 **CRLF** 行尾，写 sed 时 `$` 锚点匹配不到行尾，要用 `\r\?`。

## 3. 还差什么（需要 Cloudflare 权限）

源站侧能做的已经做完。剩下的三件事都在 Cloudflare 控制台 / API 上：

| 想要 | 为什么 | 需要 |
|---|---|---|
| **Cache Rule：缓存 HTML（如 60s + stale-while-revalidate）** | 现在首页是 `DYNAMIC`，每次访问都回源跨一次太平洋（TTFB 1.8–8.9 s）。缓存后回访接近边缘延迟 | CF API Token（Zone.Cache Rules:Edit） |
| Brotli + Tiered Cache | 前者再省 ~15% 字节，后者提高边缘命中率 | 同上（Zone 设置） |
| Argo Smart Routing（付费） | 走 CF 骨干网而不是公网，跨洋丢包明显缓解 | 付费项，需你确认 |

没有 CF 权限时能做到的上限就是「字节少了 80%、回访握手免了」，
**往返次数和丢包这件事只能靠边缘缓存或换线路解决**。

长期看，如果国内用户是主要人群，真正有效的方案是把源站放到香港/新加坡，
或接一家国内 CDN（`ccwu.cc` 未备案，国内 CDN 通常要求备案）。

## 4. 怎么验证

```bash
# 压缩是否生效（源站直连，带 SNI）
curl -sk --http2 --resolve talkfirst.ccwu.cc:443:127.0.0.1 \
  -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' https://talkfirst.ccwu.cc/
# 期望 ~8.8KB（未压缩 47KB）

# HTTP/2
curl -sk --http2 --resolve talkfirst.ccwu.cc:443:127.0.0.1 -o /dev/null \
  -w 'version=%{http_version}\n' https://talkfirst.ccwu.cc/
# 期望 version=2

# 头像体积
curl -s -o /dev/null -D - https://api.talkfirst.ccwu.cc/uploads/avatars/<xx>.png \
  | grep -iE 'content-length|cf-cache-status'
```
