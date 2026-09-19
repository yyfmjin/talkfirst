"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { GradientButton, SmallButton } from "@/components/ui";
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
    : "your email";

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
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-6 pt-6">
        <p className="text-center text-[14px] leading-6 text-muted">
          我们已发送验证码到你的邮箱
          <br />
          {maskedEmail}
        </p>
        <div className="mt-8 flex justify-between gap-2">
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
                "h-14 w-12 rounded-2xl border bg-[#F8FAFF] text-center text-xl outline-none focus:ring-2 focus:ring-indigo-200",
                digit ? "border-[#8B6CFF]" : "border-line",
              )}
            />
          ))}
        </div>
        {error ? <p className="mt-4 text-center text-[12px] text-red-500">{error}</p> : null}
        {info ? <p className="mt-4 text-center text-[12px] text-indigo-500">{info}</p> : null}
        {devCode ? (
          <button
            onClick={() => updateDigit(0, devCode)}
            className="mt-2 text-center text-[12px] text-amber-500 underline decoration-dotted"
          >
            开发模式验证码：{devCode}（点击自动填入）
          </button>
        ) : null}
        <button
          onClick={() => {
            if (secondsLeft <= 0) void sendCode();
          }}
          disabled={secondsLeft > 0}
          className="mt-6 w-full text-center text-[13px] text-muted disabled:opacity-60"
        >
          {secondsLeft > 0 ? `重新发送 (${secondsLeft}s)` : "重新发送"}
        </button>
        <div className="mt-auto pb-1 pt-8">
          <GradientButton onClick={handleVerify} disabled={loading || code.join("").length !== CODE_LENGTH}>
            {loading ? "验证中…" : "下一步"}
          </GradientButton>
          <SmallButton className="mt-3 w-full" onClick={() => router.push("/login")}>
            返回登录
          </SmallButton>
        </div>
      </div>
    </PhoneShell>
  );
}
