"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton } from "@/components/tf";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Onboarding step 1 — the avatar.
 *
 * ## Two dishonest controls removed (Phase C)
 *
 * **1. The colour presets did nothing.** `handleNext()` only ever uploaded an
 * image; `selected` was never read, never sent, and there is no column to send it
 * to. So the screen offered four swatches, highlighted the one you tapped, and
 * threw the choice away on the next tap. A control that appears to save something
 * and does not is worse than no control, so the picker is gone.
 *
 * This is not a loss of function: `TFAvatar` derives a stable tint from the
 * user's id, so members without a photo already get a deterministic, per-person
 * colour everywhere in the app — and one that cannot disagree between screens,
 * which a hand-picked preset could.
 *
 * **2. The "或粘贴 https://…" field.** The 「发布动态」 composer is the product's
 * reference for media input and it deliberately has NO url field: a member picks
 * a file, or nothing. A raw URL box asks someone to host an image elsewhere and
 * paste a link at the moment they are least likely to have one. Removed; the file
 * picker is the only path, exactly as the composer works.
 *
 * ## What is unchanged
 *
 * The step is still skippable (「稍后再说」), still uploads through
 * `POST /uploads/avatar`, and still advances to `/onboarding/profile`. The
 * validation (jpg/png/webp, 5MB) is untouched.
 */

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export default function AvatarPage() {
  const router = useRouter();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!ACCEPTED.includes(file.type)) {
      setError("只支持 jpg / png / webp 格式的图片。");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("图片不能超过 5MB。");
      return;
    }
    try {
      setPreview(await fileToDataUrl(file));
    } catch {
      setError("图片读取失败，请换一张试试。");
    }
  }

  async function handleNext() {
    setError("");
    // Skipping is a legitimate choice, not an error state.
    if (!preview) {
      router.push("/onboarding/profile");
      return;
    }
    setLoading(true);
    try {
      await apiFetch<{ avatarUrl: string }>("/uploads/avatar", {
        method: "POST",
        body: { image: preview },
      });
      router.push("/onboarding/profile");
    } catch (requestError) {
      // The preview is deliberately kept so a retry does not mean re-picking the
      // file — the same rule the composer follows for a failed publish.
      setError(requestError instanceof ApiRequestError ? requestError.message : "头像上传失败，请稍后再试。");
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="设置头像" backHref="/register/success" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-6 pt-8">
        {/* The preview doubles as the picker: the camera badge is inside the
            circle, so the whole avatar is one tap target instead of a separate
            "选择图片" row underneath it. */}
        <label className="relative block cursor-pointer">
          <span className="grid h-32 w-32 place-items-center overflow-hidden rounded-full bg-brand-100 text-display font-semibold text-brand-600 ring-1 ring-black/5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="头像预览" className="h-full w-full object-cover" />
            ) : (
              "A"
            )}
          </span>
          <span className="absolute bottom-0 right-0 grid h-10 w-10 place-items-center rounded-full bg-brand-500 text-white shadow-brand">
            <Camera size={17} aria-hidden="true" />
          </span>
          <input
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            aria-label="选择头像图片"
            onChange={(event) => void onPickFile(event.target.files?.[0])}
          />
        </label>

        <p className="mt-6 max-w-[260px] text-center text-ui leading-6 text-content-muted">
          点击头像选择一张图片。清楚的正面照片会让别人更愿意和你打招呼。
        </p>
        <p className="mt-2 text-center text-caption text-content-subtle">支持 jpg / png / webp，最大 5MB</p>

        {preview ? (
          <button
            type="button"
            onClick={() => setPreview("")}
            className="mt-4 rounded-control px-3 py-2 text-ui text-content-muted underline decoration-dotted"
          >
            移除这张图片
          </button>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 break-words text-center text-caption text-danger-600">
            {error}
          </p>
        ) : null}

        <div className="mt-auto w-full pt-8">
          <TFButton onClick={() => void handleNext()} loading={loading} loadingLabel="保存中…" size="lg" fullWidth>
            下一步
          </TFButton>
          <TFButton variant="ghost" size="md" fullWidth className="mt-1" href="/onboarding/profile">
            稍后再说
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
