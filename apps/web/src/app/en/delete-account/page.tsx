import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import DeleteAccountPage from "../../delete-account/page";

/**
 * 英文入口。
 *
 * 不写 canonical/hreflang：这一页是给商店（Data safety 表单）用的**功能页**，
 * 不是给人搜的内容页 —— 收录它没有意义，反而可能让搜索结果里出现一个“删号说明”。
 */
export const metadata: Metadata = {
  title: t("en", "da.title"),
  robots: { index: false, follow: false },
};

export default function DeleteAccountPageEn() {
  return <DeleteAccountPage />;
}
