"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/api";

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
  /** `使用 Google` — the action is appended per screen. */
  name: string;
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
  google: { id: "google", name: "使用 Google", glyph: "G" },
  local: { id: "local", name: "本地开发登录（假）", glyph: "L" },
};

export function OAuthButtons({
  /** Where to land after a successful sign-in; passed through to the API. */
  redirectTo,
  /** `登录` or `注册` — the only difference between the two screens. */
  verb = "登录",
  className,
}: {
  redirectTo?: string;
  verb?: string;
  className?: string;
}) {
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

        return (
          <a
            key={provider.id}
            href={start.toString()}
            data-testid={`oauth-${provider.id}`}
            // `rel="nofollow"` because this is an action, not a page to index.
            rel="nofollow"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-ui font-medium text-content transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span
              aria-hidden="true"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-overline font-semibold"
            >
              {provider.glyph}
            </span>
            {provider.name}
            {verb}
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
const OAUTH_ERROR_TEXT: Record<string, string> = {
  OAUTH_PROVIDER_DISABLED: "该登录方式当前不可用，请使用邮箱登录。",
  OAUTH_TOKEN_INVALID: "Google 返回的登录凭据无法验证，请重新尝试。",
  OAUTH_STATE_INVALID: "这次登录已超时或不是从这里发起的，请重新点击登录。",
  OAUTH_EXCHANGE_FAILED: "与 Google 的通信失败，请稍后重试。",
  OAUTH_NONCE_MISMATCH: "这次登录校验失败，请重新尝试。",
  OAUTH_EMAIL_UNVERIFIED:
    "Google 报告该邮箱尚未验证，无法用它登录。请先在 Google 账号中完成邮箱验证，或改用邮箱注册。",
  OAUTH_EMAIL_REQUIRED: "Google 没有提供邮箱地址，无法用它创建账号。请改用邮箱注册。",
  OAUTH_FAILED: "快捷登录失败，请稍后重试或改用邮箱登录。",
};

/**
 * `OAUTH_ACCOUNT_EXISTS` is special: it is the one refusal with a next step that
 * depends on the account. Telling someone to "use your password" when the account
 * has none is the dead end this code exists to avoid, so the message is built
 * from the flags the API sent back.
 */
export function oauthErrorMessage(searchParams: URLSearchParams): string {
  const code = searchParams.get("oauth_error");
  if (!code) return "";

  if (code === "OAUTH_ACCOUNT_EXISTS") {
    const hasPassword = searchParams.get("oauth_has_password") === "true";
    const providers = (searchParams.get("oauth_providers") ?? "").split(",").filter(Boolean);

    if (hasPassword) {
      return "该邮箱已经注册过。请用邮箱和密码登录，然后可以在设置里绑定 Google。";
    }
    if (providers.includes("GOOGLE")) {
      return "该邮箱已经用 Google 注册过。请直接用 Google 登录。";
    }
    return "该邮箱已经注册过。请用邮箱登录，或先通过「忘记密码」设置一个密码。";
  }

  return OAUTH_ERROR_TEXT[code] ?? OAUTH_ERROR_TEXT.OAUTH_FAILED;
}

/** True when the URL carries an OAuth refusal, for the page's error slot. */
export function hasOAuthError(searchParams: URLSearchParams): boolean {
  return Boolean(searchParams.get("oauth_error"));
}
