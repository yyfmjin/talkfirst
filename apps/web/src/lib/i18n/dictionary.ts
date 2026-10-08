import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * web 端文案词典。
 *
 * ## 覆盖范围（重要）
 *
 * 这里**不是**整站文案，只装了已经双语化的那几个面：官网（`/site`）与启动屏（`/`）。
 * 成员端其余页面（发现 / 动态 / 消息 / 我的 / 引导 …）仍然是中文写死在页面里 ——
 * 整站约 938 条文案，得一批一批搬。**没搬过来的页面不要假装它有英文版**：
 * 它们的 `en` 路由还不存在，英文站点上的链接也不会指向它们（见 `locales.ts`）。
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
