/**
 * 语言判定（纯函数：没有 React、没有原生依赖）。
 *
 * ## 为什么不装 `expo-localization`
 *
 * 它能给出更细的系统语言信息（地区、时区、是否 RTL），但它是一个**原生模块**：
 * 加进来就必须重新出一版构建才能验证，而这条链路刚修好、还没在真机上验过
 * （见 `apps/mobile/README.md`）。Hermes 自带 `Intl`，
 * `Intl.DateTimeFormat().resolvedOptions().locale` 拿到的就是系统设置里的语言
 * （Android / iOS 都是），对「中英二选一」这个需求足够了。
 *
 * 哪天要做泰语、越南语、RTL（阿拉伯语），再换 `expo-localization` —— 那时
 * 需要的就不是语言，而是 `isRTL` 这类运行时布局信息，`Intl` 给不了。
 *
 * ## 兜底为什么是英文
 *
 * 这个产品面向国际市场。认不出来的语言如果退到中文，绝大多数新用户一进来
 * 看到的就是看不懂的界面；退到英文至少是通用语。中文用户不受影响：
 * 系统语言是 `zh-*` 会命中中文。
 *
 * 已知取舍：繁中（`zh-TW` / `zh-HK`）目前也走简体文案 —— 我们还没有真正的
 * 繁体词典，硬拆一套半成品不如不做。
 */

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** 认不出来的语言一律落到这里。 */
export const DEFAULT_LOCALE: Locale = "en";

/** `"zh-Hans-CN"` / `"en_US"` / `"EN"` → `"zh"` / `"en"` / `"en"`；认不出返回 `null`。 */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : null;
}

/** 按优先级逐个试，第一个认得的语言胜出；都不认得则 `DEFAULT_LOCALE`。 */
export function detectLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const tag of tags) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * 系统语言列表。
 *
 * 拿不到就返回空数组（`detectLocale` 会兜底）—— 不抛错：一个拿不到语言的
 * 设备不该因此打不开 App。
 */
export function systemLocaleTags(): string[] {
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    return resolved ? [resolved] : [];
  } catch {
    return [];
  }
}
