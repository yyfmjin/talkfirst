import { Logger } from "@nestjs/common";
import { emailVerificationEnforced } from "../auth/email-verification.policy";
import type { MailProviderKind, SmtpConfig } from "./mail.types";

/** Environment variable names owned by this module. */
export const MAIL_PROVIDER_ENV = "MAIL_PROVIDER";

/**
 * Picks the transport. An explicit `MAIL_PROVIDER` always wins; otherwise the
 * environment decides a sensible default so a plain `npm run start:dev` works
 * without any mail configuration and a test run never needs a network.
 */
export function resolveMailProviderKind(env: NodeJS.ProcessEnv = process.env): MailProviderKind {
  const raw = (env[MAIL_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (raw === "console" || raw === "fake" || raw === "smtp") return raw;

  if (env.NODE_ENV === "test") return "fake";
  if (env.NODE_ENV === "production") return "smtp";
  return "console";
}

/**
 * Reads the SMTP settings, returning `null` when the set is incomplete.
 *
 * `SMTP_PORT` defaults to 587 and `SMTP_SECURE` is derived from the port (465 is
 * implicit TLS), so only host/credentials/from are genuinely required.
 */
export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? "").trim();
  const user = (env.SMTP_USER ?? "").trim();
  const password = env.SMTP_PASSWORD ?? "";
  const from = (env.SMTP_FROM ?? "").trim();
  if (!host || !user || !password || !from) return null;

  const port = Number((env.SMTP_PORT ?? "").trim() || "587");
  if (!Number.isFinite(port) || port <= 0) return null;

  const secureRaw = (env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "true" : port === 465;

  return { host, port, user, password, from, secure };
}

export class MailConfigurationError extends Error {}

/**
 * 2026-10-06 —— 一次真实事故留下的守卫：生产上「不强制验证 + console 通道」。
 *
 * 事故现场：`.env` 里 `MAIL_PROVIDER=console`、`SMTP_*` 四项全空，
 * 于是 `POST /auth/send-verification-code` 只写一行日志
 * （`EMAIL VERIFICATION SENT (console) …`）——**一封信都没发**；
 * 而注册页照旧显示「我们已发送验证码到你的邮箱」。用 QQ 邮箱注册的成员
 * 一直在等一封不存在的信，直到有人去翻服务器日志。
 *
 * 为什么当时完全静默：启动检查只在 `ENFORCE_EMAIL_VERIFICATION=true` 时才校验 ——
 * 「不强制验证就不该因为邮件起不来」这个设计是对的，但它把「能起来」
 * 误当成了「配好了」。这里补上那条静默路径的**告警**：不拦启动，只让它刺眼。
 *
 * （不返回布尔值而是只告警：调用方是启动路径，多一个返回值就多一个被抄错的判断。）
 */
export function warnIfVerificationMailIsUndeliverable(env: NodeJS.ProcessEnv = process.env): void {
  const kind = resolveMailProviderKind(env);
  if (kind === "smtp" && readSmtpConfig(env)) return;

  // 两种发不出去的原因要分开写：只报「当前通道：smtp」会让读日志的人
  // 以为已经配好了 SMTP（那种情况其实是**字段没填全**）。
  const reason =
    kind === "smtp"
      ? "MAIL_PROVIDER=smtp，但 SMTP_HOST / SMTP_USER / SMTP_PASSWORD / SMTP_FROM 没填全"
      : `当前通道是 ${kind}`;

  new Logger("Mail").warn(
    `验证码邮件不会真正送达（${reason}）。注册与找回密码的验证码只会写进本进程日志，` +
      "成员收不到。要真正发信：设置 MAIL_PROVIDER=smtp，并补齐 SMTP_HOST / SMTP_USER / " +
      "SMTP_PASSWORD / SMTP_FROM（QQ 邮箱：smtp.qq.com:465 + 授权码）。",
  );
}

/**
 * SEC-005 — fail fast rather than trap users.
 *
 * If a production deployment demands verification but cannot send mail, every
 * new account becomes permanently locked out with no way to recover. Refusing to
 * boot is the least-bad outcome, and the message deliberately names only the
 * variables that are missing — never their values.
 *
 * 不强制验证时不再直接返回：那条路径现在会走 `warnIfVerificationMailIsUndeliverable`
 * （能起来不等于配好了 —— 2026-10-06 的事故就是从这里静默过去的）。
 */
export function assertMailConfigurationForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  if (!emailVerificationEnforced(env)) {
    warnIfVerificationMailIsUndeliverable(env);
    return;
  }

  const kind = resolveMailProviderKind(env);
  if (kind !== "smtp" || readSmtpConfig(env) === null) {
    throw new MailConfigurationError(
      "Email verification is enabled but SMTP configuration is incomplete. " +
        "Set MAIL_PROVIDER=smtp and SMTP_HOST / SMTP_PORT / SMTP_USER / " +
        "SMTP_PASSWORD / SMTP_FROM.",
    );
  }
}
