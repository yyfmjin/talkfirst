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
