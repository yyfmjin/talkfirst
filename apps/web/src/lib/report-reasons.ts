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

import type { MsgKey } from "@/lib/i18n";

export const REPORT_REASON_LABELS: Record<string, MsgKey> = {
  Harassment: "report.reason.Harassment",
  Spam: "report.reason.Spam",
  Scam: "report.reason.Scam",
  "Sexual content": "report.reason.Sexual content",
  "Hate speech": "report.reason.Hate speech",
  "Fake profile": "report.reason.Fake profile",
  Other: "report.reason.Other",
};

/**
 * Matched case-insensitively: `Report.reason` is free-form, and `SPAM` is a
 * value that genuinely exists in the table (the API itself filters with
 * `mode: "insensitive"`).
 *
 * Always returns a key: an unmapped reason degrades to 「其它」 rather than to a raw
 * English code on a Chinese screen.
 */
export function reportReasonKey(reason: string): MsgKey {
  const key = Object.keys(REPORT_REASON_LABELS).find(
    (candidate) => candidate.toLowerCase() === reason.toLowerCase(),
  );
  return key ? REPORT_REASON_LABELS[key] : "report.reason.Other";
}
