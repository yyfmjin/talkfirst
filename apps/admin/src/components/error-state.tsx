import type { ReactNode } from "react";

/**
 * The one refusal / failure panel.
 *
 * Callers pass the message **verbatim** from the API (or from their own
 * `friendlyError`), because the browser suites assert on that exact copy — a
 * 403 has to say why, and a 500 must not be dressed up as a success.
 *
 * `testId` stays on the outer element: the C-era suites locate the refusal by
 * `[data-testid$="-error"]` and assert the panel is absent on permitted screens.
 */
export type ErrorStateProps = {
  message: ReactNode;
  onRetry?: () => void;
  /** Label while a retry is in flight; also the retry button's busy text. */
  retrying?: boolean;
  retryLabel?: string;
  testId?: string;
  className?: string;
};

export function ErrorState({
  message,
  onRetry,
  retrying = false,
  retryLabel = "重试",
  testId,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      {...(testId ? { "data-testid": testId } : {})}
      className={`rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 ${className}`}
    >
      <p className="text-[13px] leading-5 text-danger">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="tf-btn tf-btn-sm mt-3 border-[#FCA5A5] bg-card hover:bg-danger-wash"
        >
          {retrying ? `${retryLabel}中…` : retryLabel}
        </button>
      ) : null}
    </div>
  );
}
