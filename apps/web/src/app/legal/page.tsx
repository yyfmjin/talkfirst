"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { GradientButton } from "@/components/ui";
import { ScreenHeader } from "@/components/screen-header";

export default function LegalPage() {
  const router = useRouter();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  return (
    <PhoneShell>
      <ScreenHeader title="用户协议与隐私政策" backHref="/verify" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-4">
        <p className="text-[14px] leading-6 text-muted">
          请阅读并同意我们的《用户协议》和《隐私政策》，以继续使用 TalkFirst。
        </p>
        <label className="mt-8 flex items-start gap-3 text-[14px]">
          <input type="checkbox" checked={terms} onChange={() => setTerms((value) => !value)} className="mt-1" />
          <span>我已阅读并同意《用户协议》</span>
        </label>
        <label className="mt-4 flex items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            checked={privacy}
            onChange={() => setPrivacy((value) => !value)}
            className="mt-1"
          />
          <span>我已阅读并同意《隐私政策》</span>
        </label>
        <div className="mb-1 mt-10">
          <GradientButton disabled={!terms || !privacy} onClick={() => router.push("/register/success")}>
            同意并继续
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
