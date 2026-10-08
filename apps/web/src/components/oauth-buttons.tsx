"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { t, useT, type Locale, type MsgKey } from "@/lib/i18n";

/**
 * Google 快捷登录按钮。
 *
 * ## Why the button is a LINK, not a fetch
 *
 * The authorization-code flow is a browser navigation: the provider has to show
 * its own consent screen at its own origin. A `fetch` could not do that (the
 * response is an opaque cross-origin document), so the button is an anchor to our
 * own `/auth/oauth/google/start`, and the API answers with a 302 to Google.
 *
 * ## Why the provider list is fetched rather than assumed
 *
 * The previous implementation rendered two permanently-disabled buttons with a
 * 「即将上线」 note. That is a control that looks available and is not, and it
 * also lies in the other direction once the feature ships: on a deployment whose
 * Google credentials are missing, a live-looking button would send the user to a
 * provider that answers `OAUTH_PROVIDER_DISABLED`. So the list comes from the API
 * and nothing is rendered for a provider this deployment cannot actually offer.
 *
 * ## Failure to load the list is silent, on purpose
 *
 * If `GET /auth/oauth/providers` fails, email sign-in still works and the screen
 * must not gain an error banner about a *secondary* login method. Rendering
 * nothing is the honest outcome: we do not know that Google is available, so we
 * do not offer it.
 */

type Provider = {
  id: string;
  /**
   * 按钮文案的词典键。**整句**（不是「使用 Google」这种半句）：英文的语序是
   * 「Log in with Google」，中文是「使用 Google登录」—— 拼字符串等于把中文语序
   * 焊进代码，所以用 `{verb}` 占位、两种语言各自决定词序。
   */
  labelKey: MsgKey;
  /** 这个提供方需不需要拼上「登录 / 注册」这个动作词。 */
  usesVerb: boolean;
  /** Shown in the badge; kept in the API's vocabulary, not here. */
  glyph: string;
};

/**
 * Presentation for the provider ids the API can return.
 *
 * `local` is the development stand-in. It is deliberately visible when enabled —
 * a developer needs to know they are about to sign in as a fake account, and the
 * API refuses to enable it outside development — but it is labelled so nobody
 * mistakes it for Google.
 */
const PROVIDER_PRESENTATION: Record<string, Provider> = {
  google: { id: "google", labelKey: "auth.oauthGoogle", usesVerb: true, glyph: "G" },
  local: { id: "local", labelKey: "auth.oauthLocal", usesVerb: false, glyph: "L" },
};

export function OAuthButtons({
  /** Where to land after a successful sign-in; passed through to the API. */
  redirectTo,
  /**
   * `auth.login` 或 `auth.register` —— 两个页面唯一的差别就是这个动作词。
   * 传**词典键**而不是中文串：语言切换后按钮要跟着变。
   */
  verbKey = "auth.login",
  className,
}: {
  redirectTo?: string;
  verbKey?: MsgKey;
  className?: string;
}) {
  const { t } = useT();
  const [providers, setProviders] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void apiFetch<{ providers: string[] }>("/auth/oauth/providers")
      .then((data) => {
        if (alive) setProviders(data.providers ?? []);
      })
      .catch(() => {
        // See the module comment: silence is the correct degradation here.
        if (alive) setProviders([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // `null` means the list has not arrived yet. Rendering nothing avoids the
  // button appearing and then vanishing, which is its own kind of lie.
  if (!providers || providers.length === 0) return null;

  const offered = providers
    .map((id) => PROVIDER_PRESENTATION[id])
    .filter((entry): entry is Provider => Boolean(entry));

  if (offered.length === 0) return null;

  return (
    <div className={className}>
      {offered.map((provider) => {
        /**
         * Built from `API_BASE_URL` because the API is a different origin in
         * development (`:4000` vs `:3000`). The link must be absolute: a relative
         * `/api/...` would hit the Next.js server, which has no such route.
         */
        const start = new URL(`${API_BASE_URL}/auth/oauth/${provider.id}/start`);
        if (redirectTo) start.searchParams.set("redirectTo", redirectTo);

        /**
         * `rel="nofollow"` because this is an action, not a page to index.
         *
         * Note for future edits: this comment is a BLOCK comment placed OUTSIDE the
         * tag. A `//` comment inside a JSX opening tag is still scanned as tag
         * content by `scripts/tf-prop-check.mjs`, which does not skip comments — so
         * its English prose gets read as prop names and reported as undeclared
         * (`does not declare "because"`). Keeping it out here costs nothing.
         */
        return (
          <a
            key={provider.id}
            href={start.toString()}
            data-testid={`oauth-${provider.id}`}
            rel="nofollow"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-ui font-medium text-content transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span
              aria-hidden="true"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-overline font-semibold"
            >
              {provider.glyph}
            </span>
            {t(provider.labelKey, provider.usesVerb ? { verb: t(verbKey) } : undefined)}
          </a>
        );
      })}
    </div>
  );
}

/**
 * Turn the API's OAuth refusal codes into member-facing copy.
 *
 * The codes are the contract (`OAuthError` in the API), and the wording lives
 * here so the API never ships Chinese presentation strings. Same arrangement as
 * `lib/errors.ts`, but separate because these arrive as a QUERY PARAMETER on a
 * redirect rather than in an error envelope — a browser navigation cannot read a
 * JSON body.
 */
const OAUTH_ERROR_KEYS: Record<string, MsgKey> = {
  OAUTH_PROVIDER_DISABLED: "auth.oauthError.OAUTH_PROVIDER_DISABLED",
  OAUTH_TOKEN_INVALID: "auth.oauthError.OAUTH_TOKEN_INVALID",
  OAUTH_STATE_INVALID: "auth.oauthError.OAUTH_STATE_INVALID",
  OAUTH_EXCHANGE_FAILED: "auth.oauthError.OAUTH_EXCHANGE_FAILED",
  OAUTH_NONCE_MISMATCH: "auth.oauthError.OAUTH_NONCE_MISMATCH",
  OAUTH_EMAIL_UNVERIFIED: "auth.oauthError.OAUTH_EMAIL_UNVERIFIED",
  OAUTH_EMAIL_REQUIRED: "auth.oauthError.OAUTH_EMAIL_REQUIRED",
  OAUTH_FAILED: "auth.oauthError.OAUTH_FAILED",
};

/**
 * `OAUTH_ACCOUNT_EXISTS` is special: it is the one refusal with a next step that
 * depends on the account. Telling someone to "use your password" when the account
 * has none is the dead end this code exists to avoid, so the message is built
 * from the flags the API sent back.
 */
export function oauthErrorMessage(searchParams: URLSearchParams, locale: Locale): string {
  const code = searchParams.get("oauth_error");
  if (!code) return "";

  if (code === "OAUTH_ACCOUNT_EXISTS") {
    const hasPassword = searchParams.get("oauth_has_password") === "true";
    const providers = (searchParams.get("oauth_providers") ?? "").split(",").filter(Boolean);

    if (hasPassword) return t(locale, "auth.oauthError.OAUTH_ACCOUNT_EXISTS_PASSWORD");
    if (providers.includes("GOOGLE")) return t(locale, "auth.oauthError.OAUTH_ACCOUNT_EXISTS_GOOGLE");
    return t(locale, "auth.oauthError.OAUTH_ACCOUNT_EXISTS_OTHER");
  }

  return t(locale, OAUTH_ERROR_KEYS[code] ?? "auth.oauthError.OAUTH_FAILED");
}

/** True when the URL carries an OAuth refusal, for the page's error slot. */
export function hasOAuthError(searchParams: URLSearchParams): boolean {
  return Boolean(searchParams.get("oauth_error"));
}
