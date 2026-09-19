"use client";

import { useEffect, useState } from "react";

export type ConfirmPayload = {
  reason: string;
  /** Only present when the dialog was opened with `withExpiry`. */
  expiresAt?: string;
};

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** What is about to happen, in plain language. */
  description: string;
  /** Extra warning shown in red, e.g. for permanent bans. */
  danger?: string;
  confirmLabel?: string;
  /** Text the admin must type to confirm. Omit for a simple confirm. */
  requirePhrase?: string;
  /** Show a required expiry picker (used by temporary suspensions). */
  withExpiry?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (payload: ConfirmPayload) => void;
};

/** Default expiry offered for a temporary suspension: 7 days from now. */
function defaultExpiry(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Phase A: confirmation gate for destructive admin actions.
 *
 * Enforces two things the previous UI did not:
 *   1. a deliberate second confirmation (never a one-click ban)
 *   2. a non-blank reason, collected here and re-validated by the backend
 *
 * The backend rejects a missing reason with 400 and a suspension without an
 * expiry with 400, regardless of what this component does — so this is UX, not
 * the security boundary.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  danger,
  confirmLabel = "确认",
  requirePhrase,
  withExpiry = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset every time the dialog opens so a stale reason never carries over.
  useEffect(() => {
    if (open) {
      setReason("");
      setPhrase("");
      setExpiresAt(withExpiry ? defaultExpiry() : "");
      setTouched(false);
    }
  }, [open, withExpiry]);

  if (!open) return null;

  const reasonOk = reason.trim().length > 0;
  const phraseOk = !requirePhrase || phrase.trim() === requirePhrase;
  const expiryOk = !withExpiry || (expiresAt.length > 0 && new Date(expiresAt).getTime() > Date.now());
  const canConfirm = reasonOk && phraseOk && expiryOk && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <p className="mt-2 text-[13px] leading-5 text-muted">{description}</p>
        {danger ? (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-600">{danger}</p>
        ) : null}

        <label className="mt-4 block text-[12px] text-muted">
          原因（必填）
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setTouched(true);
            }}
            rows={3}
            maxLength={500}
            placeholder="请说明本次操作的原因，将写入审计日志"
            className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>
        {touched && !reasonOk ? (
          <p className="mt-1 text-[11px] text-red-500">原因不能为空</p>
        ) : null}

        {withExpiry ? (
          <label className="mt-3 block text-[12px] text-muted">
            解封时间（必填，必须晚于当前时间）
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-[13px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
        ) : null}
        {withExpiry && !expiryOk ? (
          <p className="mt-1 text-[11px] text-red-500">请选择晚于当前时间的解封时间</p>
        ) : null}

        {requirePhrase ? (
          <label className="mt-3 block text-[12px] text-muted">
            请输入 <span className="font-semibold text-red-600">{requirePhrase}</span> 以确认
            <input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-[13px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-10 flex-1 rounded-xl border border-line text-[13px] disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={() =>
              onConfirm({
                reason: reason.trim(),
                ...(withExpiry ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
              })
            }
            disabled={!canConfirm}
            className="h-10 flex-1 rounded-xl bg-red-500 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
