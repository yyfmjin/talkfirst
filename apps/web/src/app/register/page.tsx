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
    <div>
      <button
        type="button"
        onClick={() => setHint(true)}
        className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white text-[15px] text-ink transition active:scale-95"
        aria-label={label}
      >
        {icon}
      </button>
      {hint ? <p className="mt-1 text-center text-[10px] text-muted">即将上线</p> : null}
    </div>
  );
}

export default function RegisterPage() {
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    if (password.length < 8) {
      setError("密码至少 8 位。");
      return;
    }
    setLoading(true);
    try {
      const user = await apiFetch<SessionUser>("/auth/register", {
        method: "POST",
        body: { email: trimmed, password },
      });
      setUser(user);
      router.push("/verify");
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError ? requestError.message : "注册失败，请稍后再试",
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
        <h1 className="text-center text-[26px] font-semibold">创建账号</h1>
        <p className="mt-2 text-center text-[13px] text-muted">加入 TalkFirst，认识更多有趣的人</p>

        <form className="mt-8 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="邮箱地址" placeholder="your@email.com" value={email} onChange={setEmail} />
          <Field
            label="密码"
            type="password"
            placeholder="至少 8 位密码"
            value={password}
            onChange={setPassword}
          />
          <p className="text-[11px] leading-4 text-muted">
            仅限 18 岁以上使用。注册即表示同意社区规则。
          </p>
          {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
          <GradientButton type="submit" className="mt-2" disabled={loading}>
            {loading ? "注册中…" : "注册"}
          </GradientButton>
        </form>

        <div className="my-6 flex items-center gap-3 text-[12px] text-muted">
          <span className="h-px flex-1 bg-line" />
          或使用以下方式注册
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex items-start justify-center gap-4">
          <ComingSoonButton label="使用 Google 注册" icon="G" />
          <ComingSoonButton label="使用 Apple 注册" icon="*" />
        </div>

        <p className="mt-8 text-center text-[13px] text-muted">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-[#6B7CFF]">
            立即登录
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
