"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { Field, GradientButton } from "@/components/ui";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useSession, type SessionUser } from "@/lib/session";

function ComingSoonButton({ label, icon }: { label: string; icon: string }) {
  const [hint, setHint] = useState(false);
  return (
    <div className="flex-1">
      <button
        type="button"
        onClick={() => setHint(true)}
        className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-[13px] font-medium text-ink transition active:scale-[0.99]"
        aria-label={label}
      >
        <span className="grid h-5 w-5 place-items-center rounded-full border text-[11px]">{icon}</span>
        {label}
      </button>
      {hint ? <p className="mt-1 text-center text-[10px] text-muted">即将上线，暂用邮箱登录</p> : null}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) {
      setError("请填写邮箱和密码。");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    setLoading(true);
    try {
      const user = await apiFetch<SessionUser>("/auth/login", {
        method: "POST",
        body: { email: trimmed, password },
      });
      setUser(user);
      router.push("/discover");
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError ? requestError.message : "登录失败，请稍后再试",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-8">
        <div className="mb-8 flex justify-center">
          <LogoMark size={56} />
        </div>
        <h1 className="text-center text-[26px] font-semibold">欢迎回来</h1>
        <p className="mt-2 text-center text-[13px] text-muted">很高兴再次见到你</p>

        <form className="mt-8 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="邮箱地址" placeholder="your@email.com" value={email} onChange={setEmail} />
          <Field
            label="密码"
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={setPassword}
          />
          {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
          <GradientButton type="submit" className="mt-2" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </GradientButton>
        </form>

        <div className="my-6 flex items-center gap-3 text-[12px] text-muted">
          <span className="h-px flex-1 bg-line" />
          或
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex gap-2">
          <ComingSoonButton label="Google 登录" icon="G" />
          <ComingSoonButton label="Apple 登录" icon="*" />
        </div>

        <p className="mt-6 text-center text-[13px] text-muted">
          还没有账号？{" "}
          <Link href="/register" className="font-medium text-[#6B7CFF]">
            立即注册
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
