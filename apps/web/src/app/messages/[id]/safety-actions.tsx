"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TFButton, TFTextarea } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { REPORT_REASONS, reportReasonKey } from "@/lib/report-reasons";
import { useT } from "@/lib/i18n";

/**
 * The block / report menu for one conversation.
 *
 * It used to bail out with `if (!peerId) return null` while `peerId` came from
 * socket presence, so a websocket that never connected removed the button
 * entirely — leaving a user with no way to block or report a harasser. The
 * caller now passes the peer id from the conversation data; `onRetry` covers
 * the only remaining gap (that fetch failing) by keeping the menu reachable
 * instead of invisible.
 */
export default function SafetyActions({
  peerId,
  peerName,
  onRetry,
}: {
  peerId: string | null;
  peerName: string;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report" | "block">("menu");
  const [reason, setReason] = useState("Harassment");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submitReport() {
    if (!peerId) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/reports", {
        method: "POST",
        body: { userId: peerId, reason, description: description.trim() || undefined },
      });
      setMessage(t("sy.reported"));
      setMode("menu");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : t("sy.reportFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlock() {
    if (!peerId) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/blocks", { method: "POST", body: { userId: peerId } });
      router.push("/messages");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : t("sy.blockFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMode("menu");
          setMessage("");
        }}
        aria-label={t("sy.menuAria")}
        aria-haspopup="dialog"
        className="grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <span aria-hidden="true" className="text-heading leading-none">⋯</span>
      </button>

      {open ? (
        /*
         * `absolute`, not `fixed` — the overlay must stay inside the phone frame
         * (see `phone-shell.tsx`). The sheet shape, scrim token, radius and safe
         * area all come from the same definitions `TFSheet` uses.
         */
        <div
          className="absolute inset-0 z-30 flex items-end justify-center bg-surface-scrim"
          role="dialog"
          aria-modal="true"
          aria-label={t("sy.sheetAria", { name: peerName })}
        >
          <div className="tf-scroll max-h-[85%] w-full overflow-y-auto rounded-t-sheet bg-surface p-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            {mode === "menu" ? (
              <>
                <h2 className="text-heading font-semibold text-content">{t("sy.settingsHeading", { name: peerName })}</h2>
                {peerId ? (
                  <>
                    <div className="mt-4 space-y-2">
                      <TFButton variant="secondary" fullWidth onClick={() => setMode("report")}>
                        {t("sy.reportUser")}
                      </TFButton>
                      <TFButton variant="secondary" fullWidth onClick={() => setMode("block")}>
                        {t("sy.block")}
                      </TFButton>
                      <TFButton variant="ghost" fullWidth onClick={() => setOpen(false)}>
                        {t("sy.cancel")}
                      </TFButton>
                    </div>
                    <p className="mt-3 text-caption leading-4 text-content-subtle">
                      {t("sy.menuNote")}
                    </p>
                  </>
                ) : (
                  /* Reachable but not yet actionable: the peer identity has not
                     loaded, so reporting would have no `userId` to send. This
                     beats the old behaviour of hiding the entry point. */
                  <>
                    <p className="mt-3 text-caption leading-5 text-content-muted">
                      {t("sy.peerUnknown")}
                    </p>
                    <div className="mt-4 space-y-2">
                      {onRetry ? (
                        <TFButton variant="secondary" fullWidth onClick={onRetry}>
                          {t("sy.retry")}
                        </TFButton>
                      ) : null}
                      <TFButton variant="ghost" fullWidth onClick={() => setOpen(false)}>
                        {t("sy.cancel")}
                      </TFButton>
                    </div>
                  </>
                )}
              </>
            ) : null}

            {mode === "report" ? (
              <>
                <h2 className="text-heading font-semibold text-content">{t("sy.reportHeading")}</h2>
                {/* `data-reason` mirrors the moment report dialog, which the suite
                    selects on (`[data-testid="moment-report-reason"][data-reason=…]`).
                    Same two surfaces, same contract. */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {REPORT_REASONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      data-testid="chat-report-reason"
                      data-reason={item}
                      aria-pressed={reason === item}
                      onClick={() => setReason(item)}
                      className={cn(
                        "rounded-row border px-3 py-2.5 text-left text-caption transition-[background-color,border-color] duration-instant ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                        reason === item
                          ? "border-brand-500 bg-brand-50 font-medium text-content"
                          : "border-border bg-surface text-content hover:bg-surface-sunken",
                      )}
                    >
                      {t(reportReasonKey(item))}
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <label htmlFor="chat-report-description" className="mb-1.5 block text-caption font-medium text-content-muted">
                    {t("sy.descriptionLabel")}
                  </label>
                  <TFTextarea
                    id="chat-report-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder={t("sy.descriptionPlaceholder")}
                  />
                </div>
                <div className="mt-4 flex gap-2">
                  <TFButton variant="secondary" className="flex-1" onClick={() => setMode("menu")}>
                    {t("sy.back")}
                  </TFButton>
                  <TFButton
                    className="flex-[2]"
                    onClick={() => void submitReport()}
                    disabled={!reason}
                    loading={busy}
                    loadingLabel={t("sy.submitting")}
                  >
                    {t("sy.submitReport")}
                  </TFButton>
                </div>
                {!reason ? (
                  <p className="mt-2 text-caption text-content-subtle">{t("sy.needReason")}</p>
                ) : null}
              </>
            ) : null}

            {mode === "block" ? (
              <>
                <h2 className="text-heading font-semibold text-content">{t("sy.blockHeading")}</h2>
                <p className="mt-2 text-ui leading-6 text-content-muted">
                  {t("sy.blockNote")}
                </p>
                <div className="mt-4 flex gap-2">
                  <TFButton variant="secondary" className="flex-1" onClick={() => setMode("menu")}>
                    {t("sy.back")}
                  </TFButton>
                  <TFButton
                    variant="danger"
                    className="flex-[2]"
                    onClick={() => void confirmBlock()}
                    loading={busy}
                    loadingLabel={t("sy.processing")}
                  >
                    {t("sy.confirmBlock")}
                  </TFButton>
                </div>
              </>
            ) : null}

            {message ? (
              <p role="status" className="mt-3 break-words text-caption text-content-muted">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
