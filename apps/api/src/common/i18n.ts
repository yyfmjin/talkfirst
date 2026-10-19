/**
 * 服务端下发文案的多语言。
 *
 * 为什么需要这一层：客户端（app / web）早已双语，但**由服务端生成的句子**
 * —— 通知的 `title` / `body`、验证码邮件 —— 以前是硬编码的，而且中英混用：
 * 消息与连接是英文，点赞、评论、管理员处理结果是中文。结果两头都不对：
 * 中文用户收到「New message」，英文用户收到「你的动态收到点赞」。
 *
 * 为什么不让客户端按 `type` 自己翻译：决定语言的必须是**收件人**，而收件人
 * 往往不在请求里 —— 发消息的是对方。而且正文里混着昵称、消息摘要这类运行时
 * 数据，客户端只看到 `type` 是还原不出来的。
 *
 * 收件人的语言按 `resolveLocale` 的顺序决定：
 * 显式选择的界面语言 → 母语 → 中文兜底。
 */

export const SUPPORTED_LOCALES = ["zh", "en"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 兜底语言。产品的基本盘是中文用户，语言未知时按中文发。 */
export const DEFAULT_LOCALE: SupportedLocale = "zh";

/** 列表连接符：中文用顿号，英文用逗号加空格。 */
const LIST_SEPARATOR: Record<SupportedLocale, string> = { zh: "、", en: ", " };

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * 把语言标签归一到受支持的语言：`"zh-CN"` → `"zh"`、`"en_US"` → `"en"`。
 * 认不出来就返回 `null`，由调用方决定兜底 —— 这里不猜。
 */
export function localeFromLanguageCode(code: string | null | undefined): SupportedLocale | null {
  if (typeof code !== "string") return null;
  const primary = code.trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(primary) ? primary : null;
}

/**
 * 解析 `Accept-Language`，取第一个受支持的标签。
 *
 * 只看 q 值之外的顺序（浏览器已经按优先级排好）。`*` 与未知语言跳过：
 * 一个只写了 `ja` 的客户端应该落到兜底语言，而不是被当成英文。
 */
export function localeFromAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  if (typeof header !== "string" || header.trim() === "") return null;

  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim();
    const resolved = localeFromLanguageCode(tag);
    if (resolved) return resolved;
  }
  return null;
}

/** 未知或缺失时落到 `DEFAULT_LOCALE`，用于「一定要一个语言」的位置（邮件模板）。 */
export function localeOrDefault(locale: string | null | undefined): SupportedLocale {
  return localeFromLanguageCode(locale ?? undefined) ?? DEFAULT_LOCALE;
}

/**
 * 决定某个用户的语言。
 *
 * 顺序：显式选择的界面语言 → 母语 → 中文。
 * 用母语兜底而不是直接落中文，是因为老用户还没有这个字段，而母语早就存在
 * 用户语言列表里 —— 英文母语的用户不该收到中文通知。
 */
export function resolveLocale(input: {
  locale?: string | null;
  /** 用户语言列表；调用方按「母语优先、其余在后」的顺序传入。 */
  languageCodes?: ReadonlyArray<string | null | undefined>;
}): SupportedLocale {
  const explicit = localeFromLanguageCode(input.locale ?? undefined);
  if (explicit) return explicit;

  for (const code of input.languageCodes ?? []) {
    const derived = localeFromLanguageCode(code ?? undefined);
    if (derived) return derived;
  }
  return DEFAULT_LOCALE;
}

/** 占位符的值。数组按语言的列表连接符拼接（中文顿号 / 英文逗号）。 */
export type MessageParams = Record<string, string | number | ReadonlyArray<string | number>>;

export type LocalizedText = { key: MessageKey; params?: MessageParams };

const ZH = {
  // —— 聊天 ——
  "notify.newMessage.title": "新消息",
  "notify.newMessage.imageTitle": "新图片",
  "notify.newMessage.imageBody": "对方发来一张图片",

  // —— 打招呼与连接 ——
  "notify.sayHello.title": "{name} 想和你打个招呼",
  // 没昵称时的版本。不能把「Someone」塞进中文句子里，也不能把参数做成可翻译的
  // —— 参数在产出点生成，那时还不知道收件人的语言。
  "notify.sayHello.anonymousTitle": "有人想和你打个招呼",
  "notify.sayHello.template.language": "🗣️ 我想练练口语",
  "notify.sayHello.template.gaming": "🎮 我们都很喜欢游戏",
  "notify.sayHello.template.country": "🌍 我想了解你的国家",
  "notify.sayHello.template.music": "🎵 我们都很喜欢音乐",
  "notify.sayHello.template.travel": "✈️ 一起聊聊旅行故事",
  "notify.sayHello.template.custom": "✍️ 我想自己写一句",
  "notify.requestAccepted.title": "🎉 连接成功！",
  "notify.requestAccepted.body": "你们都想聊聊，开始对话吧。",

  // —— 联系方式交换 ——
  "notify.exchangeRequest.title": "🔗 联系方式交换请求",
  "notify.exchangeRequest.body": "{name} 想和你交换 {platforms}",
  "notify.exchangeRequest.anonymousBody": "有人想和你交换 {platforms}",
  "notify.exchangeAccepted.title": "🎉 交换请求已接受",
  "notify.exchangeAccepted.body": "去「连接」里看看对方的账号吧。",

  // —— 动态与评论 ——
  "notify.momentLike.title": "你的动态收到点赞",
  "notify.momentComment.title": "你的动态收到评论",
  "notify.commentReply.title": "你的评论收到回复",

  // —— 管理员操作结果 ——
  "notify.flowerReceived.title": "你收到了一朵花",
  "notify.userStatus.title": "账号状态已更新",
  "notify.userStatus.body.ACTIVE": "你的账号已恢复正常。",
  "notify.userStatus.body.DISABLED": "你的账号已被停用。",
  "notify.userStatus.body.SUSPENDED": "你的账号已被临时封禁。",
  "notify.userStatus.body.BANNED": "你的账号已被封禁。",
  "safety.externalLink": "⚠️ 小心外部链接。TalkFirst 不会向你索要钱款或验证码。",
  "safety.contactLeak": "请通过「交换联系方式」交换账号，不要直接在聊天里发送。",
  "ai.blockedFallback": "这个话题我们先跳过吧，聊点别的？",
  "platform.connected.TALKFIRST": "站内动态",
  "platform.connected.INSTAGRAM": "已连接用户主页",
  "platform.connected.X": "已连接时间线",
  "platform.connected.TIKTOK": "已连接短视频",
  "platform.connected.YOUTUBE": "已连接频道",
  "platform.connected.FACEBOOK": "已连接主页",
  "discover.all": "🌎 全部",
  "discover.category.language": "语言交换",
  "discover.category.gaming": "游戏搭子",
  "discover.reason.languages": "语言互补",
  "discover.reason.interests": "共同兴趣：{names}",
  "discover.reason.purposes": "交友目的相近",
  "discover.reason.country": "符合国家偏好",
  "discover.reason.active": "近期活跃",
  "discover.reason.complete": "资料较完整",
  "notify.reportReview.title": "举报处理结果",
  "notify.reportReview.body.REVIEWING": "你提交的举报正在处理中。",
  "notify.reportReview.body.RESOLVED": "你提交的举报已处理。",
  "notify.reportReview.body.REJECTED": "你提交的举报已审核。",

  // —— 邮件 ——
  "mail.verification.subject": "TalkFirst 邮箱验证码",
  "mail.verification.heading": "TalkFirst 邮箱验证",
  "mail.verification.greeting": "你好，",
  "mail.verification.intro": "你正在注册 TalkFirst 账号，请使用下面的验证码完成邮箱验证：",
  "mail.verification.expiry": "验证码有效期为 {minutes} 分钟。",
  "mail.verification.ignore": "如果这不是你的操作，请忽略此邮件。请勿将验证码透露给他人。",
  "mail.verification.text": "你的 TalkFirst 验证码是 {code}，{minutes} 分钟内有效。如非本人操作请忽略本邮件。",
} as const;

export type MessageKey = keyof typeof ZH;

/**
 * 键集合必须与中文一致 —— 类型注解就是校验：漏一条英文编译不过。
 * 这正是这一层的价值所在：以前漏翻是运行时才发现，现在是编译期。
 */
const EN: Record<MessageKey, string> = {
  "notify.newMessage.title": "New message",
  "notify.newMessage.imageTitle": "New image",
  "notify.newMessage.imageBody": "You received an image",

  "notify.sayHello.title": "{name} said hello",
  "notify.sayHello.anonymousTitle": "Someone said hello",
  "notify.sayHello.template.language": "🗣️ I'd like to practice languages.",
  "notify.sayHello.template.gaming": "🎮 We both like gaming.",
  "notify.sayHello.template.country": "🌍 I want to learn about your country.",
  "notify.sayHello.template.music": "🎵 We both like music.",
  "notify.sayHello.template.travel": "✈️ Let's share travel stories.",
  "notify.sayHello.template.custom": "✍️ Write my own message.",
  "notify.requestAccepted.title": "🎉 It's a connection!",
  "notify.requestAccepted.body": "You both want to talk. Start chatting.",

  "notify.exchangeRequest.title": "🔗 Contact exchange request",
  "notify.exchangeRequest.body": "{name} wants to exchange {platforms}",
  "notify.exchangeRequest.anonymousBody": "Someone wants to exchange {platforms}",
  "notify.exchangeAccepted.title": "🎉 Contact exchange accepted",
  "notify.exchangeAccepted.body": "Check Connections to see each other's accounts.",

  "notify.momentLike.title": "Your moment got a like",
  "notify.momentComment.title": "Your moment got a comment",
  "notify.commentReply.title": "Your comment got a reply",

  "notify.flowerReceived.title": "You received a flower",
  "notify.userStatus.title": "Account status updated",
  "notify.userStatus.body.ACTIVE": "Your account is active again.",
  "notify.userStatus.body.DISABLED": "Your account has been disabled.",
  "notify.userStatus.body.SUSPENDED": "Your account has been suspended.",
  "notify.userStatus.body.BANNED": "Your account has been banned.",
  "safety.externalLink": "⚠️ Watch out for outside links. TalkFirst will never ask you for money or a verification code.",
  "safety.contactLeak": "Share accounts through \"Exchange contact details\", not directly in chat.",
  "ai.blockedFallback": "Let's leave that one aside — tell me something else?",
  "platform.connected.TALKFIRST": "Posts on TalkFirst",
  "platform.connected.INSTAGRAM": "Linked profile",
  "platform.connected.X": "Linked timeline",
  "platform.connected.TIKTOK": "Linked short videos",
  "platform.connected.YOUTUBE": "Linked channel",
  "platform.connected.FACEBOOK": "Linked page",
  "discover.all": "🌎 All",
  "discover.category.language": "Language exchange",
  "discover.category.gaming": "Gaming buddies",
  "discover.reason.languages": "Complementary languages",
  "discover.reason.interests": "Shared interests: {names}",
  "discover.reason.purposes": "Similar purpose",
  "discover.reason.country": "Matches your country picks",
  "discover.reason.active": "Recently active",
  "discover.reason.complete": "Detailed profile",
  "notify.reportReview.title": "Report update",
  "notify.reportReview.body.REVIEWING": "Your report is being reviewed.",
  "notify.reportReview.body.RESOLVED": "Your report has been resolved.",
  "notify.reportReview.body.REJECTED": "Your report has been reviewed.",

  "mail.verification.subject": "Your TalkFirst verification code",
  "mail.verification.heading": "Verify your TalkFirst email",
  "mail.verification.greeting": "Hello,",
  "mail.verification.intro": "You're creating a TalkFirst account. Enter this code to verify your email:",
  "mail.verification.expiry": "This code is valid for {minutes} minutes.",
  "mail.verification.ignore": "If this wasn't you, ignore this email. Never share the code with anyone.",
  "mail.verification.text": "Your TalkFirst verification code is {code}. It expires in {minutes} minutes. If you didn't request it, ignore this email.",
};

export const MESSAGES: Record<SupportedLocale, Record<MessageKey, string>> = { zh: ZH, en: EN };

function formatParam(value: string | number | ReadonlyArray<string | number>, locale: SupportedLocale): string {
  return Array.isArray(value) ? value.join(LIST_SEPARATOR[locale]) : String(value);
}

/**
 * 渲染一条文案。占位符缺失时保留 `{name}` 原样 —— 打印出花括号比打印
 * `undefined` 更容易在测试和排查里看出是哪一层出了问题。
 */
export function t(locale: SupportedLocale, key: MessageKey, params?: MessageParams): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : formatParam(value, locale);
  });
}

/** 生成一条带键的文案，渲染推到写入通知时（那时才知道收件人的语言）。 */
export function msg(key: MessageKey, params?: MessageParams): LocalizedText {
  return params ? { key, params } : { key };
}

/**
 * 把「可能是键、也可能已经是成品字符串」的文案渲染成最终字符串。
 *
 * 字符串原样返回是刻意的：通知正文常常是**用户自己的内容**（消息摘要、
 * 动态正文、对方写的招呼语），它们不该被翻译。
 */
export function renderText(
  locale: SupportedLocale,
  text: string | LocalizedText | null | undefined,
): string | null {
  if (text === null || text === undefined) return null;
  if (typeof text === "string") return text;
  return t(locale, text.key, text.params);
}
