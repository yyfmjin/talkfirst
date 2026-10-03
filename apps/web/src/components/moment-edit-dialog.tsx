"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { TFButton, TFDialog, TFTextarea } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/errors";

/**
 * 修改已发布的动态。
 *
 * This dialog used to edit the body and the tags only, and nothing rendered it:
 * the detail screen imported it and never mounted it, so a member who had
 * published something had no way to correct it — only to delete it. All four
 * fields the PATCH route accepts are editable now, and the media half mirrors
 * the composer's rules (`POST /uploads/moment-media`, one request per item, 9
 * photos, 1 clip) instead of re-implementing them.
 *
 * Two states matter and are kept separate:
 *
 *  - a media item that is already on the moment (`stored`) keeps its server URL
 *    and is never re-uploaded;
 *  - a newly picked one carries a local object URL and a `file`, and only
 *    becomes part of the payload once the upload answered.
 *
 * `open` resets the draft, and the caller also remounts through `key`, so a
 * cancelled edit can never leak into the next one.
 */

const MAX_CONTENT = 2000;
const MAX_IMAGES = 9;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"];

type Kind = "image" | "video";
type Status = "stored" | "uploading" | "ready" | "error";

/** Exactly what the caller has to merge back into its own copy of the moment. */
export type MomentEditable = {
  id: string;
  content: string;
  images: string[];
  videoUrl: string | null;
  tags: string[];
};

export type MomentEditDialogProps = {
  open: boolean;
  onClose: () => void;
  moment: MomentEditable;
  onSaved: (updated: MomentEditable) => void;
};

type MediaItem = {
  id: string;
  kind: Kind;
  /** Server URL once stored or uploaded; absent while a local file has none. */
  url?: string;
  /** Already-published media uses its own URL as the preview. */
  previewUrl: string;
  status: Status;
  /** Only a locally picked file has one. */
  file?: File;
  error?: string;
};

function localId(prefix: string, index: number) {
  return `${prefix}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Seeded from the moment being edited: published media is never re-uploaded. */
function seedItems(moment: MomentEditable): MediaItem[] {
  const images: MediaItem[] = (moment.images ?? []).map((url, index) => ({
    id: localId("img", index),
    kind: "image" as const,
    url,
    previewUrl: url,
    status: "stored" as const,
  }));
  if (!moment.videoUrl) return images;
  return [
    ...images,
    {
      id: localId("vid", 0),
      kind: "video" as const,
      url: moment.videoUrl,
      previewUrl: moment.videoUrl,
      status: "stored" as const,
    },
  ];
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

/** The media that would actually be sent: stored rows and finished uploads. */
function usableMedia(items: MediaItem[]) {
  return items.filter((item) => Boolean(item.url));
}

export function MomentEditDialog({ open, onClose, moment, onSaved }: MomentEditDialogProps) {
  const [content, setContent] = useState(moment.content);
  const [tagsInput, setTagsInput] = useState((moment.tags ?? []).join(" "));
  const [items, setItems] = useState<MediaItem[]>(() => seedItems(moment));
  const [uploadError, setUploadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  /**
   * The latest list also lives in a ref. An upload resolves after the member may
   * have removed another item, and reading `items` inside that callback would
   * write a stale array back over the removal.
   */
  const itemsRef = useRef<MediaItem[]>(items);
  const commitItems = (next: MediaItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patchItem = (id: string, patch: Partial<MediaItem>) => {
    commitItems(itemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  // Reset the draft whenever the dialog opens — including a second open of the
  // same moment after a previous edit was cancelled.
  useEffect(() => {
    if (!open) return;
    setContent(moment.content);
    setTagsInput((moment.tags ?? []).join(" "));
    const seeded = seedItems(moment);
    itemsRef.current = seeded;
    setItems(seeded);
    setError("");
    setUploadError("");
    setSaving(false);
  }, [open, moment]);

  // Object URLs belong to this dialog; they are released when it unmounts.
  useEffect(() => {
    const store = itemsRef;
    return () => {
      for (const item of store.current) releaseLocal(item);
    };
  }, []);

  function releaseLocal(item: MediaItem) {
    if (item.file && item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  }

  function upload(item: MediaItem) {
    if (!item.file) return;
    const file = item.file;
    patchItem(item.id, { status: "uploading", error: undefined });
    void (async () => {
      try {
        const dataUrl = await fileToDataUrl(file);
        const uploaded = await apiFetch<{ url: string; kind: Kind }>("/uploads/moment-media", {
          method: "POST",
          body: { media: dataUrl },
        });
        patchItem(item.id, { status: "ready", url: uploaded.url, error: undefined });
      } catch (uploadFailure) {
        patchItem(item.id, {
          status: "error",
          error: friendlyErrorMessage(uploadFailure, "上传失败，请重试。"),
        });
      }
    })();
  }

  function addFiles(list: FileList | null, kind: Kind) {
    if (!list || list.length === 0) return;
    setUploadError("");
    let next = [...itemsRef.current];
    for (const file of Array.from(list)) {
      const photos = next.filter((item) => item.kind === "image");
      if (kind === "image") {
        if (photos.length >= MAX_IMAGES) {
          setUploadError(`最多保留 ${MAX_IMAGES} 张照片`);
          break;
        }
        if (!IMAGE_MIME.includes(file.type)) {
          setUploadError("照片仅支持 jpg / png / webp");
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setUploadError(`照片不能超过 ${formatBytes(MAX_IMAGE_BYTES)}`);
          continue;
        }
      } else {
        if (next.some((item) => item.kind === "video")) {
          setUploadError("一条动态只能有一个视频");
          break;
        }
        if (!VIDEO_MIME.includes(file.type)) {
          setUploadError("视频仅支持 mp4 / webm / mov");
          continue;
        }
        if (file.size > MAX_VIDEO_BYTES) {
          setUploadError(`视频不能超过 ${formatBytes(MAX_VIDEO_BYTES)}`);
          continue;
        }
      }
      const added: MediaItem = {
        id: localId(kind, next.length),
        kind,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        file,
      };
      next = [...next, added];
      upload(added);
    }
    commitItems(next);
  }

  function removeItem(id: string) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item) releaseLocal(item);
    commitItems(itemsRef.current.filter((entry) => entry.id !== id));
  }

  /** Reorder within the same kind: that order is the order the feed renders. */
  function moveItem(id: string, direction: -1 | 1) {
    const current = itemsRef.current;
    const item = current.find((entry) => entry.id === id);
    if (!item) return;
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

  const uploading = items.some((item) => item.status === "uploading");
  const failed = items.some((item) => item.status === "error");
  const canSave = !saving && !uploading && !failed;

  async function handleSave() {
    const trimmed = content.trim();
    const media = usableMedia(itemsRef.current);
    if (!trimmed && media.length === 0) {
      setError("动态内容不能为空，至少保留一张照片或一个视频。");
      return;
    }

    const tags = tagsInput
      .split(/[\s,，]+/)
      .map((tag) => tag.trim().replace(/^#+/, ""))
      .filter(Boolean)
      .slice(0, 10);

    setSaving(true);
    setError("");

    try {
      const saved = await apiFetch<MomentEditable>(`/moments/${moment.id}`, {
        method: "PATCH",
        /**
         * Every editable field travels explicitly. The route treats an absent
         * key as "leave it alone", so removing the last photo has to be an
         * empty array — and removing the clip an empty string, which is the
         * documented way to clear a value the service would otherwise validate
         * as a URL (`updateMoment` maps `""` to null).
         */
        body: {
          content: trimmed,
          tags,
          images: media.filter((item) => item.kind === "image").map((item) => item.url as string),
          videoUrl: media.find((item) => item.kind === "video")?.url ?? "",
        },
      });

      onSaved({
        id: saved.id,
        content: saved.content,
        images: saved.images ?? [],
        videoUrl: saved.videoUrl ?? null,
        tags: saved.tags ?? [],
      });
      onClose();
    } catch (saveFailure) {
      setError(friendlyErrorMessage(saveFailure, "保存修改失败，请稍后重试。"));
    } finally {
      setSaving(false);
    }
  }

  const images = items.filter((item) => item.kind === "image");
  const video = items.find((item) => item.kind === "video") ?? null;

  return (
    <TFDialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="修改动态"
      description="正文、话题和照片 / 视频都可以改。"
      wide
      footer={
        <>
          <TFButton variant="secondary" className="flex-1" disabled={saving} onClick={onClose}>
            取消
          </TFButton>
          <TFButton
            variant="primary"
            className="flex-1"
            loading={saving}
            loadingLabel="保存中…"
            disabled={!canSave}
            onClick={() => void handleSave()}
            data-testid="moment-edit-save"
          >
            保存修改
          </TFButton>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <div
            data-testid="moment-edit-error"
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-caption text-danger-700"
          >
            {error}
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-caption font-medium text-content-muted" htmlFor="moment-edit-content">
            动态正文
          </label>
          <TFTextarea
            id="moment-edit-content"
            data-testid="moment-edit-content"
            rows={4}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="分享你当下的想法..."
            maxLength={MAX_CONTENT}
          />
          <div className="mt-1 text-right text-caption text-content-subtle">
            {content.length}/{MAX_CONTENT}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-caption font-medium text-content-muted">照片与视频</p>
          {items.length > 0 ? (
            <div data-testid="moment-edit-media" className="grid grid-cols-3 gap-2">
              {images.map((item, index) => (
                <MediaTile
                  key={item.id}
                  item={item}
                  index={index}
                  total={images.length}
                  onRemove={() => removeItem(item.id)}
                  onMove={(direction) => moveItem(item.id, direction)}
                  onRetry={() => upload(item)}
                />
              ))}
              {video ? (
                <div className="col-span-3">
                  <MediaTile
                    item={video}
                    index={0}
                    total={1}
                    video
                    onRemove={() => removeItem(video.id)}
                    onMove={() => undefined}
                    onRetry={() => upload(video)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p data-testid="moment-edit-media-empty" className="text-caption text-content-subtle">
              这条动态还没有照片或视频。
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="moment-edit-add-photo"
              onClick={() => imageInputRef.current?.click()}
              disabled={images.length >= MAX_IMAGES}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border px-3 text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-50"
            >
              <ImagePlus size={15} aria-hidden="true" />
              添加照片
            </button>
            <button
              type="button"
              data-testid="moment-edit-add-video"
              onClick={() => videoInputRef.current?.click()}
              disabled={Boolean(video)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border px-3 text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-50"
            >
              <Plus size={15} aria-hidden="true" />
              添加视频
            </button>
          </div>

          <input
            ref={imageInputRef}
            data-testid="moment-edit-image-input"
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
            data-testid="moment-edit-video-input"
            type="file"
            accept={VIDEO_MIME.join(",")}
            className="sr-only"
            aria-label="选择视频"
            onChange={(event) => {
              addFiles(event.target.files, "video");
              event.target.value = "";
            }}
          />

          {uploading ? (
            <p data-testid="moment-edit-uploading" className="mt-1.5 text-caption text-content-muted">
              正在上传…上传完成后才能保存。
            </p>
          ) : null}
          {failed || uploadError ? (
            <p
              data-testid="moment-edit-upload-error"
              role="alert"
              className="mt-1.5 break-words text-caption text-danger-600"
            >
              {uploadError || "有媒体上传失败，请重试或删除后再保存。"}
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1.5 block text-caption font-medium text-content-muted" htmlFor="moment-edit-tags">
            话题标签（空格或逗号分隔，最多 10 个）
          </label>
          <input
            id="moment-edit-tags"
            data-testid="moment-edit-tags"
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
            placeholder="例如：生活 摄影 旅行"
            className="h-10 w-full rounded-control border border-border bg-surface px-3 text-ui text-content outline-none transition-colors duration-instant focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
          />
        </div>
      </div>
    </TFDialog>
  );
}

function MediaTile({
  item,
  index,
  total,
  video = false,
  onRemove,
  onMove,
  onRetry,
}: {
  item: MediaItem;
  index: number;
  total: number;
  video?: boolean;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid={video ? "moment-edit-media-video" : "moment-edit-media-image"}
      className={cn(
        "relative overflow-hidden rounded-card bg-surface-sunken",
        video ? "aspect-video" : "aspect-square",
      )}
    >
      {video ? (
        <video src={item.previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
      )}

      {item.status === "uploading" ? (
        <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        </span>
      ) : null}
      {item.status === "error" ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="moment-edit-media-retry"
          className="absolute inset-0 grid place-items-center bg-black/50 text-caption text-white"
        >
          <span className="inline-flex items-center gap-1">
            <RefreshCw size={13} aria-hidden="true" />
            重试
          </span>
        </button>
      ) : null}

      <span className="absolute left-1 top-1 flex gap-1">
        {!video && index > 0 ? (
          <TileButton label="前移" onClick={() => onMove(-1)}>
            <ArrowLeft size={12} aria-hidden="true" />
          </TileButton>
        ) : null}
        {!video && index < total - 1 ? (
          <TileButton label="后移" onClick={() => onMove(1)}>
            <ArrowRight size={12} aria-hidden="true" />
          </TileButton>
        ) : null}
      </span>
      <span className="absolute right-1 top-1">
        <TileButton label="删除媒体" onClick={onRemove}>
          <Trash2 size={12} aria-hidden="true" />
        </TileButton>
      </span>
    </div>
  );
}

function TileButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
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
