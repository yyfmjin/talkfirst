"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * TFField / TFInput / TFTextarea — one form control.
 *
 * ## The four defects this closes
 *
 * The audit found the same omission in every form in the app:
 *
 *  1. **Labels were never programmatically associated.** `htmlFor` appeared zero
 *     times in the whole codebase. A `<label>` wrapping an `<input>` is valid and
 *     was used, but it gives no way to point an error message at the control, and
 *     several inputs were not wrapped at all.
 *  2. **No error was ever tied to its field.** `aria-invalid` and
 *     `aria-describedby` were absent everywhere, so a screen-reader user heard
 *     "invalid" or a generic form error with no idea which field to fix.
 *  3. **`type="email"` was never used.** Login and register both shipped
 *     `type="text"`, so a phone keyboard never offered `@` and browsers never
 *     validated.
 *  4. **Field geometry drifted.** Five input heights (36/40/44/48) across three
 *     radii, plus a textarea with three different paddings.
 *
 * `TFField` owns the label, the hint, the error and the ids; `TFInput` /
 * `TFTextarea` render the control itself and can also be used alone when a
 * screen owns its own layout.
 *
 * ## Error text is announced, not just coloured
 *
 * The error paragraph carries `role="alert"`, so it is read when it appears
 * rather than only when focus happens to pass over it, and the control is marked
 * `aria-invalid` with `aria-describedby` pointing at that paragraph.
 */

const CONTROL_BASE =
  "w-full min-w-0 rounded-control border bg-surface-sunken text-content transition-[border-color,box-shadow,background-color] duration-instant ease-out placeholder:text-content-subtle focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 read-only:text-content-muted";

/** `error` is a distinct visual state, not just a red border on `default`. */
function controlState(error?: boolean | string) {
  return error
    ? "border-danger-500 bg-danger-50/40 focus:border-danger-600 focus:ring-2 focus:ring-danger-200"
    : "border-border focus:border-brand-400 focus:bg-surface focus:ring-2 focus:ring-brand-200";
}

export type TFFieldProps = {
  label: ReactNode;
  /** Rendered under the control when there is no error. */
  hint?: ReactNode;
  /** Rendered under the control, marked invalid, and referenced by the input. */
  error?: ReactNode;
  /** Marks the control as required for assistive tech (and shows an asterisk). */
  required?: boolean;
  /** Shown at the right of the label row — a counter, a "查看" link. */
  labelAction?: ReactNode;
  className?: string;
  /** Receives the generated ids so the control can wire itself up. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

export function TFField({ label, hint, error, required, labelAction, className, children }: TFFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-caption font-medium text-content-muted">
          {label}
          {required ? (
            <span className="ml-0.5 text-danger-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {labelAction}
      </div>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 break-words text-caption text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 break-words text-caption text-content-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type TFInputProps = {
  /** Marks the field invalid and wires `aria-invalid`. */
  invalid?: boolean;
  /** Ids of the element(s) describing this control. */
  describedBy?: string;
  /** Leading adornment inside the box, e.g. a search icon. */
  leading?: ReactNode;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export const TFInput = forwardRef<HTMLInputElement, TFInputProps>(function TFInput(
  { invalid, describedBy, leading, className, ...rest },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        CONTROL_BASE,
        controlState(invalid),
        "h-11 px-3.5 text-ui",
        /* A leading icon needs the text to clear it. */
        Boolean(leading) && "pl-10",
        className,
      )}
      {...rest}
    />
  );

  if (!leading) return control;

  return (
    <span className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle">{leading}</span>
      {control}
    </span>
  );
});

export type TFTextareaProps = {
  invalid?: boolean;
  describedBy?: string;
  className?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">;

export const TFTextarea = forwardRef<HTMLTextAreaElement, TFTextareaProps>(function TFTextarea(
  { invalid, describedBy, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(CONTROL_BASE, controlState(invalid), "resize-none px-3.5 py-2.5 text-ui", className)}
      {...rest}
    />
  );
});

/**
 * TFSearch — the search box, which is its own thing.
 *
 * A search field is never part of a form submission, always has a leading icon,
 * and needs a clear affordance once it has a value. Baking that in stops the
 * three different search boxes the audit found (rounded-full here, rounded-2xl
 * there, different heights) from reappearing.
 */
export type TFSearchProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name. Defaults to the placeholder. */
  label?: string;
  onClear?: () => void;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "value" | "onChange" | "placeholder">;

export function TFSearch({
  value,
  onValueChange,
  placeholder = "搜索",
  label,
  onClear,
  className,
  ...rest
}: TFSearchProps) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn(
          CONTROL_BASE,
          controlState(false),
          "h-11 pl-10 pr-10 text-ui [&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...rest}
      />
      {value && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="清除搜索"
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-content-subtle hover:bg-surface-sunken hover:text-content"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
