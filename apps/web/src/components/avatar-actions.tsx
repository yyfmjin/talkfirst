"use client";

import { useRef, useState } from "react";
import { Camera, Eye, Loader2, Upload } from "lucide-react";
import { TFButton, TFDialog, TFSheet, TFAvatar } from "@/components/tf";
import { apiFetch, ApiRequestError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n/use-locale";

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
  const { t } = useT();
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
      setError(t("me.avatar.wrongType"));
      return;
    }

    if (file.size > MAX_BYTES) {
      setError(t("me.avatar.tooLarge"));
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
        err instanceof ApiRequestError ? err.message : t("me.avatar.uploadFailed")
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
        aria-label={t("me.avatar.chooseFile")}
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
        title={t("me.avatar.sheetTitle")}
        description={t("me.avatar.sheetDescription")}
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
              <span>{t("me.avatar.view")}</span>
            </div>
            <span className="text-caption text-content-muted">{t("me.avatar.viewLarge")}</span>
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
              <span>{uploading ? t("me.avatar.uploading") : t("me.avatar.change")}</span>
            </div>
            <span className="text-caption text-content-muted">
              {uploading ? t("me.avatar.pleaseWait") : t("me.avatar.chooseFromLibrary")}
            </span>
          </button>

          <p className="px-1 text-center text-caption text-content-subtle">
            {t("me.avatar.supported")}
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
              {t("common.cancel")}
            </TFButton>
          </div>
        </div>
      </TFSheet>

      {/* Large avatar preview dialog */}
      <TFDialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        title={t("me.avatar.previewTitle")}
        description={name ? t("me.avatar.yourAvatar", { name }) : t("me.avatar.genericAvatar")}
        footer={
          <>
            <TFButton
              variant="secondary"
              className="flex-1"
              onClick={() => setViewDialogOpen(false)}
            >
              {t("common.close")}
            </TFButton>
            <TFButton
              variant="primary"
              className="flex-1"
              onClick={() => {
                setViewDialogOpen(false);
                handlePickFile();
              }}
            >
              {t("me.avatar.changeAgain")}
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
                alt={name ? t("me.avatar.yourAvatar", { name }) : t("me.avatar.genericAvatar")}
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
              {t("me.avatar.noAvatar")}
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
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-block cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${className || ""}`}
      aria-label={t("me.avatar.clickToEdit")}
    >
      <TFAvatar name={name} src={avatarUrl} size={size} ring />
      <span className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-white shadow-brand ring-2 ring-surface transition-transform group-hover:scale-110 group-active:scale-95">
        <Camera size={14} aria-hidden="true" />
      </span>
    </button>
  );
}
