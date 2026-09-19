"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { apiFetch } from "@/lib/api";

export default function SocialPlaceholderPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/users/me").catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    });
  }, []);

  return (
    <PhoneShell>
      <ScreenHeader title="社交账号" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        <p className="rounded-3xl bg-[#F7F9FF] p-4 text-[12px] leading-5 text-muted">
          社交账号管理已并入个人动态同步设置，请前往动态设置绑定平台。
        </p>
        {error ? <p className="mt-3 text-[12px] text-red-500">{error}</p> : null}
      </div>
    </PhoneShell>
  );
}
