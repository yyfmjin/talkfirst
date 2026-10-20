import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import PasswordPage from "../../../me/password/page";

/**
 * 修改/设置密码的英文入口。
 *
 * 页面标题在中文侧有两种（「设置密码」/「修改密码」，取决于是否已设过），而
 * `metadata` 是构建期求值的、拿不到这个状态，所以这里用稳妥的「修改密码」。
 */
export const metadata: Metadata = {
  title: t("en", "me.changePassword"),
  alternates: {
    canonical: "/en/me/password",
    languages: { zh: "/me/password", en: "/en/me/password" },
  },
};

export default function MePasswordPageEn() {
  return <PasswordPage />;
}
