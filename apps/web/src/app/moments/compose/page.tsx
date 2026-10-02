"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  MapPin,
  Play,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/errors";
import { useSession } from "@/lib/session";

/**
 * PC-3.6 — 「发布动态」composer.
 *
 * This screen is a rewrite of the old three-card, raw-URL form. It answers the
 * four questions a member opens it with — where do I type, how do I add a photo
 * or clip, who can see it, how do I post — with one continuous column instead
 * of stacked boxes:
 *
 *   identity + visibility chip → borderless body → media → optional details →
 *   sticky CTA.
 *
 * Everything that reads or writes a moment goes through the existing endpoints
 * (`POST /moments`, `PATCH /moments/settings`, `POST /uploads/moment-media`); no
 * business rule is re-implemented here. Media is picked from the device and
 * uploaded before publish, so raw URLs never surface.
 */

const MAX_CONTENT = 2000;
const MAX_IMAGES = 9;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"];
const RECENT_TAG_KEY = "tf.moment.tags.recent";

type Kind = "image" | "video";
type Status = "uploading" | "done" | "error";

type MediaItem = {
  id: string;
  kind: Kind;
  name: string;
  file: File;
  /** Object URL for the local preview; revoked when the item leaves. */
  previewUrl: string;
  status: Status;
  url?: string;
  error?: string;
};

type VisibilityValue = "everyone" | "connections" | "private";

const VISIBILITY_OPTIONS: Array<{ value: VisibilityValue; label: string; hint: string; icon: typeof Globe }> = [
  { value: "everyone", label: "公开", hint: "任何人都能看到这条动态", icon: Globe },
  { value: "connections", label: "仅好友", hint: "只有互相连接的朋友能看到", icon: Users },
  { value: "private", label: "仅自己", hint: "只有你自己能看到", icon: Lock },
];

const VISIBILITY_LABEL: Record<VisibilityValue, string> = {
  everyone: "公开",
  connections: "仅好友",
  private: "仅自己",
};

const HOT_TOPICS = ["旅行", "美食", "音乐", "游戏", "摄影", "电影", "学习", "运动"];

function isVisibility(value: unknown): value is VisibilityValue {
  return value === "everyone" || value === "connections" || value === "private";
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function ComposePage() {
  const router = useRouter();
  const { user } = useSession();

  const [content, setContent] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [visibleTo, setVisibleTo] = useState<VisibilityValue>("everyone");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  // Panels / sheets.
  const [sheet, setSheet] = useState<null | "media" | "visibility">(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [topicQuery, setTopicQuery] = useState("");
  const [recentTags, setRecentTags] = useState<string[]>([]);
  const [locationOpen, setLocationOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  /**
   * `items` drives rendering, but uploads resolve asynchronously, so the latest
   * list is also held in a ref. Reading state inside an awaited publish would
   * otherwise see the list as it was when the button was pressed.
   */
  const itemsRef = useRef<MediaItem[]>([]);
  const inflight = useRef(new Map<string, Promise<void>>());

  const commitItems = useCallback((next: MediaItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patchItem = useCallback(
    (id: string, patch: Partial<MediaItem>) => {
      commitItems(itemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    [commitItems],
  );

  const queueUpload = useCallback(
    (item: MediaItem) => {
      const promise = (async () => {
        try {
          const dataUrl = await fileToDataUrl(item.file);
          const uploaded = await apiFetch<{ url: string; kind: Kind }>("/uploads/moment-media", {
            method: "POST",
            body: { media: dataUrl },
          });
          patchItem(item.id, { status: "done", url: uploaded.url, error: undefined });
        } catch (uploadError) {
          patchItem(item.id, {
            status: "error",
            error: friendlyErrorMessage(uploadError, "上传失败"),
          });
        } finally {
          inflight.current.delete(item.id);
        }
      })();
      inflight.current.set(item.id, promise);
    },
    [patchItem],
  );

  // Revoke every object URL when the composer unmounts.
  useEffect(() => {
    const store = itemsRef;
    return () => {
      for (const item of store.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  // Prefill visibility from the stored setting; failure is non-fatal (the
  // default stays 公开 and the chip still works).
  useEffect(() => {
    let alive = true;
    void apiFetch<{ visibleTo?: string }>("/moments/settings")
      .then((setting) => {
        if (alive && isVisibility(setting.visibleTo)) setVisibleTo(setting.visibleTo);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_TAG_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentTags(parsed.filter((tag): tag is string => typeof tag === "string").slice(0, 12));
        }
      }
    } catch {
      // A corrupt value is simply ignored.
    }
  }, []);

  // Auto-grow the body, then scroll internally once it hits the cap.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [content]);

  const images = useMemo(() => items.filter((item) => item.kind === "image"), [items]);
  const video = useMemo(() => items.find((item) => item.kind === "video") ?? null, [items]);

  const hasContent = content.trim().length > 0;
  const dirty = hasContent || items.length > 0 || tags.length > 0 || location.trim().length > 0;
  const canPublish = !publishing && (hasContent || items.length > 0);

  const submitterName = user?.nickname?.trim() || "我";
  const avatarUrl = user?.avatarUrl ?? null;

  function rememberTags(next: string[]) {
    const merged = [...next, ...recentTags.filter((tag) => !next.includes(tag))].slice(0, 12);
    setRecentTags(merged);
    try {
      window.localStorage.setItem(RECENT_TAG_KEY, JSON.stringify(merged));
    } catch {
      // Storage is a convenience; failure must not block publishing.
    }
  }

  function addFiles(list: FileList | null, kind: Kind) {
    if (!list || list.length === 0) return;
    setError("");
    let next = [...itemsRef.current];
    for (const file of Array.from(list)) {
      if (kind === "image") {
        if (next.filter((item) => item.kind === "image").length >= MAX_IMAGES) {
          setError(`最多添加 ${MAX_IMAGES} 张照片`);
          break;
        }
        if (!IMAGE_MIME.includes(file.type)) {
          setError("照片仅支持 jpg / png / webp");
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`照片不能超过 ${formatBytes(MAX_IMAGE_BYTES)}`);
          continue;
        }
      } else {
        if (next.some((item) => item.kind === "video")) {
          setError("最多添加 1 个视频");
          break;
        }
        if (!VIDEO_MIME.includes(file.type)) {
          setError("视频仅支持 mp4 / webm / mov");
          continue;
        }
        if (file.size > MAX_VIDEO_BYTES) {
          setError(`视频不能超过 ${formatBytes(MAX_VIDEO_BYTES)}`);
          continue;
        }
      }
      const item: MediaItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind,
        name: file.name,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      };
      next = [...next, item];
      queueUpload(item);
    }
    commitItems(next);
  }

  function retryItem(id: string) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item) return;
    setError("");
    patchItem(id, { status: "uploading", error: undefined });
    queueUpload(item);
  }

  function removeItem(id: string) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    inflight.current.delete(id);
    commitItems(itemsRef.current.filter((entry) => entry.id !== id));
  }

  function moveItem(id: string, direction: -1 | 1) {
    const current = itemsRef.current;
    const item = current.find((entry) => entry.id === id);
    if (!item) return;
    // Reorder within the same kind: the grid lays images out in order, and a
    // clip is always a single full-width preview regardless of position.
    const siblings = current.filter((entry) => entry.kind === item.kind);
    const at = siblings.indexOf(item);
    const swapWith = siblings[at + direction];
    if (!swapWith) return;
    const a = current.indexOf(item);
    const b = current.indexOf(swapWith);
    const next = [...current];
    next[a] = swapWith;
    next[b] = item;
    commitItems(next);
  }

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag].slice(0, 10)));
  }

  async function chooseVisibility(value: VisibilityValue) {
    setSheet(null);
    if (value === visibleTo || savingVisibility) return;
    const previous = visibleTo;
    setVisibleTo(value);
    setSavingVisibility(true);
    setError("");
    try {
      await apiFetch("/moments/settings", { method: "PATCH", body: { visibleTo: value } });
    } catch (requestError) {
      setVisibleTo(previous);
      setError(friendlyErrorMessage(requestError, "可见范围保存失败，请重试。"));
    } finally {
      setSavingVisibility(false);
    }
  }

  async function publish() {
    if (!canPublish) return;
    setError("");
    if (itemsRef.current.some((item) => item.status === "error")) {
      setError("有媒体上传失败，请重试或删除后再发布。");
      return;
    }
    setPublishing(true);
    try {
      const pending = [...inflight.current.values()];
      if (pending.length > 0) await Promise.all(pending);

      if (itemsRef.current.some((item) => item.status === "error")) {
        setError("有媒体上传失败，请重试或删除后再发布。");
        setPublishing(false);
        return;
      }

      const imageUrls = itemsRef.current
        .filter((item) => item.kind === "image" && item.status === "done" && item.url)
        .map((item) => item.url as string);
      const videoItem = itemsRef.current.find(
        (item) => item.kind === "video" && item.status === "done" && item.url,
      );

      const body: { content: string; images: string[]; videoUrl?: string; tags?: string[] } = {
        // Media-only publishes still need the key: the API validates `content`
        // as a string, so an empty string is sent rather than omitting it.
        content: location.trim()
          ? `${content.trim()}\n\n📍 ${location.trim()}`.trim().slice(0, MAX_CONTENT)
          : content.trim(),
        images: imageUrls,
      };
      if (videoItem?.url) body.videoUrl = videoItem.url;
      if (tags.length > 0) body.tags = tags;

      const newTags = tags.length > 0 ? tags : [];
      await apiFetch("/moments", { method: "POST", body });
      if (newTags.length > 0) rememberTags(newTags);
      router.push("/moments");
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "发布失败，请稍后再试。"));
      setPublishing(false);
    }
  }

  function handleBack() {
    if (dirty) {
      setLeaveOpen(true);
      return;
    }
    router.push("/moments");
  }

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const filteredTopics = useMemo(() => {
    const query = topicQuery.trim().replace(/^#+/, "").toLowerCase();
    const pool = [...recentTags, ...HOT_TOPICS.filter((tag) => !recentTags.includes(tag))];
    if (!query) return pool;
    return pool.filter((tag) => tag.toLowerCase().includes(query));
  }, [recentTags, topicQuery]);

  return (
    <PhoneShell>
      <ScreenHeader title="发布动态" backHref="/moments" onBack={handleBack} />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="tf-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-3">
          {/* Identity + who-can-see, condensed to one line. */}
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#F1F3FF] text-[15px] font-semibold text-[#6572D8]">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                submitterName.slice(0, 1)
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium">{submitterName}</p>
              <button
                type="button"
                data-testid="moment-visibility"
                onClick={() => setSheet("visibility")}
                aria-label="谁可以看到"
                className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#F1F3FF] px-2.5 py-0.5 text-[11px] font-medium text-[#6572D8]"
              >
                {VISIBILITY_LABEL[visibleTo]}
                <span className="text-[9px]">▼</span>
              </button>
            </div>
          </div>

          {/* The body — borderless, grows with content, scrolls past the cap. */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="分享这一刻，或者说点什么……"
            maxLength={MAX_CONTENT}
            rows={4}
            aria-label="动态内容"
            data-testid="moment-content"
            className="mt-4 max-h-[220px] min-h-[7rem] w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-7 outline-none placeholder:text-muted/70"
          />
          <p
            data-testid="moment-counter"
            className={cn(
              "text-right text-[11px] tabular-nums",
              content.length >= MAX_CONTENT ? "text-amber-600" : "text-muted",
            )}
          >
            {content.length}/{MAX_CONTENT}
          </p>

          {/* Media grid. */}
          {items.length > 0 ? (
            <div className="mt-3 space-y-2" data-testid="moment-media-list">
              {video ? <VideoTile item={video} onRemove={() => removeItem(video.id)} onRetry={() => retryItem(video.id)} /> : null}
              {images.length > 0 ? (
                <div className={gridClasses(images.length)}>
                  {images.map((item, index) => (
                    <div key={item.id} className={cn("relative overflow-hidden rounded-2xl bg-[#F1F3FF]", tileClasses(images.length, index))} data-testid="moment-media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      <StatusOverlay item={item} />
                      <div className="absolute left-1 top-1 flex gap-1">
                        {index > 0 ? (
                          <IconButton label="前移" onClick={() => moveItem(item.id, -1)}>
                            <ArrowLeft size={13} />
                          </IconButton>
                        ) : null}
                        {index < images.length - 1 ? (
                          <IconButton label="后移" onClick={() => moveItem(item.id, 1)}>
                            <ArrowRight size={13} />
                          </IconButton>
                        ) : null}
                      </div>
                      <div className="absolute right-1 top-1">
                        <IconButton label="删除媒体" onClick={() => removeItem(item.id)}>
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                      {item.status === "error" ? (
                        <button
                          type="button"
                          onClick={() => retryItem(item.id)}
                          data-testid="moment-media-retry"
                          className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[10px] text-[#6572D8] shadow"
                        >
                          <RefreshCw size={11} />
                          重试
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            data-testid="moment-add-media"
            onClick={() => setSheet("media")}
            disabled={images.length >= MAX_IMAGES && Boolean(video)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-[13px] text-[#6572D8] transition active:scale-[0.99] disabled:opacity-50"
          >
            <ImagePlus size={16} />
            添加照片/视频
          </button>

          <input
            ref={imageInputRef}
            data-testid="moment-image-input"
            type="file"
            accept={IMAGE_MIME.join(",")}
            multiple
            className="sr-only"
            aria-label="选择照片"
            onChange={(event) => {
              addFiles(event.target.files, "image");
              event.target.value = "";
            }}
          />
          <input
            ref={videoInputRef}
            data-testid="moment-video-input"
            type="file"
            accept={VIDEO_MIME.join(",")}
            className="sr-only"
            aria-label="选择视频"
            onChange={(event) => {
              addFiles(event.target.files, "video");
              event.target.value = "";
            }}
          />

          {/* Optional details, kept collapsed until asked for. */}
          <div className="mt-4 space-y-2">
            <button
              type="button"
              data-testid="moment-topic-toggle"
              onClick={() => setTopicsOpen((open) => !open)}
              aria-expanded={topicsOpen}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-[#6572D8]"
            >
              <Hash size={13} />
              添加话题
            </button>

            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    data-testid="moment-tag"
                    className="inline-flex items-center gap-1 rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[11px] text-[#6572D8]"
                  >
                    #{tag}
                    <button type="button" aria-label={`移除话题 ${tag}`} onClick={() => toggleTag(tag)}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {topicsOpen ? (
              <div className="rounded-2xl border border-line p-3" data-testid="moment-topic-panel">
                <input
                  value={topicQuery}
                  onChange={(event) => setTopicQuery(event.target.value)}
                  placeholder="搜索或输入话题，如 旅行"
                  aria-label="搜索话题"
                  data-testid="moment-topic-input"
                  className="h-9 w-full rounded-xl border border-line px-3 text-[12px] outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {topicQuery.trim() && !filteredTopics.includes(topicQuery.trim().replace(/^#+/, "")) ? (
                  <button
                    type="button"
                    data-testid="moment-topic-create"
                    onClick={() => {
                      toggleTag(topicQuery.trim().replace(/^#+/, ""));
                      setTopicQuery("");
                    }}
                    className="mt-2 text-[12px] text-[#6572D8]"
                  >
                    使用「#{topicQuery.trim().replace(/^#+/, "")}」
                  </button>
                ) : null}
                {recentTags.length > 0 && !topicQuery ? (
                  <p className="mt-3 text-[11px] text-muted">最近使用</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {filteredTopics.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      data-testid="moment-topic-option"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px]",
                        tags.includes(tag) ? "border-transparent tf-gradient text-white" : "border-line text-[#3D4663]",
                      )}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Location */}
            {locationOpen || location ? (
              <div className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12px]">
                <MapPin size={13} className="shrink-0 text-[#6572D8]" />
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="你在哪里？"
                  maxLength={40}
                  aria-label="位置"
                  data-testid="moment-location-input"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
                <button
                  type="button"
                  aria-label="清除位置"
                  onClick={() => {
                    setLocation("");
                    setLocationOpen(false);
                  }}
                >
                  <X size={13} className="text-muted" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="moment-location-toggle"
                onClick={() => setLocationOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-[#6572D8]"
              >
                <MapPin size={13} />
                添加位置
              </button>
            )}
          </div>

          {error ? (
            <p role="alert" data-testid="moment-error" className="mt-3 break-words text-[12px] text-red-500">
              {error}
            </p>
          ) : null}
        </div>

        {/* Sticky CTA — the single strongest action on the screen. */}
        <div className="shrink-0 border-t border-line/70 bg-white px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <GradientButton
            onClick={() => void publish()}
            disabled={!canPublish}
            className="shadow-lg"
          >
            {publishing ? "发布中…" : "发布"}
          </GradientButton>
        </div>

        {/* Media source picker. */}
        <Sheet open={sheet === "media"} onClose={() => setSheet(null)} title="添加照片/视频">
          <div className="space-y-2">
            <SheetOption
              icon={<ImagePlus size={17} />}
              label="照片"
              hint="jpg / png / webp，最多 9 张"
              onClick={() => {
                setSheet(null);
                imageInputRef.current?.click();
              }}
            />
            <SheetOption
              icon={<Play size={17} />}
              label="视频"
              hint="mp4 / webm / mov，最多 1 个"
              disabled={Boolean(video)}
              onClick={() => {
                setSheet(null);
                videoInputRef.current?.click();
              }}
            />
          </div>
        </Sheet>

        {/* Visibility picker. */}
        <Sheet open={sheet === "visibility"} onClose={() => setSheet(null)} title="谁可以看到">
          <div className="space-y-2">
            {VISIBILITY_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = visibleTo === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  data-testid={`moment-visibility-${option.value}`}
                  aria-pressed={active}
                  disabled={savingVisibility}
                  onClick={() => void chooseVisibility(option.value)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition disabled:opacity-60",
                    active ? "border-[#8B6CFF] bg-[#F4F1FF]" : "border-line",
                  )}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[#6572D8]">
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{option.label}</span>
                    <span className="block text-[11px] text-muted">{option.hint}</span>
                  </span>
                  {active ? <Check size={16} className="shrink-0 text-[#6572D8]" /> : null}
                </button>
              );
            })}
          </div>
        </Sheet>

        {/* Leave guard — only when there is something to lose. */}
        {leaveOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="放弃这条动态"
            data-testid="moment-leave-dialog"
            className="absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-black/30 p-5"
          >
            <div className="w-full max-w-[320px] rounded-3xl bg-white p-5 text-center shadow-xl">
              <p className="text-[15px] font-semibold">放弃这条动态？</p>
              <p className="mt-1 text-[12px] leading-5 text-muted">你编辑的内容还没有发布，离开后将不会保存。</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  data-testid="moment-leave-cancel"
                  onClick={() => setLeaveOpen(false)}
                  className="h-10 min-w-0 flex-1 rounded-full border border-line text-[13px] text-[#3D4663]"
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  data-testid="moment-leave-confirm"
                  onClick={() => {
                    setLeaveOpen(false);
                    router.push("/moments");
                  }}
                  className="h-10 min-w-0 flex-1 rounded-full bg-[#6572D8] text-[13px] text-white"
                >
                  放弃
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </PhoneShell>
  );
}

function gridClasses(count: number) {
  if (count === 1) return "grid grid-cols-1";
  if (count === 2) return "grid grid-cols-2 gap-2";
  if (count === 3) return "grid aspect-[3/2] grid-cols-3 grid-rows-2 gap-2";
  if (count === 4) return "grid grid-cols-2 gap-2";
  return "grid grid-cols-3 gap-2";
}

function tileClasses(count: number, index: number) {
  if (count === 1) return "aspect-[4/3]";
  if (count === 3) return index === 0 ? "col-span-2 row-span-2 h-full" : "h-full";
  return "aspect-square";
}

function StatusOverlay({ item }: { item: MediaItem }) {
  if (item.status === "uploading") {
    return (
      <span
        data-testid="moment-media-uploading"
        className="absolute inset-0 grid place-items-center bg-black/35 text-white"
      >
        <Loader2 size={20} className="animate-spin" />
      </span>
    );
  }
  if (item.status === "error") {
    return (
      <span
        data-testid="moment-media-error"
        className="absolute inset-0 grid place-items-center bg-black/45 px-2 text-center text-[10px] text-white"
      >
        上传失败
      </span>
    );
  }
  return null;
}

function VideoTile({ item, onRemove, onRetry }: { item: MediaItem; onRemove: () => void; onRetry: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black" data-testid="moment-media-video">
      <video src={item.previewUrl} className="aspect-video w-full object-cover" muted playsInline preload="metadata" />
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-black/45 text-white">
          <Play size={20} fill="currentColor" />
        </span>
      </span>
      <StatusOverlay item={item} />
      <div className="absolute right-1 top-1">
        <IconButton label="删除媒体" onClick={onRemove}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      {item.status === "error" ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="moment-media-retry"
          className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[10px] text-[#6572D8] shadow"
        >
          <RefreshCw size={11} />
          重试
        </button>
      ) : null}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur"
    >
      {children}
    </button>
  );
}

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <p className="mb-3 text-center text-[14px] font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function SheetOption({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border border-line px-3 py-3 text-left transition active:scale-[0.99] disabled:opacity-50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#EEF1FF] text-[#5B6BD6]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  );
}
