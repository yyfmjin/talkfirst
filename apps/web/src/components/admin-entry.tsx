"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n/use-locale";

export function AdminEntry() {
  const { user } = useSession();
  const { t } = useT();
  if (!user?.isAdmin) return null;
  return (
    <Link
      href="/admin"
      className="rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-medium text-amber-700"
    >
      {t("admin.entry")}
    </Link>
  );
}
