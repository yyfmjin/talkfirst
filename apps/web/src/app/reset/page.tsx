"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TFButton, TFInput } from "@/components/tf";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * FEATURE (post-audit) — password recovery.
 *
 * The product had no recovery path at all: a user who forgot their password
 * could only be rescued by an administrator with database access, and the login
 * screen offered nothing but "还没有账号？立即注册". This screen plus
 * `POST /auth/password/forgot` and `POST /auth/password/reset` close that hole.
 *
 * ## Why everything is on one screen
 *
 * The server takes an e-mail + a 6-digit code + the new password in a single
 * call, so a two-step wizard would be local state pretending to be a protocol —
 * and the intermediate "we sent a code" screen is exactly where users get stuck
 * (wrong address, code never arrived, tab closed). Here the address, the code
 * field and the new password are visible together, with an explicit
 * 「发送验证码」 action, so a user who mistyped their address can fix it and
 * re-send without losing their place.
 *
 * ## Why success goes to /login instead of signing the user in
 *
 * The API revokes every refresh token on a successful reset — that is the point
 * of a reset — and deliberately issues no session. Sending the user to the
 * sign-in form makes the new credential prove itself exactly like any other
 * login, which is also what keeps the reset auditable as a normal sign-in in the
 * security log.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedEmail = email.trim().toLowerCase();

  // Resend cooldown mirror of the server's 60s per-address budget, so the button
  // does not invite a request the server will refuse.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    setError("");
    setNotice("");
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    setSending(true);
    try {
      await apiFetch("/auth/password/forgot", {
        method: "POST",
        body: { email: normalizedEmail },
      });
      // The API answers identically for every address on purpose, so this copy
      // must not imply that an account was found.
      setNotice("如果该邮箱已注册，我们已发送 6 位验证码，请查收（含垃圾邮件箱）。");
      setCooldown(60);
      codeInputRef.current?.focus();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "验证码发送失败，请稍后再试。");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位数字验证码。");
      return;
    }
    if (password.length < 8) {
      setError("新密码至少 8 位。");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/auth/password/reset", {
        method: "POST",
        body: { email: normalizedEmail, code: code.trim(), newPassword: password },
      });
      setDone(true);
    } catch (requestError) {
      // CODE_LOCKED in particular is worth distinguishing: the user has to ask
      // for a fresh code rather than keep guessing this one.
      if (requestError instanceof ApiRequestError && requestError.code === "CODE_LOCKED") {
        setError("验证码尝试次数过多，请重新发送验证码。");
      } else {
        setError(requestError instanceof Error ? requestError.message : "重置失败，请稍后再试。");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-8">
        <div className="mb-6 flex justify-center">
          <LogoMark size={56} />
        </div>

        {done ? (
          <>
            <h1 className="text-center text-title font-semibold text-content">密码已重置</h1>
            <p className="mt-2 text-center text-ui leading-6 text-content-muted">
              为安全起见，其他设备上的登录已全部退出。请用新密码重新登录。
            </p>
            <TFButton className="mt-8" size="lg" fullWidth onClick={() => router.replace("/login")}>
              前往登录
            </TFButton>
          </>
        ) : (
          <>
            <h1 className="text-center text-title font-semibold text-content">重置密码</h1>
            <p className="mt-2 text-center text-ui leading-6 text-content-muted">
              用注册邮箱接收验证码，然后设置新密码。
            </p>

            <form className="mt-7 space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
              <div>
                <label
                  htmlFor="reset-email"
                  className="mb-1.5 block text-caption font-medium text-content-muted"
                >
                  注册邮箱
                </label>
                <TFInput
                  id="reset-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="请输入注册时使用的邮箱"
                  value={email}
                  invalid={Boolean(error)}
                  describedBy={error ? "reset-error" : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="reset-code"
                  className="mb-1.5 block text-caption font-medium text-content-muted"
                >
                  邮箱验证码
                </label>
                <div className="flex gap-2">
                  {/* `autoComplete="one-time-code"` lets iOS/Android offer the code
                      straight from the SMS/mail notification instead of making the
                      member switch apps and memorise six digits. */}
                  <TFInput
                    id="reset-code"
                    ref={codeInputRef}
                    value={code}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 位数字"
                    className="min-w-0 flex-1 tracking-[0.3em] placeholder:tracking-normal"
                    invalid={Boolean(error)}
                    describedBy={error ? "reset-error" : undefined}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  <TFButton
                    variant="secondary"
                    className="shrink-0"
                    disabled={sending || cooldown > 0}
                    loading={sending}
                    loadingLabel="发送中…"
                    onClick={() => void sendCode()}
                  >
                    {cooldown > 0 ? `${cooldown}s 后可重发` : "发送验证码"}
                  </TFButton>
                </div>
              </div>

              <div>
                <label
                  htmlFor="reset-password"
                  className="mb-1.5 block text-caption font-medium text-content-muted"
                >
                  新密码
                </label>
                <TFInput
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  value={password}
                  invalid={Boolean(error)}
                  describedBy={error ? "reset-error" : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="reset-confirm"
                  className="mb-1.5 block text-caption font-medium text-content-muted"
                >
                  确认新密码
                </label>
                <TFInput
                  id="reset-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入新密码"
                  value={confirm}
                  invalid={Boolean(error)}
                  describedBy={error ? "reset-error" : undefined}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </div>

              {error ? (
                <p id="reset-error" className="break-words text-caption text-danger-600" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="break-words text-caption text-content-muted" role="status">
                  {notice}
                </p>
              ) : null}

              <TFButton
                type="submit"
                size="lg"
                fullWidth
                className="mt-1"
                loading={submitting}
                loadingLabel="重置中…"
              >
                重置密码
              </TFButton>
            </form>

            <p className="mt-6 text-center text-ui text-content-muted">
              想起来了？{" "}
              <Link href="/login" className="font-medium text-brand-600">
                返回登录
              </Link>
            </p>
          </>
        )}
      </div>
    </PhoneShell>
  );
}
