import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { detectLocale, systemLocaleTags, type Locale } from "./locale";
import { translate, type MsgKey, type MsgParams } from "./messages";
import { setActiveLocale } from "./i18n";
import { getLocalePreference, saveLocalePreference } from "./storage";

/**
 * 界面语言。
 *
 * ## 默认行为：跟随系统
 *
 * 没设置过就每次启动都读一次系统语言（不是「安装时读一次然后存下来」）——
 * 用户在手机设置里把系统语言改成英文，重开 App 就该是英文，而不是还得再进
 * 这个页面手动改一次。所以存的是**偏好**（`system` / `zh` / `en`），
 * 不是「当前语言」。
 *
 * ## 为什么不用 React 的 `Suspense` 或载入态挡住界面
 *
 * 读本地存储是毫秒级的；为了它先显示一屏空白，代价比「极少见的覆盖设置晚
 * 一两帧生效」大得多。跟随系统这条主路径根本不依赖存储（`systemLocaleTags`
 * 同步可读），所以不存在闪烁。
 */
export type LocalePreference = Locale | "system";

type I18nValue = {
  /** 真正生效的语言。 */
  locale: Locale;
  /** 用户的选择（默认跟随系统）。 */
  preference: LocalePreference;
  setPreference: (next: LocalePreference) => void;
  t: TranslateFn;
};

/**
 * 翻译函数的形状。导出来是给**纯函数**用的：例如把时间戳格式化成「3 分钟前」
 * 这类工具函数需要翻译，但它不是组件、拿不到 context。
 * 让调用方把 `t` 当参数传进去，而不是在工具函数里直接 import 模块级的 `t` ——
 * 那样语言一变，已经渲染出去的列表不会重算。
 */
export type TranslateFn = (key: MsgKey, params?: MsgParams) => string;

const I18nContext = createContext<I18nValue | null>(null);

/**
 * 本地存的是字符串，不能直接当 `LocalePreference` 用 —— 它可能来自旧版本、
 * 也可能被手工改坏。校验不过就当作「跟随系统」。
 */
function asPreference(value: string | null): LocalePreference {
  return value === "zh" || value === "en" || value === "system" ? value : "system";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getLocalePreference();
      if (!cancelled) setPreferenceState(asPreference(stored));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = useMemo(
    () => (preference === "system" ? detectLocale(systemLocaleTags()) : preference),
    [preference],
  );

  // 让非 React 的 `t()`（api.ts 的错误兜底）与界面同语言。
  // 放在 effect 里而不是渲染中：渲染不该有副作用，而这里晚一帧没有影响 ——
  // 它唯一服务的场景是「请求失败」，那时早就过了首次渲染。
  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    // 存不上就算了：这一次选择仍然生效，只是下次启动回到跟随系统。
    void saveLocalePreference(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      preference,
      setPreference,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, preference, setPreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n 必须在 <I18nProvider> 里使用。");
  }
  return value;
}
