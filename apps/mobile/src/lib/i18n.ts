import { DEFAULT_LOCALE, type Locale } from "./locale";
import { translate, type MsgKey, type MsgParams } from "./messages";

/**
 * 当前生效的语言，模块级保存一份。
 *
 * ## 为什么需要它（而不是只有 React context）
 *
 * `api.ts` 里有两处兜底文案 —— 超时、连不上服务器 —— 它们不是 React 组件，
 * 拿不到 context。那两处如果写死中文，英文用户会看到「整个界面英文，唯独断网
 * 提示是中文」，这种半吊子比全中文更让人怀疑 App 坏了。
 *
 * ## 写入口只有一个
 *
 * 只有 `I18nProvider` 会调 `setActiveLocale`（在语言变化时）。组件里请用
 * `useI18n().t`，这样语言一变组件就会重渲染；直接调这个模块的 `t()` 拿到的
 * 值不会触发重渲染，只适合非 React 的纯函数（比如时间格式化的兜底）。
 */
let activeLocale: Locale = DEFAULT_LOCALE;

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** 给非 React 代码用的翻译入口。组件里请用 `useI18n().t`。 */
export function t(key: MsgKey, params?: MsgParams): string {
  return translate(activeLocale, key, params);
}
