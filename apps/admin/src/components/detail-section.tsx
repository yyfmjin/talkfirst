import type { ReactNode } from "react";

/**
 * A titled card on a detail screen.
 *
 * Every detail page grew its own `<section className="rounded-2xl border …">`
 * with slightly different padding and heading size. This is that block, once.
 *
 * `testId` and `className` land on the outer element, so an existing suite that
 * locates the section by testid keeps working unchanged.
 */
export type DetailSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered top-right of the title row — status pills, action buttons. */
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
  /** `flush` drops the body padding for a section that is itself a table. */
  flush?: boolean;
};

export function DetailSection({
  title,
  description,
  aside,
  children,
  testId,
  className = "",
  flush = false,
}: DetailSectionProps) {
  return (
    <section
      {...(testId ? { "data-testid": testId } : {})}
      className={`rounded-2xl border border-line bg-card shadow-card ${className}`}
    >
      {title || aside ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="tf-section-title">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>
            ) : null}
          </div>
          {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "px-4 py-3.5"}>{children}</div>
    </section>
  );
}
