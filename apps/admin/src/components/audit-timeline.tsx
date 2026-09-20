import type { ReactNode } from "react";

/**
 * An activity feed.
 *
 * ## The actor rule this component exists to enforce
 *
 * `actorType: "SYSTEM"` means the *platform* acted — a scheduler tick, a
 * background job — and such a row has `adminId === null`. Rendering
 * `adminId.slice(0, 8)` unconditionally is exactly the defect this shape was
 * built to prevent: one machine row threw during render and blanked the audit
 * log for every operator.
 *
 * So the branch is structural, not defensive: only the `SYSTEM` arm describes
 * the actor without an id, and only the `USER` arm reads `adminId` at all.
 *
 * The row card is a direct parent of the action line, which is a contract — a
 * suite locates a row with `getByText(action).locator("..")` and then asserts
 * what that element does and does not contain.
 */
export type AuditTimelineItem = {
  id: string;
  /** `undefined` on an older API build; absent rows are treated as human. */
  actorType?: "USER" | "SYSTEM";
  /** `null` for SYSTEM rows: there is deliberately no administrator to name. */
  adminId: string | null;
  action: string;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
};

/** The single rendering of a machine actor. */
export function SystemActorBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-medium text-[#4338CA]"
      title="平台自动执行，没有人工操作者"
    >
      系统 · 自动
    </span>
  );
}

/** Short id, or the placeholder when a row legitimately has no target. */
function shortId(value: string | null) {
  return value ? value.slice(0, 8) : "-";
}

export function AuditTimeline({ items }: { items: AuditTimelineItem[] }) {
  return (
    <ol className="relative mt-4 space-y-2.5">
      {/* The rail. Decorative, so it carries no semantics for a screen reader. */}
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[3px] top-2 w-px bg-line"
      />
      {items.map((item) => (
        <li key={item.id} className="relative pl-6">
          <span
            aria-hidden="true"
            className={`absolute left-0 top-[13px] h-[7px] w-[7px] rounded-full ring-4 ring-bg ${
              item.actorType === "SYSTEM" ? "bg-[#A5B4FC]" : "bg-[#93C5FD]"
            }`}
          />
          <div className="rounded-2xl border border-line bg-card p-3 text-[12px] shadow-card">
            <p className="font-medium text-ink">{item.action}</p>
            <p className="mt-1 text-muted">
              {new Date(item.createdAt).toLocaleString()} ·{" "}
              {item.actorType === "SYSTEM" ? (
                <SystemActorBadge />
              ) : (
                // Defensive `?.`: `adminId` is nullable at the type level, and a
                // USER row should always have one — but a rendering crash is not
                // an acceptable way to discover a bad row.
                `admin ${item.adminId?.slice(0, 8) ?? "-"}`
              )}{" "}
              · target {shortId(item.targetId)}
            </p>
            {item.detail ? <p className="mt-1 text-muted">{item.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Counts and page position, as one text node so a substring match stays unique. */
export function TimelineSummary({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[12px] text-muted">{children}</p>;
}
