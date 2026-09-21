/**
 * PC-3.4 — the report reasons, in one place, in Chinese.
 *
 * `Report.reason` is a free-form column, not an enum: `social-safety.controller.ts`
 * is the authority and it keeps its own allow-list of canonical English codes.
 * Those codes are the API contract, so they are sent verbatim — but a member
 * must never read "Harassment" on screen, so the display labels live here once
 * rather than in a second dictionary beside each dialog.
 *
 * `ui-copy.test.mjs` reads the controller and fails if these two lists drift.
 */
export const REPORT_REASONS = [
  "Harassment",
  "Spam",
  "Scam",
  "Sexual content",
  "Hate speech",
  "Fake profile",
  "Other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<string, string> = {
  Harassment: "骚扰",
  Spam: "垃圾信息",
  Scam: "欺诈",
  "Sexual content": "色情内容",
  "Hate speech": "仇恨言论",
  "Fake profile": "虚假资料",
  Other: "其它",
};

/**
 * Matched case-insensitively: `Report.reason` is free-form, and `SPAM` is a
 * value that genuinely exists in the table (the API itself filters with
 * `mode: "insensitive"`). Falls back to the raw code so an unmapped reason is
 * still readable.
 */
export function reportReasonLabel(reason: string): string {
  const key = Object.keys(REPORT_REASON_LABELS).find(
    (candidate) => candidate.toLowerCase() === reason.toLowerCase(),
  );
  return key ? REPORT_REASON_LABELS[key] : reason;
}
