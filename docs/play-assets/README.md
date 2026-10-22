# Play 商店素材

| 文件 | 用途 | 规格 |
|---|---|---|
| `icon-512.png` | 商店页图标 | 512×512 PNG |
| `feature-graphic-1024x500.png` | 商店页顶部横幅 | 1024×500 PNG（**无 alpha**） |
| `screenshot-1-login.png` | 登录页 | 1170×2532 |
| `screenshot-2-moments.png` | 动态时间线 | 1170×2532 |
| `screenshot-3-discover.png` | 发现（每日推荐） | 1170×2532 |
| `screenshot-4-messages.png` | 消息列表 | 1170×2532 |
| `screenshot-5-chat.png` | 聊天窗口 | 1170×2532 |
| `screenshot-6-ai.png` | AI 朋友 | 1170×2532 |

## 截图怎么来的

演示账号 `review@talkfirst.ccwu.cc`，Playwright 在 **390×844 @3x** 下抓 6 个界面：

```bash
# 1) 本地起网页端（接口会被脚本全部拦掉）
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 npm run dev -w @talkfirst/web
# 2) 另一个终端
node scripts/play-screenshots.mjs
```

`fixtures.json` 是从**真实接口**抓下来的演示账号数据（Mia、4 条动态、和 Ben 的会话、
AI 朋友小暖）。脚本把 `/api/v1/*` 全部替换成这些固定响应，所以：

- 页面是真实组件渲染出来的，不是画出来的 mockup；
- 不依赖这台机器到生产 API 的网络（它会时不时挂几十秒，页面就停在「正在加载」）。

每张截图旁边有同名 `.txt`，是截图那一刻页面上的文字，用来确认「没有截到加载中/报错页」。

## 想要严格的原生截图

用同一个演示账号在手机上拍同样六个界面即可，文件名保持一致，Play 后台直接替换。
（构建机驱动不了模拟器：`adb` 一启动就把终端挂住。）

## 重新生成图标与横幅

```bash
python docs/play-assets/make-assets.py
```
