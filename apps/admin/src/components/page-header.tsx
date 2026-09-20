import type { ReactNode } from "react";

/**
 * The one page title block.
 *
 * Every screen used to hand-roll `<h1>` + a description paragraph + a refresh
 * button, which drifted in spacing and in where the button landed. This is the
 * single definition: title, optional description, optional meta line, and a
 * right-aligned action cluster that wraps under the title on narrow screens
 * instead of squeezing it.
 */
export type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** A quiet line under the description — counts, filters in effect, page x/y. */
  meta?: ReactNode;
  /** Buttons, links, filter toggles. Never wrapped. */
  actions?: ReactNode;
};

export function PageHeader({ title, description, meta, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1>{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
