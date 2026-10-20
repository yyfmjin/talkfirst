import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import ProfilePage from "../../../profile/[id]/page";

/**
 * 他人资料页的英文入口。地址里带用户 id，所以只给标题、不给 canonical
 * （理由见 `en/moments/[id]/page.tsx`）。
 */
export const metadata: Metadata = {
  title: t("en", "pf.title"),
};

export default function ProfilePageEn() {
  return <ProfilePage />;
}
