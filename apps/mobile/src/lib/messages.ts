import { DEFAULT_LOCALE, type Locale } from "./locale";

/**
 * 全部界面文案。
 *
 * ## 为什么英文词典的类型写成 `Record<MsgKey, string>`
 *
 * `zh` 是源语言（产品原本就是中文），`en` 必须**一条不缺**。把 `en` 声明成
 * 「键必须与 `zh` 完全一致」的类型，漏翻一条就 typecheck 报错。这是刻意的：
 * i18n 最常见的坏味道是某条文案只翻了一半，它在界面上表现为「一句英文里夹着
 * 中文」—— 不报错、不上报，只能靠人眼碰到。
 *
 * ## 为什么用 `{name}` 占位而不是拼字符串
 *
 * 语序在不同语言里不一样：中文「3 分钟前」、英文「3 min ago」，日文又是别的
 * 顺序。拼字符串等于把中文语序焊进代码里。所以一律整句进词典、变量用占位符。
 */

export type MsgParams = Record<string, string | number>;

export const zh = {
  /* ───────────────────────── 通用 ───────────────────────── */
  "common.user": "用户",
  "common.talkfirstUser": "TalkFirst 用户",
  "common.retry": "重试",
  "common.reload": "重新加载",
  "common.close": "关闭",
  "common.actionFailed": "操作失败，请稍后再试。",
  "common.networkError": "无法连接服务器，请检查网络后重试。",
  "common.timeout": "请求超时。",
  "common.justNow": "刚刚",
  "common.minutesAgo": "{n} 分钟前",
  "common.hoursAgo": "{n} 小时前",
  "common.daysAgo": "{n} 天前",
  "common.age": "{n} 岁",

  /* 顶层错误边界（万一把界面崩了，至少说一句人话、而不是白屏） */
  "error.title": "出了点问题",
  "error.body":
    "App 遇到了无法继续的错误。可以先点下面的按钮重试；如果一直这样，请把这一屏截图发给我们。",

  /* ───────────────────────── 底部导航 ───────────────────────── */
  "tab.discover": "发现",
  "tab.moments": "动态",
  "tab.messages": "消息",
  "tab.notifications": "通知",
  "tab.me": "我的",

  /* ───────────────────────── 登录 / 注册 ───────────────────────── */
  "auth.welcomeBack": "欢迎回来",
  "auth.createAccount": "创建账号",
  "auth.loginSubtitle": "很高兴再次见到你",
  "auth.registerSubtitle": "先聊聊，再成为朋友",
  "auth.email": "邮箱地址",
  "auth.emailPlaceholder": "请输入邮箱地址",
  "auth.password": "密码",
  "auth.passwordPlaceholder": "请输入密码",
  "auth.login": "登录",
  "auth.register": "注册",
  "auth.noAccount": "还没有账号？",
  "auth.haveAccount": "已经有账号？",
  "auth.toRegister": "立即注册",
  "auth.toLogin": "去登录",
  "auth.errorMissingFields": "请填写邮箱和密码。",
  "auth.errorInvalidEmail": "请输入有效的邮箱地址。",
  "auth.errorPasswordTooShort": "密码至少需要 {n} 位字符。",
  "auth.errorPasswordTooLong": "密码不能超过 {n} 位字符。",

  /* ───────────────────────── 发现 ───────────────────────── */
  "discover.title": "发现",
  "discover.subtitle": "先聊聊，再成为朋友。",
  "discover.remaining": "今日剩余 {n}",
  "discover.filterAll": "全部",
  "discover.filterLanguage": "语言交换",
  "discover.filterGaming": "游戏搭子",
  "discover.loading": "正在发现新朋友…",
  "discover.errorTitle": "推荐暂时不可用",
  "discover.errorBody": "推荐加载失败，请稍后再试。",
  "discover.emptyDoneTitle": "今天的推荐看完啦",
  "discover.emptyDoneBody": "明天再来看看，认真认识一个人。",
  "discover.emptyNoneTitle": "暂时没有合适的人",
  "discover.emptyNoneBody": "完善语言、兴趣和目的后，会得到更好的推荐。",
  "discover.viewProfile": "查看 {name} 的资料",

  /* ───────────────────────── 动态 ───────────────────────── */
  "moments.title": "动态",
  "moments.empty": "还没有动态。发布一条，或者去发现页认识新朋友。",
  "moments.errorLoading": "动态加载失败，请稍后再试。",
  "moments.like": "点赞",
  "moments.unlike": "取消点赞",

  /* ───────────────────────── 消息 ───────────────────────── */
  "messages.title": "消息",
  "messages.empty": "还没有对话。去发现页打个招呼，双方接受后就能聊了。",
  "messages.loadOlder": "加载更早的消息",
  "messages.backToList": "返回会话列表",
  "messages.conversationFallback": "对话",
  "messages.startChat": "开始聊天",
  "messages.composerPlaceholder": "发条消息…",
  "messages.composerLabel": "消息输入框",
  "messages.send": "发送",
  "messages.errorList": "会话加载失败，请稍后再试。",
  "messages.errorThread": "消息加载失败。",
  "messages.errorSend": "发送失败，请稍后再试。",

  /* ───────────────────────── 通知 ───────────────────────── */
  "notifications.title": "通知",
  "notifications.unreadCount": "{n} 条未读",
  "notifications.markAll": "全部已读",
  "notifications.markAllLabel": "全部已读",
  "notifications.retry": "重试",
  "notifications.retryLabel": "重试加载通知",
  "notifications.empty": "暂无通知",
  "notifications.loadMore": "加载更多",
  "notifications.errorLoading": "通知加载失败，请稍后再试。",
  "notifications.typeFallback": "通知",
  "notifications.unreadItemLabel": "未读：{title}",
  "notifications.countSuffix": " · {n} 条",
  "notifications.type.NEW_MESSAGE": "新消息",
  "notifications.type.SAY_HELLO": "有人向你打招呼",
  "notifications.type.REQUEST_ACCEPTED": "连接已接受",
  "notifications.type.EXCHANGE_REQUEST": "交换请求",
  "notifications.type.EXCHANGE_ACCEPTED": "交换已接受",
  "notifications.type.MOMENT_LIKE": "动态收到赞",
  "notifications.type.MOMENT_COMMENT": "动态收到评论",
  "notifications.type.MOMENT_REPLY": "评论收到回复",
  "notifications.type.REPORT_REVIEW": "举报处理结果",
  "notifications.type.USER_STATUS": "账号状态更新",
  "notifications.type.FLOWER_RECEIVED": "收到一朵花",

  /* ───────────────────────── 我的 ───────────────────────── */
  "me.title": "我的",
  "me.profileComplete": "资料已完善",
  "me.profileIncomplete": "资料待完善",
  "me.signOut": "退出登录",
  "me.language": "界面语言",
  "me.languageNote": "默认跟随手机的系统语言；认不出的语言显示英文。",
  "me.languageSystem": "跟随系统",
  "me.languageZh": "中文",
  "me.languageEn": "English",

  /* ───────────────────────── 个人资料卡 ───────────────────────── */
  "profile.title": "个人资料",
  "profile.errorLoading": "资料加载失败，请稍后再试。",
  "profile.sectionLanguages": "语言",
  "profile.sectionInterests": "兴趣",
  "profile.sectionPurposes": "交友目的",
  "profile.languageNative": " 母语",
  "profile.languageLearning": " 学习中",
  "profile.age": " {n} 岁",
  "profile.connected": "已连接",
  "profile.hello": "打招呼",
  "profile.helloSending": "发送中…",
  "profile.helloDone": "已打招呼",
  "profile.errorSend": "发送失败，请稍后再试。",
} as const;

export type MsgKey = keyof typeof zh;

/**
 * 英文词典。类型是 `Record<MsgKey, string>` —— 少一条就编译不过（见文件顶部）。
 *
 * 语气不逐字照搬：中文里靠语气词（「啦」「哦」）表达的热度，英文用别的方式表达，
 * 逐字直译会读成机器翻译。
 */
export const en: Record<MsgKey, string> = {
  /* common */
  "common.user": "User",
  "common.talkfirstUser": "TalkFirst user",
  "common.retry": "Retry",
  "common.reload": "Reload",
  "common.close": "Close",
  "common.actionFailed": "Something went wrong. Please try again.",
  "common.networkError": "Can't reach the server. Check your connection and try again.",
  "common.timeout": "The request timed out.",
  "common.justNow": "Just now",
  "common.minutesAgo": "{n} min ago",
  "common.hoursAgo": "{n} hr ago",
  "common.daysAgo": "{n} days ago",
  "common.age": "{n} y/o",

  /* top-level error boundary */
  "error.title": "Something went wrong",
  "error.body":
    "The app hit an error it couldn't recover from. Try again below — if it keeps happening, please send us a screenshot of this screen.",

  /* tabs */
  "tab.discover": "Discover",
  "tab.moments": "Moments",
  "tab.messages": "Messages",
  "tab.notifications": "Alerts",
  "tab.me": "Me",

  /* auth */
  "auth.welcomeBack": "Welcome back",
  "auth.createAccount": "Create account",
  "auth.loginSubtitle": "Good to see you again",
  "auth.registerSubtitle": "Talk first, connect later",
  "auth.email": "Email",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "Password",
  "auth.passwordPlaceholder": "Enter your password",
  "auth.login": "Log in",
  "auth.register": "Sign up",
  "auth.noAccount": "New here?",
  "auth.haveAccount": "Already have an account?",
  "auth.toRegister": "Create one",
  "auth.toLogin": "Log in",
  "auth.errorMissingFields": "Enter your email and password.",
  "auth.errorInvalidEmail": "Enter a valid email address.",
  "auth.errorPasswordTooShort": "Password must be at least {n} characters.",
  "auth.errorPasswordTooLong": "Password must be at most {n} characters.",

  /* discover */
  "discover.title": "Discover",
  "discover.subtitle": "Talk first, connect later.",
  "discover.remaining": "{n} left today",
  "discover.filterAll": "Everyone",
  "discover.filterLanguage": "Language swap",
  "discover.filterGaming": "Gaming buddies",
  "discover.loading": "Finding new friends…",
  "discover.errorTitle": "Recommendations unavailable",
  "discover.errorBody": "Couldn't load recommendations. Please try again.",
  "discover.emptyDoneTitle": "That's everyone for today",
  "discover.emptyDoneBody": "Come back tomorrow — one good match beats ten swipes.",
  "discover.emptyNoneTitle": "No matches right now",
  "discover.emptyNoneBody": "Add your languages, interests and goals to get better recommendations.",
  "discover.viewProfile": "View {name}'s profile",

  /* moments */
  "moments.title": "Moments",
  "moments.empty": "No posts yet. Share one, or meet someone in Discover.",
  "moments.errorLoading": "Couldn't load posts. Please try again.",
  "moments.like": "Like",
  "moments.unlike": "Unlike",

  /* messages */
  "messages.title": "Messages",
  "messages.empty": "No conversations yet. Say hello in Discover — once you both accept, you can chat.",
  "messages.loadOlder": "Load earlier messages",
  "messages.backToList": "Back to conversations",
  "messages.conversationFallback": "Chat",
  "messages.startChat": "Tap to start chatting",
  "messages.composerPlaceholder": "Message…",
  "messages.composerLabel": "Message input",
  "messages.send": "Send",
  "messages.errorList": "Couldn't load conversations. Please try again.",
  "messages.errorThread": "Couldn't load messages.",
  "messages.errorSend": "Couldn't send. Please try again.",

  /* notifications */
  "notifications.title": "Alerts",
  "notifications.unreadCount": "{n} unread",
  "notifications.markAll": "Mark all read",
  "notifications.markAllLabel": "Mark all as read",
  "notifications.retry": "Retry",
  "notifications.retryLabel": "Retry loading alerts",
  "notifications.empty": "No alerts yet",
  "notifications.loadMore": "Load more",
  "notifications.errorLoading": "Couldn't load alerts. Please try again.",
  "notifications.typeFallback": "Alert",
  "notifications.unreadItemLabel": "Unread: {title}",
  "notifications.countSuffix": " · {n} new",
  "notifications.type.NEW_MESSAGE": "New message",
  "notifications.type.SAY_HELLO": "Someone said hello",
  "notifications.type.REQUEST_ACCEPTED": "Connection accepted",
  "notifications.type.EXCHANGE_REQUEST": "Contact exchange request",
  "notifications.type.EXCHANGE_ACCEPTED": "Contact exchange accepted",
  "notifications.type.MOMENT_LIKE": "Like on your post",
  "notifications.type.MOMENT_COMMENT": "Comment on your post",
  "notifications.type.MOMENT_REPLY": "Reply to your comment",
  "notifications.type.REPORT_REVIEW": "Report update",
  "notifications.type.USER_STATUS": "Account status update",
  "notifications.type.FLOWER_RECEIVED": "You received a flower",

  /* me */
  "me.title": "Me",
  "me.profileComplete": "Profile complete",
  "me.profileIncomplete": "Profile incomplete",
  "me.signOut": "Log out",
  "me.language": "Language",
  "me.languageNote": "Follows your phone's language by default; anything else shows English.",
  "me.languageSystem": "System default",
  "me.languageZh": "中文",
  "me.languageEn": "English",

  /* profile preview */
  "profile.title": "Profile",
  "profile.errorLoading": "Couldn't load this profile. Please try again.",
  "profile.sectionLanguages": "Languages",
  "profile.sectionInterests": "Interests",
  "profile.sectionPurposes": "Looking for",
  "profile.languageNative": " native",
  "profile.languageLearning": " learning",
  "profile.age": " {n} y/o",
  "profile.connected": "Connected",
  "profile.hello": "Say hello",
  "profile.helloSending": "Sending…",
  "profile.helloDone": "Hello sent",
  "profile.errorSend": "Couldn't send. Please try again.",
};

export const MESSAGES: Record<Locale, Record<MsgKey, string>> = { zh, en };

/** `{n}` / `{title}` 占位替换。缺参数时原样保留占位符 —— 宁可看出是占位符，也不要变成 `undefined`。 */
export function interpolate(template: string, params?: MsgParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function translate(locale: Locale, key: MsgKey, params?: MsgParams): string {
  // 词典在类型上已保证「键齐全」，这里只是 defensive：运行时真缺了也不炸界面。
  const template = MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}
