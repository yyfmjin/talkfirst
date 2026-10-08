import type { Metadata } from "next";
import { OfficialSite } from "@/marketing/official-site";
import { localePath, t } from "@/lib/i18n";

/**
 * 首页 = 官网（中文）。
 *
 * ## 为什么首页就是官网，而不是先给一个「开始」的启动屏
 *
 * 运营方要的是：**一打开就看见这是什么、能下载、能登录**。启动屏（原来那一版
 * 「先聊聊，再成为朋友」+ 两个按钮）本质上只做了官网主视觉已经做完的事，
 * 而且它把「这是什么」讲得比官网更少 —— 所以合并成一个页面，少一跳。
 *
 * 官网本体在 `src/marketing/official-site.tsx`，中英文共用一份实现；
 * 英文首页是 `app/en/page.tsx`。`/site`、`/en/site` 仍然可用（老链接不能失效），
 * 但它们的 canonical 指到首页。
 */
export const metadata: Metadata = {
  title: t("zh", "welcome.title"),
  description: t("zh", "welcome.description"),
  alternates: {
    canonical: localePath("zh", "/"),
    languages: {
      zh: localePath("zh", "/"),
      en: localePath("en", "/"),
    },
  },
};

export default function HomePage() {
  return <OfficialSite locale="zh" />;
}
