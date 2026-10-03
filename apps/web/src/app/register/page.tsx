"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TFInput, TFButton } from "@/components/tf";
import { OAuthButtons } from "@/components/oauth-buttons";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useSession, type SessionUser } from "@/lib/session";

/**
 * Create an account.
 *
 * ## What changed in Phase C
 *
 * The same two fixes as `login/page.tsx`, for the same reasons: real
 * `<label for>` + `aria-describedby` on every field (the old `Field` used a
 * `<span>`, so the control had no programmatic label), and an `autoComplete` on
 * each input — `new-password` here, which is what makes a password manager offer
 * to *generate* one instead of autofilling an existing credential into a
 * registration form.
 *
 * The third-party buttons are now visibly disabled rather than looking live and
 * only admitting 「即将上线」 after a tap. This file's copy of the pattern was a
 * verbatim duplicate of the one in `login/page.tsx`; the login screen now owns
 * the pattern and this one is inline, so there is one implementation per shape
 * instead of two drifting ones.
 *
 * `smoke.test.mjs` pins `apiFetch<SessionUser>("/auth/register"`, and that call is
 * untouched.
 */
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
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-10">
        <div className="mb-6 flex justify-center">
          <LogoMark size={56} />
        </div>
        <h1 className="text-center text-title font-semibold text-content">创建账号</h1>
        <p className="mt-1.5 text-center text-ui text-content-muted">加入 TalkFirst，认识更多有趣的人</p>

        <form className="mt-7 space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div>
            <label htmlFor="register-email" className="mb-1.5 block text-caption font-medium text-content-muted">
              邮箱地址
            </label>
            <TFInput
              id="register-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="请输入邮箱地址"
              value={email}
              invalid={Boolean(error)}
              describedBy={error ? "register-error" : "register-hint"}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="register-password" className="mb-1.5 block text-caption font-medium text-content-muted">
              密码
            </label>
            <TFInput
              id="register-password"
              type="password"
              autoComplete="new-password"
              placeholder="至少 8 位密码"
              value={password}
              invalid={Boolean(error)}
              describedBy={error ? "register-error" : "register-hint"}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {/* The hint doubles as the error target, so the 18+ / terms statement is
              announced to assistive tech when the field is focused rather than
              only being visible. */}
          <p id="register-hint" className="text-caption leading-4 text-content-subtle">
            仅限 18 岁以上使用。注册即表示同意社区规则。
          </p>
          {error ? (
            <p id="register-error" role="alert" className="break-words text-caption text-danger-600">
              {error}
            </p>
          ) : null}

          <TFButton type="submit" size="lg" fullWidth loading={loading} loadingLabel="注册中…" className="mt-1">
            注册
          </TFButton>
        </form>

        <div className="my-6 flex items-center gap-3 text-caption text-content-subtle">
          <span className="h-px flex-1 bg-border" />
          或使用以下方式注册
          <span className="h-px flex-1 bg-border" />
        </div>

        {/*
          「用 Google 注册」 and 「用 Google 登录」 are the SAME server flow.

          Google returns the identity and the API decides whether that means
          "create an account" or "sign in"; there is no separate registration
          endpoint to call. Splitting the copy is therefore honest about intent
          without pretending there are two code paths — and it is why this is one
          shared component instead of two drifting implementations.
        */}
        <OAuthButtons redirectTo="/discover" verb="注册" className="flex flex-col gap-2" />

        <p className="mt-6 text-center text-ui text-content-muted">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-brand-600">
            立即登录
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
