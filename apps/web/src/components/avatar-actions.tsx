"use client";

import { useRef, useState } from "react";
import { Camera, Eye, Loader2, Upload } from "lucide-react";
import { TFButton, TFDialog, TFSheet, TFAvatar } from "@/components/tf";
import { apiFetch, ApiRequestError } from "@/lib/api";
import { useSession } from "@/lib/session";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

export type AvatarActionSheetProps = {
  open: boolean;
  onClose: () => void;
  avatarUrl: string | null;
  name: string | null;
  onAvatarUpdated: (newAvatarUrl: string) => void;
};

export function AvatarActionSheet({
  open,
  onClose,
  avatarUrl,
  name,
  onAvatarUpdated,
}: AvatarActionSheetProps) {
  const { user, setUser } = useSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handlePickFile = () => {
    setError("");
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset file input value so re-selecting the same file triggers change
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("仅支持 JPG、PNG、WebP 格式图片。");
      return;
    }

    if (file.size > MAX_BYTES) {
      setError("图片大小不能超过 5MB。");
      return;
    }

    setError("");
    setUploading(true);

    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await apiFetch<{ avatarUrl: string }>("/uploads/avatar", {
        method: "POST",
        body: { image: dataUrl },
      });

      const newUrl = res.avatarUrl;
      onAvatarUpdated(newUrl);

      // Update global user session state
      if (user) {
        setUser({ ...user, avatarUrl: newUrl });
      }

      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "头像上传失败，请稍后重试。"
      );
    } finally {
      setUploading(false);
    }
  };

  const handleOpenView = () => {
    onClose();
    setViewDialogOpen(true);
  };

  return (
    <>
      {/* Hidden local file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        aria-label="选择本地头像文件"
        onChange={handleFileChange}
      />

      {/* Action sheet */}
      <TFSheet
        open={open}
        onClose={() => {
          if (!uploading) {
            setError("");
            onClose();
          }
        }}
        title="头像操作"
        description="查看大图或从本地上传新头像"
      >
        <div className="space-y-3 pt-2">
          {error ? (
            <div className="rounded-control bg-danger-50 px-3 py-2 text-caption text-danger-700">
              {error}
            </div>
          ) : null}

          {/* Action: View Avatar */}
          <button
            type="button"
            onClick={handleOpenView}
            className="flex w-full items-center justify-between rounded-control border border-border bg-surface px-4 py-3.5 text-body font-medium text-content transition-colors hover:bg-surface-sunken active:bg-surface-sunken"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-600">
                <Eye size={18} aria-hidden="true" />
              </span>
              <span>查看头像</span>
            </div>
            <span className="text-caption text-content-muted">查看大图</span>
          </button>

          {/* Action: Upload Local Avatar */}
          <button
            type="button"
            disabled={uploading}
            onClick={handlePickFile}
            className="flex w-full items-center justify-between rounded-control border border-border bg-surface px-4 py-3.5 text-body font-medium text-content transition-colors hover:bg-surface-sunken active:bg-surface-sunken disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-600">
                {uploading ? (
                  <Loader2 size={18} className="animate-spin text-brand-600" aria-hidden="true" />
                ) : (
                  <Upload size={18} aria-hidden="true" />
                )}
              </span>
              <span>{uploading ? "正在上传..." : "修改头像"}</span>
            </div>
            <span className="text-caption text-content-muted">
              {uploading ? "请稍候" : "从本地相册选择"}
            </span>
          </button>

          <p className="px-1 text-center text-caption text-content-subtle">
            支持 jpg / png / webp，最大 5MB
          </p>

          <div className="pt-2">
            <TFButton
              variant="secondary"
              fullWidth
              disabled={uploading}
              onClick={() => {
                setError("");
                onClose();
              }}
            >
              取消
            </TFButton>
          </div>
        </div>
      </TFSheet>

      {/* Large avatar preview dialog */}
      <TFDialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        title="头像预览"
        description={name ? `${name} 的个人头像` : "个人头像"}
        footer={
          <>
            <TFButton
              variant="secondary"
              className="flex-1"
              onClick={() => setViewDialogOpen(false)}
            >
              关闭
            </TFButton>
            <TFButton
              variant="primary"
              className="flex-1"
              onClick={() => {
                setViewDialogOpen(false);
                handlePickFile();
              }}
            >
              更换头像
            </TFButton>
          </>
        }
      >
        <div className="flex flex-col items-center justify-center py-4">
          <div className="relative overflow-hidden rounded-full ring-4 ring-brand-100 shadow-raised">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={name ? `${name} 的头像` : "个人头像"}
                className="h-48 w-48 object-cover sm:h-56 sm:w-56"
              />
            ) : (
              <div className="grid h-48 w-48 place-items-center bg-brand-50 text-display font-semibold text-brand-600 sm:h-56 sm:w-56">
                {(name?.[0] ?? "U").toUpperCase()}
              </div>
            )}
          </div>
          {!avatarUrl ? (
            <p className="mt-4 text-caption text-content-muted">
              尚未设置个性化头像，可点击下方按钮选择图片上传。
            </p>
          ) : null}
        </div>
      </TFDialog>
    </>
  );
}

export type ClickableAvatarProps = {
  avatarUrl: string | null;
  name: string | null;
  size?: "md" | "lg" | "xl";
  className?: string;
  onClick: () => void;
};

export function ClickableAvatar({
  avatarUrl,
  name,
  size = "xl",
  className,
  onClick,
}: ClickableAvatarProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-block cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${className || ""}`}
      aria-label="点击查看或修改头像"
    >
      <TFAvatar name={name} src={avatarUrl} size={size} ring />
      <span className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white shadow-brand ring-2 ring-surface transition-transform group-hover:scale-110 group-active:scale-95">
        <Camera size={14} aria-hidden="true" />
      </span>
    </button>
  );
}
