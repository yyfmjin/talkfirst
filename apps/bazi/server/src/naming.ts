// 中文起名引擎（面向外国朋友）。
//
// 依据用户本人的命盘（computeChart 的结果）选字：
// 1. 喜用神：名字用字优先取命局「喜用」五行；
// 2. 补缺：命局力量最弱（或为 0）的一行优先补益；
// 3. 避忌：命局「忌」五行的字大幅扣分，基本不会入选；
// 4. 五格数理：按简体笔画算天/人/地/外/总五格，人、地、总格落在常用吉数加分；
// 5. 音律：两字声调有起伏（平仄相间）加分。
// 字库为本站手工整理的常用起名汉字与百家姓，含拼音、声调、简体笔画、
// 五行（按字形偏旁与字义的通行归类）、字义与寓意短语——全部为参考数据，
// 每个名字都会给出逐字解析与选字理由，前端原样展示。

import { ELEMENTS, ELEMENTS_EN, type Chart, type ElementName, type Lang } from "./bazi";

export type { Lang };

const elemEn = (el: string): string =>
  `${ELEMENTS_EN[ELEMENTS.indexOf(el as ElementName)] ?? el} (${el})`;
const strengthEn = (s: string): string =>
  s === "强" ? "strong" : s === "弱" ? "weak" : "balanced";

export type NameGender = "male" | "female";

interface GivenChar {
  c: string;
  py: string; // 带声调拼音
  tone: number; // 1-4
  el: ElementName;
  strokes: number; // 简体笔画
  g: "m" | "f" | "b"; // 适用性别
  styles: string[]; // 文雅 / 大气 / 清新 / 稳重 / 灵动
  meaning: string; // 字义
  blessing: string; // 寓意短语
}

const G = (
  c: string, py: string, tone: number, el: ElementName, strokes: number,
  g: "m" | "f" | "b", styles: string[], meaning: string, blessing: string,
): GivenChar => ({ c, py, tone, el, strokes, g, styles, meaning, blessing });

export const GIVEN_CHARS: GivenChar[] = [
  // ---- 木 ----
  G("梓", "zǐ", 3, "木", 11, "b", ["文雅"], "梓树，古人常植于宅旁，后世以「桑梓」代指故乡", "桑梓情深"),
  G("桐", "tóng", 2, "木", 10, "b", ["清新", "文雅"], "梧桐树，传说凤凰非梧桐不栖", "引凤来栖"),
  G("林", "lín", 2, "木", 8, "b", ["大气", "清新"], "树木成片为林，生机盎然", "林木葱茏"),
  G("森", "sēn", 1, "木", 12, "m", ["大气"], "三木成森，繁茂而有气势", "森然挺拔"),
  G("柏", "bǎi", 3, "木", 9, "m", ["稳重"], "柏树四季常青，耐寒坚贞", "松柏长青"),
  G("松", "sōng", 1, "木", 8, "m", ["稳重", "大气"], "松树岁寒不凋，象征坚韧长寿", "苍松劲节"),
  G("楠", "nán", 2, "木", 13, "b", ["稳重", "文雅"], "楠木，质地坚实珍贵的良木", "楠木之坚"),
  G("芸", "yún", 2, "木", 7, "f", ["文雅", "清新"], "芸香草，古人藏书防虫，带有书卷气", "书香盈袖"),
  G("若", "ruò", 4, "木", 8, "b", ["文雅", "清新"], "如、似，也有从容自若之意", "从容自若"),
  G("茜", "qiàn", 4, "木", 9, "f", ["清新"], "茜草，可作红色染料，明艳鲜活", "茜色明艳"),
  G("蓉", "róng", 2, "木", 13, "f", ["文雅", "清新"], "芙蓉花，清雅而出尘", "出水芙蓉"),
  G("芷", "zhǐ", 3, "木", 7, "f", ["文雅", "清新"], "白芷，香草，古人以香草喻品德高洁", "兰芷之香"),
  G("萱", "xuān", 1, "木", 12, "f", ["清新", "文雅"], "萱草，又称忘忧草", "忘忧解愁"),
  G("楷", "kǎi", 3, "木", 13, "m", ["稳重", "文雅"], "楷树，也指法式、模范", "堪为楷模"),
  G("桦", "huà", 4, "木", 10, "b", ["清新"], "白桦树，挺拔秀洁", "桦木挺秀"),
  G("枫", "fēng", 1, "木", 8, "b", ["清新", "灵动"], "枫树，秋来叶红如霞", "枫叶知秋"),
  G("英", "yīng", 1, "木", 8, "b", ["大气", "文雅"], "花，也指才智出众的人", "英华内蕴"),
  G("梅", "méi", 2, "木", 11, "f", ["文雅", "清新"], "梅花，寒冬绽放，清雅而有风骨", "寒梅傲雪"),
  G("桂", "guì", 4, "木", 10, "b", ["文雅"], "桂树，秋日飘香，也指月中桂树", "桂馥兰香"),
  G("柳", "liǔ", 3, "木", 9, "b", ["文雅", "灵动"], "柳枝柔韧，依依多姿", "杨柳依依"),
  G("杉", "shān", 1, "木", 7, "m", ["清新"], "杉树挺拔常青", "杉青如盖"),
  G("柯", "kē", 1, "木", 9, "m", ["稳重"], "草木的枝茎，引申为根本", "柯干坚正"),
  G("茉", "mò", 4, "木", 8, "f", ["清新"], "茉莉花，素净清香", "茉香清浅"),
  G("茗", "míng", 2, "木", 9, "b", ["文雅"], "茶芽，引申为品茶清谈", "茗香入韵"),
  G("芊", "qiān", 1, "木", 6, "f", ["清新"], "草木茂盛的样子", "芊芊草木"),
  // ---- 火 ----
  G("炎", "yán", 2, "火", 8, "m", ["大气"], "火焰上升，热烈而有力量", "炎阳高照"),
  G("烨", "yè", 4, "火", 14, "m", ["大气", "灵动"], "火光灿烂、光明盛大", "光华灿烂"),
  G("煜", "yù", 4, "火", 13, "b", ["大气", "文雅"], "照耀、光辉闪耀", "煜煜生辉"),
  G("旭", "xù", 4, "火", 6, "b", ["大气", "清新"], "初升的太阳，朝气初生", "旭日东升"),
  G("晗", "hán", 2, "火", 11, "f", ["清新", "文雅"], "天将明、雪后初晴", "破晓之光"),
  G("昕", "xīn", 1, "火", 8, "b", ["清新"], "太阳将升、黎明之时", "昕光初启"),
  G("晴", "qíng", 2, "火", 12, "f", ["清新", "灵动"], "天气晴朗、云散天开", "晴空万里"),
  G("彤", "tóng", 2, "火", 7, "f", ["灵动", "清新"], "红色、红霞", "彤云暖日"),
  G("丹", "dān", 1, "火", 4, "f", ["文雅", "清新"], "丹砂之红，也喻赤诚之心", "丹心一片"),
  G("灿", "càn", 4, "火", 7, "b", ["灵动", "大气"], "灿烂、鲜明耀眼", "灿烂明朗"),
  G("炜", "wěi", 3, "火", 8, "m", ["文雅"], "光彩鲜明、文采焕发", "光彩炜然"),
  G("灵", "líng", 2, "火", 7, "b", ["灵动", "文雅"], "灵动聪慧、机敏有生气", "灵秀聪慧"),
  G("曜", "yào", 4, "火", 18, "m", ["大气"], "日光照耀、光辉", "曜曜光明"),
  G("晨", "chén", 2, "火", 11, "b", ["清新", "大气"], "清晨，一日之始", "晨光熹微"),
  G("昭", "zhāo", 1, "火", 9, "b", ["大气", "文雅"], "光明显著、明白昭彰", "昭然光明"),
  G("晔", "yè", 4, "火", 10, "m", ["大气"], "光耀、明亮", "晔晔其光"),
  G("朗", "lǎng", 3, "火", 10, "m", ["大气", "文雅"], "明亮、开朗", "朗月清风"),
  G("南", "nán", 2, "火", 9, "b", ["清新"], "南方，向阳之处", "南山之阳"),
  G("暖", "nuǎn", 3, "火", 13, "f", ["清新"], "温暖", "暖意融融"),
  G("曦", "xī", 1, "火", 20, "f", ["清新", "灵动"], "早晨的阳光", "曦光初照"),
  // ---- 土 ----
  G("宇", "yǔ", 3, "土", 6, "b", ["大气", "稳重"], "天地宇宙，也指人的风度气宇", "气宇轩昂"),
  G("磊", "lěi", 3, "土", 15, "m", ["稳重", "大气"], "众石累积，喻胸怀坦荡磊落", "磊落坦荡"),
  G("岩", "yán", 2, "土", 8, "m", ["稳重"], "岩石山崖，坚实可靠", "坚如磐岩"),
  G("坤", "kūn", 1, "土", 8, "b", ["稳重", "大气"], "大地，《易经》坤卦，厚德载物", "厚德载物"),
  G("城", "chéng", 2, "土", 9, "m", ["稳重"], "城墙，坚固而能守护", "金城之固"),
  G("培", "péi", 2, "土", 11, "b", ["稳重", "文雅"], "培土育苗，引申为培养、扶持成长", "培植成长"),
  G("峻", "jùn", 4, "土", 10, "m", ["稳重", "大气"], "山高而严正，喻品格端方", "峻岭之姿"),
  G("轩", "xuān", 1, "土", 7, "b", ["大气", "文雅"], "高敞的房屋或车驾，喻气度不凡", "轩昂气度"),
  G("辰", "chén", 2, "土", 7, "b", ["文雅", "大气"], "星辰与时光，日月星的总称", "星辰大海"),
  G("逸", "yì", 4, "土", 11, "b", ["文雅", "灵动"], "安逸超迈、不受拘束", "逸群之才"),
  G("安", "ān", 1, "土", 6, "b", ["稳重", "清新"], "平安、安定", "安然顺遂"),
  G("嵩", "sōng", 1, "土", 13, "m", ["大气", "稳重"], "高山，特指中岳嵩山", "嵩高维岳"),
  G("远", "yuǎn", 3, "土", 7, "b", ["大气", "文雅"], "辽远、志向高远", "志存高远"),
  G("均", "jūn", 1, "土", 7, "b", ["稳重"], "公平、和谐调和", "均平致和"),
  G("岚", "lán", 2, "土", 7, "f", ["清新", "文雅"], "山间雾气", "山岚出岫"),
  G("峰", "fēng", 1, "土", 10, "m", ["大气"], "山峰", "峰峦如聚"),
  G("岳", "yuè", 4, "土", 8, "m", ["大气"], "高山", "岳峙渊渟"),
  G("依", "yī", 1, "土", 8, "f", ["文雅"], "依傍、亲近", "依仁游艺"),
  // ---- 金 ----
  G("铭", "míng", 2, "金", 11, "b", ["文雅", "稳重"], "铭刻于器物之上，铭记不忘", "铭记于心"),
  G("锦", "jǐn", 3, "金", 13, "b", ["文雅", "清新"], "华美的丝织品，喻美好前程", "锦绣前程"),
  G("钰", "yù", 4, "金", 10, "b", ["文雅", "清新"], "珍宝、坚硬的金属", "如钰之珍"),
  G("鑫", "xīn", 1, "金", 24, "m", ["大气", "稳重"], "三金叠加，兴盛多金", "鑫盛兴旺"),
  G("锐", "ruì", 4, "金", 12, "m", ["大气", "灵动"], "锋利敏锐、勇往直前", "锐意进取"),
  G("锋", "fēng", 1, "金", 12, "m", ["大气"], "刀锋、先锋，锐意领先", "先锋之姿"),
  G("铮", "zhēng", 1, "金", 11, "m", ["稳重", "大气"], "金属相击的清亮声，喻刚正不阿", "铮铮铁骨"),
  G("钧", "jūn", 1, "金", 9, "m", ["稳重", "大气"], "古代大重量单位，喻分量与尊贵", "分量千钧"),
  G("铃", "líng", 2, "金", 10, "f", ["灵动", "清新"], "铃铛，声音清脆悦耳", "铃音清脆"),
  G("瑜", "yú", 2, "金", 13, "b", ["文雅"], "美玉的光泽", "美玉生辉"),
  G("瑾", "jǐn", 3, "金", 15, "f", ["文雅"], "美玉，喻品德纯美", "怀瑾之德"),
  G("璟", "jǐng", 3, "金", 16, "b", ["文雅", "大气"], "玉的光彩", "璟光熠熠"),
  G("珊", "shān", 1, "金", 9, "f", ["清新", "文雅"], "珊瑚，姿态轻盈美好", "珊珊可爱"),
  G("诗", "shī", 1, "金", 8, "f", ["文雅", "清新"], "诗歌、文采风流", "诗情画意"),
  G("诚", "chéng", 2, "金", 8, "b", ["稳重", "文雅"], "诚实、真心实意", "诚信为本"),
  G("思", "sī", 1, "金", 9, "b", ["文雅", "灵动"], "思考、怀念，心思深远", "思致深远"),
  G("书", "shū", 1, "金", 4, "b", ["文雅"], "书籍与书写，书香文气", "书香致远"),
  G("铎", "duó", 2, "金", 10, "m", ["文雅"], "古时的大铃，用于宣教", "木铎金声"),
  G("银", "yín", 2, "金", 11, "b", ["清新"], "银色，洁白有光", "银辉皎洁"),
  G("铄", "shuò", 4, "金", 10, "m", ["大气"], "光亮、光明", "铄铄其光"),
  // ---- 水 ----
  G("泽", "zé", 2, "水", 8, "b", ["大气", "稳重"], "水泽润泽万物，也指恩泽", "泽被万物"),
  G("洋", "yáng", 2, "水", 9, "b", ["大气", "清新"], "海洋广大、丰盛", "心怀汪洋"),
  G("海", "hǎi", 3, "水", 10, "b", ["大气"], "大海，博大包容", "海纳百川"),
  G("涵", "hán", 2, "水", 11, "b", ["文雅", "稳重"], "包容蕴藏、修养涵养", "涵养深厚"),
  G("汐", "xī", 1, "水", 6, "f", ["清新", "灵动"], "夜晚的潮水", "潮汐有信"),
  G("沐", "mù", 4, "水", 7, "b", ["清新", "文雅"], "沐浴润泽、承受恩泽", "如沐春风"),
  G("清", "qīng", 1, "水", 11, "b", ["文雅", "清新"], "水清澈、品行清明", "清澈明净"),
  G("渊", "yuān", 1, "水", 11, "m", ["稳重", "文雅"], "深水潭，喻学识深邃", "学识渊深"),
  G("润", "rùn", 4, "水", 10, "b", ["文雅", "稳重"], "滋润、温和细腻", "温润如玉"),
  G("泓", "hóng", 2, "水", 8, "b", ["文雅", "清新"], "水深而广、清澈见底", "心澄如泓"),
  G("溪", "xī", 1, "水", 13, "b", ["清新", "灵动"], "山间的小溪，清流不息", "溪水长流"),
  G("雨", "yǔ", 3, "水", 8, "b", ["清新", "灵动"], "雨水滋润、润物无声", "润物无声"),
  G("雪", "xuě", 3, "水", 11, "f", ["清新", "文雅"], "雪，纯洁明净", "冰雪纯净"),
  G("浩", "hào", 4, "水", 10, "m", ["大气"], "水势浩大、正气充盈", "浩然之气"),
  G("淼", "miǎo", 3, "水", 12, "b", ["大气", "清新"], "三水汇聚，水面辽阔", "水天一色"),
  G("文", "wén", 2, "水", 4, "b", ["文雅"], "文采、纹理，温文尔雅", "文采斐然"),
  G("子", "zǐ", 3, "水", 3, "b", ["文雅", "清新"], "古代对有学问、有品德之人的尊称", "君子之风"),  G("沁", "qìn", 4, "水", 7, "f", ["清新"], "沁润，凉意透入", "沁人心脾"),

];

interface Surname {
  c: string;
  py: string;
  tone: number;
  el: ElementName;
  strokes: number;
  origin: string; // 姓氏小注（由来/名人印象，一句即可）
}

const S = (c: string, py: string, tone: number, el: ElementName, strokes: number, origin: string): Surname =>
  ({ c, py, tone, el, strokes, origin });

export const SURNAMES: Surname[] = [
  S("李", "lǐ", 3, "木", 7, "唐朝国姓，天下第一大姓之一，出自嬴姓"),
  S("王", "wáng", 1, "土", 4, "源出周王室后裔，笔画简洁、大气稳重"),
  S("林", "lín", 2, "木", 8, "源出商朝比干后人避难长林山而得姓"),
  S("张", "zhāng", 1, "火", 7, "源出黄帝之孙挥，发明弓箭而赐姓张"),
  S("刘", "liú", 2, "金", 6, "汉朝国姓，帝王之姓，气度恢弘"),
  S("杨", "yáng", 2, "木", 7, "源出周宣王之子，杨树之姓，清朗挺拔"),
  S("黄", "huáng", 2, "土", 11, "源出黄帝后裔黄国，厚重敦实"),
  S("周", "zhōu", 1, "金", 8, "源出周王室，周全、周正之意"),
  S("吴", "wú", 2, "木", 7, "源出周代吴国，江南大姓"),
  S("徐", "xú", 2, "金", 10, "源出东夷徐国，徐徐舒缓、从容之姓"),
  S("孙", "sūn", 1, "金", 6, "源出周文王后裔，绵延子孙之意"),
  S("胡", "hú", 2, "土", 9, "源出陈国胡公满，北方望族"),
  S("朱", "zhū", 1, "木", 6, "明朝国姓，朱砂之红，明艳端正"),
  S("高", "gāo", 1, "木", 10, "源出姜太公后裔，高大、高远之意"),
  S("罗", "luó", 2, "火", 8, "源出罗国，网罗万象、包罗之量"),
  S("郑", "zhèng", 4, "金", 8, "源出周代郑国，郑重其事"),
  S("梁", "liáng", 2, "水", 11, "源出梁国，栋梁之才的期许"),
  S("宋", "sòng", 4, "金", 7, "源出商朝后裔宋国，文气悠长"),
  S("唐", "táng", 2, "火", 10, "源出上古唐尧，唐朝之姓，气象盛大"),
  S("韩", "hán", 2, "水", 12, "源出周成王后裔韩国，战国七雄之一"),
  S("冯", "féng", 2, "水", 5, "源出魏国宗室，冯姓望族多文士"),
  S("于", "yú", 2, "土", 3, "源出周武王之子邘叔，笔画极简"),
  S("萧", "xiāo", 1, "木", 11, "源出春秋宋国，萧洒（洒脱）之音"),
  S("曹", "cáo", 2, "金", 11, "源出黄帝后裔曹国，三国曹操之姓"),
  S("袁", "yuán", 2, "土", 10, "源出陈国袁乡，汝南袁氏为汉末望族"),
  S("沈", "shěn", 3, "水", 7, "源出周文王之子沈国，沉静内敛之姓"),
  S("曾", "zēng", 1, "金", 12, "孔子弟子曾参之姓，以孝德传家"),
  S("彭", "péng", 2, "水", 12, "彭祖长寿之姓，鼓声彭彭、气势足"),
  S("苏", "sū", 1, "木", 7, "苏轼、苏秦之姓，万物复苏之意"),
  S("卢", "lú", 2, "火", 5, "源出姜太公后裔卢邑，简洁利落"),
  S("蒋", "jiǎng", 3, "木", 12, "源出周公之子蒋国，蒋姓多将才"),
  S("蔡", "cài", 4, "金", 14, "源出周文王之子蔡叔度，蔡伦造纸传世"),
  S("丁", "dīng", 1, "火", 2, "笔画最少的姓之一，丁是丁、卯是卯，踏实"),
  S("魏", "wèi", 4, "金", 17, "战国七雄魏国之姓，魏然高大"),
  S("叶", "yè", 4, "土", 5, "源出楚国沈尹戌后人，叶落归根、温润"),
  S("潘", "pān", 1, "水", 15, "源出周代潘国，水润之姓"),
  S("杜", "dù", 4, "木", 7, "杜甫之姓，杜木成荫、沉静好学"),
  S("夏", "xià", 4, "火", 10, "大禹夏朝之姓，华夏之源"),
  S("钟", "zhōng", 1, "金", 9, "钟灵毓秀、钟情专注之姓"),
  S("汪", "wāng", 1, "水", 7, "水汪汪、汪洋恣肆，温润宽厚"),
  S("田", "tián", 2, "土", 5, "田园之姓，踏实安稳"),
  S("任", "rèn", 4, "金", 6, "任重道远、值得信任之姓"),
  S("姜", "jiāng", 1, "木", 9, "姜太公之姓，炎帝神农氏之后"),
  S("范", "fàn", 4, "水", 8, "范仲淹之姓，模范、规范之意"),
  S("方", "fāng", 4, "水", 4, "方正大方，笔画利落"),
  S("石", "shí", 2, "金", 5, "金石之姓，坚定可靠"),
  S("姚", "yáo", 2, "土", 9, "上古姚重华（舜）之姓，姚姚美好"),
  S("邹", "zōu", 1, "金", 7, "源出春秋邹国，孟子故里之姓"),
  S("金", "jīn", 1, "金", 8, "金姓源出少昊金天氏，金玉满堂"),
  S("陆", "lù", 4, "火", 7, "陆地之姓，脚踏实地"),
  S("孔", "kǒng", 3, "木", 4, "孔子之姓，文脉之源"),
  S("白", "bái", 2, "水", 5, "李白之姓，洁白明朗"),
  S("崔", "cuī", 1, "土", 11, "源出姜太公后裔崔邑，崔巍高大"),
  S("康", "kāng", 1, "木", 11, "健康安康，人人所愿"),
  S("秦", "qín", 2, "木", 10, "秦朝之姓，秦地禾稼兴盛"),
  S("江", "jiāng", 1, "水", 6, "大江之姓，江河行地、气象开阔"),
  S("顾", "gù", 4, "木", 10, "顾全大局、体贴周到之姓"),
  S("侯", "hóu", 2, "水", 9, "王侯之姓，贵气内敛"),
  S("孟", "mèng", 4, "水", 8, "孟子之姓，四书之亚圣"),
  S("龙", "lóng", 2, "火", 5, "龙图腾之姓，望子成龙"),
  S("万", "wàn", 4, "水", 3, "万象更新、包罗万有"),
  S("雷", "léi", 2, "水", 13, "雷霆之姓，声势响亮"),
  S("钱", "qián", 2, "金", 10, "吴越王钱镠之姓，江南望族"),
  S("汤", "tāng", 1, "水", 6, "商汤之姓，汤汤大水、荡平天下"),
  S("尹", "yǐn", 3, "土", 4, "治理、官长之意，简洁端正"),
  S("黎", "lí", 2, "水", 15, "黎明之姓，众民、众生之意"),
  S("易", "yì", 4, "金", 8, "《易经》之易，变易中求恒常"),
  S("常", "cháng", 2, "金", 11, "恒常、长久，平平常常最长久"),
  S("武", "wǔ", 3, "水", 8, "尚武英气，止戈为武"),
  S("莫", "mò", 4, "水", 10, "莫愁前路、莫测高深之姓"),
  S("贺", "hè", 4, "水", 9, "庆贺之姓，喜气自带"),
  S("文", "wén", 2, "水", 4, "斯文有礼、文质彬彬"),
];

/* ---------- 英文版释义（lang="en" 时使用；查不到时回退中文） ---------- */
const GIVEN_EN: Record<string, { m: string; b: string }> = {
  梓: { m: "the catalpa tree, planted by ancient homes; 'sangzi' became a word for one's hometown", b: "roots and homeland love" },
  桐: { m: "the paulownia tree — legend says the phoenix rests only on paulownia", b: "the phoenix comes to roost" },
  林: { m: "a grove of trees, full of growth and life", b: "lush, thriving woods" },
  森: { m: "three trees make a forest — lush and majestic", b: "tall and flourishing" },
  柏: { m: "the cypress, evergreen through winter, steadfast and true", b: "evergreen endurance" },
  松: { m: "the pine, unbent by frost — a symbol of resilience and long life", b: "strength that outlasts winter" },
  楠: { m: "nanmu, a precious, solid hardwood", b: "precious solidity" },
  芸: { m: "rue, the fragrant herb once kept among books to protect them — a scholarly air", b: "the scent of books" },
  若: { m: "'as if, like' — also calm and self-possessed", b: "graceful composure" },
  茜: { m: "madder, the plant of bright red dye — vivid and alive", b: "radiant red vitality" },
  蓉: { m: "the lotus flower, refined and unworldly", b: "a lotus above the water" },
  芷: { m: "white angelica, a fragrant herb the ancients used to symbolize noble character", b: "fragrance of integrity" },
  萱: { m: "the daylily, also called the 'forget-sorrow herb'", b: "freedom from worries" },
  楷: { m: "the楷 tree; also a model or standard to follow", b: "a model for others" },
  桦: { m: "the birch — upright, clean and bright", b: "upright purity" },
  枫: { m: "the maple, its leaves turning scarlet in autumn", b: "autumn brilliance" },
  英: { m: "a flower in bloom; also a person of outstanding talent", b: "brilliance within" },
  炎: { m: "rising flames — warm, powerful, ardent", b: "blazing sunshine" },
  烨: { m: "brilliant firelight, radiant and grand", b: "dazzling radiance" },
  煜: { m: "to shine and illuminate", b: "glowing brilliance" },
  旭: { m: "the rising sun, the freshness of beginnings", b: "sunrise in the east" },
  晗: { m: "the moment just before dawn, clear skies after snow", b: "first light of dawn" },
  昕: { m: "the sun about to rise — daybreak", b: "the first opening light" },
  晴: { m: "clear skies, clouds dispersed", b: "skies clear for miles" },
  彤: { m: "vermilion red, rosy clouds", b: "warm rosy glow" },
  丹: { m: "cinnabar red; also a sincere, loyal heart", b: "a heart of pure devotion" },
  灿: { m: "brilliant, dazzling, bright", b: "bright and shining" },
  炜: { m: "bright luster, talents shining forth", b: "luminous talent" },
  灵: { m: "nimble, bright and full of life", b: "quick, luminous spirit" },
  曜: { m: "sunlight shining down, glory", b: "radiant glory" },
  晨: { m: "early morning, the start of the day", b: "soft morning light" },
  昭: { m: "bright and manifest, clearly shining", b: "open, shining clarity" },
  宇: { m: "the cosmos itself; also a person's bearing and presence", b: "commanding presence" },
  磊: { m: "stones piled high — an open, upright, magnanimous heart", b: "open-hearted integrity" },
  岩: { m: "rock and cliff — solid and dependable", b: "firm as bedrock" },
  坤: { m: "the Earth trigram of the I Ching — 'great virtue carries all things'", b: "virtue that carries all" },
  城: { m: "city walls — strong, protective, a guardian", b: "an unbreachable stronghold" },
  培: { m: "to mound soil around seedlings — to nurture and help grow", b: "nurtured growth" },
  峻: { m: "high, stern mountains — upright, principled character", b: "the bearing of peaks" },
  轩: { m: "a high, open hall or carriage — an air of distinction", b: "dignified bearing" },
  辰: { m: "the stars and time itself — sun, moon and stars together", b: "a sea of stars" },
  逸: { m: "at ease and unbound, rising above the ordinary", b: "talent beyond the crowd" },
  安: { m: "peace, safety, settled calm", b: "peaceful, smooth sailing" },
  嵩: { m: "lofty mountains — Mount Song, the central sacred peak", b: "towering heights" },
  远: { m: "far-reaching — high aspirations", b: "ambition that reaches far" },
  均: { m: "fairness, balance and harmony", b: "harmony through fairness" },
  铭: { m: "inscribed on metal or stone — remembered forever", b: "kept in the heart forever" },
  锦: { m: "brocade, the finest silk — a splendid future", b: "a brocade-bright future" },
  钰: { m: "a treasure; hard, precious metal", b: "precious as a jewel" },
  鑫: { m: "three 'gold' characters stacked — flourishing prosperity", b: "flourishing prosperity" },
  锐: { m: "sharp and keen, pressing ever forward", b: "keen, determined advance" },
  锋: { m: "the blade's edge; the vanguard — leading from the front", b: "the vanguard's bearing" },
  铮: { m: "the clear ring of struck metal — upright and unbending", b: "a spine of iron" },
  钧: { m: "an ancient great unit of weight — gravity and dignity", b: "weighty dignity" },
  铃: { m: "a bell, its sound clear and sweet", b: "a bell's clear chime" },
  瑜: { m: "the luster of fine jade", b: "jade-like radiance" },
  瑾: { m: "beautiful jade — pure, fine character", b: "the virtue of jade" },
  璟: { m: "the glow of jade", b: "sparkling jade light" },
  珊: { m: "coral — light, graceful beauty", b: "lovely as coral" },
  诗: { m: "poetry — literary grace and flair", b: "a life like poetry" },
  诚: { m: "honesty, sincerity of heart", b: "integrity above all" },
  思: { m: "thought and longing — a deep, far-reaching mind", b: "depth of thought" },
  书: { m: "books and writing — a scholarly fragrance", b: "learning that reaches far" },
  泽: { m: "waters that nourish all things; also kindness and grace", b: "grace that nourishes all" },
  洋: { m: "the vast ocean — abundance", b: "a heart like the ocean" },
  海: { m: "the sea — vast and all-embracing", b: "embracing a hundred rivers" },
  涵: { m: "to hold and contain — depth of cultivation", b: "deep cultivation" },
  汐: { m: "the evening tide", b: "tides that keep their promise" },
  沐: { m: "to bathe in and be nourished by grace", b: "like bathing in spring breeze" },
  清: { m: "clear water; a clear, upright character", b: "clear and pure" },
  渊: { m: "a deep pool — profound learning", b: "depth of knowledge" },
  润: { m: "moistening, gentle and refined", b: "gentle as jade" },
  泓: { m: "deep, broad water, clear to the bottom", b: "a heart clear as still water" },
  溪: { m: "a mountain stream, flowing without cease", b: "an ever-flowing stream" },
  雨: { m: "rain that nourishes silently", b: "silent nourishment" },
  雪: { m: "snow — pure and bright", b: "the purity of snow" },
  浩: { m: "vast waters; upright, boundless spirit", b: "a spirit of vast integrity" },
  淼: { m: "three 'water' characters merged — boundless waters", b: "where water meets sky" },
  文: { m: "letters and patterns — gentle, cultivated grace", b: "shining literary talent" },
  子: { m: "in ancient times, an honorific for a learned, virtuous person", b: "the air of a gentleman" },
};

const SURNAME_EN: Record<string, string> = {
  李: "the imperial surname of the Tang dynasty; one of the most common surnames in China, from the Ying clan",
  王: "descended from the Zhou royal house; simple strokes, grand and steady",
  林: "from descendants of the Shang-dynasty loyalist Bigan, who took refuge in a long forest (lin)",
  张: "from Huangdi's grandson Hui, rewarded with this surname for inventing the bow",
  刘: "the imperial surname of the Han dynasty — majestic in bearing",
  杨: "from a son of King Xuan of Zhou; the poplar surname — clear and upright",
  黄: "from the ancient state of Huang, descendants of Huangdi — weighty and solid",
  周: "from the Zhou royal house; carries the sense of completeness and uprightness",
  吴: "from the ancient state of Wu — a great surname of the Jiangnan south",
  徐: "from the ancient state of Xu — unhurried, composed, at ease",
  孙: "from descendants of King Wen of Zhou; the sense of generations continuing",
  胡: "from Hu Gongman of the state of Chen — a great northern clan",
  朱: "the imperial surname of the Ming dynasty; the red of cinnabar — bright and upright",
  高: "from descendants of Jiang Taigong; tall, far-reaching",
  罗: "from the ancient state of Luo; the breadth of a net that gathers all things",
  郑: "from the Zhou state of Zheng; solemn and earnest",
  梁: "from the ancient state of Liang; the hope of becoming a pillar (liang) of one's world",
  宋: "from the state of Song, founded by Shang descendants — a long literary air",
  唐: "from the sage-king Tang Yao; the surname of the Tang dynasty — grand in scope",
  韩: "from a branch of King Cheng of Zhou's line; one of the Seven Warring States",
  冯: "from the Wei royal clan — a surname rich in scholars",
  于: "from Yu Shu, son of King Wu of Zhou; extremely simple strokes",
  萧: "from the Spring-and-Autumn state of Song; its sound echoes carefree ease",
  曹: "from the ancient state of Cao, descendants of Huangdi; the surname of Cao Cao",
  袁: "from Yuan Xiang of Chen; the Yuan clan of Runan was a great house of the late Han",
  沈: "from the state of Shen, founded by a son of King Wen of Zhou — quiet and inward",
  曾: "the surname of Zeng Shen, disciple of Confucius — a family known for filial virtue",
  彭: "the surname of Peng Zu, emblem of longevity; the drumbeat 'peng peng' — full of force",
  苏: "the surname of Su Shi and Su Qin; the sense of all things reviving",
  卢: "from Lu Yi, granted to descendants of Jiang Taigong — clean and crisp",
  蒋: "from the state of Jiang, founded by a son of the Duke of Zhou — a surname of generals",
  蔡: "from Cai Shudu, son of King Wen of Zhou; Cai Lun, inventor of paper, bore this name",
  丁: "one of the fewest-stroke surnames; the saying goes 'a ding is a ding' — solid and reliable",
  魏: "the surname of Wei, one of the Seven Warring States — towering and grand",
  叶: "from descendants of Shen Yinshu of Chu; 'fallen leaves return to roots' — gentle warmth",
  潘: "from the Zhou state of Pan — a water-softened surname",
  杜: "the surname of the poet Du Fu — quiet, studious, growing into shade",
  夏: "the surname of Yu the Great's Xia dynasty — the very source of 'Huaxia' (China)",
  钟: "from the idiom 'where heaven's beauty gathers' — devoted, focused",
  汪: "brimming water, a vast expanse — warm and generous",
  田: "the farmland surname — down-to-earth, steady, secure",
  任: "from 'a heavy burden and a long road' — worthy of trust",
  姜: "the surname of Jiang Taigong, descended from the Flame Emperor Shennong",
  范: "the surname of Fan Zhongyan; the sense of a model and standard",
  方: "square and upright; crisp, clean strokes",
  石: "the surname of metal and stone — firm and dependable",
  姚: "the surname of the sage-king Shun (Yao Chonghua) — 'yaoyao', beautiful",
  邹: "from the Spring-and-Autumn state of Zou — homeland of Mencius",
  金: "from Shaohao of the Golden Heaven clan; the sense of halls filled with gold and jade",
  陆: "the land surname — feet firmly on the ground",
  孔: "the surname of Confucius — the source of a great scholarly lineage",
  白: "the surname of the poet Li Bai — bright and clear",
  崔: "from Cui Yi, granted to descendants of Jiang Taigong — towering height",
  康: "health and peace — what everyone wishes for",
  秦: "the surname of the Qin dynasty; flourishing grain in the Qin lands",
  江: "the great river surname — open vistas, a river that never stops",
  顾: "from 'considering the whole picture' — thoughtful and caring",
  侯: "the surname of lords and marquises — quiet nobility",
  孟: "the surname of Mencius, the 'Second Sage' of the Four Books",
  龙: "the dragon-totem surname — every parent's hope for their child",
  万: "from 'ten thousand things renewed' — all-embracing",
  雷: "the thunder surname — a resounding voice",
  钱: "the surname of Qian Liu, king of Wuyue — a great Jiangnan house",
  汤: "the surname of Tang of Shang; great sweeping waters that level the world",
  尹: "the sense of governing, an official's title — clean and upright",
  黎: "the dawn surname; also the common people, all living beings",
  易: "the 'yi' of the I Ching — constancy sought within change",
  常: "constancy and endurance — the ordinary, lasting longest",
  武: "martial vigor; 'stopping the spear is true wu' — strength with restraint",
  莫: "from 'no sorrow for the road ahead'; unfathomable depth",
  贺: "the celebration surname — joy built into the name",
  文: "gentle and refined, courtesy with substance",
};

// 五格吉数（通行数理吉数表，节选）
const LUCKY_NUMBERS = new Set([
  1, 3, 5, 6, 7, 8, 11, 13, 15, 16, 17, 18, 21, 23, 24, 25, 29, 31, 32, 33,
  35, 37, 39, 41, 45, 47, 48, 52, 57, 61, 63, 65, 67, 68, 81,
]);

export interface NameCharOut {
  char: string;
  pinyin: string;
  element: string;
  strokes: number;
  meaning: string;
  role: string; // 姓 / 名一字 / 名二字
  reason: string; // 为什么选这个字（与命局五行的关系）
}

export interface NameSuggestion {
  fullName: string;
  pinyin: string;
  score: number;
  surnameNote: string;
  chars: NameCharOut[];
  elementSummary: string; // 名字整体与命局五行的关系
  meaningSummary: string; // 名字整体寓意
  wuge: { tian: number; ren: number; di: number; wai: number; zong: number; lucky: string[] };
  toneNote: string;
}

export interface NamingBasis {
  dayMaster: string;
  dayMasterElement: string;
  strength: string;
  favorable: string[];
  avoid: string[];
  weakest: string;
  weakestValue: number;
  missing: string[];
  zodiacSign: string;
  explanation: string;
}

const GEN_NEXT: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 0 }; // 木→火→土→金→水→木（相生序，索引按 ELEMENTS）

function elemIdx(el: string): number {
  return ELEMENTS.indexOf(el as ElementName);
}

function charElementReason(
  g: GivenChar,
  ctx: { favorable: string[]; avoid: string[]; weakest: string },
  lang: Lang = "zh",
): string {
  const en = lang === "en";
  const fav = ctx.favorable.includes(g.el);
  const weakest = g.el === ctx.weakest;
  if (fav && weakest) {
    return en
      ? `Element ${elemEn(g.el)} — both a favorable element for your chart and its weakest line, so this one character fills the gap and boosts fortune at once`
      : `五行属${g.el}，既是命局喜用、又是命局最弱的一行，一字同时补缺与助运`;
  }
  if (fav) return en
    ? `Element ${elemEn(g.el)} — exactly one of your chart's favorable elements; carrying it in the name is a daily supplement`
    : `五行属${g.el}，正是命局的喜用之神，名字里带上它，等于随身补益`;
  if (weakest) return en
    ? `Element ${elemEn(g.el)} — the weakest line in your chart; the name replenishes ${elemEn(g.el)} to keep the five elements flowing in balance`
    : `五行属${g.el}，命局中这一行最弱，取名补${g.el}，求五行流通平衡`;
  const genFav = ctx.favorable.some((f) => GEN_NEXT[elemIdx(g.el)] === elemIdx(f));
  if (genFav) {
    const target = ctx.favorable.find((f) => GEN_NEXT[elemIdx(g.el)] === elemIdx(f));
    return en
      ? `Element ${elemEn(g.el)} — ${elemEn(g.el)} generates ${target ? elemEn(target) : ""}, indirectly nourishing the favorable ${target ? elemEn(target) : ""} line`
      : `五行属${g.el}，${g.el}能生${target}，间接滋养命局喜用的${target}行`;
  }
  if (ctx.avoid.includes(g.el)) return en
    ? `Element ${elemEn(g.el)} — though in the avoided set, it harmonizes with the name's other character and its meaning and sound are excellent, so it is kept`
    : `五行属${g.el}，虽在忌神之列，但与名字另一字构成调和，且字义音形俱佳，故保留`;
  return en
    ? `Element ${elemEn(g.el)} — neither clashing nor avoided; chosen mainly for its meaning and sound`
    : `五行属${g.el}，不冲不忌，主要取其字义与音律之美`;
}

function surnameElementReason(
  s: Surname,
  ctx: { favorable: string[]; avoid: string[]; weakest: string },
  lang: Lang = "zh",
): string {
  const en = lang === "en";
  if (ctx.favorable.includes(s.el) && s.el === ctx.weakest) {
    return en
      ? `The surname 「${s.c}」 is element ${elemEn(s.el)} — in tune with your favorable elements and replenishing the weakest line`
      : `姓「${s.c}」五行属${s.el}，与喜用同气、又补最弱一行`;
  }
  if (ctx.favorable.includes(s.el)) return en
    ? `The surname 「${s.c}」 is element ${elemEn(s.el)}, a favorable element for your chart — the family name itself starts with the right energy`
    : `姓「${s.c}」五行属${s.el}，是命局喜用，姓氏先得其气`;
  if (s.el === ctx.weakest) return en
    ? `The surname 「${s.c}」 is element ${elemEn(s.el)}, replenishing your chart's weakest ${elemEn(s.el)} line`
    : `姓「${s.c}」五行属${s.el}，补命局最弱的${s.el}行`;
  return en
    ? `The surname 「${s.c}」 is element ${elemEn(s.el)} — neither clashing with nor avoided by your chart`
    : `姓「${s.c}」五行属${s.el}，与命局不冲不忌`;
}

export function generateChineseNames(
  chart: Chart,
  gender: NameGender,
  opts: { surname?: string; style?: string; batch?: number; lang?: Lang },
): { basis: NamingBasis; names: NameSuggestion[] } {
  const lang: Lang = opts.lang === "en" ? "en" : "zh";
  const en = lang === "en";
  const favorable = chart.favorable;
  const avoid = chart.avoid;
  const values = chart.elements;
  let weakestIdx = 0;
  values.forEach((v, i) => {
    if (v < (values[weakestIdx] ?? 0)) weakestIdx = i;
  });
  const weakest = ELEMENTS[weakestIdx] ?? "木";
  const weakestValue = values[weakestIdx] ?? 0;
  const missing = ELEMENTS.filter((_, i) => (values[i] ?? 0) === 0);
  const ctx = { favorable, avoid, weakest };

  const elementsText = ELEMENTS.map((e, i) => `${e} ${values[i] ?? 0}`).join(" · ");
  const elementsTextEn = ELEMENTS.map((e, i) => `${elemEn(e)} ${values[i] ?? 0}`).join(" · ");
  const basis: NamingBasis = {
    dayMaster: chart.dayMaster,
    dayMasterElement: chart.dayMasterElement,
    strength: chart.strength,
    favorable,
    avoid,
    weakest,
    weakestValue,
    missing,
    zodiacSign: chart.zodiacSign,
    explanation: en
      ? `Your Day Master is ${chart.dayMaster} (${elemEn(chart.dayMasterElement)}), ${strengthEn(chart.strength)}. Favorable elements: ${favorable.map(elemEn).join(", ")}; avoided: ${avoid.map(elemEn).join(", ")}. ` +
        `Element strength in your chart: ${elementsTextEn} — ${elemEn(weakest)} is the weakest${missing.includes(weakest) ? " (nearly missing)" : ""}. ` +
        `So the names below favor characters of ${[...new Set([...favorable, weakest])].map(elemEn).join(", ")} — favorable elements support fortune, the weakest line gets replenished — ` +
        `while avoiding ${avoid.map(elemEn).join(", ")} characters. Five-grid numerology (simplified stroke counts) and level/oblique tone balance are factored in as well, using common characters with beautiful meanings.`
      : `日主为${chart.dayMaster}（${chart.dayMasterElement}），身${chart.strength}，喜用${favorable.join("、")}，忌${avoid.join("、")}。` +
        `命局五行力量：${elementsText}，其中${weakest}最弱${missing.includes(weakest) ? "（几近缺失）" : ""}。` +
        `星座为${chart.zodiacSign}。起名因此优先选属${[...new Set([...favorable, weakest])].join("、")}的字——喜用字助运、最弱一行补缺，` +
        `并避开忌神${avoid.join("、")}的字；同时参酌三才五格数理（简体笔画）与声调平仄，取字义美好的常用字。`,
  };

  // ---- 姓氏候选 ----
  let surnamePool: Surname[];
  const wanted = (opts.surname ?? "").trim();
  if (wanted) {
    const found = SURNAMES.find((s) => s.c === wanted);
    surnamePool = found
      ? [found]
      : [{ c: wanted, py: "", tone: 0, el: "土" as ElementName, strokes: 8, origin: en ? "The surname you specified" : "你指定的姓氏" }];
  } else {
    const scored = SURNAMES.map((s) => {
      let sc = 40;
      if (favorable.includes(s.el)) sc += 30;
      if (s.el === weakest) sc += 20;
      if (avoid.includes(s.el)) sc -= 25;
      return { s, sc };
    }).sort((a, b) => b.sc - a.sc);
    surnamePool = scored.slice(0, 6).map((x) => x.s);
  }

  // ---- 名字用字打分 ----
  const style = opts.style && opts.style !== "any" ? opts.style : "";
  const pool = GIVEN_CHARS.filter((g) => g.g === "b" || (gender === "male" ? g.g === "m" : g.g === "f"));
  const charScore = (g: GivenChar): number => {
    let sc = 40;
    if (favorable.includes(g.el)) sc += 35;
    if (g.el === weakest) sc += 25;
    if (avoid.includes(g.el)) sc -= 45;
    const genFav = favorable.some((f) => GEN_NEXT[elemIdx(g.el)] === elemIdx(f));
    if (genFav && !favorable.includes(g.el)) sc += 12;
    if (style && g.styles.includes(style)) sc += 12;
    return sc;
  };
  const scoredChars = pool
    .map((g) => ({ g, sc: charScore(g) }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 26);

  // ---- 组合 ----
  interface Combo {
    surname: Surname;
    g1: GivenChar;
    g2: GivenChar;
    score: number;
  }
  const combos: Combo[] = [];
  for (const surname of surnamePool) {
    for (let i = 0; i < scoredChars.length; i++) {
      for (let j = 0; j < scoredChars.length; j++) {
        if (i === j) continue;
        const a = scoredChars[i];
        const b = scoredChars[j];
        if (!a || !b) continue;
        if (a.g.c === b.g.c) continue;
        let sc = (a.sc + b.sc) / 2;
        // 五行搭配：相生 +10，同行 +4，相克 -8
        const ia = elemIdx(a.g.el);
        const ib = elemIdx(b.g.el);
        if (GEN_NEXT[ia] === ib || GEN_NEXT[ib] === ia) sc += 10;
        else if (ia === ib) sc += 4;
        else if ((ia + 2) % 5 === ib || (ib + 2) % 5 === ia) sc -= 8;
        // 声调：平（1/2）仄（3/4）相间最佳
        const ping = (t: number) => t === 1 || t === 2;
        if (a.g.tone !== b.g.tone) sc += 5;
        if (ping(a.g.tone) !== ping(b.g.tone)) sc += 5;
        // 五格：人/地/总格吉数加分
        const ren = surname.strokes + a.g.strokes;
        const di = a.g.strokes + b.g.strokes;
        const zong = surname.strokes + a.g.strokes + b.g.strokes;
        for (const n of [ren, di, zong]) if (LUCKY_NUMBERS.has(n > 81 ? n - 80 : n)) sc += 5;
        combos.push({ surname, g1: a.g, g2: b.g, score: sc });
      }
    }
  }
  combos.sort((x, y) => y.score - x.score);

  // 去重（同名只留最高分），按批次取不同窗口，实现「换一批」
  const seen = new Set<string>();
  const unique: Combo[] = [];
  for (const c of combos) {
    const key = `${c.surname.c}${c.g1.c}${c.g2.c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  const batch = Math.max(0, opts.batch ?? 0);
  const pageSize = 6;
  const maxStart = Math.max(0, unique.length - pageSize);
  const start = maxStart === 0 ? 0 : (batch * pageSize) % (maxStart + 1);
  const picked = unique.slice(start, start + pageSize);

  const names: NameSuggestion[] = picked.map((c) => {
    const { surname, g1, g2 } = c;
    const tian = surname.strokes + 1;
    const ren = surname.strokes + g1.strokes;
    const di = g1.strokes + g2.strokes;
    const zong = surname.strokes + g1.strokes + g2.strokes;
    const wai = Math.max(1, zong - ren + 1);
    const luckyOf = (label: string, n: number) =>
      LUCKY_NUMBERS.has(n > 81 ? n - 80 : n)
        ? en
          ? `${label} ${n} · Auspicious`
          : `${label} ${n} 吉`
        : null;
    const lucky = [
      luckyOf(en ? "Personality grid" : "人格", ren),
      luckyOf(en ? "Foundation grid" : "地格", di),
      luckyOf(en ? "Total grid" : "总格", zong),
    ].filter((x): x is string => x !== null);
    const g1En = GIVEN_EN[g1.c];
    const g2En = GIVEN_EN[g2.c];
    const chars: NameCharOut[] = [
      {
        char: surname.c,
        pinyin: surname.py,
        element: surname.el,
        strokes: surname.strokes,
        meaning: en ? (SURNAME_EN[surname.c] ?? surname.origin) : surname.origin,
        role: en ? "Family name" : "姓",
        reason: surnameElementReason(surname, ctx, lang),
      },
      {
        char: g1.c,
        pinyin: g1.py,
        element: g1.el,
        strokes: g1.strokes,
        meaning: en ? (g1En?.m ?? g1.meaning) : g1.meaning,
        role: en ? "Given name · 1st character" : "名 · 第一字",
        reason: charElementReason(g1, ctx, lang),
      },
      {
        char: g2.c,
        pinyin: g2.py,
        element: g2.el,
        strokes: g2.strokes,
        meaning: en ? (g2En?.m ?? g2.meaning) : g2.meaning,
        role: en ? "Given name · 2nd character" : "名 · 第二字",
        reason: charElementReason(g2, ctx, lang),
      },
    ];
    const nameElems = [g1.el, g2.el];
    const hitsFav = nameElems.filter((e) => favorable.includes(e));
    const hitsWeak = nameElems.filter((e) => e === weakest);
    const generates = GEN_NEXT[elemIdx(g1.el)] === elemIdx(g2.el);
    const elementSummary = en
      ? `The two given-name characters are ${elemEn(g1.el)} and ${elemEn(g2.el)}: ` +
        (hitsFav.length > 0 ? `${[...new Set(hitsFav)].map(elemEn).join(", ")} is a favorable element for your chart; ` : "") +
        (hitsWeak.length > 0 ? `they replenish the chart's weakest line, ${elemEn(weakest)}; ` : "") +
        (generates
          ? `${elemEn(g1.el)} generates ${elemEn(g2.el)}, so the elements flow into each other; `
          : g1.el === g2.el
            ? "both characters share one element, concentrating its strength; "
            : "") +
        `read with the surname 「${surname.c}」 (${elemEn(surname.el)}), the full name runs ${elemEn(surname.el)}–${elemEn(g1.el)}–${elemEn(g2.el)} and supports your Day Master ${chart.dayMaster} ${elemEn(chart.dayMasterElement)} (${strengthEn(chart.strength)}).`
      : `名字两字属${g1.el}、属${g2.el}：` +
        (hitsFav.length > 0 ? `其中${[...new Set(hitsFav)].join("、")}为命局喜用，` : "") +
        (hitsWeak.length > 0 ? `补足了命局最弱的${weakest}行，` : "") +
        (generates
          ? `且${g1.el}生${g2.el}、五行相生流通，`
          : g1.el === g2.el
            ? `两字同气连枝、力量集中，`
            : "") +
        `与姓氏「${surname.c}」（属${surname.el}）合看，全名五行${surname.el}${g1.el}${g2.el}，对日主${chart.dayMaster}${chart.dayMasterElement}（身${chart.strength}）形成补益。`;
    const ping = (t: number) => t === 1 || t === 2;
    const toneNote = en
      ? surname.tone > 0
        ? `Pronounced ${surname.py} ${g1.py} ${g2.py} — tones ${surname.tone}·${g1.tone}·${g2.tone}, ${ping(g1.tone) !== ping(g2.tone) ? "level and oblique tones alternating" : "with a natural rise and fall"}; it rolls off the tongue.`
        : `Pronounced ${g1.py} ${g2.py} — tones ${g1.tone}·${g2.tone}, with a natural rise and fall; it rolls off the tongue.`
      : surname.tone > 0
        ? `读音 ${surname.py} ${g1.py} ${g2.py}，声调 ${surname.tone}·${g1.tone}·${g2.tone} 声，${
            ping(g1.tone) !== ping(g2.tone) ? "平仄相间" : "起伏有致"
          }，读来流畅不拗口。`
        : `读音 ${g1.py} ${g2.py}，声调 ${g1.tone}·${g2.tone} 声，起伏有致，读来流畅不拗口。`;
    const b1 = en ? (g1En?.b ?? g1.blessing) : g1.blessing;
    const b2 = en ? (g2En?.b ?? g2.blessing) : g2.blessing;
    return {
      fullName: `${surname.c}${g1.c}${g2.c}`,
      pinyin: [surname.py, g1.py, g2.py].filter(Boolean).join(" "),
      score: Math.max(62, Math.min(99, Math.round(c.score))),
      surnameNote: en ? (SURNAME_EN[surname.c] ?? surname.origin) : surname.origin,
      chars,
      elementSummary,
      meaningSummary: en
        ? `「${g1.c}」 carries the wish of ${b1}; 「${g2.c}」 holds ${b2} — together the name means ${b1} and ${b2}: a Chinese name with a ${g1.styles[0] ? "distinctive" : ""} character and a blessing woven into every stroke.`
        : `「${g1.c}」取${g1.blessing}之意，「${g2.c}」含${g2.blessing}之愿——合起来寓意${g1.blessing}、${g2.blessing}，是一个${g1.styles[0] ?? ""}${g2.styles[0] && g2.styles[0] !== g1.styles[0] ? `而${g2.styles[0]}` : ""}的中文名字。`,
      wuge: { tian, ren, di, wai, zong, lucky },
      toneNote,
    };
  });

  return { basis, names };
}
