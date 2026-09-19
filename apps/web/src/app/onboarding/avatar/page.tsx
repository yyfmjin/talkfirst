"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ApiRequestError, apiFetch } from "@/lib/api";

const presets = [
  { id: "purple", color: "#7B86FF" },
  { id: "pink", color: "#F472B6" },
  { id: "teal", color: "#2DD4BF" },
  { id: "amber", color: "#FBBF24" },
];

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
  const [avatarUrl, setAvatarUrl] = useState("");
  const [preview, setPreview] = useState("");
  const [selected, setSelected] = useState("purple");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("只支持 jpg / png / webp");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("图片不能超过 5MB");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setPreview(dataUrl);
    setAvatarUrl("");
  }

  async function uploadPreview(): Promise<string | null> {
    if (!preview) return avatarUrl || null;
    setLoading(true);
    try {
      const result = await apiFetch<{ avatarUrl: string }>("/uploads/avatar", {
        method: "POST",
        body: { image: preview },
      });
      return result.avatarUrl;
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "头像上传失败");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    setError("");
    if (!preview && !avatarUrl) {
      router.push("/onboarding/profile");
      return;
    }
    if (preview) {
      const uploaded = await uploadPreview();
      if (!uploaded) return;
    } else if (avatarUrl) {
      setLoading(true);
      try {
        await apiFetch("/users/me/avatar", { method: "PUT", body: { avatarUrl } });
      } catch (requestError) {
        setError(requestError instanceof ApiRequestError ? requestError.message : "头像保存失败");
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    router.push("/onboarding/profile");
  }

  return (
    <PhoneShell>
      <ScreenHeader title="设置头像" backHref="/register/success" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pb-6 pt-6">
        <div
          className="relative grid h-32 w-32 place-items-center overflow-hidden rounded-full text-4xl text-white shadow-xl shadow-indigo-100"
          style={{ background: presets.find((item) => item.id === selected)?.color ?? "#7B86FF" }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="头像预览" className="h-full w-full object-cover" />
          ) : (
            (avatarUrl ? "✓" : "A")
          )}
          <span className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full bg-white text-indigo-500">
            <Camera size={16} />
          </span>
        </div>
        <p className="mt-6 text-[13px] text-muted">可先跳过，或本地选一张图上传（最大 5MB）</p>
        <label className="mt-4 block w-full cursor-pointer rounded-2xl border border-dashed border-line bg-[#F8FAFF] px-4 py-3 text-center text-[13px] text-muted">
          选择图片
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="选择头像图片"
            onChange={(event) => void onPickFile(event.target.files?.[0])}
          />
        </label>
        <input
          value={avatarUrl}
          onChange={(event) => {
            setAvatarUrl(event.target.value);
            setPreview("");
          }}
          placeholder="或粘贴 https://…"
          aria-label="头像图片链接"
          className="mt-3 h-12 w-full min-w-0 rounded-2xl border border-line bg-[#F8FAFF] px-4 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <div className="mt-8 flex gap-3">
          {presets.map((item) => (
            <button
              key={item.id}
              aria-label={`选择 ${item.id} 主题色`}
              onClick={() => setSelected(item.id)}
              className={cn(
                "grid h-12 w-12 place-items-center rounded-full text-sm font-medium text-white",
                selected === item.id && "ring-2 ring-offset-2 ring-[#7B7BFF]",
              )}
              style={{ background: item.color }}
            >
              ✓
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
        <div className="mb-1 mt-8 w-full">
          <GradientButton onClick={handleNext} disabled={loading}>
            {loading ? "保存中…" : "下一步"}
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
