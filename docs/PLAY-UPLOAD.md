# Play 上架：手动一次 + 之后全自动

> 现状（2026-11-06）：代码侧已就绪 —— AAB `versionCode 15`（`D:\Android\play\talkfirst-0.1.15.aab`，
> 16 KB 对齐通过，上传密钥 `71:83:AE:…`），但**应用在 Play Console 里还没建**，
> 所以现在没有"提交审核"这个动作可点。
>
> Play 的公开 API **不能**创建应用、填商店资料、填数据安全表单、做内容分级。
> 这些必须人工在 Console 点一次；点完之后，后面每次发版都可以用
> `scripts/upload-aab-to-play.mjs` 一条命令上传。

## 一、一次性手动（Console，约 30 分钟）

按顺序做，每步都在 Play Console 左侧菜单里：

| # | 位置 | 做什么 | 素材/口径 |
|---|---|---|---|
| 1 | 所有应用 → 创建应用 | 名称 `TalkFirst`、默认语言中文、类型「应用」、免费 | — |
| 2 | 商店 → 主要商店商品详情 | 应用名称 ≤30 字、简短说明 ≤80 字、完整说明 ≤4000 字 | 文案见 `docs/PLAY-STORE.md` §B |
| 3 | 同上 → 图形素材 | 图标 512×512、Feature Graphic 1024×500、手机截图 ≥2 张（现有 6 张） | `store/play/`、`docs/play-assets/` |
| 4 | 政策 → 应用内容 → 内容分级 | 填问卷（用户可交流 / 可发布内容） | `docs/PLAY-STORE.md` §B.4 |
| 5 | 政策 → 应用内容 → 数据安全 | 按表填；**语音动态要声明「音频」**；AI 对话按 §B.5 勾 | `docs/PLAY-STORE.md` §B.5 |
| 6 | 政策 → 应用内容 → 目标受众 | 18+，不吸引儿童 | — |
| 7 | 政策 → 应用内容 → 广告 | 不含广告 | — |
| 8 | 发布 → 国家/地区 | 选择要上架的地区 | — |
| 9 | 政策 → 应用访问权限 | 选「所有功能都需要登录」，填审核账号 `review@talkfirst.ccwu.cc` / `TalkFirst-Review-2026`，备注写清 AI 陪练/发动态/举报路径 | `docs/PLAY-REVIEW-ACCOUNT.md` |
| 10 | 测试 → 内部测试 | 创建轨道，加至少 1 个测试人员邮箱 | 首次上传后才有版本可选 |

做完第 10 步，应用就"存在"了 —— 之后才能用脚本推 AAB。

## 二、自动化上传（一次性配置 + 以后一条命令）

### 2.1 建服务账号（一次）

1. Google Cloud Console → 选一个项目（没有就新建）→ **API 和服务 → 库** →
   启用 **Google Play Android Developer API**。
2. **API 和服务 → 凭据 → 创建凭据 → 服务账号**，名字随意（如 `talkfirst-ci`）。
3. 进入该服务账号 → **密钥 → 添加密钥 → 创建新密钥 → JSON**，下载。
   把文件放到**仓库外**，例：`D:\Android\play\service-account.json`（不要提交进 git）。
4. 复制服务账号邮箱（`xxx@yyy.iam.gserviceaccount.com`）。
5. Play Console → **用户和权限 → 邀请新用户** → 填这个邮箱 →
   权限选 **发布管理员**（Administrator 也行）→ 应用范围勾上 TalkFirst。

### 2.2 上传

```bash
# 先空跑，确认参数和包名（不联网）
node scripts/upload-aab-to-play.mjs --aab D:/Android/play/talkfirst-0.1.15.aab --dry-run

# 传到内部测试轨道，先存成 draft（推荐：Console 里确认后再点发布）
node scripts/upload-aab-to-play.mjs \
  --key D:/Android/play/service-account.json \
  --aab D:/Android/play/talkfirst-0.1.15.aab \
  --track internal --status draft \
  --notes "毛玻璃改版 + 字号/圆角收敛"

# 直接进入测试轨道（内部测试不需要审核，测试人员立刻能装）
node scripts/upload-aab-to-play.mjs --key ... --aab ... --track internal --status completed

# 生产：走审核（提审后仍要在 Console 点「发布」，除非用 --status completed）
node scripts/upload-aab-to-play.mjs --key ... --aab ... --track production --status completed
```

参数：

| 参数 | 含义 |
|---|---|
| `--key` | 服务账号 JSON 路径（**必填**，除 `--dry-run`） |
| `--aab` | AAB 路径（必填） |
| `--track` | `internal` / `alpha` / `beta` / `production`，默认 `internal` |
| `--status` | `draft`（默认，先不发布）/ `completed`（提交到该轨道）/ `halted` |
| `--notes` | 本次更新说明（中文） |
| `--package` | 覆盖包名，默认 `com.talkfirst.app` |
| `--dry-run` | 只校验文件与参数 |

### 2.3 常见报错

| 报错 | 原因 |
|---|---|
| `401` / `invalid_grant` | 服务账号 JSON 不对，或系统时间偏差过大 |
| `403` | 服务账号在 Play Console 里没被邀请，或没勾这个应用 |
| `404` + 包名 | 应用还没在 Console 创建（回去做第一节第 1 步） |
| `versionCode … already used` | 这个 versionCode 传过了，重新出包（`app.json` 的 `versionCode` +1） |
| `APK/AAB 的签名不对` | 用了本机侧载密钥而不是 Play 上传密钥（`71:83:AE:…`） |

## 三、安全

- 服务账号 JSON 等同发版权限：只放本机/CI 密钥目录，**永不提交**（`.gitignore` 已加
  `service-account*.json`、`*play-upload*.json`）。
- 不要把密钥贴进对话或文档。
