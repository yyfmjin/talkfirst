"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";

const platforms = ["Instagram", "Telegram", "WhatsApp", "Discord", "X (Twitter)", "TikTok"];

export default function SocialPage() {
  const router = useRouter();
  const { user, setUser } = useSession();

  async function handleComplete() {
    if (user) {
      setUser({ ...user, emailVerified: true });
    }
    router.push("/onboarding/complete");
  }

  useEffect(() => {
    void apiFetch("/users/me")
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  return (
    <PhoneShell>
      <ScreenHeader title="社交账号" backHref="/onboarding/countries" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <p className="text-[13px] text-muted">
          可先不绑定。账号默认对陌生人隐藏，只有双方同意交换后才会展示。
        </p>
        <div className="mt-5 space-y-3">
          {platforms.map((item) => (
            <div
              key={item}
              className="flex h-14 items-center justify-between rounded-2xl border border-line px-4"
            >
              <span className="text-[14px]">{item}</span>
              <span className="text-[12px] text-muted">未绑定</span>
            </div>
          ))}
        </div>
        <div className="mb-1 mt-8">
          <GradientButton onClick={handleComplete}>完成</GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}