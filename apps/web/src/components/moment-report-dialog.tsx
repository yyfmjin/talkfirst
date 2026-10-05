"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/errors";
import { REPORT_REASONS, reportReasonLabel } from "@/lib/report-reasons";

/**
 * PC-2.5.4 — 举报一个对象：一条动态，或（C2 起）一条评论。
 *
 * 理由列表是 `social-safety.controller.ts` 里那份 allow-list 的镜像，而那份才是权威：
 * `Report.reason` 是一个自由文本列，所以可选项集合只能来自校验它的那个端点。
 * 不在那份列表里的理由会被 `403 INVALID_REASON` 拒掉，所以代码逐字发送、只翻译标签
 * （PC-3.4 把这对东西挪进 `@/lib/report-reasons`，让聊天里的安全菜单与此处不会漂移）。
 *
 * 请求体只带 `{ momentId | commentId, reason, description }`，**从不**带上用户 id：
 * 作者由服务端从行里读出来，所以客户端无法把举报指向内容作者之外的账号。
 * 举报人同理，取自 JWT subject。
 *
 * C2 把「动态」扩展成「动态 或 评论」而不是再写一个弹窗：两者的请求形状、理由列表、
 * 失败语义完全相同，分叉成两份只会让"后来只改了一个"成为默认结局。
 *
 * 这里不重实现任何鉴权。`POST /reports` 跑的是与详情页同一个 `resolveMomentAccess` 闸门，
 * 所以看不见的对象会回 `403 MOMENT_LOCKED` / `404 COMMENT_NOT_FOUND`，报自己的东西会回
 * `403 CANNOT_REPORT_SELF`。这几种情况下弹窗保持打开并如实说明 —— 被拒的举报永远不会
 * 被渲染成成功。
 */

/** `ReportDto.description` is `@MaxLength(1000)`; the field cannot exceed it. */
const DESCRIPTION_MAX = 1000;

export function MomentReportDialog({
  momentId,
  commentId,
  onCancel,
  onSubmitted,
}: {
  /** 被举报的动态。与 `commentId` 恰好给一个（与 API 的 DTO 同规则）。 */
  momentId?: string;
  /** C2 — 被举报的评论。 */
  commentId?: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  // 只改文案与根 testid；内部那几个 `moment-report-*` 是弹窗自己的部件
  // （理由列表、说明框、按钮），两个目标共用同一套，不因目标不同而改名。
  const isComment = Boolean(commentId);
  const what = isComment ? "这条评论" : "这条动态";
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
        body: {
          // 两个目标互斥，与 `POST /reports` 的 DTO 同一条规则（同时给会被 400）。
          ...(commentId ? { commentId } : { momentId }),
          reason,
          description: description.trim() || undefined,
        },
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
      data-testid={isComment ? "comment-report-dialog" : "moment-report-dialog"}
      role="dialog"
      aria-modal="true"
      aria-label={`举报${what}`}
      /* Phase B: `absolute`, not `fixed` — see `moment-comments.tsx` for why. */
      className="absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-surface-scrim p-5"
    >
      <div className="w-full max-w-[340px] rounded-sheet bg-surface p-5 text-left shadow-overlay">
        <p className="text-heading font-semibold text-content">举报{what}</p>
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
