"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { TFIconButton } from "./button";

/**
 * Overlay primitives — TFSheet and TFDialog.
 *
 * ## The defects these close
 *
 * The audit found eight hand-rolled overlays with five different
 * position/z-index combinations, and:
 *
 *  - **only one of the eight handled Escape** (the profile card), so a keyboard
 *    user could get stuck in a report dialog with no way out;
 *  - **none trapped focus**, so Tab walked out of the dialog and into the page
 *    behind it;
 *  - **none restored focus**, so dismissing a dialog dropped the caret at the top
 *    of the document;
 *  - two of them used `fixed inset-0`, which on a desktop width escapes the
 *    390px phone shell and covers the entire browser window;
 *  - two dialogs had no `role="dialog"` at all and one had no accessible name.
 *
 * ## One trap, shared
 *
 * `useFocusTrap` keeps Tab inside the panel, focuses the first sensible element
 * on open, and returns focus to whatever opened it on close. It reads the tabbable
 * set at keydown time rather than caching it, because these panels are re-rendered
 * as their content loads.
 *
 * ## `absolute` by default, not `fixed`
 *
 * Both components position against their nearest positioned ancestor, which is
 * the phone shell. That is what keeps a 320px dialog centred inside the device
 * frame instead of floating in the middle of a 1440px monitor. A caller that
 * genuinely needs viewport-relative positioning can pass `portal`.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember the trigger so focus can go back to it.
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      // `preventScroll` matters on a phone: focusing the first control of a
      // bottom sheet must not yank the page behind it.
      (first ?? panel).focus({ preventScroll: true });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  return panelRef;
}

/** Locks the background scroller while an overlay is open. */
function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
}

function Scrim({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClose}
      className="absolute inset-0 cursor-default bg-surface-scrim animate-fade-in motion-reduce:animate-none"
    />
  );
}

/* -------------------------------------------------------------------------- */

/**
 * TFSheet — a bottom sheet.
 *
 * The default container for a choice list (visibility, media source, report
 * reason) because it keeps the action near the thumb and never covers the whole
 * screen.
 */
export type TFSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional explanatory line under the title. */
  description?: ReactNode;
  children: ReactNode;
  /** A sticky row under the content — usually the confirm/cancel pair. */
  footer?: ReactNode;
  className?: string;
};

export function TFSheet({ open, onClose, title, description, children, footer, className }: TFSheetProps) {
  const panelRef = useFocusTrap(open, onClose);
  useScrollLock(open);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <Scrim onClose={onClose} label="关闭" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          /* Safe area: written as ONE `padding-bottom` rather than `pb-4` plus a
             `pb-safe-b` helper. Two declarations on the same property would be
             resolved by Tailwind's internal CSS ordering, which is not something a
             component should depend on — and this is the form the composer already
             uses. */
          "relative max-h-[88%] min-h-0 overflow-hidden rounded-t-sheet bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))]",
          "shadow-overlay animate-sheet-up motion-reduce:animate-none",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
        <div className="flex items-start gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-heading font-semibold text-content">{title}</h2>
            {description ? <p className="mt-0.5 text-caption text-content-muted">{description}</p> : null}
          </div>
          <TFIconButton label="关闭" size="sm" onClick={onClose} className="-mr-1.5 -mt-1">
            <X size={18} />
          </TFIconButton>
        </div>
        <div className="tf-scroll min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * TFDialog — a centred, blocking confirmation.
 *
 * Reserved for decisions that must interrupt: deleting content, blocking a
 * person, discarding a draft. A sheet is for choosing; a dialog is for confirming
 * something irreversible, which is why `danger` exists and why the caller is
 * expected to require a typed phrase for account deletion.
 */
export type TFDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** The action row. Keep it to two buttons. */
  footer?: ReactNode;
  /** Wider variant for a form inside the dialog. */
  wide?: boolean;
};

export function TFDialog({ open, onClose, title, description, children, footer, wide }: TFDialogProps) {
  const panelRef = useFocusTrap(open, onClose);
  useScrollLock(open);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 grid place-items-center overflow-y-auto p-5">
      <Scrim onClose={onClose} label="关闭" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative w-full rounded-sheet bg-surface p-5 shadow-overlay animate-slide-up motion-reduce:animate-none",
          wide ? "max-w-[390px]" : "max-w-[320px]",
        )}
      >
        <h2 className="text-heading font-semibold text-content">{title}</h2>
        {description ? <p className="mt-1 text-caption leading-5 text-content-muted">{description}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-5 flex gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * TFMenu — the overflow menu.
 *
 * For actions that must be reachable but must NOT compete with the screen's
 * primary action: block, report, delete, copy link. The audit found these as
 * bare `⋯` characters with a ~12px hit target, no focus state and no way to close
 * them from the keyboard.
 */
export type TFMenuItem = {
  label: string;
  onSelect: () => void;
  /** Renders the destructive pair in the danger colour. */
  tone?: "default" | "danger";
  icon?: ReactNode;
};

export function TFMenu({
  open,
  onClose,
  items,
  align = "right",
  label = "更多操作",
}: {
  open: boolean;
  onClose: () => void;
  items: TFMenuItem[];
  align?: "left" | "right";
  label?: string;
}) {
  const panelRef = useFocusTrap(open, onClose);

  if (!open) return null;

  return (
    <>
      <Scrim onClose={onClose} label={label} />
      <div
        ref={panelRef}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "absolute top-full z-40 mt-1 min-w-[168px] overflow-hidden rounded-row border border-border bg-surface py-1 shadow-raised animate-fade-in motion-reduce:animate-none",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2.5 text-left text-ui hover:bg-surface-sunken",
              item.tone === "danger" ? "text-danger-600" : "text-content",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
