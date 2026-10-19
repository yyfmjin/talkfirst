"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton, TFInput } from "@/components/tf";
import { ApiRequestError, apiFetch, fetchAuthMethods } from "@/lib/api";
import { useT, type MsgKey } from "@/lib/i18n";

/**
 * 修改密码 —— 或者，对没有密码的账号，设置第一个密码。
 *
 * ## The dead end this screen used to have
 *
 * A Google-only account has `passwordHash === null`. The form required
 * 「当前密码」 on the client, so a member who signed up with Google could never
 * give their account a password — and if they later wanted to stop using Google,
 * they had no way in at all. The API has supported the first-time case since
 * `passwordHash` became nullable (`changePassword` verifies the old password only
 * when one exists); the screen was the part that made it unreachable.
 *
 * ## How the screen knows which case it is in
 *
 * `GET /auth/oauth/me/methods` reports `hasPassword`. It is read once on mount and
 * the form adapts:
 *
 *  - **has a password** — current password required, exactly as before;
 *  - **has none** — the field is not rendered at all, and the copy says what is
 *    happening. The API ignores `currentPassword` in that case, so nothing is sent
 *    that could be mistaken for a credential.
 *
 * While the answer is unknown the submit button stays disabled rather than
 * assuming: guessing "has a password" would show a field that cannot be filled,
 * and guessing the opposite would hide one that is required.
 */

type Mode = "loading" | "set" | "change";

/**
 * The route's own refusal codes, in Chinese.
 *
 * `friendlyErrorMessage` is not used here: it falls back to the API's own
 * `error.message`, and this route's messages are English ("Current password is
 * incorrect"). `npm run test -w @talkfirst/web` scans UI copy for stray English,
 * so an unmapped code would surface a raw English sentence in a Chinese form.
 * Every code this endpoint can answer with is mapped instead, and an unmapped one
 * degrades to a Chinese sentence rather than to the API's English.
 */
const PASSWORD_ERROR_KEY: Record<string, MsgKey> = {
  PASSWORD_MISMATCH: "me.pwErrMismatch",
  PASSWORD_UNCHANGED: "me.pwErrUnchanged",
  INVALID_CREDENTIALS: "me.pwErrCurrent",
  VALIDATION_ERROR: "me.pwErrLength",
  USER_SUSPENDED: "me.pwErrSuspended",
  USER_BANNED: "me.pwErrBanned",
  UNAUTHORIZED: "me.pwErrExpired",
};

function passwordErrorMessage(error: unknown, t: (key: MsgKey) => string): string {
  if (error instanceof ApiRequestError) {
    const key = PASSWORD_ERROR_KEY[error.code];
    return key ? t(key) : t("me.pwErrSave");
  }
  return t("me.pwErrSave");
}

export default function ChangePasswordPage() {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>("loading");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchAuthMethods()
      .then((methods) => {
        if (alive) setMode(methods.hasPassword ? "change" : "set");
      })
      .catch(() => {
        /**
         * Could not tell. Falling back to "change" is the safe direction: it asks
         * for the current password, so a member who HAS one is not offered a form
         * that would silently act without proving it. Someone with no password
         * sees an error they cannot act on — annoying, and better than the
         * alternative, but it is why the failure is surfaced rather than swallowed.
         */
        if (alive) {
          setMode("change");
          setError(t("me.pwErrMethods"));
        }
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const settingFirstPassword = mode === "set";

  async function handleSubmit() {
    setError("");
    setSuccess("");
    /**
     * Only enforced when a current password exists. For a first-time set the API
     * ignores this field entirely, so requiring it would block the one request
     * that can give the account a password.
     */
    if (!settingFirstPassword && !currentPassword) {
      setError(t("me.pwErrEnterCurrent"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("me.pwErrMin8"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("me.pwErrMismatch"));
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/password", {
        method: "POST",
        body: {
          /**
           * `currentPassword` is always SENT, because the route's DTO requires a
           * non-empty string (`@MinLength(1)`) — the register/reset flows share
           * that DTO shape. When the account has no password its VALUE is never
           * read: `changePassword` compares it only if a hash exists on the row.
           *
           * A placeholder on the wire is not the same as a fabricated credential:
           * nothing is stored, and the field is ignored end to end. It exists so
           * one request can satisfy one DTO without the API growing a second
           * endpoint for a case it already handles.
           */
          currentPassword: currentPassword || "-",
          newPassword,
          confirmPassword,
        },
      });
      /**
       * The account now has a password, so the mode changes with it: leaving the
       * copy saying 「设置密码」 after a successful set would invite a second
       * pointless attempt.
       */
      setMode("change");
      setSuccess(t(settingFirstPassword ? "me.pwDoneSet" : "me.pwDoneChange"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(passwordErrorMessage(requestError, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader
        title={t(settingFirstPassword ? "me.pwTitleSet" : "me.pwTitleChange")}
        backHref="/me"
      />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-6">
        <p className="mb-5 text-caption leading-5 text-content-muted">
          {t(settingFirstPassword ? "me.pwIntroSet" : "me.pwIntroChange")}
        </p>

        {/* A real `<form>` so Enter submits — a password change is exactly the
            place a keyboard user expects that to work. Each field has a proper
            `<label for>`, and the two new-password fields use
            `autoComplete="new-password"` so a manager offers to generate one
            instead of autofilling the current password into them. */}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          noValidate
        >
          {settingFirstPassword ? null : (
            <div>
              <label htmlFor="pw-current" className="mb-1.5 block text-caption font-medium text-content-muted">
                {t("me.pwCurrent")}
              </label>
              <TFInput
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                invalid={Boolean(error)}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="pw-new" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t(settingFirstPassword ? "me.pwFirstWithLen" : "me.pwNewWithLen")}
            </label>
            <TFInput
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              invalid={Boolean(error)}
              describedBy={error ? "pw-error" : "pw-hint"}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="pw-confirm" className="mb-1.5 block text-caption font-medium text-content-muted">
              {t(settingFirstPassword ? "me.pwConfirmFirst" : "me.pwConfirm")}
            </label>
            <TFInput
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              invalid={Boolean(error)}
              describedBy={error ? "pw-error" : "pw-hint"}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>

          <p id="pw-hint" className="text-caption leading-4 text-content-subtle">
            {t("me.pwHint")}
          </p>

          {success ? (
            <p data-testid="password-success" role="status" className="text-caption text-success-600">
              {success}
            </p>
          ) : null}
          {error ? (
            <p id="pw-error" role="alert" className="break-words text-caption text-danger-600">
              {error}
            </p>
          ) : null}

          {/*
            `disabled` while the account's login methods are still unknown — see
            `Mode`. Kept as a JSX comment (not `//` inside the tag) because
            `scripts/tf-prop-check.mjs` scans tag content without skipping comments,
            so English prose in there is reported as undeclared props.
          */}
          <TFButton
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            loadingLabel={t(settingFirstPassword ? "me.pwLoadingSet" : "me.pwLoadingChange")}
            disabled={mode === "loading"}
            data-testid="password-submit"
          >
            {t(settingFirstPassword ? "me.pwSubmitSet" : "me.pwSubmitChange")}
          </TFButton>
        </form>
      </div>
    </PhoneShell>
  );
}
