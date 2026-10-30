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
