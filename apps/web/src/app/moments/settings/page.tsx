"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, ShieldCheck, SlidersHorizontal, Unplug } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFBadge, TFButton, TFDialog, TFInput, TFLoadingRegion, TFSkeleton } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { useT, type MsgKey } from "@/lib/i18n";

type Platform = { id: string; label: string; icon: string; color: string; connectedLabel: string };
type Binding = { platform: string; handle: string; displayName: string | null; syncEnabled: boolean };
type Setting = {
  syncEnabled: boolean;
  visibleTo: string;
  filterSensitive: boolean;
  showPhotos: boolean;
  showVideos: boolean;
  showTexts: boolean;
  showReels: boolean;
  showLives: boolean;
};

type ToggleKey = "syncEnabled" | "filterSensitive" | "showPhotos" | "showVideos" | "showTexts" | "showReels" | "showLives";

export default function MomentsSettingsPage() {
  const { t } = useT();
  const router = useRouter();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The platform whose unbind is awaiting confirmation. */
  const [pendingUnbind, setPendingUnbind] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [platformList, bindingList, current] = await Promise.all([
        apiFetch<Platform[]>("/moments/platforms"),
        apiFetch<Binding[]>("/moments/bindings"),
        apiFetch<Setting>("/moments/settings"),
      ]);
      setPlatforms(platformList);
      setBindings(bindingList);
      setSetting(current);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("ms.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  async function bind(platform: string) {
    const handle = (handles[platform] ?? "").trim().replace(/^@+/, "");
    if (!handle) {
      setError(t("ms.needHandle"));
      return;
    }
    setActing(platform);
    setError("");
    try {
      await apiFetch("/moments/bindings", { method: "POST", body: { platform, handle } });
      setHandles((current) => ({ ...current, [platform]: "" }));
      await load();
      flashSaved();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("ms.bindFailed"));
    } finally {
      setActing(null);
    }
  }

  /**
   * Unbinding asks first — but through the app's own dialog, not `window.confirm`.
   *
   * This was the last `window.confirm` in the member app. It sat inconsistently
   * next to `/moments`'s post deletion, which already used `TFDialog`, for two
   * comparably destructive actions. Opening the dialog is all this does; nothing
   * leaves the server until the confirm button is pressed.
   */
  function unbind(platform: string) {
    setPendingUnbind(platform);
  }

  async function confirmUnbind() {
    if (!pendingUnbind) return;
    const platform = pendingUnbind;
    setActing(platform);
    try {
      await apiFetch(`/moments/bindings/${platform}`, { method: "DELETE" });
      setPendingUnbind(null);
      await load();
      flashSaved();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("ms.unbindFailed"));
    } finally {
      setActing(null);
    }
  }

  async function togglePlatform(platform: string, syncEnabled: boolean) {
    setActing(platform);
    try {
      await apiFetch(`/moments/bindings/${platform}`, { method: "PATCH", body: { syncEnabled } });
      setBindings((current) => current.map((item) => (item.platform === platform ? { ...item, syncEnabled } : item)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("ms.toggleFailed"));
    } finally {
      setActing(null);
    }
  }

  async function updateSetting(patch: Partial<Setting>) {
    const previous = setting;
    if (previous) setSetting({ ...previous, ...patch });
    try {
      const next = await apiFetch<Setting>("/moments/settings", { method: "PATCH", body: patch });
      setSetting(next);
      flashSaved();
    } catch (requestError) {
      if (previous) setSetting(previous);
      setError(requestError instanceof Error ? requestError.message : t("ms.saveFailed"));
    }
  }

  const bound = (platform: string) => bindings.find((item) => item.platform === platform);
  const boundCount = bindings.filter((item) => item.syncEnabled).length;

  return (
    <PhoneShell>
      <ScreenHeader
        title={t("ms.title")}
        backHref="/moments"
        action={
          saved ? (
            <TFBadge tone="success">
              <Check size={12} aria-hidden="true" />
              {t("ms.saved")}
            </TFBadge>
          ) : undefined
        }
      />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        {/* The honesty notice. It states plainly that no platform is actually
            connected yet and that everything shown is sample data — the kind of
            claim that should be impossible to miss, so it keeps warning colours. */}
        <div className="rounded-card border border-warning-200 bg-warning-50 p-4 text-caption leading-5 text-warning-800">
          <p className="font-semibold">{t("ms.noticeTitle")}</p>
          <p className="mt-1">
            {t("ms.noticeBody")}
          </p>
        </div>
        <p className="mt-3 rounded-card bg-surface-sunken p-4 text-caption leading-5 text-content-muted">
          {t("ms.intro", { count: boundCount })}
        </p>
        {error ? (
          <p role="alert" className="mt-3 break-words text-caption text-danger-600">
            {error}
          </p>
        ) : null}

        {loading ? (
          <TFLoadingRegion label={t("ms.loading")}>
            <div className="mt-5 space-y-3">
              <TFSkeleton shape="block" className="h-20 w-full" />
              <TFSkeleton shape="block" className="h-20 w-full" />
              <TFSkeleton shape="block" className="h-32 w-full" />
            </div>
          </TFLoadingRegion>
        ) : (
          <>
            <section className="mt-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-ui font-semibold text-content">
                  <Link2 size={16} className="text-brand-500" aria-hidden="true" />
                  {t("ms.syncHeading")}
                </h2>
                <Toggle
                  checked={Boolean(setting?.syncEnabled)}
                  label={t("ms.masterToggle")}
                  onClick={() => void updateSetting({ syncEnabled: !setting?.syncEnabled })}
                />
              </div>
              <div className="mt-3 space-y-2">
                {platforms
                  .filter((item) => item.id !== "TALKFIRST")
                  .map((item) => {
                    const binding = bound(item.id);
                    return (
                      <div key={item.id} className="rounded-card border border-border bg-surface p-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-control text-caption font-semibold text-white"
                            style={{ background: item.color }}
                          >
                            {item.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-ui font-medium text-content">{item.label}</p>
                            <p className="truncate text-caption text-content-muted">
                              {binding ? `@${binding.handle}` : item.connectedLabel}
                            </p>
                          </div>
                          {binding ? (
                            <Toggle
                              checked={binding.syncEnabled}
                              label={t("ms.syncToggleAria", { platform: item.label })}
                              busy={acting === item.id}
                              onClick={() => void togglePlatform(item.id, !binding.syncEnabled)}
                            />
                          ) : (
                            <TFBadge tone="neutral" className="shrink-0">
                              {t("ms.unbound")}
                            </TFBadge>
                          )}
                        </div>
                        {!binding ? (
                          <div className="mt-2.5 flex gap-2">
                            {/* `aria-label="{平台}账号"` is how a member (and any
                                future test) addresses this field. */}
                            <TFInput
                              value={handles[item.id] ?? ""}
                              onChange={(event) => setHandles((current) => ({ ...current, [item.id]: event.target.value }))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void bind(item.id);
                              }}
                              placeholder={t("ms.handlePlaceholder", { platform: item.label })}
                              maxLength={128}
                              aria-label={t("ms.handleAria", { platform: item.label })}
                              className="min-w-0 flex-1"
                            />
                            <TFButton
                              className="shrink-0"
                              onClick={() => void bind(item.id)}
                              disabled={acting === item.id && acting !== null}
                              loading={acting === item.id}
                              loadingLabel={t("ms.binding")}
                            >
                              {t("ms.bind")}
                            </TFButton>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => unbind(item.id)}
                            className="mt-2.5 flex items-center gap-1 rounded-control px-1.5 py-1 text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken"
                          >
                            <Unplug size={13} aria-hidden="true" />
                            {t("ms.unbindPlatform")}
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>

            {setting ? (
              <>
                <section className="mt-6">
                  <h2 className="flex items-center gap-1.5 text-ui font-semibold text-content">
                    <ShieldCheck size={16} className="text-brand-500" aria-hidden="true" />
                    {t("ms.privacyHeading")}
                  </h2>
                  <p className="mt-1 text-caption text-content-muted">{t("ms.privacyHint")}</p>
                  {/* A real `radiogroup`: the three options are mutually exclusive,
                      and each carries `aria-checked` so the state is announced
                      rather than only tinted. */}
                  <div role="radiogroup" aria-label={t("ms.visibleAria")} className="mt-3 space-y-1 rounded-card border border-border p-2">
                    {(
                      [
                        ["everyone", "ms.visEveryone", "ms.visEveryoneDesc"],
                        ["connections", "ms.visConnections", "ms.visConnectionsDesc"],
                        ["private", "ms.visPrivate", "ms.visPrivateDesc"],
                      ] as const
                    ).map(([value, labelKey, descKey]) => {
                      const active = setting.visibleTo === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => void updateSetting({ visibleTo: value })}
                          className={`flex w-full items-center justify-between gap-3 rounded-row px-3 py-2.5 text-left text-ui transition-colors duration-instant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
                            active ? "bg-brand-50" : "hover:bg-surface-sunken"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className={`block ${active ? "font-medium text-brand-600" : "text-content"}`}>{t(labelKey)}</span>
                            <span className="block text-caption text-content-muted">{t(descKey)}</span>
                          </span>
                          <span
                            aria-hidden="true"
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                              active ? "border-brand-500 bg-brand-500 text-white" : "border-border text-transparent"
                            }`}
                          >
                            <Check size={12} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="mt-6">
                  <h2 className="flex items-center gap-1.5 text-ui font-semibold text-content">
                    <SlidersHorizontal size={16} className="text-brand-500" aria-hidden="true" />
                    {t("ms.filterHeading")}
                  </h2>
                  <div className="mt-3 divide-y divide-border rounded-card border border-border px-4">
                    {(
                      [
                        ["showPhotos", "ms.fPhotos", "ms.fPhotosDesc"],
                        ["showVideos", "ms.fVideos", "ms.fVideosDesc"],
                        ["showTexts", "ms.fTexts", "ms.fTextsDesc"],
                        ["showReels", "ms.fReels", "ms.fReelsDesc"],
                        ["showLives", "ms.fLives", "ms.fLivesDesc"],
                        ["filterSensitive", "ms.fSensitive", "ms.fSensitiveDesc"],
                      ] as Array<[ToggleKey, MsgKey, MsgKey]>
                    ).map(([key, labelKey, descKey]) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-3">
                        <span className="min-w-0">
                          <span className="block text-ui font-medium text-content">{t(labelKey)}</span>
                          <span className="block text-caption text-content-muted">{t(descKey)}</span>
                        </span>
                        <Toggle checked={setting[key]} label={t(labelKey)} onClick={() => void updateSetting({ [key]: !setting[key] } as Partial<Setting>)} />
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}

        <TFButton variant="secondary" fullWidth className="mt-6" onClick={() => router.push("/moments")}>
          {t("ms.done")}
        </TFButton>
      </div>

      {/* The unbind confirmation, in the app's own dialog. Copy is kept verbatim
          from the `window.confirm` it replaces, because it makes a promise the
          member relies on: synced posts survive the unbind. */}
      <TFDialog
        open={pendingUnbind !== null}
        onClose={() => setPendingUnbind(null)}
        title={t("ms.unbindTitle")}
        description={t("ms.unbindBody")}
        footer={
          <>
            <TFButton variant="secondary" className="flex-1" onClick={() => setPendingUnbind(null)}>
              {t("ms.cancel")}
            </TFButton>
            <TFButton
              variant="danger"
              className="flex-1"
              onClick={() => void confirmUnbind()}
              loading={acting === pendingUnbind && pendingUnbind !== null}
              loadingLabel={t("ms.unbinding")}
              data-testid="unbind-confirm"
            >
              {t("ms.unbindConfirm")}
            </TFButton>
          </>
        }
      >
        {pendingUnbind ? (
          <p className="break-words text-caption leading-5 text-content-muted">
            {t("ms.aboutToUnbind")}
            {platforms.find((item) => item.id === pendingUnbind)?.label ?? pendingUnbind}
            {bound(pendingUnbind)?.handle ? `（@${bound(pendingUnbind)?.handle}）` : ""}
          </p>
        ) : null}
      </TFDialog>
    </PhoneShell>
  );
}

/**
 * A switch. `role="switch"` + `aria-checked` + a required `aria-label` — the
 * previous version had the role and the state but no name, so a screen reader
 * announced an unlabelled switch.
 *
 * The knob translates rather than being repositioned with `left-[22px]` /
 * `left-0.5`, so it animates on the compositor and respects the global
 * `prefers-reduced-motion` rule.
 */
function Toggle({ checked, label, busy, onClick }: { checked: boolean; label: string; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-fast ease-out disabled:opacity-60 ${
        checked ? "bg-brand-500" : "bg-neutral-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-surface shadow-card transition-transform duration-fast ease-out motion-reduce:transition-none ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
