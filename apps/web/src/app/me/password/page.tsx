"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton, TFInput } from "@/components/tf";
import { ApiRequestError, apiFetch, fetchAuthMethods } from "@/lib/api";

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
const PASSWORD_ERROR_TEXT: Record<string, string> = {
  PASSWORD_MISMATCH: "两次输入的新密码不一致。",
  PASSWORD_UNCHANGED: "新密码不能与当前密码相同。",
  INVALID_CREDENTIALS: "当前密码不正确。",
  VALIDATION_ERROR: "新密码长度需为 8-72 个字符。",
  USER_SUSPENDED: "账号当前处于受限状态，暂时无法修改密码。",
  USER_BANNED: "账号已被封禁，暂时无法修改密码。",
  UNAUTHORIZED: "登录状态已过期，请重新登录。",
};

function passwordErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return PASSWORD_ERROR_TEXT[error.code] ?? "保存失败，请稍后再试";
  }
  return "保存失败，请稍后再试";
}

export default function ChangePasswordPage() {
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
          setError("读取账号登录方式失败，请刷新页面后重试。");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

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
      setError("请输入当前密码。");
      return;
    }
    if (newPassword.length < 8) {
      setError("新密码至少 8 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
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
      setSuccess(settingFirstPassword ? "密码已设置，之后可以用邮箱和密码登录。" : "密码已修改。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(passwordErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title={settingFirstPassword ? "设置密码" : "修改密码"} backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-6">
        <p className="mb-5 text-caption leading-5 text-content-muted">
          {settingFirstPassword
            ? "你的账号是通过 Google 创建的，目前还没有密码。设置之后，你也可以用邮箱和密码登录。"
            : "修改成功后，其他设备会被登出，需要重新登录。当前设备会保持登录状态。"}
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
                当前密码
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
              {settingFirstPassword ? "密码（8-72 字符）" : "新密码（8-72 字符）"}
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
              {settingFirstPassword ? "确认密码" : "确认新密码"}
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
            密码长度 8-72 个字符，建议混用大小写字母、数字和符号。
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
            loadingLabel={settingFirstPassword ? "设置中…" : "修改中…"}
            disabled={mode === "loading"}
            data-testid="password-submit"
          >
            {settingFirstPassword ? "设置密码" : "确认修改"}
          </TFButton>
        </form>
      </div>
    </PhoneShell>
  );
}
