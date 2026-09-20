import type { ReactNode } from "react";

/**
 * The empty case, always stated.
 *
 * A blank gap and a spinner that never resolves look identical to a working
 * screen with no rows — so every list and every feed renders this explicitly.
 *
 * The default title is deliberately the bare string 「暂无数据」, because the
 * dashboard suite asserts that exactly three elements on that page carry it.
 * Empty cases that are *not* one of those three must pass their own `title`.
 */
export type EmptyStateProps = {
  /** Defaults to 「暂无数据」 — override it wherever that phrase is spoken for. */
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  testId?: string;
  className?: string;
};

export function EmptyState({
  title = "暂无数据",
  description,
  action,
  testId,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      {...(testId ? { "data-testid": testId } : {})}
      className={`rounded-2xl border border-dashed border-line bg-card/60 px-4 py-8 text-center ${className}`}
    >
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
