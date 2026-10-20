import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import ChatPage from "../../../messages/[id]/page";

/**
 * 会话详情页的英文入口。
 *
 * 不写 canonical / hreflang：地址里带会话 id，静态 `metadata` 取不到具体值
 * （原因见 `en/moments/[id]/page.tsx` 的注释）。
 */
export const metadata: Metadata = {
  title: t("en", "mc.title"),
};

export default function ChatPageEn() {
  return <ChatPage />;
}
