import type { MsgKey } from "./messages";
import type { Locale } from "./locale";

/**
 * 法律文档的线上地址。
 *
 * App 里**不内嵌**这几份长文，一律交给系统浏览器打开线上页面：
 * 法律文本会随版本更新（生效日期、条款措辞），内嵌副本迟早和线上不一致 ——
 * 而用户点开「隐私政策」时看到的必须是生效中的那一版。Google Play 审核也按
 * 线上地址核对，两边指向同一个页面才不会有第二种说法。
 */
const SITE_BASE = "https://talkfirst.ccwu.cc";

/** 与 web 端 `/legal/terms` 里写的同一个地址，别处再写一份就会漂。 */
export const SUPPORT_EMAIL = "support@talkfirst.ccwu.cc";

/** 三份对外文档，顺序即展示顺序。 */
export const LEGAL_DOCS = [
  { key: "legal.terms", path: "/legal/terms" },
  { key: "legal.privacy", path: "/legal/privacy" },
  { key: "legal.rules", path: "/legal/rules" },
] as const satisfies readonly { key: MsgKey; path: string }[];

/**
 * 拼出当前语言对应的地址：英文界面去 `/en/legal/*`，中文界面去 `/legal/*`。
 * 两套正文是同一份内容的不同语言版本，不是两个产品。
 */
export function legalUrl(locale: Locale, path: string): string {
  return `${SITE_BASE}${locale === "en" ? "/en" : ""}${path}`;
}
