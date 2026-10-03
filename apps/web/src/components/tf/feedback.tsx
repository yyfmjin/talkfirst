"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { TFButton } from "./button";

/**
 * Feedback primitives — TFSkeleton, TFEmptyState, TFToast.
 *
 * The three states every list in this product needs and that the audit found
 * rebuilt from scratch on every page: loading (18 hand-rolled `animate-pulse`
 * blocks), empty (five copies of one dashed-border string, plus four other
 * treatments), and "something happened" (no toast system at all — success was
 * communicated five different ways, including not at all, and never announced to
 * assistive tech).
 */

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * TFSkeleton — the loading state.
 *
 * A skeleton is preferred over a spinner because it tells the user the SHAPE of
 * what is coming, which is what keeps a slow list from feeling broken. It is
 * `aria-hidden` and the container carries `aria-busy`, so a screen reader hears
 * "busy" once instead of reading a dozen empty boxes.
 *
 * The shimmer is a 1.6s opacity pulse — no gradient sweep, no infinite translate,
 * and it stops entirely under `prefers-reduced-motion`.
 */
export function TFSkeleton({
  /** Height in Tailwind units, e.g. `h-4`, `h-11`. */
  className,
  /** `text` is a single line, `circle` an avatar, `block` media. */
  shape = "text",
}: {
  className?: string;
  shape?: "text" | "circle" | "block";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block bg-surface-sunken animate-pulse-soft motion-reduce:animate-none",
        shape === "text" && "h-4 rounded-md",
        shape === "circle" && "h-11 w-11 rounded-full",
        shape === "block" && "rounded-card",
        className,
      )}
    />
  );
}

/** A feed/notification row skeleton — the most common shape in the app. */
export function TFRowSkeleton({ avatar = true }: { avatar?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3" aria-hidden="true">
      {avatar ? <TFSkeleton shape="circle" className="h-11 w-11" /> : null}
      <div className="min-w-0 flex-1 space-y-2">
        <TFSkeleton className="w-1/3" />
        <TFSkeleton className="w-full" />
        <TFSkeleton className="w-4/5" />
      </div>
    </div>
  );
}

/** Wraps a loading region so assistive tech is told once that it is busy. */
export function TFLoadingRegion({ label = "加载中", children }: { label?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * TFEmptyState — a real empty state.
 *
 * The brief is explicit: not 「暂无数据」 followed by blankness, but an icon, one
 * sentence about what would appear here, and the single action that fixes it.
 * `title`/`description`/`action` are all required by convention — a caller that
 * cannot name the action has probably found a flow with a dead end, which is
 * exactly the defect this component surfaces.
 */
export function TFEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** A lucide icon element, ~28px. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** The one thing the user should do next. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon ? (
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-500" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="text-ui font-semibold text-content">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-[260px] text-caption leading-5 text-content-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * TFErrorState — the failure counterpart.
 *
 * Separated from `TFEmptyState` because the two demand different actions: an
 * empty list wants "go do the thing", a failed load wants "try again". Rendering
 * one as the other is how the audit found eight routes offering a 重试 that could
 * never succeed.
 */
export function TFErrorState({
  title = "加载失败",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-8 text-center", className)}>
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-danger-50 text-danger-500" aria-hidden="true">
        <AlertCircle size={24} />
      </span>
      <p role="alert" className="text-ui font-semibold text-content">
        {title}
      </p>
      {description ? (
        <p className="mt-1.5 max-w-[260px] break-words text-caption leading-5 text-content-muted">{description}</p>
      ) : null}
      {onRetry ? (
        <TFButton variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          重试
        </TFButton>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * TFToast — one transient message, in one place.
 *
 * ## Why a provider instead of a per-page paragraph
 *
 * Before this, "it worked" was expressed as: an emerald paragraph on some pages,
 * an indigo one on others, a header chip with a `setTimeout` on a third, an
 * inline 「已复制」 on a fourth, and nothing at all on the rest. None of them were
 * announced to a screen reader. A single bottom-anchored region fixes the
 * position, the wording and the announcement at once.
 *
 * ## Rules this enforces
 *
 *  - **One at a time.** A new toast replaces the current one rather than
 *    stacking, because three overlapping messages at the bottom of a phone screen
 *    obscure the content the user is trying to reach.
 *  - **`role="status"`** for success/info (polite) and **`role="alert"`** for
 *    errors (assertive), which is the difference between "noticed eventually" and
 *    "interrupted", and it is the correct distinction.
 *  - **Human copy.** The type system cannot force it, but `TFToastProvider`'s
 *    docblock and the error mapping in `lib/errors.ts` both point the same way.
 *  - **Above the safe area**, so it never sits under the home indicator or behind
 *    the tab bar.
 */
type ToastTone = "success" | "error" | "info";
type ToastInput = { message: string; tone?: ToastTone; durationMs?: number };

const ToastContext = createContext<{ show: (toast: ToastInput) => void }>({ show: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_ICON: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <AlertCircle size={16} />,
  info: <Info size={16} />,
};

export function TFToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);
  const timerRef = useRef<number | null>(null);
  const counterRef = useRef(0);

  const show = useCallback(({ message, tone = "info", durationMs = 2600 }: ToastInput) => {
    counterRef.current += 1;
    const id = counterRef.current;
    setToast({ id, message, tone });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    // Errors linger: the user may need to read them, and they are the case where
    // "it disappeared before I looked" is most costly.
    timerRef.current = window.setTimeout(() => setToast(null), tone === "error" ? 4200 : durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          /* `bottom-20` clears the 52px tab bar; the safe-area inset is added to
             the same declaration so the toast is never under the home indicator.
             The region is `pointer-events-none` so it can never swallow a tap
             meant for the content underneath. */
          className="pointer-events-none absolute inset-x-0 z-[60] flex justify-center px-5 bottom-[calc(5rem+env(safe-area-inset-bottom))]"
        >
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto flex max-w-full items-start gap-2 rounded-row px-3.5 py-2.5 text-caption font-medium shadow-raised animate-slide-up motion-reduce:animate-none",
              toast.tone === "success" && "bg-content text-content-inverse",
              toast.tone === "error" && "bg-danger-600 text-white",
              toast.tone === "info" && "bg-content text-content-inverse",
            )}
          >
            <span className="mt-px shrink-0" aria-hidden="true">
              {TOAST_ICON[toast.tone]}
            </span>
            <span className="min-w-0 break-words">{toast.message}</span>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
