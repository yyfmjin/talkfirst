# 提审自检（一页版）

> 用途：真正点「提交审核」前，从上到下勾一遍。每条都能在 30 秒内验证。
> 详细背景见 `docs/PLAY-STORE.md`；本文只保留**动作**。

---

## A. 产物（5 条）

- [ ] AAB 存在且是**最新一次构建**：`D:\Android\play\talkfirst-<version>.aab`
- [ ] `versionCode` 比上一次上传的大（当前 `10`，versionName `0.1.10`）
- [ ] 签名用的是 Play 上传密钥（证书 SHA-256 以 `71:83:AE:` 开头）
- [ ] 权限里**没有**相机/录音/悬浮窗/存储：
      `aapt2 dump badging` 只应出现 `INTERNET`、`VIBRATE`、`ACCESS_NETWORK_STATE`、
      `FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- [ ] `targetSdkVersion = 36`

一键复核：

```bash
AAPT=/d/Android/sdk/build-tools/36.0.0/aapt2.exe
"$AAPT" dump badging /d/Android/play/talkfirst-0.1.4.aab 2>/dev/null | grep -E "^package|uses-permission"
```

## B. 商店资料（6 条）

- [ ] 应用名称 ≤30 字符（中文 `TalkFirst — 先聊再交朋友`）
- [ ] 简短说明 ≤80 字符
- [ ] 完整说明 ≤4000 字符，且**只写已经能用的功能**
- [ ] 图标 512×512：`store/play/icon-512.png`
- [ ] Feature Graphic 1024×500：`store/play/feature-graphic-1024x500.png`
- [ ] 手机截图 ≥2 张（现有 6 张）：`docs/play-assets/screenshot-*.png`

## C. 政策表单（6 条）

- [ ] 隐私政策网址：`https://talkfirst.ccwu.cc/legal/privacy`（浏览器打开是完整中文正文）
- [ ] 账号删除网址：`https://talkfirst.ccwu.cc/delete-account`
- [ ] 数据安全：按 `PLAY-STORE.md` §B.5 的表格填，**AI 对话要勾「共享给 Google」**
- [ ] 内容分级：按 §B.4 填，勾「用户可互相交流」「用户可发布内容」
- [ ] 目标受众：18+，不吸引儿童
- [ ] 广告：不含广告

## D. 应用访问权限（2 条）

- [ ] 选了「所有功能都需要登录」
- [ ] 填了测试账号，且**当场用它登录过一次**确认能进
      （现成账号见 `docs/PLAY-REVIEW-ACCOUNT.md`；改过密码就同步更新）
- [ ] 备注里写了三条路径：AI 陪练在哪、怎么发动态、怎么举报/拉黑

## E. 提审前最后一遍真机（4 条）

- [ ] 从**内部测试轨道**装一次（不是侧载 APK），能正常启动
- [ ] Android 15/16 真机：状态栏、导航栏不遮内容（targetSdk 36 强制边到边）
- [ ] 走一遍注册 → 验证码 → 同意条款 → 发一条动态
- [ ] 聊天发一条消息，对方（另一台/网页端）能立刻收到

## F. 审核期间（2 条纪律）

- [ ] **不推 OTA**（`runtimeVersion = appVersion`，热更新会改变审核员看到的内容）
- [ ] 不在审核中改商店截图/描述

---

## 常见驳回原因（对照自查）

| 驳回理由 | 我们的对应动作 |
|---|---|
| 功能不可用 / 登录失败 | D 段测试账号 |
| 隐私政策打不开或与应用不符 | C 段第 1 条 + AI 共享声明 |
| 无法删除账号 | C 段第 2 条 + 应用内注销 |
| UGC 无举报/拉黑 | 应用内「我的 → 隐私与安全」 |
| 目标受众/分级填错 | C 段第 4、5 条 |
| 敏感权限未申报 | A 段第 4 条 |
