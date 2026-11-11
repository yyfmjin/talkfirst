"use client";

import { useEffect, useState } from "react";
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
 * 注册被拒时的文案，按错误码取词典键。
 *
 * `EMAIL_TAKEN` 原来**故意**不在这里 —— 它一直是把接口的英文原句直接显示出来。
 * 2026-10-08 改掉了：线上真有人撞上它，而一个中文界面里冒出一句英文，用户只会得到
 * 「注册/登录失败」这种模糊印象，根本不知道下一步该干什么。
 *
 * 仍然只列**已知**的码：未知错误直接显示服务端的话，比盖成一句模糊的失败更有用。
 */
const REGISTER_ERROR_KEYS: Record<string, MsgKey> = {
  USERNAME_TAKEN: "auth.errorUsernameTaken",
  EMAIL_TAKEN: "auth.errorEmailTaken",
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
  /*
   * 18 岁以上必须是**用户主动勾的**，不能只有一行说明文字。
   * Play 对含用户生成内容、且目标受众标为 18+ 的应用，会看注册流程里
   * 有没有可核查的年龄确认；移动端一开始就是勾选框，web 端这里补齐。
   */
  const [adult, setAdult] = useState(false);
  /**
   * 「这个邮箱注册过吗」的实时结论（2026-11-11）。
   *
   * 背景：有用户用早就注册过的邮箱重新注册，结果验证码收不到、也不知道自己本来就有
   * 账号。后端已改成拒绝给已验证邮箱发注册码（见 `auth.controller.ts`），但前端也不该
   * 等到提交后才说 —— 输入停下来就问一次，结果直接摆在输入框下面。
   */
  const [emailStatus, setEmailStatus] = useState<
    "idle" | "checking" | "available" | "registered" | "unverified"
  >("idle");

  /**
   * 停 500ms 就问一次。只在邮箱格式合法时问，避免把半截地址打成请求；
   * `alive` 守卫防慢响应覆盖新输入的结果；查不到就回到 idle —— 不下结论，
   * 让用户照常提交，由注册接口给出最终答案。
   */
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailStatus("idle");
      return;
    }
    let alive = true;
    setEmailStatus("checking");
    const timer = window.setTimeout(() => {
      void apiFetch<{ status: "AVAILABLE" | "REGISTERED" | "UNVERIFIED" }>("/auth/email-check", {
        method: "POST",
        body: { email: trimmed },
      })
        .then((data) => {
          if (!alive) return;
          setEmailStatus(
            data.status === "AVAILABLE"
              ? "available"
              : data.status === "REGISTERED"
                ? "registered"
                : "unverified",
          );
        })
        .catch(() => {
          if (alive) setEmailStatus("idle");
        });
    }, 500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [email]);
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
    // 已经查出来是注册过的，就别再让请求跑一趟（后端也会拒，但没必要来回）。
    if (emailStatus === "registered") {
      setError(t("auth.errorEmailTaken"));
      return;
    }
    /**
     * 注册过但没验证：同样在本地拦下。否则会被服务端拒成 EMAIL_TAKEN，而这个账号
     * 其实还等着他去验证 —— 提示「直接登录」会把他送到一个他还进不去的门口。
     */
    if (emailStatus === "unverified") {
      setError(t("auth.emailUnverifiedInline"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.errorPasswordMin8"));
      return;
    }
    if (!adult) {
      setError(t("auth.adultRequired"));
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
      router.push(localePath(locale, "/verify"));
    } catch (requestError) {
      const mapped =
        requestError instanceof ApiRequestError
          ? REGISTER_ERROR_KEYS[requestError.code ?? ""]
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
            {emailStatus === "registered" ? (
              <p data-testid="email-registered" className="mt-1.5 text-caption leading-5 text-danger-600">
                {t("auth.emailRegisteredInline")}{" "}
                <Link href={localePath(locale, "/login")} className="underline underline-offset-2">
                  {t("auth.login")}
                </Link>
                {" · "}
                <Link href={localePath(locale, "/reset")} className="underline underline-offset-2">
                  {t("auth.forgotPassword")}
                </Link>
              </p>
            ) : null}
            {emailStatus === "unverified" ? (
              <p data-testid="email-unverified" className="mt-1.5 text-caption leading-5 text-content-muted">
                {t("auth.emailUnverifiedInline")}{" "}
                <Link href={localePath(locale, "/verify")} className="underline underline-offset-2">
                  {t("auth.continueVerify")}
                </Link>
              </p>
            ) : null}
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
          <label className="flex cursor-pointer items-start gap-2 text-caption leading-5 text-content-muted">
            <input
              type="checkbox"
              checked={adult}
              onChange={(event) => {
                setAdult(event.target.checked);
                if (event.target.checked) setError("");
              }}
              className="mt-0.5 size-4 shrink-0 accent-brand-600"
            />
            <span>{t("auth.adultConfirm")}</span>
          </label>
          <p id="register-hint" className="text-caption leading-4 text-content-subtle">
            {t("auth.termsHint")}
            <Link href={localePath(locale, "/legal/rules")} className="font-medium text-brand-600">
              {t("site.legalRules")}
            </Link>
            {t("auth.termsSuffix")}
          </p>
          {error ? (
            <p id="register-error" role="alert" className="break-words text-caption text-danger-600">
              {error}
            </p>
          ) : null}

          <TFButton type="submit" size="lg" fullWidth loading={loading} loadingLabel={t("auth.registering")} disabled={!adult} className="mt-1">
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
