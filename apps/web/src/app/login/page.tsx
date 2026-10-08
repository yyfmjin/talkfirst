"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TFCard, TFInput, TFButton } from "@/components/tf";
import { OAuthButtons, oauthErrorMessage } from "@/components/oauth-buttons";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { localePath, useT } from "@/lib/i18n";
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
 *
 * ## 双语（2026-10-08）
 *
 * 文案搬进了词典（`lib/i18n/dictionary.ts`）—— 包括 `test/smoke.test.mjs` 与
 * `test/email-verification.test.mjs` 盯过的那几条（`欢迎回来`、`邮箱`、`邮箱尚未验证`、
 * `验证码`）：它们的断言跟着搬到词典去断言，而不是把中文串硬留在这里。
 *
 * 语言由**路径**决定（`useT()`，见 `lib/i18n/use-locale.ts`）：本页在 `/login` 是中文、
 * 在 `/en/login` 是英文（后者是一个只做转出的两行文件）。
 *
 * 指向**自己兄弟页**（注册）的链接用 `localePath()`，所以英文站会去 `/en/register`；
 * 指向**还没双语化**的页面的链接（找回密码、邮箱验证、登录后的发现页）暂时留着
 * 中文路径 —— 那些页还没有英文版。**不要**把它们改成 `localePath()`，那会变成 404。
 */
export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const { locale, t } = useT();
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
    const message = oauthErrorMessage(params, locale);
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
      setError(t("auth.errorVerificationEmailOnly"));
      return;
    }
    try {
      await apiFetch("/auth/send-verification-code", {
        method: "POST",
        body: { email: normalizedIdentifier },
      });
      setNotice(t("auth.noticeCodeSent"));
    } catch {
      setError(t("auth.errorCodeSendFailed"));
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
    setNotice(t("auth.noticeVerificationPending"));
    router.push("/verify");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setNeedsVerification(false);
    const trimmed = normalizedIdentifier;
    if (!trimmed || !password) {
      setError(t("auth.errorMissingIdentifier"));
      return;
    }
    /**
     * Only the e-mail branch is shape-checked here. An account name's rules
     * (`[a-z0-9]`, 8-30, reserved words) live on the server, which is the only
     * authority — a second copy here would drift, and a drifted copy refuses
     * names the server accepts.
     */
    if (looksLikeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("auth.errorInvalidEmail"));
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
        setError(t("auth.errorEmailNotVerified"));
      } else if (
        requestError instanceof ApiRequestError &&
        requestError.code === "INVALID_CREDENTIALS"
      ) {
        /*
         * 接口给的是英文原文（`Email, username or password is incorrect`），摆在中文
         * 界面里很突兀 —— 所以按语言换掉它。其它未知错误码仍直接显示服务端的话：
         * 宁可让人看到一句不准的英文，也不要把他真正的错误盖成一个模糊的“失败”。
         */
        setError(t("auth.errorInvalidCredentials"));
      } else {
        setError(
          requestError instanceof ApiRequestError ? requestError.message : t("auth.errorSignInFailed"),
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
        <h1 className="text-center text-title font-semibold text-content">{t("auth.welcomeBack")}</h1>
        <p className="mt-1.5 text-center text-ui text-content-muted">{t("auth.loginSubtitle")}</p>

        <form className="mt-7 space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div>
            {/*
              The label still reads 「邮箱或用户名」 in Chinese: the E2E helper
              `test/fixtures/browser.ts` signs in with `getByLabel("邮箱或用户名")` — an
              EXACT match — and that helper is the entry point for nearly every
              authenticated spec. The string now lives in the dictionary (with the
              assertions in `test/smoke.test.mjs`); running E2E against the English
              route would need the English label, which is a separate decision about
              which language E2E runs in.
            */}
            <label htmlFor="login-identifier" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t("auth.identifierLabel")}
            </label>
            <TFInput
              id="login-identifier"
              // `type="text"`, not `type="email"`: the field legitimately holds an
              // account name, and the email type would have the browser reject it
              // before the request is ever sent.
              type="text"
              autoComplete="username"
              placeholder={t("auth.identifierPlaceholder")}
              value={identifier}
              invalid={Boolean(error) && !needsVerification}
              describedBy={error && !needsVerification ? "login-error" : undefined}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t("auth.passwordLabel")}
            </label>
            <TFInput
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder={t("auth.passwordPlaceholder")}
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

          <TFButton type="submit" size="lg" fullWidth loading={loading} loadingLabel={t("auth.loggingIn")} className="mt-1">
            {t("auth.login")}
          </TFButton>
        </form>

        {/* FEATURE (post-audit): password recovery. Until this existed, a user who
            forgot their password had no way back into their account at all. */}
        <p className="mt-3 text-center text-ui">
          <Link href="/reset" className="font-medium text-brand-600">
            {t("auth.forgotPassword")}
          </Link>
        </p>

        {needsVerification ? (
          <TFCard tone="brand" className="mt-4">
            <p className="text-center text-caption leading-5 text-content-muted">{t("auth.verifyToSignIn")}</p>
            <TFButton
              variant="secondary"
              size="sm"
              fullWidth
              className="mt-3"
              onClick={() => void resendVerification()}
            >
              {t("auth.resendVerification")}
            </TFButton>
            <TFButton
              variant="ghost"
              size="sm"
              fullWidth
              className="mt-1"
              onClick={() => void recheckVerification()}
            >
              {t("auth.recheckVerification")}
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
          {t("auth.or")}
          <span className="h-px flex-1 bg-border" />
        </div>

        {/*
          Google 快捷登录.

          This replaced two permanently-disabled buttons that revealed 「即将上线」
          only after a tap. The component fetches which providers this deployment
          actually offers and renders nothing for the rest, so a live-looking
          control can never lead to a provider that is not configured.
        */}
        <OAuthButtons redirectTo="/discover" verbKey="auth.login" className="flex flex-col gap-2" />

        <p className="mt-6 text-center text-ui text-content-muted">
          {t("auth.noAccount")}{" "}
          <Link href={localePath(locale, "/register")} className="font-medium text-brand-600">
            {t("auth.toRegister")}
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
