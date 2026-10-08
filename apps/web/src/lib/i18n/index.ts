/**
 * web 端语言的唯一入口。
 *
 * 组件从这里 import，不要去碰里面的具体文件：`locales.ts` 讲 URL 约定，
 * `dictionary.ts` 装文案。以后要换实现（例如整站搬进 `app/[locale]/`），
 * 改的是这两个文件，不是每个调用点。
 */
export { LOCALES, DEFAULT_LOCALE, localePath, otherLocale, type Locale } from "./locales";
export { t, zh, en, type MsgKey, type MsgParams } from "./dictionary";
