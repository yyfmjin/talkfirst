# Play 审核演示账号 + 提交流程（2026-10-22）

## 一、演示账号

| 项 | 值 |
|---|---|
| 邮箱 | `review@talkfirst.ccwu.cc` |
| 密码 | `TalkFirst-Review-2026` |
| 昵称 | Mia（资料完整、18 岁以上） |
| 内容 | 4 条动态（含话题）、2 个会话（真人 + AI 朋友「小暖」）、发现页可刷到 3 个推荐用户 |

账号已通过邮箱验证（否则登录会被 `EMAIL_NOT_VERIFIED` 拦住，审核员会直接看到错误页）。

**复核结果（生产接口实测）**

```
登录            200
资料            Mia | 完整: true
动态            4 条
发现页推荐      3 人
会话            2 个 | DIRECT,AI
AI 朋友         小暖 | 消息 1
```

重新生成（幂等，已存在就登录补齐）：

```bash
ALLOW_SEED_DEMO_ACCOUNT=1 node scripts/seed-demo-account.mjs --base http://127.0.0.1:4000
```

> 注意：脚本注册出来的账号 `emailVerified=false`，第一次跑完要在库里翻一下：
> `update "User" set "emailVerified"=true where email='review@talkfirst.ccwu.cc';`
> 然后再跑一次，动态/会话/AI 才会建起来。

## 二、Play Console「App access」怎么填

选择：**所有功能都需要登录**（All functionality is restricted）

```
Email:    review@talkfirst.ccwu.cc
Password: TalkFirst-Review-2026
```

说明栏可以写：

> The app is a language-exchange social app. All features are behind sign-in.
> The demo account above is pre-verified and has sample content (moments,
> conversations, AI friend). No 2FA, no SMS code, no invite needed.

## 三、建议的审核路径（写进说明，减少来回）

1. 登录 → 底部「动态」：时间线
2. 「发现」：每天推荐用户，可打招呼
3. 「消息」：会话列表 → 点进去聊天；顶部「AI 朋友」→ 和 AI 聊天
4. 「我的」：资料、隐私、安全中心（拉黑/举报记录）、注销账号
5. 注册页（可退出登录后看）：条款与隐私的同意闸门

## 四、还要交的商店素材

| 素材 | 规格 | 状态 |
|---|---|---|
| 应用图标 | 512×512 PNG | ✅ `docs/play-assets/icon-512.png` |
| Feature graphic | 1024×500 PNG（无 alpha） | ✅ `docs/play-assets/feature-graphic-1024x500.png` |
| 手机截图 | ≥2 张，1080×1920 以上 | ❌ **待补** |

**截图怎么拍**（手机装最新包，用上面的演示账号登录）：

1. 登录页（含「Google / Facebook / 邮箱」三种登录方式）——展示入口
2. 动态时间线（有内容、不像空壳）
3. 聊天页（和 AI 朋友的对话，展示核心功能）

拍摄注意：关掉通知横幅、别露出手机号/真实姓名、竖屏、不要裁掉状态栏。

拍好把文件放进 `docs/play-assets/`，命名 `screenshot-1-*.png` 依此类推。

## 五、其它要填的 URL

| 表单项 | 值 |
|---|---|
| 隐私政策 | `https://talkfirst.ccwu.cc/legal/privacy` |
| 账号删除 | `https://talkfirst.ccwu.cc/delete-account` |
| 应用类别 | 社交 / 通讯 |
| 目标受众 | 18 岁以上 |
| 广告 / 新闻 / 政府 / 健康 / 金融 | 全部「否」 |
