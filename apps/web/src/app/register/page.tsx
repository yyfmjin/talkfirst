"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TFInput, TFButton } from "@/components/tf";
import { OAuthButtons } from "@/components/oauth-buttons";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { localePath, useT, type MsgKey } from "@/lib/i18n";
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
 * `USERNAME_RESERVED`) are mapped to member copy below, because the API's own
 * messages are English and this screen renders whatever the server said. Since
 * 2026-10-08 that copy lives in the dictionary and this page is bilingual — see
 * `login/page.tsx` for the same pattern and the same caveat about links to pages
 * that do not have an English route yet.
 */

/**
 * The account-name refusals, as dictionary keys.
 *
 * `EMAIL_TAKEN` is deliberately NOT in this map: it has always reached the screen
 * as the API's English string, and changing that is a separate copy cleanup rather
 * than part of adding an account name. Adding only the new codes keeps this file
 * honest about what it does rather than pretending to be a general mapping.
 */
const USERNAME_ERROR_KEYS: Record<string, MsgKey> = {
  USERNAME_TAKEN: "auth.errorUsernameTaken",
  USERNAME_RESERVED: "auth.errorUsernameReserved",
  USERNAME_INVALID: "auth.errorUsernameFormat",
};

export default function RegisterPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const { locale, t } = useT();
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
      setError(t("auth.errorInvalidEmail"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.errorPasswordMin8"));
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
      setError(t("auth.errorUsernameFormat"));
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
          ? USERNAME_ERROR_KEYS[requestError.code ?? ""]
          : undefined;
      setError(
        mapped
          ? t(mapped)
          : requestError instanceof ApiRequestError
            ? requestError.message
            : t("auth.errorRegisterFailed"),
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
        <h1 className="text-center text-title font-semibold text-content">{t("auth.createAccount")}</h1>
        <p className="mt-1.5 text-center text-ui text-content-muted">{t("auth.registerSubtitle")}</p>

        <form className="mt-7 space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div>
            <label htmlFor="register-email" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t("auth.email")}
            </label>
            <TFInput
              id="register-email"
              type="email"
              inputMode="email"
              // "email", not "username": the account-name field below now claims
              // that hint, and two fields advertising the same autofill target is
              // how a password manager ends up filling the wrong one.
              autoComplete="email"
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              invalid={Boolean(error)}
              describedBy={error ? "register-error" : "register-hint"}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="register-username" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t("auth.usernameLabel")}
            </label>
            <TFInput
              id="register-username"
              type="text"
              autoComplete="username"
              placeholder={t("auth.usernamePlaceholder")}
              value={username}
              invalid={Boolean(error)}
              describedBy={error ? "register-error" : "register-hint"}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="register-password" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t("auth.passwordLabel")}
            </label>
            <TFInput
              id="register-password"
              type="password"
              autoComplete="new-password"
              placeholder={t("auth.passwordMin8")}
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
            {t("auth.termsHint")}
            {/* 社区规则页还没双语化 —— 英文站暂时也去中文页，不要改成 localePath()。 */}
            <Link href="/legal/rules" className="font-medium text-brand-600">
              {t("site.legalRules")}
            </Link>
            {t("auth.termsSuffix")}
          </p>
          {error ? (
            <p id="register-error" role="alert" className="break-words text-caption text-danger-600">
              {error}
            </p>
          ) : null}

          <TFButton type="submit" size="lg" fullWidth loading={loading} loadingLabel={t("auth.registering")} className="mt-1">
            {t("auth.register")}
          </TFButton>
        </form>

        <div className="my-6 flex items-center gap-3 text-caption text-content-subtle">
          <span className="h-px flex-1 bg-border" />
          {t("auth.orOAuthRegister")}
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
        <OAuthButtons redirectTo="/discover" verbKey="auth.register" className="flex flex-col gap-2" />

        <p className="mt-6 text-center text-ui text-content-muted">
          {t("auth.haveAccount")}{" "}
          <Link href={localePath(locale, "/login")} className="font-medium text-brand-600">
            {t("auth.toLogin")}
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
