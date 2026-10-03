"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TFCard, TFInput, TFButton } from "@/components/tf";
import { OAuthButtons, oauthErrorMessage } from "@/components/oauth-buttons";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useSession, type SessionUser } from "@/lib/session";

/**
 * Sign in.
 *
 * ## What changed in Phase C
 *
 *  - **Inputs are real fields.** The old shared `Field` rendered a `<span>` for
 *    the label, so the control had no programmatic label — only a placeholder,
 *    which vanishes the moment you type. Now each input has a real `<label for>`,
 *    and an error is wired to it with `aria-invalid` + `aria-describedby`.
 *  - **Password managers can fill it.** Neither input had an `autoComplete`, so
 *    browsers and managers could not reliably offer the saved credential. Sign-in
 *    is the one screen where that is least forgivable.
 *  - **The third-party buttons are honest.** They used to look fully enabled and
 *    only revealed 「即将上线」 *after* you tapped. A control that looks available
 *    and is not is a small lie the user pays for with a wasted tap; they are now
 *    visibly disabled with the reason always shown. (They were also duplicated
 *    verbatim in `register/page.tsx`; this is now the only copy of the pattern.)
 *  - **Copy and behaviour are byte-identical where the suites pin them.** Four
 *    tests match this file's source text — `欢迎回来`, `邮箱`,
 *    `apiFetch<SessionUser>("/auth/login"`, and `邮箱尚未验证` — so those strings and
 *    that call signature are deliberately untouched. See
 *    `test/smoke.test.mjs` and `test/email-verification.test.mjs`.
 */
export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();

  /**
   * Surface a refusal the OAuth callback bounced back with.
   *
   * Read from `window.location.search` rather than `useSearchParams()`: this route
   * is statically prerendered, and `useSearchParams()` would force the whole page
   * behind a `<Suspense>` boundary (or a dynamic render) for the sake of a value
   * that only exists after a redirect. The effect runs once on mount, which is
   * exactly when a redirect lands.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = oauthErrorMessage(params);
    if (!message) return;
    setError(message);
    /**
     * The code is cleared from the address bar so a refresh does not re-show a
     * stale refusal — the sign-in it described is over.
     */
    params.delete("oauth_error");
    params.delete("oauth_has_password");
    params.delete("oauth_providers");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  async function resendVerification() {
    setError("");
    setNotice("");
    try {
      await apiFetch("/auth/send-verification-code", {
        method: "POST",
        body: { email: normalizedEmail },
      });
      setNotice("验证码已重新发送，请查收邮箱。");
    } catch {
      setError("验证码发送失败，请稍后再试。");
    }
  }

  async function recheckVerification() {
    setError("");
    setNotice("");
    try {
      const profile = await apiFetch<SessionUser>("/users/me");
      if (profile.emailVerified) {
        setUser(profile);
        router.push("/discover");
        return;
      }
    } catch {
      // Fall through: an unverifiable read is treated as "not verified yet".
    }
    setNotice("尚未检测到验证结果，请先输入邮箱验证码。");
    router.push("/verify");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setNeedsVerification(false);
    const trimmed = normalizedEmail;
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
      if (requestError instanceof ApiRequestError && requestError.code === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
        setError("邮箱尚未验证，请先完成邮箱验证。");
      } else {
        setError(
          requestError instanceof ApiRequestError ? requestError.message : "登录失败，请稍后再试",
        );
      }
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
        <h1 className="text-center text-title font-semibold text-content">欢迎回来</h1>
        <p className="mt-1.5 text-center text-ui text-content-muted">很高兴再次见到你</p>

        <form className="mt-7 space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div>
            {/* The label is 「邮箱地址」, NOT 「邮箱」. `test/fixtures/browser.ts`
                signs in with `getByLabel("邮箱地址")` and that helper is the entry
                point for nearly every authenticated spec — renaming this to the
                shorter string would fail the whole suite at login. */}
            <label htmlFor="login-email" className="mb-1.5 block text-caption font-medium text-content-muted">
              邮箱地址
            </label>
            <TFInput
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="请输入邮箱地址"
              value={email}
              invalid={Boolean(error) && !needsVerification}
              describedBy={error && !needsVerification ? "login-error" : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-caption font-medium text-content-muted">
              密码
            </label>
            <TFInput
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              invalid={Boolean(error) && !needsVerification}
              describedBy={error && !needsVerification ? "login-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p
              id="login-error"
              role="alert"
              className="break-words text-caption text-danger-600"
            >
              {error}
            </p>
          ) : null}

          <TFButton type="submit" size="lg" fullWidth loading={loading} loadingLabel="登录中…" className="mt-1">
            登录
          </TFButton>
        </form>

        {/* FEATURE (post-audit): password recovery. Until this existed, a user who
            forgot their password had no way back into their account at all. */}
        <p className="mt-3 text-center text-ui">
          <Link href="/reset" className="font-medium text-brand-600">
            忘记密码？
          </Link>
        </p>

        {needsVerification ? (
          <TFCard tone="brand" className="mt-4">
            <p className="text-center text-caption leading-5 text-content-muted">完成邮箱验证后即可正常登录。</p>
            <TFButton
              variant="secondary"
              size="sm"
              fullWidth
              className="mt-3"
              onClick={() => void resendVerification()}
            >
              重新发送验证邮件
            </TFButton>
            <TFButton
              variant="ghost"
              size="sm"
              fullWidth
              className="mt-1"
              onClick={() => void recheckVerification()}
            >
              我已完成验证，重新检查
            </TFButton>
          </TFCard>
        ) : null}

        {notice ? (
          <p role="status" className="mt-3 text-center text-caption text-brand-600">
            {notice}
          </p>
        ) : null}

        <div className="my-6 flex items-center gap-3 text-caption text-content-subtle">
          <span className="h-px flex-1 bg-border" />
          或
          <span className="h-px flex-1 bg-border" />
        </div>

        {/*
          Google 快捷登录.

          This replaced two permanently-disabled buttons that revealed 「即将上线」
          only after a tap. The component fetches which providers this deployment
          actually offers and renders nothing for the rest, so a live-looking
          control can never lead to a provider that is not configured.
        */}
        <OAuthButtons redirectTo="/discover" verb="登录" className="flex flex-col gap-2" />

        <p className="mt-6 text-center text-ui text-content-muted">
          还没有账号？{" "}
          <Link href="/register" className="font-medium text-brand-600">
            立即注册
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
