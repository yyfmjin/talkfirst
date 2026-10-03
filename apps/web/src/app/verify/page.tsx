"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { TFButton } from "@/components/tf";
import { ScreenHeader } from "@/components/screen-header";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";
import { useSession, type SessionUser } from "@/lib/session";

type SendResponse = { sent: boolean; expiresInSeconds: number; devCode?: string };

const CODE_LENGTH = 6;
const RESEND_SECONDS = 58;

export default function VerifyPage() {
  const router = useRouter();
  const { user, setUser } = useSession();
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const maskedEmail = user?.email
    ? user.email.replace(/^(.{2}).*(@.*)$/, (_match, head: string, tail: string) => `${head}***${tail}`)
    : "你的邮箱";

  async function sendCode() {
    if (!user?.email) {
      setError("会话已失效，请重新注册。");
      return;
    }
    setError("");
    setInfo("");
    try {
      const data = await apiFetch<SendResponse>("/auth/send-verification-code", {
        method: "POST",
        body: { email: user.email },
      });
      setDevCode(data.devCode ?? null);
      setInfo("验证码已发送。");
      setSecondsLeft(RESEND_SECONDS);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发送失败，请稍后再试");
    }
  }

  useEffect(() => {
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDigit(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setCode((current) => current.map((value, i) => (i === index ? "" : value)));
      return;
    }
    setCode((current) => {
      const next = [...current];
      for (let offset = 0; offset < digits.length && index + offset < CODE_LENGTH; offset += 1) {
        next[index + offset] = digits[offset];
      }
      return next;
    });
    const focusIndex = Math.min(index + digits.length, CODE_LENGTH - 1);
    inputsRef.current[focusIndex]?.focus();
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  async function handleVerify() {
    if (!user?.email) {
      setError("会话已失效，请重新注册。");
      return;
    }
    const value = code.join("");
    if (value.length !== CODE_LENGTH) {
      setError(`请输入 ${CODE_LENGTH} 位验证码。`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch("/auth/verify-email", {
        method: "POST",
        body: { email: user.email, code: value },
      });
      const refreshed = await apiFetch<SessionUser>("/users/me");
      setUser(refreshed);
      router.push("/legal");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "验证失败，请稍后再试");
      setCode(Array(CODE_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="验证码" backHref="/register" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-6">
        <p className="text-center text-ui leading-6 text-content-muted">
          我们已发送验证码到你的邮箱
          <br />
          <span className="font-medium text-content">{maskedEmail}</span>
        </p>

        {/*
          FIX (responsive): the six cells used to be `w-12` inside a `px-8`
          container, which is 6×48 + 5×8 = 328px of content in
          `320 − 64 = 256px` of space. On a 320px device (iPhone SE) that
          overflowed the frame AND the page's horizontal scroll was hidden by
          `overflow-x: hidden`, so the last digit was simply unreachable.

          `min-w-0 flex-1` with a `max-w-12` cap makes the row fit any width
          while keeping the cells square-ish at 390px. `gap-1.5` also buys back
          10px versus `gap-2`.
        */}
        <div className="mt-8 flex justify-center gap-1.5">
          {code.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputsRef.current[index] = element;
              }}
              value={digit}
              maxLength={1}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={`验证码第 ${index + 1} 位`}
              onChange={(event) => updateDigit(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              className={cn(
                "h-14 min-w-0 flex-1 max-w-12 rounded-control border bg-surface-sunken text-center text-title font-semibold text-content",
                "transition-colors duration-instant ease-out",
                "focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
                digit ? "border-brand-500" : "border-border",
              )}
            />
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-4 break-words text-center text-caption text-danger-600">
            {error}
          </p>
        ) : null}
        {info ? <p className="mt-4 text-center text-caption text-content-muted">{info}</p> : null}

        {/* Development convenience: only rendered when the API echoed a code back,
            which `mayExposeVerificationCode()` allows in development only. */}
        {devCode ? (
          <button
            type="button"
            onClick={() => updateDigit(0, devCode)}
            className="mt-3 text-center text-caption text-warning-600 underline decoration-dotted"
          >
            开发模式验证码：{devCode}（点击自动填入）
          </button>
        ) : null}

        {/* Resend is a text action, not a button: it is secondary to 下一步 and it
            is disabled while the cooldown runs, so a filled control would just be
            a large grey block. */}
        <button
          type="button"
          onClick={() => {
            if (secondsLeft <= 0) void sendCode();
          }}
          disabled={secondsLeft > 0}
          className="mt-6 w-full rounded-control py-2 text-center text-ui text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
        >
          {secondsLeft > 0 ? `重新发送 (${secondsLeft}s)` : "重新发送"}
        </button>

        <div className="mt-auto pb-1 pt-6">
          <TFButton
            onClick={handleVerify}
            disabled={code.join("").length !== CODE_LENGTH}
            loading={loading}
            loadingLabel="验证中…"
            size="lg"
            fullWidth
          >
            下一步
          </TFButton>
          <TFButton variant="ghost" size="md" fullWidth className="mt-1" href="/login">
            返回登录
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
