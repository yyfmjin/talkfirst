"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * ScreenHeader — the top bar of every sub-screen.
 *
 * ## What changed in Phase B
 *
 *  - The back control grows from 36px to **44px**, the thumb minimum. It was the
 *    single most-tapped control in the app at 36px, and on a phone that is a miss
 *    waiting to happen.
 *  - The title moves to the `heading` type step (17px) with a real weight, so it
 *    stops competing with body text.
 *  - Colours come from tokens (`border-border`, `surface/95` instead of
 *    `border-line/70`, `bg-white/95`).
 *
 * ## What deliberately did NOT change
 *
 *  - **It still renders `<h1>`.** Every route using this header relies on it for
 *    the page's single top-level heading; two of them have no heading of their
 *    own, so removing it would leave them with none.
 *  - **`onBack` still wins over `backHref`.** The composer uses it to intercept
 *    "back" and guard unsaved edits.
 *  - **`action` keeps a reserved 44px-wide slot.** Without it the centred title
 *    would sit off-centre on screens that have a right-hand action and jump back
 *    on those that do not.
 */
export function ScreenHeader({
  title,
  backHref,
  action,
  onBack,
}: {
  title: string;
  backHref?: string;
  action?: React.ReactNode;
  onBack?: () => void;
}) {
  const backClasses =
    "grid h-11 w-11 shrink-0 place-items-center rounded-full text-content transition-colors duration-instant ease-out hover:bg-surface-sunken active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";

  return (
    <header className="z-10 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border bg-surface/95 px-2 py-1 backdrop-blur">
      {onBack ? (
        <button type="button" onClick={onBack} className={backClasses} aria-label="返回">
          <ChevronLeft size={24} />
        </button>
      ) : (
        <Link href={backHref ?? "/"} className={backClasses} aria-label="返回">
          <ChevronLeft size={24} />
        </Link>
      )}
      <h1 className="min-w-0 truncate text-center text-heading font-semibold text-content">{title}</h1>
      <div className="flex min-w-[2.75rem] shrink-0 items-center justify-end">{action}</div>
    </header>
  );
}
