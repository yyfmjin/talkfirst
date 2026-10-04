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
 *
 *    P0-02 note: the label became 「邮箱或用户名」 and the request body became
 *    `{ identifier, password }`. All four pinned strings still hold — `邮箱` is
 *    still a substring of the new label, and the call signature is unchanged —
 *    but the SECOND pinned string moved: `test/fixtures/browser.ts` resolves the
 *    field with `getByLabel(...)`, so that one line had to be renamed with it.
 *    The label is an exact match there, so the two are not free to drift apart.
 */
export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const normalizedIdentifier = identifier.trim().toLowerCase();

  /**
   * `@` is the discriminator between the two things the field accepts (P0-02),
   * and it is unambiguous rather than a guess: an account name is `[a-z0-9]` by
   * rule, so a value containing `@` cannot be one.
   */
  const looksLikeEmail = normalizedIdentifier.includes("@");

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
    /**
     * This endpoint MAILS a code, so it needs an address. The sign-in field may
     * hold an account name, and answering 「验证码已重新发送」 in that case would be
     * a plain lie — the request could not have produced a code.
     */
    if (!looksLikeEmail) {
      setError("验证码只能发送到邮箱地址，请填写邮箱后重试。");
      return;
    }
    try {
      await apiFetch("/auth/send-verification-code", {
        method: "POST",
        body: { email: normalizedIdentifier },
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
    const trimmed = normalizedIdentifier;
    if (!trimmed || !password) {
      setError("请填写邮箱或账户名和密码。");
      return;
    }
    /**
     * Only the e-mail branch is shape-checked here. An account name's rules
     * (`[a-z0-9]`, 8-30, reserved words) live on the server, which is the only
     * authority — a second copy here would drift, and a drifted copy refuses
     * names the server accepts.
     */
    if (looksLikeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    setLoading(true);
    try {
      const user = await apiFetch<SessionUser>("/auth/login", {
        method: "POST",
        body: { identifier: trimmed, password },
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
            {/* The label keeps the substring 「邮箱」: `test/smoke.test.mjs` asserts
                it. `test/fixtures/browser.ts` signs in with
                `getByLabel("邮箱或用户名")` — an EXACT match — and that helper is
                the entry point for nearly every authenticated spec, so this
                string is not free to drift on its own. */}
            <label htmlFor="login-identifier" className="mb-1.5 block text-caption font-medium text-content-muted">
              邮箱或用户名
            </label>
            <TFInput
              id="login-identifier"
              // `type="text"`, not `type="email"`: the field legitimately holds an
              // account name, and the email type would have the browser reject it
              // before the request is ever sent.
              type="text"
              autoComplete="username"
              placeholder="请输入邮箱地址或账户名"
              value={identifier}
              invalid={Boolean(error) && !needsVerification}
              describedBy={error && !needsVerification ? "login-error" : undefined}
              onChange={(event) => setIdentifier(event.target.value)}
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
