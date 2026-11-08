// 中英双语支持：语言保存在本机（localStorage），首次按浏览器语言判断。
// 服务端生成的文本（匹配理由、起名解释、操作提示）由动作的 lang 参数控制；
// 这里负责全部界面文案，以及命盘里确定性取值（星座/生肖/五行/干支/特质）的译名。

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";
export type RelationKey = "friend" | "lover" | "partner";

const LANG_KEY = "destiny-atlas-lang";

const D = {
  // 通用 / 页签
  mainNav: ["主要功能", "Main sections"],
  tabChart: ["命盘", "Chart"],
  tabMatch: ["匹配", "Match"],
  tabPeople: ["候选", "Candidates"],
  tabFriends: ["好友", "Friends"],
  tabChat: ["聊天", "Chat"],
  tabBonds: ["绑定", "Bonds"],
  tabAccount: ["账号", "Account"],
  tabMore: ["更多", "More"],
  tfAccountManaged: [
    "账号由 TalkFirst 统一管理：改密码、退出、注销都在 TalkFirst App 的「我的」里完成，这里不再重复一套。",
    "Your account is managed by TalkFirst — change your password, sign out or delete it in the TalkFirst app under Me. There is no second account here.",
  ],
  tabAdmin: ["管理", "Admin"],
  tabToday: ["今日", "Today"],
  todayTitle: ["今日运势", "Today's Fortune"],
  todayNeedChart: ["先排个盘，才能算出属于你自己的每日运势。", "Create your chart first — your daily fortune is computed from your own BaZi."],
  todayGoChart: ["去排盘", "Create my chart"],
  todayLoading: ["正在为你算今日运势…", "Casting today's fortune…"],
  fortuneScoreLabel: ["今日契合度", "Today's alignment"],
  fortuneWhy: ["为什么是这个分", "Why this score"],
  baseScoreNote: ["基础分 50，按下列逐条加减", "Starts at 50, adjusted point by point below"],
  yiTitle: ["今日宜", "Good for today"],
  jiTitle: ["今日忌", "Better avoid"],
  luckyNumbersLabel: ["幸运数字", "Lucky numbers"],
  luckyColorsLabel: ["幸运色", "Lucky colors"],
  dailyWordLabel: ["每日一句话", "One line for today"],
  matchTodayLabel: ["今日相配", "Today's matches"],
  matchSignWord: ["星座", "Zodiac sign"],
  matchAnimalWord: ["属相", "Animal sign"],
  trineWord: ["三合", "Trines"],
  onThisDayLabel: ["历史上的今天", "On this day in history"],
  onThisDayBirths: ["这一天出生的历史人物", "Historical figures born this day"],
  onThisDaySource: ["来源：维基百科「历史上的今天」", "Source: Wikipedia, On This Day"],
  fortuneNote: ["每日运势由你的命盘与当日干支推算，属传统文化娱乐参考。", "Daily fortune is derived from your chart and today's pillar — a traditional-culture entertainment reference."],
  signIn: ["登录", "Sign in"],
  signOut: ["退出", "Sign out"],
  adminBadge: ["管理员", "Admin"],
  guestChip: ["游客试用", "Guest trial"],
  cancel: ["取消", "Cancel"],
  delete: ["删除", "Delete"],
  close: ["关闭", "Close"],
  female: ["女", "Female"],
  male: ["男", "Male"],
  loading: ["加载中…", "Loading…"],

  // 登录 / 注册
  checkingLogin: ["正在确认登录状态…", "Checking your session…"],
  loginTab: ["登录", "Sign in"],
  registerTab: ["注册", "Register"],
  regClosed: ["当前已关闭新用户注册。", "Registration is currently closed."],
  username: ["用户名", "Username"],
  usernamePlaceholder: ["3-20 字，中文/字母/数字", "3–20 chars: Chinese, letters, digits"],
  password: ["密码", "Password"],
  passwordPlaceholderReg: ["至少 6 位", "At least 6 characters"],
  passwordPlaceholderLogin: ["输入密码", "Enter your password"],
  pleaseWait: ["请稍候…", "Please wait…"],
  registerAndLogin: ["注册并登录", "Register & sign in"],
  authPrivacyNote: [
    "每个账号的数据互相隔离：你的命盘、候选人、绑定与聊天只有你自己能看到。第一个注册的账号将成为管理员，并继承此前已有的全部数据。",
    "Accounts are fully separate: your chart, candidates, bindings and chats are visible only to you. The first registered account becomes the admin and inherits all existing data.",
  ],
  registerFail: ["注册失败，请检查用户名（3-20 字）与密码（至少 6 位）。", "Registration failed — check the username (3–20 chars) and password (at least 6 chars)."],
  loginFail: ["登录失败，请稍后再试。", "Sign-in failed. Please try again later."],

  // 访客试用
  guestBannerTitle: ["免注册试用中", "You're trying as a guest"],
  guestBannerText: [
    "排盘、起名、两人合盘试算都可以直接用，数据只保存在这台设备上。注册后可以保存档案、把人存入候选库、聊天和绑定。",
    "Charts, Chinese names and a two-person compatibility trial work right away — data stays on this device only. Register to save profiles, keep a candidate library, chat and bind.",
  ],
  guestBannerCta: ["注册 / 登录", "Register / Sign in"],
  gateTitle: ["这个功能需要账号", "This needs an account"],
  gateText: [
    "「{feature}」需要注册账号后使用。注册免费，注册后你的命盘、候选人和聊天都会按账号保存，只有你自己能看到。",
    "\"{feature}\" needs a free account. After registering, your chart, candidates and chats are saved to your account — visible only to you.",
  ],
  gateCta: ["去注册 / 登录", "Register / Sign in"],
  featureSaveProfile: ["保存档案", "Saving profiles"],
  featureCandidates: ["候选库（长期保存）", "The candidate library"],
  featureFriends: ["好友列表", "The friends list"],
  featureChat: ["聊天", "Chat"],
  featureBonds: ["关系绑定", "Relationship bindings"],
  savedOnDevice: ["已保存在本机，刷新不丢失", "Saved on this device — survives a refresh"],
  guestSavedNotice: ["已把你试算时填的命盘保存到账号里。", "The chart from your trial has been saved to your account."],

  // 命盘
  chartOf: ["{name} 的命盘", "{name}'s birth chart"],
  yearsOld: ["{age} 岁", "Age {age}"],
  bornAt: ["{date} {time} 出生", "Born {date} at {time}"],
  bornNoTime: ["{date} · 出生时辰未知", "{date} · birth time unknown"],
  editProfile: ["修改我的档案", "Edit my profile"],
  chartMethodNote: [
    "排盘口径：节气以太阳黄经算法推算（误差数分钟），年柱以立春为界、月柱以节为界，日柱 23 时起子初换日；未做真太阳时校正。命理与星座配对属传统文化与娱乐参考，不能替代现实中的了解与相处。",
    "How this chart is cast: solar terms are computed from the sun's ecliptic longitude (accurate to minutes); the year pillar turns at Lichun (Start of Spring), the month pillar at each solar term, and the day pillar rolls over at 23:00. No true-solar-time correction. BaZi and zodiac matching are traditional-culture and entertainment references — no substitute for really getting to know someone.",
  ],
  loadingChart: ["正在读取命盘…", "Loading your chart…"],
  castingTitle: ["正在排盘", "Casting your chart"],
  castingHint: ["星盘运转 · 四柱将启", "The chart wheel turns · the pillars emerge"],
  createChartTitle: ["先立你的命盘", "Cast your birth chart"],
  editChartTitle: ["修改我的档案", "Edit my profile"],
  chartIntro: [
    "填入出生日期与时间，系统自动排出你的星座、四柱八字、五行力量与喜忌，作为一切匹配的基准。",
    "Enter your birth date and time — your zodiac sign, Four Pillars (BaZi), five-element strengths and favorable elements are computed automatically, as the basis for all matching.",
  ],
  saveAndRecast: ["保存并重新排盘", "Save & recast"],
  createChart: ["生成我的命盘", "Cast my chart"],
  cancelEdit: ["取消修改", "Cancel"],
  profileSaved: ["你的命盘已更新。", "Your chart has been updated."],
  trialChartTitle: ["填生日，立即排出你的命盘", "Enter your birthday — your chart appears instantly"],
  trialChartIntro: [
    "不用注册：填好出生日期与时间，立即看到你的星座、四柱八字与五行力量。试算结果只保存在这台设备上，不会上传到任何账号。",
    "No account needed: enter your birth date and time to see your zodiac sign, Four Pillars and five-element strengths right away. Trial results stay on this device and are never uploaded to any account.",
  ],
  trialSubmit: ["立即排盘（免注册）", "Cast my chart (no sign-up)"],
  saveThisChartTitle: ["保存这张命盘", "Save this chart"],
  saveThisChartText: [
    "现在这张命盘只是试用结果，只存本机。注册后可把它存进你的账号，之后还能添加候选人、做完整匹配、开始聊天和绑定关系。",
    "Right now this chart is a trial result, stored only on this device. Register to save it to your account — then you can add candidates, run full matches, chat and bind relationships.",
  ],
  registerToSave: ["注册并保存", "Register & save"],

  // 命盘明细
  yearPillar: ["年柱", "Year"],
  monthPillar: ["月柱", "Month"],
  dayPillar: ["日柱", "Day"],
  hourPillar: ["时柱", "Hour"],
  dayMasterMark: ["日主", "Day Master"],
  hourUnknown: ["时辰未知", "Unknown"],
  animalChip: ["属{animal}", "Chinese zodiac: {animal}"],
  dayMasterChip: ["日主 {dm} · 身{strength}", "Day Master {dm} · {strength}"],
  favorable: ["喜用", "Favorable"],
  avoid: ["忌", "Avoid"],
  incompleteNote: [
    "未填写出生时辰：时柱缺失，五行力量与评分按六字估算，可信度略低。",
    "No birth time given: the hour pillar is missing, so element strengths and scores are estimated from six characters — slightly less precise.",
  ],

  // 档案表单
  nameLabel: ["姓名", "Name"],
  namePlaceholder: ["如：林小满", "e.g. Emma"],
  genderLabel: ["性别", "Gender"],
  birthDateLabel: ["出生日期（公历）", "Birth date (Gregorian)"],
  birthTimeLabel: ["出生时间", "Birth time"],
  noTimeLabel: ["不知道出生时辰（时柱留空，评分按六字估算）", "I don't know the birth time (hour pillar left empty; scoring uses six characters)"],
  birthYear: ["年", "Year"],
  birthMonth: ["月", "Month"],
  birthDay: ["日", "Day"],
  traitsLabel: ["性格特质（可多选）", "Personality traits (multi-select)"],
  notesLabel: ["备注（可选）", "Notes (optional)"],
  notesPlaceholder: ["如：在书店认识，喜欢猫", "e.g. Met at a bookstore, loves cats"],
  errName: ["请填写姓名", "Please enter a name"],
  errDate: ["请选择出生日期", "Please pick a birth date"],
  errTime: ["请选择出生时间，或勾选「不知道时辰」", "Please pick a birth time, or check \"I don't know the birth time\""],
  saving: ["保存中…", "Saving…"],

  // 起名
  namingTitle: ["起一个中文名", "Get a Chinese name"],
  namingIntro: [
    "如果你是外国朋友，想要一个真正属于自己的中文名：这里不是随机抽字，而是按你上面这张命盘来选——日主强弱定喜用、五行缺什么补什么、忌神的字避开，再参酌五格数理与读音平仄。每个名字下方都会写清：为什么选这些字、和你八字五行的关系、每个字本身的含义。",
    "If you're a friend from abroad who wants a Chinese name that's truly yours: nothing here is random. Names are chosen from the chart above — your Day Master's strength sets the favorable elements, whatever is missing gets replenished, avoided elements are skipped, and five-grid numerology plus tone balance are weighed in. Under each name you'll find exactly why these characters were chosen, how they relate to your BaZi elements, and what each character means.",
  ],
  surnameLabel: ["中文姓氏（可空）", "Chinese family name (optional)"],
  surnamePlaceholder: ["留空 = 按你的命局推荐", "Leave blank = recommended from your chart"],
  generating: ["正在推算…", "Working…"],
  regenerate: ["重新起名", "New names"],
  generateNames: ["为我起名", "Name me"],
  styleGroupLabel: ["名字风格", "Name style"],
  styleAny: ["不限风格", "Any style"],
  styleElegant: ["文雅", "Refined"],
  styleGrand: ["大气", "Grand"],
  styleFresh: ["清新", "Fresh"],
  styleSteady: ["稳重", "Steady"],
  styleVivid: ["灵动", "Vivid"],
  namingFail: ["起名失败，请稍后再试。", "Naming failed — please try again later."],
  basisTitle: ["起名依据 · Why these names", "Why these names"],
  basisFavorable: ["喜用 {list}", "Favorable: {list}"],
  basisWeakest: ["最弱 {el}（{v}）", "Weakest: {el} ({v})"],
  basisMissing: [" · 命局缺 {list}", " · Missing: {list}"],
  fitScore: ["契合 {score}", "Fit {score}"],
  nameSelected: ["已点选 ✦", "Selected ✦"],
  charMeaning: ["字义：", "Meaning: "],
  strokesSuffix: ["{n} 画", "{n} strokes"],
  nameElementRelation: ["与命局的关系：", "Relation to your chart: "],
  nameMeaningLabel: ["名字寓意：", "What the name means: "],
  wugeLine: [
    "五格（简体笔画）：天格 {t} · 人格 {r} · 地格 {d} · 外格 {w} · 总格 {z}",
    "Five grids (simplified strokes): Heaven {t} · Personality {r} · Foundation {d} · Outer {w} · Total {z}",
  ],
  moreNames: ["换一批名字", "Show another batch"],
  namingDisclaimer: [
    "字库为常用起名汉字，五行按字形偏旁与字义的通行归类，笔画按简体字计算，五格为传统数理参考。正式使用前，建议再请一位中文朋友帮你听一遍读音、看看有没有不想要的谐音。",
    "The character library uses common name characters; elements follow the usual radical-and-meaning classification, strokes are simplified-character counts, and the five grids are a traditional numerology reference. Before using a name officially, ask a Chinese-speaking friend to listen for unwanted homophones.",
  ],

  // 分享卡
  shareCard: ["生成分享卡", "Share card"],
  shareCardTitle: ["分享卡", "Share card"],
  downloadImage: ["下载图片", "Download image"],
  systemShare: ["系统分享", "Share…"],
  cardNameKicker: ["我的中文名", "MY CHINESE NAME"],
  cardNameCta: ["用你的出生日期，起一个真正属于你的中文名", "Get a Chinese name crafted from your own birth date"],
  cardMatchKicker: ["合盘契合度", "COMPATIBILITY"],
  cardMatchCta: ["测测你和 TA 的契合度", "Check your compatibility with someone"],

  // 匹配
  matchNeedProfile: ["匹配需要以你的命盘为基准。", "Matching is based on your own chart."],
  goCreateChart: ["先去建立我的命盘", "Create my chart first"],
  matchTitle: ["这次想找什么关系？", "What kind of relationship this time?"],
  relationGroup: ["关系类型", "Relationship type"],
  relFriend: ["朋友", "Friend"],
  relLover: ["恋人", "Lover"],
  relPartner: ["伴侣", "Partner"],
  relFriendLimit: ["上限 {n} 人", "Up to {n}"],
  relSingleLimit: ["限 1 人", "Only 1"],
  relFriendHint: ["益友贵精不贵多", "Quality over quantity"],
  relLoverHint: ["与伴侣互斥 · 专一", "Exclusive with Partner"],
  relPartnerHint: ["与恋人互斥 · 专一", "Exclusive with Lover"],
  wantsLabel: ["希望对方具备的特质（可多选）", "Traits you'd like them to have (multi-select)"],
  surnameReqLabel: ["指定姓氏（单字，可空）", "Required family name (one character, optional)"],
  surnameReqPlaceholder: ["如：林", "e.g. 林"],
  nameContainsLabel: ["名字里带的字（可空）", "Character in their name (optional)"],
  nameContainsPlaceholder: ["如：安", "e.g. 安"],
  ageMinLabel: ["年龄下限（可空）", "Min age (optional)"],
  ageMaxLabel: ["年龄上限（可空）", "Max age (optional)"],
  unlimited: ["不限", "Any"],
  soloTarget: ["单独测算对象：", "Testing just: "],
  soloReset: ["改为测算全部候选人", "Match against all candidates"],
  startMatch: ["开始匹配", "Start matching"],
  matching: ["正在推算…", "Matching…"],
  candidatesEmptyHint: ["候选库还是空的，先到「候选库」添加想了解的人。", "Your library is empty — add people under \"Candidates\" first."],
  scoreUnit: ["分", "pts"],
  scoreZodiac: ["星座契合", "Zodiac fit"],
  scoreBazi: ["八字相合", "BaZi harmony"],
  scoreDetail: ["细节得分", "Details"],
  collapseChart: ["收起命盘", "Hide chart"],
  viewFullChart: ["查看完整命盘", "View full chart"],
  boundAs: ["已是你的{rel}", "Already your {rel}"],
  bindAs: ["绑定为{rel}", "Bind as {rel}"],
  goChat: ["去聊天", "Chat"],
  traitsLine: ["特质：", "Traits: "],
  notesLine: ["备注：", "Notes: "],
  bornLine: ["出生：{date}", "Born: {date}"],
  bornTimeUnknownSuffix: ["（时辰未知）", " (time unknown)"],

  // 访客合盘
  guestMatchTitle: ["两人合盘试算（免注册）", "Two-person compatibility trial (no sign-up)"],
  guestMatchIntro: [
    "填两个人的出生信息，立即算出契合度总分与逐条理由。试算不保存任何数据；注册后可把对方存入候选库长期使用。",
    "Enter two people's birth details for an instant compatibility score with point-by-point reasons. Nothing is saved; register to keep them in your candidate library.",
  ],
  meHeading: ["我", "You"],
  themHeading: ["对方", "Them"],
  guestMatchSubmit: ["开始合盘试算", "Run the trial"],
  saveMyInfo: ["保存我的信息", "Save my details"],
  saveTheirInfo: ["保存对方信息", "Save their details"],
  editBtn: ["修改", "Edit"],
  myChartCard: ["我的命盘", "My chart"],
  theirChartCard: ["对方命盘", "Their chart"],
  guestResultTitle: ["合盘结果", "Compatibility result"],
  registerPromptTitle: ["想把这个结果留下来？", "Want to keep this result?"],
  registerPromptText: [
    "注册后可以把对方存入候选库、绑定为朋友 / 恋人 / 伴侣，还能和站内真实用户聊天、问 AI 命理助手。",
    "Register to save them to your library, bind them as Friend, Lover or Partner, chat with real registered users and ask the AI assistant.",
  ],

  // 候选库
  peopleTitle: ["把想了解的人放进来", "Add people you want to know"],
  peopleIntro: [
    "录入对方的出生信息后会自动排盘，之后就能在「匹配」里按朋友、恋人、伴侣分别筛选。",
    "Enter their birth details and their chart is cast automatically; then match them as Friend, Lover or Partner under \"Match\".",
  ],
  addCandidate: ["添加候选人", "Add candidate"],
  addCandidateSubmit: ["加入候选库", "Add to library"],
  candidateAdded: ["候选人已加入候选库。", "Added to your candidate library."],
  candidateDeleted: ["已删除该候选人，其绑定一并解除。", "Candidate deleted; their bindings were released."],
  loadingCandidates: ["正在读取候选库…", "Loading your library…"],
  candidatesEmpty: ["候选库还是空的。添加第一位候选人后，就能开始匹配。", "Your library is empty. Add your first candidate to start matching."],
  fullChartBtn: ["完整命盘", "Full chart"],
  soloTest: ["与我单独测算", "Test with me"],
  startChat: ["开始聊天", "Start chat"],
  pillarsLine: ["四柱", "Pillars"],

  // 好友（真实注册用户 + 候选人档案）
  friendsTitle: ["好友", "Friends"],
  friendsCount: ["{n} 位档案", "{n} profiles"],
  friendsIntro: [
    "真实注册用户在上方，带真实在线状态，可以直接发消息；下方是你手动录入的候选人档案——他们不是注册账号，没有在线状态，也不再有模拟聊天。",
    "Registered users are at the top with real presence — message them directly. Below are candidate profiles you entered by hand: they aren't accounts, have no online status, and no longer have simulated chat.",
  ],
  allFriends: ["全部好友", "All friends"],
  onlineOnly: ["只看在线", "Online only"],
  friendFilterLabel: ["好友筛选", "Friends filter"],
  loadingFriends: ["正在读取好友列表…", "Loading friends…"],
  friendsEmpty: ["还没有候选人档案。先到「候选」添加你认识的人，他们就会出现在这里。", "No candidate profiles yet. Add people under \"Candidates\" and they'll show up here."],
  goAddFriends: ["去添加好友", "Add friends"],
  noOnlineNow: ["现在没有好友在线，过一会儿再来看看。", "Nobody's online right now — check back later."],
  online: ["在线", "Online"],
  activeMinsAgo: ["{m} 分钟前活跃", "Active {m}m ago"],
  activeHoursAgo: ["约 {h} 小时前活跃", "Active ~{h}h ago"],
  chattedCount: ["已聊 {n} 条", "{n} messages"],
  chatBtn: ["聊天", "Chat"],
  friendsUsersTitle: ["站内真实用户", "Registered users"],
  friendsProfilesTitle: ["候选人档案", "Candidate profiles"],
  profileChip: ["档案 · 非注册用户", "Profile · not an account"],
  noUsersYet: ["站内暂时还没有其他注册用户。", "No other registered users yet."],
  friendsNote: [
    "说明：在线状态按真实活跃时间计算（5 分钟内活跃算在线）。候选人档案是你手动录入的联系人，不是真人账号，因此不显示在线状态。",
    "Note: presence is computed from real activity (active within 5 minutes counts as online). Candidate profiles are contacts you entered yourself — not real accounts — so they show no online status.",
  ],

  // 聊天（真实用户私聊）
  messagesTitle: ["消息", "Messages"],
  chatIntro: [
    "这里是站内真实用户之间的聊天：按用户名搜索对方就能发起对话，消息保存在服务端、只有你们两个人能看到，对方上线后就能读到。候选人档案不是真人，已不再有模拟回复。",
    "This is real chat between registered users: search by username to start a conversation. Messages are stored on the server, visible only to the two of you, and waiting when they come online. Candidate profiles are not real people — simulated replies are gone.",
  ],
  loadingConversations: ["正在读取会话…", "Loading conversations…"],
  noChatsYet: ["还没有和任何人聊过。在上方搜个用户名，开始第一次真实对话。", "No conversations yet. Search a username above and start your first real chat."],
  addCandidateFirst: ["先去添加候选人", "Add a candidate first"],
  noMessagesYet: ["还没有消息，来说第一句吧", "No messages yet — say hello"],
  backToList: ["← 返回", "← Back"],
  backToListAria: ["返回会话列表", "Back to conversations"],
  typing: ["对方正在输入", "typing…"],
  connecting: ["正在连接…", "Connecting…"],
  chatEmptyHint: [
    "还没有消息。打个招呼吧——对方上线后就能看到。",
    "No messages yet. Say hello — they'll see it when they're back online.",
  ],
  clearHistory: ["清空记录", "Clear"],
  chatCleared: ["聊天记录已清空。", "Chat history cleared."],
  inputMessage: ["输入消息", "Type a message"],
  messagePlaceholder: ["说点什么…", "Say something…"],
  send: ["发送", "Send"],
  sending: ["发送中", "Sending"],
  mePrefix: ["我：", "Me: "],
  chatDisclaimer: ["模拟对话练习 · 回复由对方档案生成，不代表真人发言", "Simulated practice chat · replies are generated from their profile, not a real person"],

  // 真实私聊 / 用户搜索 / 拉黑
  realUserChip: ["站内真实用户", "Real registered user"],
  searchUsersTitle: ["找人聊天", "Find someone to chat"],
  searchUsersPlaceholder: ["输入对方用户名搜索", "Search by their username"],
  directoryTitle: ["站内用户", "People on this site"],
  noUsersFound: ["没有找到这个用户名，确认拼写后再试试。", "No user with that name — check the spelling and try again."],
  startDmChat: ["发消息", "Message"],
  neverActive: ["尚未活跃", "Not active yet"],
  activeDaysAgo: ["{d} 天前活跃", "Active {d}d ago"],
  unreadCount: ["{n} 条未读", "{n} unread"],
  dmFooterNote: ["站内真实用户之间的消息 · 仅对话双方可见", "Messages between real registered users · visible only to the two of you"],
  blockUser: ["拉黑", "Block"],
  unblockUser: ["解除拉黑", "Unblock"],
  youBlockedNotice: ["你已拉黑对方，对方不能再给你发消息；解除拉黑后你才能发消息。", "You've blocked this user — they can't message you, and you can't send until you unblock."],
  blockedYouNotice: ["对方已将你拉黑，无法发送消息。", "This user has blocked you — messages can't be sent."],
  legacyTitle: ["历史模拟记录", "Past simulated chats"],
  legacyIntro: [
    "这是早期版本与候选人档案的模拟对话记录，仅供回看，不再产生新的回复。想和真人聊天，请用上方的站内用户私聊。",
    "These are simulated-chat records with candidate profiles from the earlier version — kept for history only, no new replies. For real conversation, use the registered-user chat above.",
  ],
  legacyViewOnly: ["历史记录 · 只读", "History · read-only"],
  viewHistory: ["查看", "View"],

  // AI 命理助手
  aiAssistantName: ["AI 命理助手", "AI BaZi Assistant"],
  aiBadge: ["AI", "AI"],
  aiPinnedHint: ["问命盘、起名、合盘，或 app 怎么用", "Ask about your chart, names, matches — or how the app works"],
  aiIntro: [
    "我是 AI 命理助手（人工智能，不是真人）。登录后提问，我会结合你自己的命盘（四柱、五行、日主喜忌）、起名结果和合盘结果来回答；也可以问我 app 的用法。",
    "I'm the AI BaZi Assistant — an AI, not a real person. Ask while signed in and I'll answer from your own chart (pillars, elements, Day Master & favorable elements), your name suggestions and match results. You can also ask how the app works.",
  ],
  aiGuestNote: ["访客只能问通用问题；登录并建立命盘后，回答会结合你本人的数据。", "Guests can ask general questions. Sign in and cast your chart for answers based on your own data."],
  aiPlaceholder: ["问问你的命盘、起名或合盘…", "Ask about your chart, names or a match…"],
  aiThinking: ["正在结合你的命盘推演…", "Reading your chart…"],
  aiSuggestionsLabel: ["可以这样问：", "Try asking:"],
  aiQ1: ["我的命盘有什么特点？喜用神怎么影响起名？", "What stands out in my chart? How do my favorable elements affect naming?"],
  aiQ2: ["我和候选人的合盘结果该怎么看？", "How should I read my match result with a candidate?"],
  aiQ3: ["这个 app 怎么用？绑定规则是什么？", "How does this app work? What are the binding rules?"],
  aiClear: ["清空对话", "Clear chat"],
  aiEmptyHint: ["还没有对话。在下方输入你的问题，我会尽量结合你的命盘数据来回答。", "No conversation yet. Type a question below — I'll answer from your chart data whenever I can."],
  aiSendFail: ["助手暂时不可用，请稍后再试。", "The assistant is unavailable right now — please try again later."],
  aiFooterNote: ["AI 生成内容，结合提问者本人的命盘数据作答 · 仅供娱乐参考", "AI-generated answers, grounded in the asker's own chart data · for entertainment only"],
  blockedYouShort: ["对方已拉黑你", "Blocked you"],
  favorsShort: ["喜", "Favors"],

  // 绑定
  bondRulesTitle: ["绑定规则", "Binding rules"],
  bondRulePartner: ["伴侣：终身一人制，只能绑定 1 人。", "Partner: one person only, for life."],
  bondRuleLover: ["恋人：限 1 人，且与伴侣互斥——已有伴侣时不能再绑定恋人，反之亦然。", "Lover: only 1, and exclusive with Partner — with a Partner bound, no Lover can be bound, and vice versa."],
  bondRuleFriend: ["朋友：上限 {n} 人，益友贵精不贵多。", "Friends: up to {n} — quality over quantity."],
  bondRuleRelease: ["解除绑定后名额立即释放，可重新绑定他人。", "Unbinding frees the slot immediately; you can bind someone else."],
  notBoundYet: ["暂未绑定。在「匹配」结果里可以把合适的人绑定为{rel}。", "None bound yet. Bind someone from the Match results as your {rel}."],
  boundOn: ["{date} 绑定", "Bound {date}"],
  unbind: ["解除绑定", "Unbind"],
  unboundNotice: ["已解除绑定。", "Binding removed."],

  // 账号
  userRole: ["普通用户", "Regular user"],
  statusActive: ["正常", "Active"],
  statusDisabled: ["已停用", "Disabled"],
  registeredAt: ["注册时间", "Registered"],
  lastLogin: ["上次登录", "Last login"],
  myCandidates: ["我的候选人", "My candidates"],
  myBondsChats: ["我的绑定 / 会话", "My bindings / chats"],
  peopleUnit: ["{n} 人", "{n}"],
  accountPrivacy: [
    "你的数据只属于你的账号：命盘、候选人、绑定与聊天都按账号隔离，其他用户看不到，也改不了。",
    "Your data belongs to your account alone: chart, candidates, bindings and chats are isolated per account — no one else can see or change them.",
  ],
  signOutBtn: ["退出登录", "Sign out"],
  changePassword: ["修改密码", "Change password"],
  oldPassword: ["旧密码", "Current password"],
  newPassword: ["新密码（至少 6 位）", "New password (min 6 chars)"],
  saveNewPassword: ["保存新密码", "Save new password"],
  changingPassword: ["修改中…", "Saving…"],
  deleteAccount: ["注销账号", "Delete account"],
  deleteAccountText: ["注销后，你的命盘、候选人、绑定与聊天会被全部删除，无法恢复。", "Deleting removes your chart, candidates, bindings and chats permanently. This cannot be undone."],
  iWantDelete: ["我要注销账号", "Delete my account"],
  deleteConfirmLabel: ["输入密码确认注销", "Enter your password to confirm"],
  confirmDelete: ["确认注销并删除数据", "Delete account & data"],
  adminNoSelfDelete: ["管理员账号不能自注销；如需删除，请先在后台把管理员角色转给其他账号。", "Admin accounts can't delete themselves; transfer the admin role to another account in the backend first."],

  // 后台
  adminNavLabel: ["后台分区", "Admin sections"],
  adminOverview: ["概览", "Overview"],
  adminUsers: ["用户", "Users"],
  adminProfile: ["档案", "Profile"],
  adminCandidates: ["候选人", "Candidates"],
  adminBonds: ["绑定", "Bindings"],
  adminChats: ["聊天", "Chats"],
  adminSettingsSec: ["设置", "Settings"],
  adminData: ["数据", "Data"],
  statUsers: ["注册用户", "Registered users"],
  statUsersSub: ["今日新增 {a} · 管理员 {b} · 已停用 {c}", "{a} new today · {b} admins · {c} disabled"],
  statCandidates: ["候选人（全站）", "Candidates (site-wide)"],
  statCandSub: ["今日新增 {a} · 女 {f} / 男 {m}", "{a} new today · F {f} / M {m}"],
  statBindings: ["绑定（全站）", "Bindings (site-wide)"],
  statBindSub: ["朋友 {f} · 恋人 {l} · 伴侣 {p}", "Friend {f} · Lover {l} · Partner {p}"],
  statConversations: ["会话（全站）", "Conversations (site-wide)"],
  statConvSub: ["平均每会话 {n} 条消息", "Avg {n} messages per conversation"],
  statMessages: ["消息（全站）", "Messages (site-wide)"],
  statMsgSub: ["今日 {t} · 真实私聊 {me} / 旧模拟 {them}", "{t} today · real DMs {me} / legacy sim {them}"],
  statCompleteness: ["命盘完整度", "Chart completeness"],
  statCompSub: ["时辰齐全 / 候选人总数 · 缺时辰 {n}", "With birth time / total · {n} missing time"],
  distZodiac: ["星座分布", "Zodiac distribution"],
  distAnimal: ["生肖分布", "Chinese zodiac distribution"],
  distDayMaster: ["日主分布", "Day Master distribution"],
  distAge: ["年龄分布", "Age distribution"],
  distTraits: ["特质热度（候选人档案中出现次数）", "Trait frequency (in candidate profiles)"],
  noData: ["暂无数据", "No data"],
  recentCandidates: ["最近加入的候选人", "Recently added candidates"],
  recentMessages: ["最近消息", "Recent messages"],
  recentBindings: ["最近绑定", "Recent bindings"],
  noneYet: ["暂无", "None yet"],
  loadingOverview: ["正在汇总全站数据…", "Compiling site-wide data…"],
  senderUser: ["用户：", "User: "],
  bubbleUser: ["用户", "User"],
  senderThem: ["对方：", "Them: "],
  settingsSavedNotice: ["站点设置已保存，前台立即生效。", "Settings saved — live across the site now."],
  candidateUpdatedNotice: ["候选人档案已更新，会话与绑定中的姓名已同步。", "Candidate updated; the name was synced into chats and bindings."],
  profileDeletedNotice: ["该用户的命理档案已删除。", "That user's chart profile was deleted."],
  conversationDeletedNotice: ["会话及其消息已删除。", "Conversation and its messages deleted."],
  messageDeletedNotice: ["该条消息已删除。", "Message deleted."],
  bulkDeletedNotice: ["已批量删除 {n} 位候选人及其绑定、聊天。", "Deleted {n} candidates with their bindings and chats."],
  unbindDoneNotice: ["已解除该绑定。", "Binding removed."],
  usersTitle: ["注册用户管理", "User management"],
  usersIntro: [
    "管理全部注册账号：查看每人的数据量与明细、启用/停用、设为管理员、重置密码、删除账号及其数据。停用后该用户立即无法登录。",
    "Manage all accounts: per-user data counts and details, enable/disable, promote to admin, reset passwords, delete accounts and their data. Disabled users are signed out immediately.",
  ],
  searchUsers: ["按用户名搜索", "Search by username"],
  searchUsersLabel: ["搜索用户", "Search users"],
  disabledBadge: ["已停用", "Disabled"],
  meBadge: ["我自己", "You"],
  userDataLine: ["命盘：{profile} · 候选人 {c} · 绑定 {b} · 会话 {v} · 消息 {m}", "Chart: {profile} · Candidates {c} · Bindings {b} · Chats {v} · Messages {m}"],
  notCreated: ["未建档", "Not created"],
  registeredShort: ["注册 {date} · 上次登录 {last}", "Joined {date} · Last login {last}"],
  never: ["从未", "Never"],
  viewDetail: ["查看明细", "Details"],
  hideDetail: ["收起明细", "Hide"],
  enable: ["启用", "Enable"],
  disable: ["停用", "Disable"],
  makeAdmin: ["设为管理员", "Make admin"],
  removeAdmin: ["取消管理员", "Remove admin"],
  confirmDeleteUser: ["确认删除用户及全部数据", "Confirm: delete user & all data"],
  deleteUser: ["删除用户", "Delete user"],
  resetPwPlaceholder: ["输入新密码（至少 6 位）后点重置", "New password (min 6 chars), then Reset"],
  resetPwFor: ["为 {name} 设置新密码", "Set a new password for {name}"],
  resetPassword: ["重置密码", "Reset password"],
  deleteUserProfile: ["删除该用户的命盘档案", "Delete this user's chart profile"],
  noUserProfile: ["该用户还没有建立命盘档案。", "This user hasn't created a chart yet."],
  candidatesHead: ["候选人（{n}）", "Candidates ({n})"],
  bindingsHead: ["绑定（{n}）· 会话 {v} 个 · 消息 {m} 条", "Bindings ({n}) · {v} conversations · {m} messages"],
  loadingDetail: ["正在读取明细…", "Loading details…"],
  loadingUsers: ["正在读取用户列表…", "Loading users…"],
  noUsers: ["暂无注册用户。", "No registered users yet."],
  adminProfileTitle: ["我的命盘档案（管理员本人）", "My chart profile (the admin)"],
  goEditProfile: ["去前台修改档案", "Edit in the front end"],
  deleteMyProfile: ["删除我的档案", "Delete my profile"],
  noMyProfile: ["你还没有建立命盘档案。", "You haven't created a chart yet."],
  goCreateProfile: ["去建立档案", "Create one"],
  adminProfileNote: [
    "其他用户的档案在「用户」分区里逐个查看与管理（明细中可删除其命盘）。删除档案不影响其候选人、绑定与聊天。",
    "Other users' profiles are managed one by one under \"Users\" (their chart can be deleted from the detail view). Deleting a profile doesn't affect their candidates, bindings or chats.",
  ],
  adminCandTitle: ["候选人管理（全站）", "Candidate management (site-wide)"],
  adminCandIntro: [
    "全站所有用户候选库的统一视图：可搜索、按性别/绑定状态筛选、按时间/年龄/姓名排序，逐个编辑或删除，也可勾选批量删除。每行标注所属用户。",
    "A unified view of every user's library: search, filter by gender/binding status, sort by time/age/name, edit or delete individually, or select for bulk delete. Each row shows its owner.",
  ],
  searchCandidates: ["按姓名 / 特质 / 备注 / 所属用户搜索", "Search by name / trait / note / owner"],
  searchCandidatesLabel: ["搜索候选人", "Search candidates"],
  genderAll: ["全部性别", "All genders"],
  genderFOnly: ["只看女", "Female only"],
  genderMOnly: ["只看男", "Male only"],
  statusAll: ["全部状态", "All statuses"],
  statusBound: ["已绑定", "Bound"],
  statusUnbound: ["未绑定", "Unbound"],
  statusChatted: ["聊过天", "Chatted"],
  candFilterLabel: ["候选人筛选与排序", "Candidate filters & sorting"],
  sortLabel: ["排序方式", "Sort"],
  sortNew: ["最新添加", "Newest"],
  sortOld: ["最早添加", "Oldest"],
  sortAgeAsc: ["年龄从小到大", "Age ascending"],
  sortAgeDesc: ["年龄从大到小", "Age descending"],
  sortName: ["姓名排序", "Name"],
  selectedCount: ["已选 {n} 人", "{n} selected"],
  bulkDelete: ["批量删除（含其绑定与聊天）", "Bulk delete (with bindings & chats)"],
  cancelSelection: ["取消选择", "Clear selection"],
  loadingAllCandidates: ["正在读取全站候选人…", "Loading all candidates…"],
  noCandidatesMatch: ["没有符合条件的候选人。", "No candidates match."],
  ownerLabel: ["所属：{name}", "Owner: {name}"],
  bornPrefix: ["出生：{date}", "Born: {date}"],
  editProfileBtn: ["编辑档案", "Edit"],
  viewChartBtn: ["查看命盘", "View chart"],
  hideChartBtn: ["收起命盘", "Hide chart"],
  saveChanges: ["保存修改", "Save changes"],
  cancelEditBtn: ["取消编辑", "Cancel editing"],
  selectCandidate: ["选择 {name}", "Select {name}"],
  adminBondsTitle: ["绑定管理（全站）", "Binding management (site-wide)"],
  adminBondsIntro: [
    "当前规则：朋友上限 {f} 人 · 恋人上限 {l} 人 · 伴侣上限 {p} 人 · 恋人/伴侣互斥{state}（在「设置」里改）。下方是全站全部绑定，可按关系筛选、逐条解除。",
    "Current rules: Friends up to {f} · Lover up to {l} · Partner up to {p} · Lover/Partner exclusivity {state} (change under Settings). All bindings site-wide are below — filter by relationship or unbind individually.",
  ],
  exclOn: ["开启", "on"],
  exclOff: ["关闭", "off"],
  filterAll: ["全部", "All"],
  bondFilterLabel: ["绑定筛选", "Binding filter"],
  loadingAllBindings: ["正在读取全站绑定…", "Loading all bindings…"],
  noBindingsMatch: ["暂无符合条件的绑定。", "No bindings match."],
  ownerLine: ["所属用户：{name} · {date} 绑定", "Owner: {name} · Bound {date}"],
  adminChatsTitle: ["真实用户会话管理（全站）", "Real-user conversations (site-wide)"],
  adminChatsIntro: [
    "这里是注册用户之间的真实私聊：可按关键词过滤会话与消息，可删除单条消息或整个会话。旧模拟聊天记录不在此列。",
    "These are real direct messages between registered users: filter conversations and messages by keyword; delete single messages or whole conversations. Old simulated chats are not included.",
  ],
  msgFilterPlaceholder: ["在打开的会话里按关键词过滤消息", "Filter messages in the open conversation by keyword"],
  msgFilterLabel: ["按关键词过滤消息", "Filter messages by keyword"],
  loadingAllConvs: ["正在读取全站会话…", "Loading all conversations…"],
  noConvsYet: ["全站还没有任何会话。", "No conversations anywhere yet."],
  convOwner: ["· 所属用户 {name}", "· Owner {name}"],
  convMsgCount: ["{n} 条消息", "{n} messages"],
  convLast: ["最近：", "Latest: "],
  viewMessages: ["查看消息", "View"],
  hideMessages: ["收起", "Hide"],
  deleteConversation: ["删除会话", "Delete conversation"],
  loadingMessages: ["正在读取消息…", "Loading messages…"],
  noMessagesMatch: ["没有符合的消息。", "No messages match."],
  deleteMsgBtn: ["删", "Del"],
  deleteMessageAria: ["删除消息 {id}", "Delete message {id}"],
  adminSettingsTitle: ["站点设置", "Site settings"],
  adminSettingsIntro: [
    "标题与公告显示在所有用户的前台；绑定上限、互斥与注册开关即时对全站生效。",
    "Title and announcement appear on everyone's front end; binding limits, exclusivity and the registration switch apply site-wide immediately.",
  ],
  loadingSettings: ["正在读取设置…", "Loading settings…"],
  stTitle: ["站点标题（刊头英文名）", "Site title (masthead)"],
  stSubtitle: ["站点副标题", "Site subtitle"],
  stAnnouncement: ["全站公告（留空不显示，显示在首页顶部）", "Announcement (blank = hidden; shown at the top of the home page)"],
  annPlaceholder: ["如：本周六晚 8 点维护 10 分钟", "e.g. Maintenance Saturday 8pm, 10 minutes"],
  friendLimit: ["朋友上限", "Friend limit"],
  loverLimit: ["恋人上限", "Lover limit"],
  partnerLimit: ["伴侣上限", "Partner limit"],
  exclLabel: ["恋人与伴侣互斥（专一原则）", "Lover & Partner are exclusive"],
  exclHint: [
    "开启后：已绑定伴侣就不能再绑定恋人，反之亦然。关闭后两者可同时存在（仍受各自上限约束）。",
    "When on: with a Partner bound you can't bind a Lover, and vice versa. When off, both may exist (each still capped).",
  ],
  regLabel: ["开放新用户注册", "Open registration"],
  regHint: [
    "关闭后，登录页只保留登录，新人无法再注册账号（已有账号不受影响）。",
    "When off, the sign-in page keeps only login; new accounts can't register (existing accounts unaffected).",
  ],
  adminNoteLabel: ["管理员备忘（仅后台可见）", "Admin memo (backend only)"],
  adminNotePlaceholder: ["记录运营注意事项、规则说明等", "Operational notes, rule explanations…"],
  lastSaved: ["上次保存：{date}", "Last saved: {date}"],
  saveSettings: ["保存设置（立即生效）", "Save settings (applies immediately)"],
  savingSettings: ["保存中…", "Saving…"],
  exportTitle: ["数据导出（备份）", "Data export (backup)"],
  exportIntro: [
    "导出全站数据为 JSON：注册用户（不含密码）、命盘档案、候选人、绑定、会话、消息与站点设置。可下载保存，用于备份或迁移。",
    "Export everything as JSON: users (no passwords), chart profiles, candidates, bindings, conversations, messages and site settings — for backup or migration.",
  ],
  exportBtn: ["生成导出 JSON", "Generate export JSON"],
  exporting: ["正在导出…", "Exporting…"],
  exportContentLabel: ["导出 JSON 内容", "Export JSON content"],
  downloadJson: ["下载 JSON 文件", "Download JSON file"],
  dangerTitle: ["危险区 · 清空数据", "Danger zone · Clear data"],
  dangerIntro: [
    "以下操作作用于全站所有用户且不可恢复，执行前会再确认一次。用户账号与站点设置不会被清。",
    "These actions affect every user site-wide and cannot be undone; you'll be asked to confirm once more. Accounts and site settings are kept.",
  ],
  clearChat: ["清空全部聊天", "Clear all chats"],
  clearBindings: ["解除全部绑定", "Remove all bindings"],
  clearCandidates: ["清空全部候选人", "Clear all candidates"],
  clearAll: ["清空全部业务数据", "Clear all business data"],
  confirmChat: ["确定要清空全站全部聊天记录吗？此操作不可恢复。", "Clear ALL chat history site-wide? This cannot be undone."],
  confirmBindings: ["确定要解除全站全部绑定吗？此操作不可恢复。", "Remove ALL bindings site-wide? This cannot be undone."],
  confirmCandidates: ["确定要清空全站全部候选人（关联绑定与聊天一并删除）吗？此操作不可恢复。", "Clear ALL candidates site-wide (their bindings and chats go too)? This cannot be undone."],
  confirmAll: ["确定要清空全站全部业务数据（档案、候选人、绑定、聊天）吗？此操作不可恢复。", "Clear ALL business data site-wide (profiles, candidates, bindings, chats)? This cannot be undone."],
  confirmExecuting: ["执行中…", "Working…"],
  confirmExecute: ["确认执行", "Confirm"],
} as const;

export type DictKey = keyof typeof D;

export interface LangCtxValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey, params?: Record<string, string | number>) => string;
  locale: string;
}

const LangCtx = createContext<LangCtxValue | null>(null);

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch { /* ignore */ }
  try {
    return (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  }, []);
  const t = useCallback(
    (key: DictKey, params?: Record<string, string | number>) => {
      const pair = D[key] as readonly [string, string];
      let s = lang === "en" ? pair[1] : pair[0];
      if (params) {
        for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      }
      return s;
    },
    [lang],
  );
  return (
    <LangCtx.Provider value={{ lang, setLang, t, locale: lang === "en" ? "en-US" : "zh-CN" }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useLang(): LangCtxValue {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <span
      className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5"
      role="group"
      aria-label="Language / 语言"
    >
      <button
        type="button"
        aria-pressed={lang === "zh"}
        onClick={() => setLang("zh")}
        className={`rounded-full px-2.5 py-1 text-xs ${lang === "zh" ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "text-[var(--dim)]"}`}
      >
        中文
      </button>
      <button
        type="button"
        aria-pressed={lang === "en"}
        onClick={() => setLang("en")}
        className={`rounded-full px-2.5 py-1 text-xs ${lang === "en" ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "text-[var(--dim)]"}`}
      >
        English
      </button>
    </span>
  );
}

/* ---------- 确定性取值的译名（命盘数据本身仍是中文原值） ---------- */

export const ELEM_EN: Record<string, string> = { 木: "Wood", 火: "Fire", 土: "Earth", 金: "Metal", 水: "Water" };
export const SIGN_EN: Record<string, string> = {
  白羊座: "Aries", 金牛座: "Taurus", 双子座: "Gemini", 巨蟹座: "Cancer",
  狮子座: "Leo", 处女座: "Virgo", 天秤座: "Libra", 天蝎座: "Scorpio",
  射手座: "Sagittarius", 摩羯座: "Capricorn", 水瓶座: "Aquarius", 双鱼座: "Pisces",
};
export const SIGN_GROUP_EN: Record<string, string> = { 火象: "Fire sign", 土象: "Earth sign", 风象: "Air sign", 水象: "Water sign" };
export const ANIMAL_EN: Record<string, string> = {
  鼠: "Rat", 牛: "Ox", 虎: "Tiger", 兔: "Rabbit", 龙: "Dragon", 蛇: "Snake",
  马: "Horse", 羊: "Goat", 猴: "Monkey", 鸡: "Rooster", 狗: "Dog", 猪: "Pig",
};
export const STRENGTH_EN: Record<string, string> = { 强: "Strong", 弱: "Weak", 中和: "Balanced" };
export const STEM_PY: Record<string, string> = {
  甲: "Jiǎ", 乙: "Yǐ", 丙: "Bǐng", 丁: "Dīng", 戊: "Wù",
  己: "Jǐ", 庚: "Gēng", 辛: "Xīn", 壬: "Rén", 癸: "Guǐ",
};
export const BRANCH_PY: Record<string, string> = {
  子: "Zǐ", 丑: "Chǒu", 寅: "Yín", 卯: "Mǎo", 辰: "Chén", 巳: "Sì",
  午: "Wǔ", 未: "Wèi", 申: "Shēn", 酉: "Yǒu", 戌: "Xū", 亥: "Hài",
};
export const TRAIT_EN: Record<string, string> = {
  温柔: "Gentle", 体贴: "Considerate", 幽默: "Humorous", 上进: "Ambitious",
  稳重: "Steady", 乐观: "Optimistic", 细心: "Attentive", 独立: "Independent",
  顾家: "Family-oriented", 浪漫: "Romantic", 诚实: "Honest", 耐心: "Patient",
  热情: "Warm", 包容: "Tolerant", 理性: "Rational", 文艺: "Artistic",
  爱运动: "Sporty", 勤俭: "Thrifty",
};

/** 五行：英文模式显示 "Wood 木"，中文模式只显示原字。 */
export const elemLabel = (el: string, lang: Lang) => (lang === "en" ? `${ELEM_EN[el] ?? el} ${el}` : el);
export const elemName = (el: string, lang: Lang) => (lang === "en" ? (ELEM_EN[el] ?? el) : el);
export const signLabel = (s: string, lang: Lang) => (lang === "en" ? (SIGN_EN[s] ?? s) : s);
export const signGroupLabel = (g: string, lang: Lang) => (lang === "en" ? (SIGN_GROUP_EN[g] ?? g) : g);
export const animalLabel = (a: string, lang: Lang) => (lang === "en" ? (ANIMAL_EN[a] ?? a) : a);
export const strengthLabel = (s: string, lang: Lang) => (lang === "en" ? (STRENGTH_EN[s] ?? s) : s);
export const traitLabel = (tr: string, lang: Lang) => (lang === "en" ? (TRAIT_EN[tr] ?? tr) : tr);
export const traitList = (list: string[], lang: Lang) =>
  list.map((x) => traitLabel(x, lang)).join(lang === "en" ? ", " : "、");
export const elemList = (list: string[], lang: Lang) =>
  list.map((x) => elemLabel(x, lang)).join(lang === "en" ? ", " : "、");

/** 干支柱：英文模式显示拼音 + 汉字（如 Jiǎzǐ 甲子）。 */
export function pillarLabel(p: { stem: string; branch: string; label: string }, lang: Lang): string {
  if (lang !== "en") return p.label;
  const py = `${STEM_PY[p.stem] ?? p.stem}${BRANCH_PY[p.branch] ?? p.branch}`;
  return `${py} ${p.label}`;
}

/** 日主：英文模式显示 "Guǐ 癸 (Water 水)"。 */
export function dayMasterLabel(dm: string, dmElem: string, lang: Lang): string {
  if (lang !== "en") return `${dm}${dmElem}`;
  return `${STEM_PY[dm] ?? dm} ${dm} (${elemLabel(dmElem, lang)})`;
}
