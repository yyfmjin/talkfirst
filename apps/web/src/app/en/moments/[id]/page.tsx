import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import MomentDetailPage from "../../../moments/[id]/page";

/**
 * 动态详情页的英文入口。
 *
 * 与静态页的镜像不同，这里**不写 canonical / hreflang**：这两个字段得填具体那条
 * 动态的地址，而 `metadata` 是静态导出的、拿不到 id。填一个指向列表页的 canonical
 * 等于告诉搜索引擎「这条动态的正式地址是列表页」，比不写更糟。标题仍然给英文。
 */
export const metadata: Metadata = {
  title: t("en", "md.title"),
};

export default function MomentDetailPageEn() {
  return <MomentDetailPage />;
}
