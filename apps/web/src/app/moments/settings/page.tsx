"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, ShieldCheck, SlidersHorizontal, Unplug } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFBadge, TFButton, TFDialog, TFInput, TFLoadingRegion, TFSkeleton } from "@/components/tf";
import { apiFetch } from "@/lib/api";

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
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError("先填写该平台的账号昵称");
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
      setError(requestError instanceof Error ? requestError.message : "绑定失败");
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
      setError(requestError instanceof Error ? requestError.message : "解绑失败");
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
      setError(requestError instanceof Error ? requestError.message : "切换失败");
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
      setError(requestError instanceof Error ? requestError.message : "设置失败");
    }
  }

  const bound = (platform: string) => bindings.find((item) => item.platform === platform);
  const boundCount = bindings.filter((item) => item.syncEnabled).length;

  return (
    <PhoneShell>
      <ScreenHeader
        title="我的动态设置"
        backHref="/moments"
        action={
          saved ? (
            <TFBadge tone="success">
              <Check size={12} aria-hidden="true" />
              已保存
            </TFBadge>
          ) : undefined
        }
      />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        {/* The honesty notice. It states plainly that no platform is actually
            connected yet and that everything shown is sample data — the kind of
            claim that should be impossible to miss, so it keeps warning colours. */}
        <div className="rounded-card border border-warning-200 bg-warning-50 p-4 text-caption leading-5 text-warning-800">
          <p className="font-semibold">示例内容说明</p>
          <p className="mt-1">
            TalkFirst 目前尚未接入 Instagram、X、TikTok 等平台的官方授权，暂不会拉取你的真实动态。
            绑定账号后展示的内容为<b>示例数据</b>，仅用于预览界面效果，均标注为「示例」。
            真实同步功能正在开发中。
          </p>
        </div>
        <p className="mt-3 rounded-card bg-surface-sunken p-4 text-caption leading-5 text-content-muted">
          同步你在其他社交平台的最新动态，让朋友了解真实的你。默认只同步你绑定的平台，可随时关闭。已绑定 {boundCount} 个平台。
        </p>
        {error ? (
          <p role="alert" className="mt-3 break-words text-caption text-danger-600">
            {error}
          </p>
        ) : null}

        {loading ? (
          <TFLoadingRegion label="正在加载动态设置">
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
                  同步其他社交平台动态
                </h2>
                <Toggle
                  checked={Boolean(setting?.syncEnabled)}
                  label="动态总开关"
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
                              label={`${item.label}同步开关`}
                              busy={acting === item.id}
                              onClick={() => void togglePlatform(item.id, !binding.syncEnabled)}
                            />
                          ) : (
                            <TFBadge tone="neutral" className="shrink-0">
                              未绑定
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
                              placeholder={`填写${item.label}账号，如 yuki_travel`}
                              maxLength={128}
                              aria-label={`${item.label}账号`}
                              className="min-w-0 flex-1"
                            />
                            <TFButton
                              className="shrink-0"
                              onClick={() => void bind(item.id)}
                              disabled={acting === item.id && acting !== null}
                              loading={acting === item.id}
                              loadingLabel="绑定中…"
                            >
                              绑定
                            </TFButton>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => unbind(item.id)}
                            className="mt-2.5 flex items-center gap-1 rounded-control px-1.5 py-1 text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken"
                          >
                            <Unplug size={13} aria-hidden="true" />
                            解绑该平台
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
                    隐私设置
                  </h2>
                  <p className="mt-1 text-caption text-content-muted">谁可以看到你在 TalkFirst 的动态聚合页。</p>
                  {/* A real `radiogroup`: the three options are mutually exclusive,
                      and each carries `aria-checked` so the state is announced
                      rather than only tinted. */}
                  <div role="radiogroup" aria-label="谁能看到你的动态聚合页" className="mt-3 space-y-1 rounded-card border border-border p-2">
                    {(
                      [
                        ["everyone", "所有人可见", "推荐流和个人主页都可见"],
                        ["connections", "仅连接可见", "只有互相连接的朋友可见"],
                        ["private", "仅自己可见", "别人打不开你的动态页"],
                      ] as const
                    ).map(([value, label, desc]) => {
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
                            <span className={`block ${active ? "font-medium text-brand-600" : "text-content"}`}>{label}</span>
                            <span className="block text-caption text-content-muted">{desc}</span>
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
                    动态内容筛选
                  </h2>
                  <div className="mt-3 divide-y divide-border rounded-card border border-border px-4">
                    {(
                      [
                        ["showPhotos", "照片", "同步 Instagram 等图片"],
                        ["showVideos", "视频", "同步短视频和频道视频"],
                        ["showTexts", "文字动态", "同步 X 等纯文字"],
                        ["showReels", "Reels / 短视频", "多图时保留滑动组图"],
                        ["showLives", "故事", "默认不同步故事"],
                        ["filterSensitive", "过滤敏感内容", "自动打码邮箱电话等联系方式"],
                      ] as Array<[ToggleKey, string, string]>
                    ).map(([key, label, desc]) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-3">
                        <span className="min-w-0">
                          <span className="block text-ui font-medium text-content">{label}</span>
                          <span className="block text-caption text-content-muted">{desc}</span>
                        </span>
                        <Toggle checked={setting[key]} label={label} onClick={() => void updateSetting({ [key]: !setting[key] } as Partial<Setting>)} />
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}

        <TFButton variant="secondary" fullWidth className="mt-6" onClick={() => router.push("/moments")}>
          完成
        </TFButton>
      </div>

      {/* The unbind confirmation, in the app's own dialog. Copy is kept verbatim
          from the `window.confirm` it replaces, because it makes a promise the
          member relies on: synced posts survive the unbind. */}
      <TFDialog
        open={pendingUnbind !== null}
        onClose={() => setPendingUnbind(null)}
        title="确定解绑该平台吗？"
        description="已展示的动态会保留。"
        footer={
          <>
            <TFButton variant="secondary" className="flex-1" onClick={() => setPendingUnbind(null)}>
              取消
            </TFButton>
            <TFButton
              variant="danger"
              className="flex-1"
              onClick={() => void confirmUnbind()}
              loading={acting === pendingUnbind && pendingUnbind !== null}
              loadingLabel="解绑中…"
              data-testid="unbind-confirm"
            >
              确认解绑
            </TFButton>
          </>
        }
      >
        {pendingUnbind ? (
          <p className="break-words text-caption leading-5 text-content-muted">
            将要解绑：
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
