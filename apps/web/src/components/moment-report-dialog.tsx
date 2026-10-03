"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/errors";
import { REPORT_REASONS, reportReasonLabel } from "@/lib/report-reasons";

/**
 * PC-2.5.4 — reporting one moment, from Post Detail.
 *
 * The reason list is a mirror of the allow-list in
 * `social-safety.controller.ts`, which is the authority: `Report.reason` is a
 * free-form column, so the option set can only come from the endpoint that
 * validates it. An option that is not in that list would be rejected with
 * `403 INVALID_REASON`, which is why the codes are sent verbatim and only the
 * labels are translated (PC-3.4 moved the pair into `@/lib/report-reasons` so
 * the chat safety menu and this dialog cannot drift apart).
 *
 * The request body carries exactly `{ momentId, reason, description }`. It never
 * names a user: the author is read from the moment server-side, so a client
 * cannot point a report at an account other than the content's owner. The
 * reporter is the JWT subject for the same reason.
 *
 * Nothing here re-implements authorization. `POST /reports` runs the same
 * `resolveMomentAccess` gate as the detail screen, so a moment this viewer may
 * not read answers `403 MOMENT_LOCKED`, and reporting one's own moment answers
 * `403 CANNOT_REPORT_SELF`. The dialog stays open on any of those and says so —
 * a rejection is never rendered as a success.
 */

/** `ReportDto.description` is `@MaxLength(1000)`; the field cannot exceed it. */
const DESCRIPTION_MAX = 1000;

export function MomentReportDialog({
  momentId,
  onCancel,
  onSubmitted,
}: {
  momentId: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  // No reason is preselected: the submit control stays disabled until one is
  // chosen, rather than silently reporting the first option on the list.
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy || !reason) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/reports", {
        method: "POST",
        body: { momentId, reason, description: description.trim() || undefined },
      });
      // The dialog closes only once the API answered, so the surface cannot
      // claim a report that PostgreSQL does not hold.
      setBusy(false);
      onSubmitted();
    } catch (requestError) {
      // The draft is deliberately kept: a rejected report must be retryable
      // without the reader retyping what they wrote.
      setError(friendlyErrorMessage(requestError, "举报提交失败，请稍后再试。"));
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="moment-report-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="举报这条动态"
      /* Phase B: `absolute`, not `fixed` — see `moment-comments.tsx` for why. */
      className="absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-surface-scrim p-5"
    >
      <div className="w-full max-w-[340px] rounded-sheet bg-surface p-5 text-left shadow-overlay">
        <p className="text-heading font-semibold text-content">举报这条动态</p>
        <p className="mt-1 text-caption leading-4 text-content-muted">
          举报会提交人工审核。请选择最接近的原因。
        </p>

        <div data-testid="moment-report-reasons" className="mt-3 space-y-1.5">
          {REPORT_REASONS.map((item) => (
            <button
              key={item}
              type="button"
              data-testid="moment-report-reason"
              data-reason={item}
              aria-pressed={reason === item}
              onClick={() => setReason(item)}
              className={cn(
                "block w-full break-words rounded-row border px-3 py-2 text-left text-caption transition-colors duration-instant",
                reason === item
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-600"
                  : "border-border text-content hover:bg-surface-sunken",
              )}
            >
              {reportReasonLabel(item)}
            </button>
          ))}
        </div>

        <textarea
          data-testid="moment-report-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          aria-label="补充说明（可选）"
          placeholder="补充说明（可选）"
          className="mt-3 w-full rounded-control border border-border bg-surface-sunken p-3 text-caption text-content outline-none transition-colors duration-instant placeholder:text-content-subtle focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
        />

        {error ? (
          <p data-testid="moment-report-error" role="alert" className="mt-2 break-words text-overline text-danger-600">
            {error}
          </p>
        ) : null}

        {/* `boundingBox()` is asserted on moment-report-cancel / -submit, so the
            h-9, flex-1 and gap stay exactly as they were. */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            data-testid="moment-report-cancel"
            onClick={onCancel}
            disabled={busy}
            className="h-9 min-w-0 flex-1 rounded-control border border-border text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="moment-report-submit"
            onClick={() => void submit()}
            disabled={busy || reason.length === 0}
            className="h-9 min-w-0 flex-1 rounded-control bg-brand-500 text-caption font-medium text-white transition-colors duration-instant hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? "提交中…" : "提交举报"}
          </button>
        </div>
      </div>
    </div>
  );
}
