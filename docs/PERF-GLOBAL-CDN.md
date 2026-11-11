# 全球访问提速：按地域优化的落点

> 2026-11-11。这份文档回答一个问题：**「针对不同访问 IP 做速度优化」在这个项目里到底该做什么。**
> 只谈性能，不涉及任何内容/结构变更。

## 一、结论先说

这个应用是「**预渲染静态壳 + 客户端取数**」：

- 所有路由都是静态预渲染（响应头 `x-nextjs-prerender: 1`、`x-nextjs-cache: HIT`、`Cache-Control: s-maxage=31536000`），
  包括 `/moments`、`/messages` 这些「看起来登录后才能看」的页面 —— HTML 对所有访客完全相同。
- 页面里的数据一律由浏览器带 cookie 调 `api.talkfirst.ccwu.cc` 取，API 响应是**用户相关、不可共享缓存**的。

所以对全球访客来说：

| 组成 | 能否就近送达 | 结论 |
| --- | --- | --- |
| HTML / JS / CSS / 图标 | **能**，CDN 边缘缓存 | 目前**没开**，每次回源 → 这是最大的一块 |
| API 响应 | 不能（用户态） | 每个请求 = 1 次到源站的往返，次数已是最少的（并行发出） |

**因此「按 IP 优化」的正确位置是 CDN 的路由与缓存策略，而不是应用代码分支。**

## 二、为什么不在代码里按 IP 分流

唯一的做法是前端先请求 `https://<你的域名>/cdn-cgi/trace` 拿到 `loc=CN`，再据此切换策略。问题是：

- 这本身就是**一次往返**；
- 它换来的是「少发一次预取」这种**只值一次往返**的收益。

净收益为零甚至为负。而且「哪里的用户慢」不等于「哪个国家的用户慢」：同一国家里既有光纤也有 3G。

所以代码侧改成**按真实链路质量自适应**（`src/lib/network-profile.ts`）：
读 `navigator.connection` 的 `saveData / effectiveType / rtt / downlink`，零请求、零延迟。
明确报告为慢链路（saveData、2g/3g、RTT≥400ms、下行≤1.5Mbps）时，关闭路由预取；
拿不到信号（Safari/Firefox 没有该 API）时按「不慢」处理，不误伤。

## 三、三档方案

### A. 零成本，建议立刻做

1. **让 HTML 上边缘缓存** —— 最大的一笔。
   Cloudflare → Rules → Cache Rules → Create：
   - When: `URI Path` matches `/*`
   - Then: Cache eligibility **Eligible**；Edge TTL **Use cache-control header if present**
   - Browser TTL 保持默认（不要覆盖源站）
   验收：`curl -sI https://talkfirst.ccwu.cc/ | grep cf-cache-status` 应为 `HIT`（现在是 `DYNAMIC`）。
2. **关掉 Cloudflare Web Analytics 的自动注入**。
   `static.cloudflareinsights.com/beacon.min.js` 在国内经常卡住，实测占掉 1.2s。
3. **APK 不要走站点**。`/apk/talkfirst.apk` 是 36MB，国内拉取极慢 → 放 R2/对象存储，官网只放链接。

### B. 测试阶段性价比高（付费，但便宜）

4. **Smart Tiered Cache**：跨 PoP 缓存分层，减少回源、提高命中率。免费/Pro 都可用（开启即可）。
5. **Argo Smart Routing**：让「动态 API 请求」走实测最优的骨干路径（约 $5/月 + 流量）。
   这一条对 `/api/v1/*` 这种不能缓存的请求最有价值。
6. **HTTP/3 / 0-RTT**：确认 CF 侧开启（默认开），对高延迟链路减少握手往返。

### C. 真正的「按 IP 就近」——架构级

7. **第二地域源站 + 地理调度**
   - 在另一个大区（如欧洲）跑同一套镜像（容器即可，只读），
   - CF → Traffic → Load Balancing：Geo Steering（亚洲 → 现有源，欧洲/美洲 → 新源）。
   - 前提：数据库要跨区读（主从/只读副本），否则 API 仍被单点拖住。
   测试阶段流量小，可先不做；等有真实海外用户反馈再上。
8. **中国大陆**
   国内访问的物理延迟，靠 CF 免费/Pro 版无解（落地在境外）。
   要真正解决只有两条路：**ICP 备案 + 国内 CDN 回源**，或 **Cloudflare China Network**（需备案 + 企业套餐）。

## 四、开启缓存前必须确认的风险

- **不要缓存 API 的 JSON**。这些接口按 `Accept-Language` 返回不同语言，而 Cloudflare 默认不按该头分键 ——
  一旦被缓存就会出现「中文用户看到英文数据」。确实要缓存，必须同时：
  响应加 `Vary: Accept-Language`，并在 CF 的 Cache Key 里加入该请求头。
- Next 的预取请求带 `?_rsc=` 查询串，按 URL 缓存天然与文档请求分开，不会串。
- `/apk/*` 已有 `public, max-age=300, must-revalidate`（`next.config.ts`），别被 Cache Rule 覆盖成长期缓存。

## 五、怎么验收

```bash
# TTFB 与 TLS 握手
curl -sS -o /dev/null -w 'ttfb=%{time_starttransfer} tls=%{time_appconnect} total=%{time_total}\n' \
  https://talkfirst.ccwu.cc/

# 边缘缓存是否生效（应为 HIT）
curl -sI https://talkfirst.ccwu.cc/ | grep -i 'cf-cache-status\|cache-control'
```

浏览器侧看 DevTools → Network 的 Protocol（h2/h3）、`cf-cache-status`、以及请求数。
本仓库可用 Playwright 脚本按固定节流参数做前后对比（本轮优化即用此法验收）。

## 六、本轮已完成的代码优化（不含内容变更）

| 改动 | 文件 | 效果 |
| --- | --- | --- |
| API / Socket 域 `dns-prefetch` + `preconnect` | `src/app/layout.tsx` | 首次接口调用省掉一次 DNS+TLS（实测 1.3–2.3s） |
| 公开页把 `/users/me` 探测推到 `load` 之后 | `src/lib/session.tsx` | 首屏不再被 2.6s 的接口抢带宽 |
| 官网登录入口 / APK 入口关预取 | `src/marketing/official-site.tsx` | 首屏少拉一整个登录页 JS（实测省 2s） |
| 慢链路下自动关预取 | `src/lib/network-profile.ts`、`tf/button.tsx`、`tf/nav.tsx`、`tab-bar.tsx` | 3G/省流量用户不再为预取付带宽 |
| 顶栏未读红点首次拉取延后 600ms | `src/components/tab-bar.tsx` | 少 2 个请求与页面数据争抢 |
