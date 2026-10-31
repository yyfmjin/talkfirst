/**
 * 每日占卜的文案表（2026-10-30）。
 *
 * ## 为什么文案在服务端
 *
 * 卡片要中英双语，而客户端有两套（`apps/mobile` 的 `messages.ts`、`apps/web`
 * 的 `dictionary.ts`）。同一个「宜忌」表如果两边各写一份，改一次要改两处，
 * 而且两边会慢慢长歪 —— 这正是仓库里反复出现的漂移模式。所以：
 *
 *   **服务端出成品字符串，客户端只渲染。**
 *
 * 客户端仍然有自己的词典，但只放卡片外壳（标题、「幸运数字」、「宜」、「忌」）。
 *
 * ## 为什么选这些条目
 *
 * 「宜忌」故意全部落在**这个产品里能做的事**上：找人聊、发动态、练发音、听语音。
 * 一份通用的老黄历（宜祭祀、宜动土）放在语言交换产品里是贴纸，不是功能 ——
 * 用户看完不知道该干嘛。这里的每一条都能直接变成一个动作。
 */

export type FortuneLang = "zh-CN" | "en";

/**
 * 宜：可以建议用户**去做**的事。
 *
 * 忌用另一组 `DONTS`，不复用这一组：同一个短语放在「忌」后面常常语义反转，
 * 「忌 早点睡」就是活例子 —— 用户一眼看出是随机拼的，整张卡就不可信了。
 */
export const DOS: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: "找人聊两句", en: "messaging someone first" },
  { zh: "发一条动态", en: "posting a moment" },
  { zh: "练一分钟发音", en: "a minute of speaking practice" },
  { zh: "听完一条语音条", en: "finishing a voice note" },
  { zh: "用翻译读一个长句", en: "reading one long sentence" },
  { zh: "背五个生词", en: "five new words" },
  { zh: "换一种语言开口", en: "opening in your second language" },
  { zh: "认真回一条消息", en: "a real reply" },
];

/** 忌：具体、好认、真会搞砸聊天的小动作。写得像人话，不像随机词。 */
export const DONTS: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: "只点赞不说话", en: "only liking, never speaking" },
  { zh: "熬夜刷消息", en: "doom-scrolling messages" },
  { zh: "发了又删", en: "typing then deleting it" },
  { zh: "还没聊就先要联系方式", en: "asking for contacts before talking" },
  { zh: "全程用母语硬撑", en: "sticking to your first language" },
  { zh: "把翻译结果当答案背下来", en: "memorising translations as answers" },
  { zh: "同时开五个对话框", en: "five chats at once" },
  { zh: "一句 hi 就没了", en: "opening with just \"hi\"" },
];

/** 今日运势的两半：主题 + 建议，由种子各挑一条拼起来。 */
export const THEMES: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: "人缘偏旺", en: "Good day for people" },
  { zh: "口条顺", en: "Words come easily" },
  { zh: "适合慢一点", en: "Better taken slowly" },
  { zh: "注意力集中", en: "Focus is on your side" },
  { zh: "适合尝新", en: "Good day for something new" },
  { zh: "适合收尾", en: "Good day to finish things" },
];

export const ADVICE: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: "先开口的人占便宜", en: "whoever speaks first wins" },
  { zh: "别在打招呼上省字数", en: "don't skimp on the opening line" },
  { zh: "语音比打字更有效", en: "voice beats typing today" },
  { zh: "看懂再回，别急着接话", en: "read it twice before replying" },
  { zh: "先聊够，再谈交换联系方式", en: "talk first, swap contacts later" },
  { zh: "把练习拆成十分钟一段", en: "break practice into ten-minute pieces" },
];

/** 幸运色：全部取自产品自己的色板（`design/tokens.ts`），不引入外来颜色。 */
export const COLORS: ReadonlyArray<{ zh: string; en: string; hex: string }> = [
  { zh: "品牌蓝", en: "brand blue", hex: "#0B7FFF" },
  { zh: "深海蓝", en: "deep sea blue", hex: "#0050B8" },
  { zh: "薄荷绿", en: "mint", hex: "#22A06B" },
  { zh: "暖橙", en: "warm amber", hex: "#D97706" },
  { zh: "雾灰", en: "mist grey", hex: "#68738A" },
  { zh: "珊瑚红", en: "coral", hex: "#E5484D" },
];

/**
 * 十二星座：[月, 日] 起算点，按时间顺序排列。
 *
 * 自己算而不是取 iztro 的 `sign`：iztro 的英文是 `gemini` 这种 id，中文是
 * `双子座`，混在一起要再判断一次语言；而这是纯日期算术，自己写死更可控。
 */
export const SIGNS: ReadonlyArray<{ from: [number, number]; zh: string; en: string }> = [
  { from: [1, 20], zh: "水瓶座", en: "Aquarius" },
  { from: [2, 19], zh: "双鱼座", en: "Pisces" },
  { from: [3, 21], zh: "白羊座", en: "Aries" },
  { from: [4, 20], zh: "金牛座", en: "Taurus" },
  { from: [5, 21], zh: "双子座", en: "Gemini" },
  { from: [6, 22], zh: "巨蟹座", en: "Cancer" },
  { from: [7, 23], zh: "狮子座", en: "Leo" },
  { from: [8, 23], zh: "处女座", en: "Virgo" },
  { from: [9, 23], zh: "天秤座", en: "Libra" },
  { from: [10, 24], zh: "天蝎座", en: "Scorpio" },
  { from: [11, 23], zh: "射手座", en: "Sagittarius" },
  { from: [12, 22], zh: "摩羯座", en: "Capricorn" },
];

/**
 * 紫微斗数的星名 → 英文。
 *
 * 用拼音而不是意译：`iztro` 自带的英文把「天同」翻成 `fortunate`、「贪狼」翻成
 * `wolf`，读起来像机器翻译；而命理术语在英文里本来就没有公认译法，拼音反而是
 * 行内看得懂、也不会误解的写法（`Tai Yin (Moon)` 这种夹注留到以后再说）。
 */
export const STAR_EN: Readonly<Record<string, string>> = {
  紫微: "Zi Wei",
  天机: "Tian Ji",
  太阳: "Tai Yang",
  武曲: "Wu Qu",
  天同: "Tian Tong",
  廉贞: "Lian Zhen",
  天府: "Tian Fu",
  太阴: "Tai Yin",
  贪狼: "Tan Lang",
  巨门: "Ju Men",
  天相: "Tian Xiang",
  天梁: "Tian Liang",
  七杀: "Qi Sha",
  破军: "Po Jun",
  左辅: "Zuo Fu",
  右弼: "You Bi",
  文昌: "Wen Chang",
  文曲: "Wen Qu",
  天魁: "Tian Kui",
  天钺: "Tian Yue",
};

/** 十天干：干支的英文写成 `Ding-Chou` 这种拼音连写。 */
const STEM_EN: Readonly<Record<string, string>> = {
  甲: "Jia", 乙: "Yi", 丙: "Bing", 丁: "Ding", 戊: "Wu",
  己: "Ji", 庚: "Geng", 辛: "Xin", 壬: "Ren", 癸: "Gui",
};

const BRANCH_EN: Readonly<Record<string, string>> = {
  子: "Zi", 丑: "Chou", 寅: "Yin", 卯: "Mao", 辰: "Chen", 巳: "Si",
  午: "Wu", 未: "Wei", 申: "Shen", 酉: "You", 戌: "Xu", 亥: "Hai",
};

/** `丁丑` → `Ding-Chou`；认不出来的字原样保留，不抛错。 */
export function ganzhiToEnglish(value: string): string {
  const [stem, branch] = Array.from(value);
  if (!stem) return value;
  return `${STEM_EN[stem] ?? stem}-${BRANCH_EN[branch] ?? branch ?? ""}`.replace(/-$/, "");
}

export function starName(zhName: string, lang: FortuneLang): string {
  if (lang === "zh-CN") return zhName;
  return STAR_EN[zhName] ?? zhName;
}

/* -------------------------------------------------------------------------- */
/* 五行与四化的对应（2026-10-31 加强版）                                        */
/* -------------------------------------------------------------------------- */

/**
 * 这一版把「幸运数字 / 幸运色 / 宜忌」从**随机抽**改成**按规则推导**。
 *
 * 理由很直接：随机抽出来的宜忌只能保证「看起来像」，经不起任何追问 —— 同一个用户
 * 问一句「为什么今天忌早睡」，答案只能是「抽到的」。下面这三张表都是命理里固定的
 * 对应关系，任何人都能拿去看：
 *
 *   - 天干/地支 → 五行（六十甲子的基础）
 *   - 五行 → 河图数（一六水、二七火、三八木、四九金、五十土）与五色
 *   - 四化（禄权科忌）与星曜 → 传统上对应的行事倾向
 *
 * 卡片上**不写**依据（用户要的是结果），但代码里必须站得住。
 */
export const STEM_ELEMENT: Readonly<Record<string, Element>> = {
  甲: "wood", 乙: "wood",
  丙: "fire", 丁: "fire",
  戊: "earth", 己: "earth",
  庚: "metal", 辛: "metal",
  壬: "water", 癸: "water",
};

export const BRANCH_ELEMENT: Readonly<Record<string, Element>> = {
  子: "water", 丑: "earth", 寅: "wood", 卯: "wood", 辰: "earth", 巳: "fire",
  午: "fire", 未: "earth", 申: "metal", 酉: "metal", 戌: "earth", 亥: "water",
};

export type Element = "wood" | "fire" | "earth" | "metal" | "water";

/** 河图数：一六水、二七火、三八木、四九金、五十土（十记作不带，取 5）。 */
export const ELEMENT_NUMBERS: Readonly<Record<Element, number[]>> = {
  water: [1, 6],
  fire: [2, 7],
  wood: [3, 8],
  metal: [4, 9],
  earth: [5],
};

/** 五行 → 五色。色值取自产品色板，避免出现系统里没有的颜色。 */
export const ELEMENT_COLORS: Readonly<Record<Element, { zh: string; en: string; hex: string }>> = {
  wood: { zh: "青（木）", en: "Green (wood)", hex: "#22A06B" },
  fire: { zh: "赤（火）", en: "Crimson (fire)", hex: "#E5484D" },
  earth: { zh: "黄（土）", en: "Amber (earth)", hex: "#B7791F" },
  metal: { zh: "白（金）", en: "Ivory (metal)", hex: "#C9A227" },
  water: { zh: "玄（水）", en: "Indigo (water)", hex: "#0B3D91" },
};

/** 五行局 → 数字，用于幸运数字不足三个时补位（水二局、木三局…）。 */
export const FIVE_ELEMENTS_CLASS_DIGIT: Readonly<Record<string, number>> = {
  水二局: 2,
  木三局: 3,
  金四局: 4,
  土五局: 5,
  火六局: 6,
};

/**
 * 四化对应的行事倾向。
 *
 * 传统说法：化禄主顺遂与得，化权主掌控与推进，化科主名声与文，化忌主阻滞与纠结。
 * 这里把它们落到**这个 App 里能做的事**（开口、发文、练习、别争吵），而不是笼统的
 * 「宜求财」—— 用户看完要能直接做一个动作。
 */
export const FOUR_THEME: Readonly<Record<"lu" | "quan" | "ke" | "ji", { zh: string; en: string }>> = {
  lu: { zh: "顺遂、人缘、得来", en: "ease, goodwill, what comes to you" },
  quan: { zh: "掌控、推进、决断", en: "control, pushing forward, decisions" },
  ke: { zh: "名声、文书、学习", en: "reputation, writing, study" },
  ji: { zh: "阻滞、反复、易执", en: "friction, repetition, fixation" },
};

/** 化禄 / 化权 / 化科 落在哪颗星，就给一条对应的「宜」。 */
export const STAR_DO: Readonly<Record<string, { zh: string; en: string }>> = {
  太阴: { zh: "把话说明白，谈钱谈感受", en: "say it plainly — money or feelings" },
  天同: { zh: "陪人聊两句，别急着办事", en: "spend a few minutes talking" },
  天机: { zh: "把待办排一遍顺序", en: "put your to-dos in order" },
  贪狼: { zh: "去认识一个新的人", en: "meet someone new" },
  巨门: { zh: "把一直没说的话说出口", en: "say the thing you have not said" },
  太阳: { zh: "公开做一件事，别藏着", en: "do something in the open" },
  武曲: { zh: "把账目或计划算清楚", en: "settle the numbers" },
  天府: { zh: "整理手头的资源", en: "take stock of what you have" },
  天相: { zh: "帮人搭个桥、做个介绍", en: "make an introduction" },
  天梁: { zh: "找长辈或有经验的人聊", en: "ask someone with experience" },
  七杀: { zh: "把拖着的那件事拍板", en: "decide the thing you keep postponing" },
  破军: { zh: "清掉一个旧习惯", en: "drop one old habit" },
  廉贞: { zh: "把边界讲清楚", en: "draw a clear boundary" },
  紫微: { zh: "主动张罗一件事", en: "take the lead on something" },
  文昌: { zh: "写点东西、读长文", en: "write something, read something long" },
  文曲: { zh: "练发音、开口念", en: "practise speaking out loud" },
  左辅: { zh: "找个人一起做", en: "do it with someone" },
  右弼: { zh: "接住别人递来的机会", en: "take the offer that comes" },
  天魁: { zh: "回应那条你搁置的消息", en: "answer the message you left" },
  天钺: { zh: "主动求助一次", en: "ask for help once" },
};

/** 化忌落在哪颗星，就给一条针对性的「忌」。 */
export const STAR_DONT: Readonly<Record<string, { zh: string; en: string }>> = {
  巨门: { zh: "口舌争辩", en: "arguing over words" },
  天机: { zh: "临时改计划", en: "changing plans at the last minute" },
  太阴: { zh: "情绪化决定", en: "deciding on a mood" },
  太阳: { zh: "逞强出头", en: "showing off / taking on too much" },
  廉贞: { zh: "冲动消费", en: "impulse spending" },
  贪狼: { zh: "应酬过度", en: "over-socialising" },
  武曲: { zh: "大额支出", en: "big payments" },
  天府: { zh: "守着旧做法不放", en: "clinging to the old way" },
  天相: { zh: "替人作保", en: "vouching for someone" },
  天梁: { zh: "开口说教", en: "lecturing people" },
  七杀: { zh: "硬碰硬", en: "head-on confrontation" },
  破军: { zh: "大改大动", en: "big upheavals" },
  文昌: { zh: "文书笔误", en: "sloppy writing" },
  文曲: { zh: "话说太满", en: "promising too much" },
  左辅: { zh: "一个人硬扛", en: "carrying it alone" },
  右弼: { zh: "错过递到手上的机会", en: "missing what is handed to you" },
  天魁: { zh: "拖着不回消息", en: "leaving messages unanswered" },
  天钺: { zh: "拒绝本该接受的帮助", en: "refusing help you need" },
  紫微: { zh: "摆架子", en: "putting on airs" },
  天同: { zh: "拖延", en: "procrastinating" },
};

/** 五行局的英文写法（iztro 只给中文「金四局」，英文环境要换掉，否则中文会漏到英文界面）。 */
export const FIVE_ELEMENTS_CLASS_EN: Readonly<Record<string, string>> = {
  水二局: "Water 2",
  木三局: "Wood 3",
  金四局: "Metal 4",
  土五局: "Earth 5",
  火六局: "Fire 6",
};
