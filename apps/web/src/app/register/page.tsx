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
 *
 * P0-02 added the optional account-name field. Its two refusals (`USERNAME_TAKEN`,
 * `USERNAME_RESERVED`) are mapped to Chinese below, because the API's own messages
 * are English and this screen renders whatever the server said.
 */

/**
 * The account-name refusals, in Chinese.
 *
 * `EMAIL_TAKEN` is deliberately NOT in this map: it has always reached the screen
 * as the API's English string, and changing that is a separate copy cleanup rather
 * than part of adding an account name. Adding only the new codes keeps this file
 * honest about what it does rather than pretending to be a general mapping.
 */
const USERNAME_ERROR_LABELS: Record<string, string> = {
  USERNAME_TAKEN: "这个账户名已经被占用了，换一个试试。",
  USERNAME_RESERVED: "这个账户名不可用，换一个试试。",
  USERNAME_INVALID: "账户名需为 8–30 位字母或数字。",
};

export default function RegisterPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  /**
   * Optional (P0-02). Blank means "generate one for me", which is what every
   * account created before this feature got.
   */
  const [username, setUsername] = useState("");
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
    const trimmedUsername = username.trim();
    /**
     * Only the FORMAT is checked here, and upper case is allowed because the
     * server lower-cases before storing. The alphabet (letters and digits only)
     * and the reserved-word list live on the server — a second copy of the list
     * would drift, and a drifted copy either refuses names the server accepts or
     * accepts names it refuses.
     */
    if (trimmedUsername && !/^[A-Za-z0-9]{8,30}$/.test(trimmedUsername)) {
      setError("账户名需为 8–30 位字母或数字。");
      return;
    }
    setLoading(true);
    try {
      const user = await apiFetch<SessionUser>("/auth/register", {
        method: "POST",
        body: {
          email: trimmed,
          password,
          // Omitted entirely when blank. Sending `username: ""` would be a
          // validation error, not "no preference".
          ...(trimmedUsername ? { username: trimmedUsername } : {}),
        },
      });
      setUser(user);
      router.push("/verify");
    } catch (requestError) {
      const mapped =
        requestError instanceof ApiRequestError
          ? USERNAME_ERROR_LABELS[requestError.code ?? ""]
          : undefined;
      setError(
        mapped ??
          (requestError instanceof ApiRequestError ? requestError.message : "注册失败，请稍后再试"),
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
              // "email", not "username": the account-name field below now claims
              // that hint, and two fields advertising the same autofill target is
              // how a password manager ends up filling the wrong one.
              autoComplete="email"
              placeholder="请输入邮箱地址"
              value={email}
              invalid={Boolean(error)}
              describedBy={error ? "register-error" : "register-hint"}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="register-username" className="mb-1.5 block text-caption font-medium text-content-muted">
              账户名（可选）
            </label>
            <TFInput
              id="register-username"
              type="text"
              autoComplete="username"
              placeholder="8–30 位字母或数字，留空则自动生成"
              value={username}
              invalid={Boolean(error)}
              describedBy={error ? "register-error" : "register-hint"}
              onChange={(event) => setUsername(event.target.value)}
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
            仅限 18 岁以上使用。注册即表示同意
            <Link href="/legal/rules" className="font-medium text-brand-600">
              社区规则
            </Link>
            。
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
