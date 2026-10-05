/**
 * PC-2.5.4 — the one place the console decides what a report points at.
 *
 * `Report` has no `targetType` column; it has two nullable pointers. The rule
 * lives here so the reports queue, the moderation queue and both detail screens
 * cannot drift apart — a row labelled MOMENT in a list that a MOMENT filter
 * cannot find would be a bug with two symptoms.
 *
 * The priority is `MOMENT > COMMENT > MESSAGE > USER`, and it matches
 * `deriveTargetType` in `apps/api/src/admin/admin.service.ts` exactly. A moment
 * report is always `momentId != null, messageId == null`, so the two are
 * mutually exclusive in practice; the order is spelled out so that a row
 * carrying both still answers the same way on both sides of the wire.
 *
 * C2 put COMMENT above MESSAGE on the API's own reasoning: `messageId` is
 * evidence attached to a *person* report, while `commentId` is a content target.
 *
 * `momentId` and `commentId` carry no foreign key, which is why a report can
 * outlive its target. That is a state to render, not an error — see
 * `momentSummary` / `commentSummary` on the API side.
 */

export type ReportTargetType = "USER" | "MESSAGE" | "MOMENT" | "COMMENT";

/** Mirrors the API's derivation. Never read a `targetType` field — there is none. */
export function deriveReportTargetType(row: {
  momentId?: string | null;
  messageId?: string | null;
  commentId?: string | null;
}): ReportTargetType {
  if (row.momentId) return "MOMENT";
  if (row.commentId) return "COMMENT";
  return row.messageId ? "MESSAGE" : "USER";
}

/** Short Chinese labels; the code itself is what the API filters on. */
export const REPORT_TARGET_LABELS: Record<ReportTargetType, string> = {
  USER: "用户举报",
  MESSAGE: "消息举报",
  MOMENT: "动态举报",
  COMMENT: "评论举报",
};

export const REPORT_TARGET_BADGE_CLASS: Record<ReportTargetType, string> = {
  USER: "bg-[#DBEAFE] text-[#1E40AF]",
  MESSAGE: "bg-[#EDE9FE] text-[#5B21B6]",
  MOMENT: "bg-[#DCFCE7] text-[#166534]",
  // 与上面三个都分得开（蓝 / 紫 / 绿之后的琥珀）。
  COMMENT: "bg-[#FEF3C7] text-[#92400E]",
};
