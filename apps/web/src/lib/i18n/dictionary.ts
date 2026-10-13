import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * web 端文案词典。
 *
 * ## 覆盖范围（重要）
 *
 * 这里**不是**整站文案，只装了已经双语化的那几个面 —— 截至 2026-10-13：
 *
 *   已双语  启动屏 `/`、官网 `/site`、登录 `/login`、注册 `/register`、
 *           找回密码 `/reset`、邮箱验证 `/verify`，以及同意闸门与两份正文
 *           （`/legal`、`/legal/terms`、`/legal/rules`）
 *   未双语  隐私政策 `/legal/privacy`、成员端内部（发现 / 动态 / 消息 / 我的 /
 *           引导 / 通知 …）—— 合计约 900 条，得一批一批搬
 *
 * **没搬过来的页面不要假装它有英文版**：它们的 `en` 路由还不存在，英文站点上的
 * 链接也不会指向它们（见 `locales.ts`）。顺序是「先把页面译完，再把指向它的链接
 * 改成 `localePath()`」—— 反过来做就是 404。
 *
 * ## 为什么 `en` 的类型是 `Record<MsgKey, string>`
 *
 * 与移动端同一手法：中文是源语言，英文少一条就编译不过。i18n 最常见的坏味道是
 * 某条只翻了一半（界面上表现为「英文里夹着中文」），不报错、没人发现。
 *
 * ## 命名
 *
 * `面.用途`：`site.navFeatures`、`welcome.headline`、`common.retry`。
 * 变量用 `{name}` 占位，整句进词典 —— 不拼字符串，因为语序在两种语言里不一样。
 */

export type MsgParams = Record<string, string | number>;

export const zh = {
  /* ───────────────────────── 通用 ───────────────────────── */
  "common.switchToOtherLanguage": "切换到 {language}",

  /* ─────────────────── 登录 / 注册（成员端） ─────────────────── */
  "auth.loginSubtitle": "很高兴再次见到你",
  "auth.welcomeBack": "欢迎回来",
  "auth.createAccount": "创建账号",
  "auth.login": "登录",
  "auth.register": "注册",
  "auth.email": "邮箱地址",
  "auth.emailPlaceholder": "请输入邮箱地址",
  "auth.password": "密码",
  "auth.errorInvalidEmail": "请输入有效的邮箱地址。",
  "auth.errorInvalidCredentials": "邮箱（或用户名）与密码不对，请重新输入。",
  "auth.errorEmailTaken": "这个邮箱已经注册过了，直接登录即可；忘了密码可以点「忘记密码」。",
  "auth.identifierLabel": "邮箱或用户名",
  "auth.identifierPlaceholder": "请输入邮箱地址或账户名",
  "auth.passwordLabel": "密码",
  "auth.passwordPlaceholder": "请输入密码",
  "auth.loggingIn": "登录中…",
  "auth.registering": "注册中…",
  "auth.or": "或",
  "auth.orOAuthRegister": "或使用以下方式注册",
  "auth.forgotPassword": "忘记密码？",
  "auth.noAccount": "还没有账号？",
  "auth.toRegister": "立即注册",
  "auth.haveAccount": "已有账号？",
  "auth.toLogin": "立即登录",
  "auth.errorMissingIdentifier": "请填写邮箱或账户名和密码。",
  "auth.errorSignInFailed": "登录失败，请稍后再试",
  "auth.errorVerificationEmailOnly": "验证码只能发送到邮箱地址，请填写邮箱后重试。",
  "auth.noticeCodeSent": "验证码已重新发送，请查收邮箱。",
  "auth.errorCodeSendFailed": "验证码发送失败，请稍后再试。",
  "auth.noticeVerificationPending": "尚未检测到验证结果，请先输入邮箱验证码。",
  "auth.verifyToSignIn": "完成邮箱验证后即可正常登录。",
  "auth.resendVerification": "重新发送验证邮件",
  "auth.recheckVerification": "我已完成验证，重新检查",
  "auth.errorEmailNotVerified": "邮箱尚未验证，请先完成邮箱验证。",
  "auth.registerSubtitle": "加入 TalkFirst，认识更多有趣的人",
  "auth.usernameLabel": "账户名（可选）",
  "auth.usernamePlaceholder": "8–30 位字母或数字，留空则自动生成",
  "auth.passwordMin8": "至少 8 位密码",
  "auth.termsHint": "仅限 18 岁以上使用。注册即表示同意 ",
  "auth.termsSuffix": "。",
  "auth.errorPasswordMin8": "密码至少 8 位。",
  "auth.errorUsernameFormat": "账户名需为 8–30 位字母或数字。",
  "auth.errorUsernameTaken": "这个账户名已经被占用了，换一个试试。",
  "auth.errorUsernameReserved": "这个账户名不可用，换一个试试。",
  "auth.errorRegisterFailed": "注册失败，请稍后再试",
  "auth.oauthGoogle": "使用 Google{verb}",
  "auth.oauthLocal": "本地开发登录（假）",
  "auth.oauthError.OAUTH_PROVIDER_DISABLED": "该登录方式当前不可用，请使用邮箱登录。",
  "auth.oauthError.OAUTH_TOKEN_INVALID": "Google 返回的登录凭据无法验证，请重新尝试。",
  "auth.oauthError.OAUTH_STATE_INVALID": "这次登录已超时或不是从这里发起的，请重新点击登录。",
  "auth.oauthError.OAUTH_EXCHANGE_FAILED": "与 Google 的通信失败，请稍后重试。",
  "auth.oauthError.OAUTH_NONCE_MISMATCH": "这次登录校验失败，请重新尝试。",
  "auth.oauthError.OAUTH_EMAIL_UNVERIFIED":
    "Google 报告该邮箱尚未验证，无法用它登录。请先在 Google 账号中完成邮箱验证，或改用邮箱注册。",
  "auth.oauthError.OAUTH_EMAIL_REQUIRED": "Google 没有提供邮箱地址，无法用它创建账号。请改用邮箱注册。",
  "auth.oauthError.OAUTH_FAILED": "快捷登录失败，请稍后重试或改用邮箱登录。",
  "auth.oauthError.OAUTH_ACCOUNT_EXISTS_PASSWORD":
    "该邮箱已经注册过。请用邮箱和密码登录，然后可以在设置里绑定 Google。",
  "auth.oauthError.OAUTH_ACCOUNT_EXISTS_GOOGLE": "该邮箱已经用 Google 注册过。请直接用 Google 登录。",
  "auth.oauthError.OAUTH_ACCOUNT_EXISTS_OTHER":
    "该邮箱已经注册过。请用邮箱登录，或先通过「忘记密码」设置一个密码。",

  /* ───────────────────────── 启动屏（/） ───────────────────────── */
  "welcome.headlineLine1": "先聊聊，",
  "welcome.headlineLine2": "再成为朋友",
  "welcome.body":
    "在 TalkFirst，你不必先成为朋友才开口。从一句「你好」开始，聊得来，再决定要不要认识。",
  "welcome.start": "开始",
  "welcome.register": "我还没有账号，去注册",
  "welcome.ageNotice": "仅限 18 岁以上使用",
  "welcome.title": "先聊聊，再成为朋友",
  "welcome.description":
    "TalkFirst 是一个语言交换与跨文化社交应用：先和陌生人聊得来，再决定要不要成为朋友。",

  /* ───────────────────────── 官网（/site） ───────────────────────── */
  "site.metaTitle": "官网 —— 下载应用",
  "site.metaDescription":
    "TalkFirst 先聊：语言交换与跨文化社交应用。先聊聊，再成为朋友。Android 内测版可直接下载安装。",
  "site.homeLabel": "TalkFirst 官网首页",
  "site.navLabel": "页面导航",
  "site.navProduct": "产品",
  "site.navHow": "怎么用",
  "site.navSafety": "安全",
  "site.navDownload": "下载",
  "site.signIn": "登录 / 注册",
  "site.heroBadge": "内测中 · Android 可装",
  "site.heroTitle": "先聊聊，再成为朋友。",
  "site.heroBody":
    "TalkFirst 是一个语言交换与兴趣社交应用。它不让你先「通过」再尬聊，而是先聊得下去，再决定要不要加好友 —— 所以第一步是打招呼，不是滑卡片。",
  "site.downloadApk": "下载 Android 版（APK）",
  "site.apkBuilding": "内测包生成中",
  "site.tryWeb": "先在浏览器里用",
  "site.heroNote":
    "内测版：功能会持续更新，安装包直接下载安装，不需要应用商店。 iOS 版在准备中。",
  "site.featuresTitle": "它是什么",
  "site.featuresIntro": "三件事，按重要程度排：语言、兴趣、以及「先聊天」这个顺序。",
  "site.featureLanguagesTitle": "语言交换",
  "site.featureLanguagesBody":
    "你会中文、对方想学中文；对方会英语、你想练英语。话题从语言本身开始，不用硬找共同点。",
  "site.featureInterestsTitle": "兴趣搭子",
  "site.featureInterestsBody":
    "游戏、音乐、电影、旅行 —— 按兴趣找人，聊的是事情本身，不是「在吗」。",
  "site.featureTalkFirstTitle": "先聊，再连",
  "site.featureTalkFirstBody":
    "打招呼 → 对方接受 → 才能互发消息。没有滑卡片，也没有一注册就被一百个人私信。",
  "site.howTitle": "怎么用",
  "site.howStep1Title": "注册并说明你想练什么",
  "site.howStep1Body": "母语、在学的语言、兴趣和目的。推荐会照着这些来。",
  "site.howStep2Title": "在「发现」里打个招呼",
  "site.howStep2Body": "每天有限的推荐名额，逼你把话说完，而不是群发。",
  "site.howStep3Title": "双方接受后开始聊天",
  "site.howStep3Body": "聊得来再交换联系方式；不顺心随时可以拉黑。",
  "site.safetyTitle": "安全",
  "site.safetyIntro":
    "和陌生人说话是这个产品的全部意义，所以下面的每一条都必须是能做到的，而不是写在官网上的口号。",
  "site.safetyBullet1": "双方任何一侧都能拉黑与举报，举报会有人看。",
  "site.safetyBullet2": "动态与评论先过审再公开，不是发出去再说。",
  "site.safetyBullet3": "注册要验证邮箱，减少机器账号。",
  "site.safetyBullet4":
    "交换联系方式必须双方同意 —— 对方不同意，你的联系方式不会到达对方。",
  "site.downloadTitle": "下载",
  "site.androidName": "Android",
  "site.available": "可下载",
  "site.building": "生成中",
  "site.androidBody":
    "直接下载 APK 安装。第一次安装时系统会问「是否允许来自此来源的应用」，允许即可。",
  "site.downloadApkShort": "下载 APK",
  "site.iosName": "iOS",
  "site.comingSoon": "即将上线",
  "site.iosBody":
    "iPhone 版在准备中。在这之前，网页版能用到绝大部分功能：发现、动态、聊天、通知。",
  "site.useWeb": "用网页版",
  "site.footerNavLabel": "页脚导航",
  "site.legalTerms": "用户协议",
  "site.legalPrivacy": "隐私政策",
  "site.legalRules": "社区规则",
  "site.previewAuthor": "小秋",
  "site.previewMeta": "日本 · 3 分钟前",
  "site.previewBody": "今天在学「差不多」和「几乎」的区别，中文的同义词真的太微妙了。",
  "site.previewLikes": "赞 12",
  "site.previewComments": "评论 4",
  "site.previewBubble1": "你也在学日语吗？",
  "site.previewBubble2": "在学！我可以帮你纠中文。",
  "site.previewCaption": "应用内的样子（预览）",

  /* ─────────── 找回密码 ★ 邮箱验证码（网页端，与登录同一段旅程） ─────────── */
  "reset.title": "重置密码",
  "reset.subtitle": "用注册邮箱接收验证码，然后设置新密码。",
  "reset.email": "注册邮箱",
  "reset.emailPlaceholder": "请输入注册时使用的邮箱",
  "reset.code": "邮箱验证码",
  "reset.codePlaceholder": "6 位数字",
  "reset.sendCode": "发送验证码",
  "reset.resendIn": "{n}s 后可重发",
  "reset.sending": "发送中…",
  "reset.newPassword": "新密码",
  "reset.newPasswordPlaceholder": "至少 8 位",
  "reset.confirmPassword": "确认新密码",
  "reset.confirmPlaceholder": "再次输入新密码",
  "reset.submit": "重置密码",
  "reset.submitting": "重置中…",
  "reset.doneTitle": "密码已重置",
  "reset.doneBody": "为安全起见，其他设备上的登录已全部退出。请用新密码重新登录。",
  "reset.goSignIn": "前往登录",
  "reset.remembered": "想起来了？",
  "reset.backToSignIn": "返回登录",
  /*
   * 「如果该邮箱已注册…」这句不能说成「已找到你的账号」。服务端对每个地址都回同一
   * 个结果（正是为了不让人探到哪些地址注册过），文案一旦暗示「找到了」，这个保护
   * 就被自己人拆了。
   */
  "reset.noticeSent": "如果该邮箱已注册，我们已发送 6 位验证码，请查收（含垃圾邮件箱）。",
  "reset.errEmail": "请输入有效的邮箱地址。",
  "reset.errCode": "请输入 6 位数字验证码。",
  "reset.errPasswordMin": "新密码至少 8 位。",
  "reset.errPasswordMismatch": "两次输入的新密码不一致。",
  "reset.errCodeLocked": "验证码尝试次数过多，请重新发送验证码。",
  "reset.errSubmit": "重置失败，请稍后再试。",
  "reset.errSend": "验证码发送失败，请稍后再试。",

  "verify.title": "验证码",
  "verify.metaDescription": "输入邮件里的 6 位验证码，完成邮箱验证。",
  "verify.sentTo": "我们已发送验证码到你的邮箱",
  "verify.fallbackEmail": "你的邮箱",
  "verify.digitLabel": "验证码第 {n} 位",
  "verify.sent": "验证码已发送。",
  "verify.devCode": "开发模式验证码：{code}（点击自动填入）",
  "verify.resendIn": "重新发送 ({n}s)",
  "verify.resend": "重新发送",
  "verify.next": "下一步",
  "verify.backToSignIn": "返回登录",
  "verify.submitting": "验证中…",
  "verify.errSession": "会话已失效，请重新注册。",
  "verify.errCodeLength": "请输入 {n} 位验证码。",
  "verify.errSend": "发送失败，请稍后再试",
  "verify.errVerify": "验证失败，请稍后再试",

  /* ── 法律文本：同意闸门 · 用户协议 · 社区规则 ──
     这三份是**工程师起草的初稿，不是法律意见**（见 docs/LEGAL-TEXTS.md）。
     英文是忠实翻译，不是另一个版本：每页顶部都挂 `legal.translationNote`，
     说明以中文原文为准 —— 译文一旦被当成另一份有效文本，管辖与责任两节的
     差异就成了真问题。 */
  "legal.translationNote": "本页另有英文译本；两种文本如有出入，以中文原文为准。",

  "legal.gate.title": "用户协议与隐私政策",
  "legal.gate.intro": "为了让你清楚知道我们如何处理你的资料，注册前需要你确认以下两项。两项都会在注册流程中提供完整文本。",
  "legal.gate.acceptTerms": "我已阅读并同意用户协议",
  "legal.gate.acceptTermsHint": "包括账号规则、内容规范，以及 18 岁以上使用的年龄要求。",
  "legal.gate.acceptPrivacy": "我已阅读并同意隐私政策",
  "legal.gate.acceptPrivacyHint": "说明我们收集哪些资料、为什么收集，以及你如何查看、更正或删除它们。",
  "legal.gate.readTerms": "阅读用户协议全文",
  "legal.gate.readPrivacy": "阅读隐私政策全文",
  "legal.gate.note": "你可以随时在「我的 → 隐私与安全」里查看和调整资料可见范围，也可以注销账号要求删除全部资料。",
  "legal.gate.continue": "同意并继续",
  "legal.gate.needBoth": "请先勾选以上两项",

  /* 只用到标题：隐私政策正文是下一批（`legal.privacy.*`），但协议/规则两份的页脚
     都要用「隐私政策」这个名字去指它。 */
  "legal.privacy.title": "隐私政策",

  "legal.terms.title": "用户协议",
  "legal.terms.updated": "最近更新：2026 年 10 月",
  "legal.terms.intro": "这份协议说明你与 TalkFirst 之间的规则：你可以用这个产品做什么、我们会对你的内容做什么、出现问题时怎么处理。请连同《隐私政策》与《社区规则》一起阅读。",
  "legal.terms.s1.title": "1. 关于本协议",
  "legal.terms.s1.p1": "本协议适用于 TalkFirst 的手机应用与网站。运营方 TalkFirst，联系方式 support@talkfirst.ccwu.cc。",
  "legal.terms.s1.p2": "如果你不同意本协议，请不要注册或继续使用本产品。",
  "legal.terms.s2.title": "2. 使用资格",
  "legal.terms.s2.i1": "本产品仅限 18 岁以上使用。注册即表示你确认自己已满 18 岁。",
  "legal.terms.s2.i2": "一个邮箱对应一个账号，请勿代人注册或批量注册。",
  "legal.terms.s2.i3": "请提供真实可用的邮箱地址，它用于登录、找回密码与安全提醒。",
  "legal.terms.s3.title": "3. 账号与登录",
  "legal.terms.s3.i1": "注册时你会得到一个用户名，用于登录；昵称是展示给别人看的名字，两者可以不同。",
  /* 密码这一条原文把「无法读回原文」加了粗，所以只能拆三段。拆点是那个加粗位置：
     两边的英文接起来仍然是一句通顺的话（“...so **the original can never be read
     back**; if you forget it..."），不是把半句话拼成一句话。 */
  "legal.terms.s3.i2a": "密码由你设置并保管。我们以不可逆的哈希形式存储密码，",
  "legal.terms.s3.i2b": "无法读回原文",
  "legal.terms.s3.i2c": "；如果忘记，只能通过邮箱重置。",
  "legal.terms.s3.i3": "你也可以选择用 Google 账号登录或注册。这样创建的账号没有密码，你可以在之后自行设置一个。",
  "legal.terms.s3.i4": "请勿把账号转借、出租或出售。账号下发生的行为视为你本人的行为。",
  "legal.terms.s4.title": "4. 你的内容",
  "legal.terms.s4.i1": "你发布的动态、评论、消息、头像与个人介绍，著作权仍归你所有。",
  "legal.terms.s4.i2": "为提供服务所必需，你授予我们在产品内存储、展示并按你的可见范围设置向其他用户分发这些内容的许可。你调整可见范围或删除内容后，我们按新设置执行。",
  "legal.terms.s4.i3": "你需保证自己有权发布这些内容，且内容不违反法律与《社区规则》。",
  "legal.terms.s4.i4": "私聊内容只有会话参与者可见。请不要在未取得对方同意的情况下，把私聊内容转发或公开。",
  "legal.terms.s5.title": "5. 服务",
  "legal.terms.s5.p1": "我们提供个人资料展示、发现与连接、动态、聊天与通知等功能，并可能调整、增加或停止其中部分功能。产品目前免费提供；如将来引入收费功能，会另行征求你的同意。",
  "legal.terms.s5.p2": "产品按「现状」提供。我们会尽力保持它可用与安全，但无法保证服务永不中断、永不出现错误。",
  "legal.terms.s6.title": "6. 违规与处理",
  "legal.terms.s6.p1": "你需要遵守《社区规则》。违反时我们可能：提醒、下架或隐藏内容、限制部分功能、临时暂停账号（到期自动解除）、或永久封禁账号。情节严重的，例如涉及真实威胁或违法内容，会直接封禁。",
  "legal.terms.s6.p2": "你可以举报动态、评论、消息或用户。我们会把处理结果通知给举报人，并且不会向被举报人透露是谁举报的。",
  "legal.terms.s7.title": "7. 注销与终止",
  "legal.terms.s7.i1": "你可以在「我的」里随时注销账号。注销后，我们按《隐私政策》在合理期限内删除你的个人资料及其关联内容。",
  "legal.terms.s7.i2": "为安全审计所必需的记录会在《隐私政策》写明的期限内保留，不会随注销立即消失。",
  "legal.terms.s7.i3": "如果你严重违反本协议或法律，我们可能中止或终止向你提供服务。",
  "legal.terms.s8.title": "8. 责任范围",
  "legal.terms.s8.i1": "请自行判断与他人的交往。在法律允许的范围内，我们不对你与其他用户之间的纠纷负责。",
  "legal.terms.s8.i2": "我们不对因不可抗力、第三方服务中断（例如你使用 Google 登录时的 Google 服务）、或你自身设备与网络问题造成的损失负责。",
  "legal.terms.s8.i3": "以上责任边界以适用法律允许的最大范围为限；法律不允许限制的部分，不因本协议而受限。",
  "legal.terms.s9.title": "9. 协议变更",
  "legal.terms.s9.p1": "本协议如有实质性变更，我们会在应用内提示。继续使用即表示你接受更新后的协议；若不同意，你可以停止使用并注销账号。",
  "legal.terms.s10.title": "10. 适用法律与争议解决",
  "legal.terms.s10.p1": "如果你与我们之间发生争议，请先用上面的联系方式与我们联系，我们会尽力协商解决。协商不成时，交由运营主体注册地有管辖权的法院处理。",
  /* 页脚的「夹链接」句：拆分点都在链接两侧（名词短语边界），两种语言都能接得上。 */
  "legal.terms.morePre": "另外请阅读",
  "legal.terms.moreAnd": "与",
  "legal.terms.moreEnd": "。",

  "legal.rules.title": "社区规则",
  "legal.rules.updated": "最近更新：2026 年 10 月",
  "legal.rules.intro": "TalkFirst 想让你先聊得来、再决定要不要成为朋友。这需要每个人在这里都能放松地说话，所以下面这些是大家共同遵守的约定。本规则是《用户协议》的一部分。",
  "legal.rules.s1.title": "1. 我们的底线",
  "legal.rules.s1.i1": "尊重对方：语言交换与交朋友都建立在愿意沟通之上，不逼迫、不纠缠。",
  "legal.rules.s1.i2": "不伤害：任何形式的骚扰、威胁、仇恨与歧视都不被接受。",
  "legal.rules.s1.i3": "不欺骗：不冒充他人，不用虚假身份获取信任。",
  "legal.rules.s2.title": "2. 禁止发布的内容",
  "legal.rules.s2.i1": "辱骂、骚扰、威胁、跟踪他人，或持续纠缠；未经同意公开他人的隐私，例如住址、单位、联系方式、聊天记录截图。",
  "legal.rules.s2.i2": "针对种族、民族、宗教、性别、性取向、身体残障等的仇恨或歧视内容。",
  "legal.rules.s2.i3": "色情或露骨的性内容；任何与未成年人有关的性内容。",
  "legal.rules.s2.i4": "宣扬暴力、自伤或自杀，或教唆违法与危险行为。",
  "legal.rules.s2.i5": "垃圾信息与广告：批量私信、拉群、推广博彩、贷款、代充、刷单、虚拟币等。",
  "legal.rules.s2.i6": "违法交易，以及恶意链接、诈骗或恶意软件。",
  "legal.rules.s3.title": "3. 禁止的行为",
  "legal.rules.s3.i1": "批量注册账号、用脚本或机器人自动操作、爬取他人资料。",
  "legal.rules.s3.i2": "绕过他人的可见范围设置或拉黑，换号继续骚扰。",
  "legal.rules.s3.i3": "冒充他人或冒充官方，伪造身份与经历。",
  "legal.rules.s3.i4": "买卖、出租、借用或共享账号。",
  "legal.rules.s4.title": "4. 举报与处理",
  "legal.rules.s4.i1": "动态、评论、消息与用户都可以举报：请选择最贴近的理由，必要时补充说明。理由由服务端校验，不在列表内的理由会被拒绝。",
  "legal.rules.s4.i2": "举报人的身份不会被透露给被举报人。",
  "legal.rules.s4.i3": "我们可能采取的处理手段：提醒、下架或隐藏内容、限制部分功能、临时暂停账号（到期自动解除）、永久封禁账号。涉及真实威胁或违法内容的，直接封禁。",
  "legal.rules.s4.i4": "处理结果会通知举报人，让举报的人知道后续如何。",
  "legal.rules.s5.title": "5. 如果你被处理了",
  "legal.rules.s5.p1": "你可以通过 support@talkfirst.ccwu.cc 申诉，并请说明你的账号与当时的情况，我们会复核。临时暂停的账号会在到期后自动恢复。",
  "legal.rules.s6.title": "6. 安全提示",
  "legal.rules.s6.i1": "初次见面请选择公共场所，并把去向告诉朋友或家人。",
  "legal.rules.s6.i2": "不要向刚认识的人转账、代付，也不要提供验证码或证件照片。",
  "legal.rules.s6.i3": "遇到可疑行为请直接举报或拉黑，不必先与对方周旋。",
  "legal.rules.footerPre": "本规则是",
  "legal.rules.footerAnd": "的一部分，也请阅读",
  "legal.rules.footerEnd": "。",
} as const;

export type MsgKey = keyof typeof zh;

export const en: Record<MsgKey, string> = {
  /* common */
  "common.switchToOtherLanguage": "Switch to {language}",

  /* ─────────────────── sign in / sign up ─────────────────── */
  "auth.loginSubtitle": "Good to see you again",
  "auth.identifierLabel": "Email or username",
  "auth.identifierPlaceholder": "Email or username",
  "auth.passwordLabel": "Password",
  "auth.passwordPlaceholder": "Enter your password",
  "auth.loggingIn": "Logging in…",
  "auth.registering": "Creating account…",
  "auth.or": "or",
  "auth.orOAuthRegister": "or sign up with",
  "auth.forgotPassword": "Forgot your password?",
  "auth.noAccount": "New here?",
  "auth.toRegister": "Create one",
  "auth.haveAccount": "Already have an account?",
  "auth.toLogin": "Log in",
  "auth.errorMissingIdentifier": "Enter your email (or username) and your password.",
  "auth.errorSignInFailed": "Couldn't sign you in. Please try again.",
  "auth.errorVerificationEmailOnly":
    "Verification codes only go to an email address — enter your email and try again.",
  "auth.noticeCodeSent": "Code sent — check your inbox.",
  "auth.errorCodeSendFailed": "Couldn't send the code. Please try again.",
  "auth.noticeVerificationPending":
    "No verification seen yet — enter the code from your email first.",
  "auth.verifyToSignIn": "Verify your email and you can sign in normally.",
  "auth.resendVerification": "Resend verification email",
  "auth.recheckVerification": "I've verified — check again",
  "auth.errorEmailNotVerified": "Your email isn't verified yet — please verify it first.",
  "auth.welcomeBack": "Welcome back",
  "auth.createAccount": "Create account",
  "auth.login": "Log in",
  "auth.register": "Sign up",
  "auth.email": "Email",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "Password",
  "auth.errorInvalidEmail": "Enter a valid email address.",
  "auth.errorInvalidCredentials": "That email (or username) and password don't match. Please try again.",
  "auth.errorEmailTaken": "That email is already registered — just sign in. Forgot the password? Use “forgot password”.",
  "auth.registerSubtitle": "Join TalkFirst and meet more interesting people",
  "auth.usernameLabel": "Account name (optional)",
  "auth.usernamePlaceholder": "8–30 letters or digits; leave blank to auto-generate",
  "auth.passwordMin8": "At least 8 characters",
  "auth.termsHint": "For adults 18 and over. By signing up you agree to our ",
  "auth.termsSuffix": ".",
  "auth.errorPasswordMin8": "Your password needs at least 8 characters.",
  "auth.errorUsernameFormat": "An account name is 8–30 letters or digits.",
  "auth.errorUsernameTaken": "That account name is taken — try another one.",
  "auth.errorUsernameReserved": "That account name isn't available — try another one.",
  "auth.errorRegisterFailed": "Couldn't create your account. Please try again.",
  "auth.oauthGoogle": "{verb} with Google",
  "auth.oauthLocal": "Local development sign-in (fake)",
  "auth.oauthError.OAUTH_PROVIDER_DISABLED": "That sign-in method isn't available — use email instead.",
  "auth.oauthError.OAUTH_TOKEN_INVALID": "Google's sign-in credential couldn't be verified. Please try again.",
  "auth.oauthError.OAUTH_STATE_INVALID":
    "This sign-in timed out or didn't start here. Please tap sign in again.",
  "auth.oauthError.OAUTH_EXCHANGE_FAILED": "Couldn't reach Google. Please try again in a moment.",
  "auth.oauthError.OAUTH_NONCE_MISMATCH": "That sign-in failed its check. Please try again.",
  "auth.oauthError.OAUTH_EMAIL_UNVERIFIED":
    "Google says that email isn't verified, so it can't be used to sign in. Verify it in your Google account, or sign up with email instead.",
  "auth.oauthError.OAUTH_EMAIL_REQUIRED":
    "Google didn't provide an email address, so we can't create an account from it. Please sign up with email.",
  "auth.oauthError.OAUTH_FAILED":
    "That quick sign-in didn't work. Try again in a moment, or use email instead.",
  "auth.oauthError.OAUTH_ACCOUNT_EXISTS_PASSWORD":
    "That email is already registered. Sign in with your email and password — you can link Google later in settings.",
  "auth.oauthError.OAUTH_ACCOUNT_EXISTS_GOOGLE":
    "That email already signed up with Google. Please use Google to sign in.",
  "auth.oauthError.OAUTH_ACCOUNT_EXISTS_OTHER":
    "That email is already registered. Sign in with email, or set a password with “forgot password” first.",

  /* launch screen */
  "welcome.headlineLine1": "Talk first,",
  "welcome.headlineLine2": "connect later",
  "welcome.body":
    "On TalkFirst you don't have to be friends before you speak. Start with hello — if it clicks, decide what comes next.",
  "welcome.start": "Get started",
  "welcome.register": "I don't have an account yet",
  "welcome.ageNotice": "For adults 18 and over",
  "welcome.title": "Talk first, connect later",
  "welcome.description":
    "TalkFirst is a language-exchange and cross-cultural social app: talk with someone first, then decide whether to become friends.",

  /* official site */
  "site.metaTitle": "Official site — download the app",
  "site.metaDescription":
    "TalkFirst: a language-exchange and cross-cultural social app. Talk first, connect later. The Android beta is available as a direct download.",
  "site.homeLabel": "TalkFirst home",
  "site.navLabel": "Page navigation",
  "site.navProduct": "Product",
  "site.navHow": "How it works",
  "site.navSafety": "Safety",
  "site.navDownload": "Download",
  "site.signIn": "Log in / Sign up",
  "site.heroBadge": "Beta · available on Android",
  "site.heroTitle": "Talk first. Connect later.",
  "site.heroBody":
    "TalkFirst is a language-exchange and interest-based social app. Nobody has to accept you before you can talk: you say hello, the conversation either works or it doesn't, and only then do you decide about adding each other. The first step is a message, not a swipe.",
  "site.downloadApk": "Download for Android (APK)",
  "site.apkBuilding": "Build in progress",
  "site.tryWeb": "Use it in the browser",
  "site.heroNote":
    "Beta: features keep changing, and the app installs straight from the file — no app store needed. The iOS build is in the works.",
  "site.featuresTitle": "What it is",
  "site.featuresIntro":
    "Three things, in order of importance: language, interests, and talking before anything else.",
  "site.featureLanguagesTitle": "Language exchange",
  "site.featureLanguagesBody":
    "You speak Chinese and someone wants to learn it; they speak English and you want the practice. The topic is right there — no need to hunt for common ground.",
  "site.featureInterestsTitle": "Shared interests",
  "site.featureInterestsBody":
    "Games, music, films, travel — find people by what they care about, and talk about that instead of “hey”.",
  "site.featureTalkFirstTitle": "Talk, then connect",
  "site.featureTalkFirstBody":
    "Say hello → they accept → then you can message each other. No swipe deck, and no inbox full of strangers the day you sign up.",
  "site.howTitle": "How it works",
  "site.howStep1Title": "Sign up and say what you're learning",
  "site.howStep1Body":
    "Your native language, the one you're studying, your interests and what you're here for. Recommendations follow from that.",
  "site.howStep2Title": "Say hello in Discover",
  "site.howStep2Body":
    "A limited number of introductions a day, so people write something real instead of copy-pasting.",
  "site.howStep3Title": "Chat once you both accept",
  "site.howStep3Body":
    "Swap contacts when it's going well; block anyone, any time, if it isn't.",
  "site.safetyTitle": "Safety",
  "site.safetyIntro":
    "Talking to strangers is the entire point of this product, so every line below has to be something we actually do — not a slogan on a marketing page.",
  "site.safetyBullet1": "Either side can block and report, and reports are read by a person.",
  "site.safetyBullet2": "Posts and comments are reviewed before they go public, not after.",
  "site.safetyBullet3": "Sign-up requires email verification, which keeps bots out.",
  "site.safetyBullet4":
    "Exchanging contact details needs both sides to agree — if they decline, your details never reach them.",
  "site.downloadTitle": "Download",
  "site.androidName": "Android",
  "site.available": "Available",
  "site.building": "Building",
  "site.androidBody":
    "Download the APK and install it directly. The first time, Android will ask whether to allow installs from this source — allow it.",
  "site.downloadApkShort": "Download APK",
  "site.iosName": "iOS",
  "site.comingSoon": "Coming soon",
  "site.iosBody":
    "The iPhone build is in the works. Until then the web version covers almost everything: Discover, Moments, chat, notifications.",
  "site.useWeb": "Open the web version",
  "site.footerNavLabel": "Footer navigation",
  "site.legalTerms": "Terms",
  "site.legalPrivacy": "Privacy",
  "site.legalRules": "Community rules",
  "site.previewAuthor": "Aki",
  "site.previewMeta": "Japan · 3 min ago",
  "site.previewBody":
    "Trying to work out the difference between 差不多 and 几乎 today. Chinese synonyms are genuinely subtle.",
  "site.previewLikes": "12 likes",
  "site.previewComments": "4 comments",
  "site.previewBubble1": "Are you learning Japanese too?",
  "site.previewBubble2": "I am! I can correct your Chinese in return.",
  "site.previewCaption": "What the app looks like",

  /* password reset / e-mail code */
  "reset.title": "Reset password",
  "reset.subtitle": "We e-mail you a code, then you pick a new password.",
  "reset.email": "E-mail address",
  "reset.emailPlaceholder": "The address you signed up with",
  "reset.code": "E-mailed code",
  "reset.codePlaceholder": "6 digits",
  "reset.sendCode": "Send code",
  "reset.resendIn": "Resend in {n}s",
  "reset.sending": "Sending…",
  "reset.newPassword": "New password",
  "reset.newPasswordPlaceholder": "At least 8 characters",
  "reset.confirmPassword": "Confirm new password",
  "reset.confirmPlaceholder": "Type the new password again",
  "reset.submit": "Reset password",
  "reset.submitting": "Resetting…",
  "reset.doneTitle": "Password reset",
  "reset.doneBody": "For your safety we signed out every other device. Please sign in with your new password.",
  "reset.goSignIn": "Go to sign in",
  "reset.remembered": "Remembered it?",
  "reset.backToSignIn": "Back to sign in",
  /* "If that address has an account" — never "we found your account": the API
     answers identically for every address so nobody can probe which are
     registered, and copy that implies otherwise undoes that on our side. */
  "reset.noticeSent": "If that address has an account, a 6-digit code is on its way (check your spam folder too).",
  "reset.errEmail": "Enter a valid e-mail address.",
  "reset.errCode": "Enter the 6-digit code.",
  "reset.errPasswordMin": "The new password needs at least 8 characters.",
  "reset.errPasswordMismatch": "The two passwords do not match.",
  "reset.errCodeLocked": "Too many attempts. Please send a new code.",
  "reset.errSubmit": "Could not reset the password. Please try again.",
  "reset.errSend": "Could not send the code. Please try again.",

  "verify.title": "Verification code",
  "verify.metaDescription": "Enter the 6-digit code from your e-mail to verify your address.",
  "verify.sentTo": "We sent a code to your e-mail",
  "verify.fallbackEmail": "your e-mail",
  "verify.digitLabel": "Verification code digit {n}",
  "verify.sent": "Code sent.",
  "verify.devCode": "Development code: {code} (tap to fill in)",
  "verify.resendIn": "Resend ({n}s)",
  "verify.resend": "Resend",
  "verify.next": "Next",
  "verify.backToSignIn": "Back to sign in",
  "verify.submitting": "Checking…",
  "verify.errSession": "Your session expired. Please sign up again.",
  "verify.errCodeLength": "Enter the {n}-digit code.",
  "verify.errSend": "Could not send the code. Please try again.",
  "verify.errVerify": "Could not verify the code. Please try again.",

  /* legal texts: consent gate, terms of use, community rules */
  "legal.translationNote": "This page is a translation of the Chinese original. If the two ever differ, the Chinese text governs.",

  "legal.gate.title": "Terms and privacy",
  "legal.gate.intro": "So you know exactly how we handle your information, we need you to confirm both items below before you sign up. The full text of each is provided in the sign-up flow.",
  "legal.gate.acceptTerms": "I have read and agree to the Terms of Use",
  "legal.gate.acceptTermsHint": "Account rules, content standards, and the 18-and-over age requirement.",
  "legal.gate.acceptPrivacy": "I have read and agree to the Privacy Policy",
  "legal.gate.acceptPrivacyHint": "What we collect, why we collect it, and how you can see, correct or delete it.",
  "legal.gate.readTerms": "Read the full Terms of Use",
  "legal.gate.readPrivacy": "Read the full Privacy Policy",
  "legal.gate.note": "You can review and adjust who sees each part of your profile at any time under Me → Privacy & safety, and you can delete your account to have all of your information removed.",
  "legal.gate.continue": "Agree and continue",
  "legal.gate.needBoth": "Please tick both boxes above",

  "legal.privacy.title": "Privacy Policy",

  "legal.terms.title": "Terms of Use",
  "legal.terms.updated": "Last updated: October 2026",
  "legal.terms.intro": "These terms set out the rules between you and TalkFirst: what you may do with the product, what we may do with your content, and what happens when something goes wrong. Please read them together with the Privacy Policy and the Community Rules.",
  "legal.terms.s1.title": "1. About these terms",
  "legal.terms.s1.p1": "These terms apply to the TalkFirst mobile app and website. The operator is TalkFirst; the contact address is support@talkfirst.ccwu.cc.",
  "legal.terms.s1.p2": "If you do not agree to these terms, please do not sign up or keep using the product.",
  "legal.terms.s2.title": "2. Who may use it",
  "legal.terms.s2.i1": "The product is for people aged 18 and over. By signing up you confirm that you are at least 18.",
  "legal.terms.s2.i2": "One e-mail address, one account. Please do not sign up on someone else's behalf or create accounts in bulk.",
  "legal.terms.s2.i3": "Please give a real, working e-mail address: it is how you sign in, recover your password and receive security notices.",
  "legal.terms.s3.title": "3. Accounts and signing in",
  "legal.terms.s3.i1": "You are given a username when you sign up, and you use it to sign in. Your nickname is the name other people see. The two can be different.",
  "legal.terms.s3.i2a": "You set and keep your own password. We store it as an irreversible hash, so ",
  "legal.terms.s3.i2b": "the original can never be read back",
  "legal.terms.s3.i2c": "; if you forget it, you can only reset it by e-mail.",
  "legal.terms.s3.i3": "You can also sign in or sign up with a Google account. Accounts created that way have no password, and you can set one later.",
  "legal.terms.s3.i4": "Please do not lend, rent out or sell your account. Anything done through your account counts as done by you.",
  "legal.terms.s4.title": "4. Your content",
  "legal.terms.s4.i1": "You keep the copyright in the posts, comments, messages, photos and profile text you publish.",
  "legal.terms.s4.i2": "As far as needed to run the service, you give us permission to store and display that content inside the product, and to share it with other members according to your visibility settings. If you change those settings or delete content, we follow the new state.",
  "legal.terms.s4.i3": "You need to make sure you have the right to publish it, and that it breaks neither the law nor the Community Rules.",
  "legal.terms.s4.i4": "Private messages are visible only to the people in the conversation. Please do not forward or publish them without the other person's agreement.",
  "legal.terms.s5.title": "5. The service",
  "legal.terms.s5.p1": "We provide profiles, discovery and connecting, posts, chat and notifications, and we may change, add or retire parts of that. The product is free today; if we introduce paid features later, we will ask for your agreement separately.",
  "legal.terms.s5.p2": "The product is provided “as is”. We work to keep it available and safe, but we cannot promise the service will never go down and never fail.",
  "legal.terms.s6.title": "6. Breaking the rules",
  "legal.terms.s6.p1": "You need to follow the Community Rules. If you do not, we may: warn you; take content down or hide it; limit some features; suspend your account temporarily (lifted automatically when it expires); or ban it permanently. In serious cases, such as a credible threat or unlawful content, we ban the account straight away.",
  "legal.terms.s6.p2": "You can report a post, a comment, a message or a member. We tell the reporter the outcome, and we never tell the reported member who reported them.",
  "legal.terms.s7.title": "7. Deleting your account and termination",
  "legal.terms.s7.i1": "You can delete your account at any time from Me. Once you do, we remove your profile and the content tied to it within a reasonable period, as the Privacy Policy describes.",
  "legal.terms.s7.i2": "Records needed for security auditing are kept for the periods the Privacy Policy sets out; they do not disappear the moment your account is deleted.",
  "legal.terms.s7.i3": "If you seriously break these terms or the law, we may suspend or end the service we provide to you.",
  "legal.terms.s8.title": "8. Limits on our responsibility",
  "legal.terms.s8.i1": "Judge for yourself who you deal with. To the extent the law allows, we are not responsible for disputes between you and another member.",
  "legal.terms.s8.i2": "We are not responsible for loss caused by events beyond our control, by an outage of a third-party service (for example Google when you sign in with Google), or by your own device or network.",
  "legal.terms.s8.i3": "These limits apply as far as the applicable law allows; anything the law does not permit us to limit is not limited by these terms.",
  "legal.terms.s9.title": "9. Changes to these terms",
  "legal.terms.s9.p1": "If we make a substantive change to these terms, we tell you inside the app. Continuing to use the product means you accept the updated terms; if you do not agree, you can stop using it and delete your account.",
  "legal.terms.s10.title": "10. Governing law and disputes",
  "legal.terms.s10.p1": "If a dispute arises between you and us, please contact us first at the address above and we will do our best to settle it by discussion. If we cannot, it goes to the courts with jurisdiction where the operator is registered.",
  "legal.terms.morePre": "Please also read our ",
  "legal.terms.moreAnd": " and our ",
  "legal.terms.moreEnd": ".",

  "legal.rules.title": "Community Rules",
  "legal.rules.updated": "Last updated: October 2026",
  "legal.rules.intro": "TalkFirst is meant to let you talk first, and decide only afterwards whether to become friends. That needs everyone here to be able to speak freely, so what follows is what we all agree to. These rules are part of the Terms of Use.",
  "legal.rules.s1.title": "1. What we hold to",
  "legal.rules.s1.i1": "Respect the other person: language exchange and friendship both rest on wanting to talk. Do not pressure, do not pester.",
  "legal.rules.s1.i2": "Do no harm: harassment, threats, hatred and discrimination in any form are not accepted here.",
  "legal.rules.s1.i3": "Do not deceive: do not impersonate anyone, and do not use a false identity to earn trust.",
  "legal.rules.s2.title": "2. Content you may not post",
  "legal.rules.s2.i1": "Abuse, harassment, threats, following someone around or pestering them without let-up; publishing someone's private information without their agreement, such as their address, employer, contact details or screenshots of a chat.",
  "legal.rules.s2.i2": "Hateful or discriminatory content aimed at race, ethnicity, religion, sex, sexual orientation, disability or anything of the kind.",
  "legal.rules.s2.i3": "Pornographic or sexually explicit content, and any sexual content involving minors.",
  "legal.rules.s2.i4": "Content that promotes violence, self-harm or suicide, or that encourages unlawful or dangerous behaviour.",
  "legal.rules.s2.i5": "Spam and advertising: mass private messages, pulling people into groups, and promotion of gambling, loans, top-up services, review-farming, crypto and the like.",
  "legal.rules.s2.i6": "Unlawful transactions, and malicious links, scams or malware.",
  "legal.rules.s3.title": "3. Things you may not do",
  "legal.rules.s3.i1": "Registering accounts in bulk, automating the product with scripts or bots, or scraping other members' information.",
  "legal.rules.s3.i2": "Working around someone's visibility settings or their block, for example by switching accounts to keep harassing them.",
  "legal.rules.s3.i3": "Impersonating another member or TalkFirst itself, or faking an identity or a history.",
  "legal.rules.s3.i4": "Buying, selling, renting, borrowing or sharing accounts.",
  "legal.rules.s4.title": "4. Reporting and what we do",
  "legal.rules.s4.i1": "You can report a post, a comment, a message or a member: pick the reason that fits best and add a note if it helps. Reasons are checked on the server, and one that is not on the list is refused.",
  "legal.rules.s4.i2": "The reported member is never told who reported them.",
  "legal.rules.s4.i3": "What we may do: warn you; take content down or hide it; limit some features; suspend your account temporarily (lifted automatically when it expires); or ban it permanently. Where a credible threat or unlawful content is involved, we ban the account straight away.",
  "legal.rules.s4.i4": "We tell the reporter the outcome, so whoever reported it knows what happened next.",
  "legal.rules.s5.title": "5. If we have actioned your account",
  "legal.rules.s5.p1": "You can appeal at support@talkfirst.ccwu.cc — tell us which account and what happened, and we will look again. A temporary suspension lifts by itself when it expires.",
  "legal.rules.s6.title": "6. Staying safe",
  "legal.rules.s6.i1": "Meet in a public place the first time, and tell a friend or family member where you are going.",
  "legal.rules.s6.i2": "Do not send money to someone you have just met, do not pay on their behalf, and do not hand over a verification code or a photo of your ID.",
  "legal.rules.s6.i3": "If something looks wrong, report or block straight away — you do not have to engage with them first.",
  "legal.rules.footerPre": "These rules are part of our ",
  "legal.rules.footerAnd": ", and please also read our ",
  "legal.rules.footerEnd": ".",
};

const MESSAGES: Record<Locale, Record<MsgKey, string>> = { zh, en };

/** `{name}` 占位替换。参数缺失时保留占位符：看得见比变成 `undefined` 好。 */
function interpolate(template: string, params?: MsgParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * 取一条文案。**纯函数**，所以服务端组件、客户端组件都能直接调 ——
 * 不需要 context provider，代价是每个需要文案的组件要知道自己的 `locale`。
 */
export function t(locale: Locale, key: MsgKey, params?: MsgParams): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}
