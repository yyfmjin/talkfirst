"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Link2, Tag, X } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton, OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";

const MAX_IMAGES = 9;

export default function ComposePage() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [imageInputs, setImageInputs] = useState<string[]>([""]);
  const [videoUrl, setVideoUrl] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);

  const images = useMemo(
    () => imageInputs.map((url) => url.trim()).filter((url) => url.length > 0),
    [imageInputs],
  );
  const tagList = useMemo(
    () => tags.split(/[,，\s#]+/).map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).slice(0, 10),
    [tags],
  );
  const invalidImages = useMemo(
    () => images.filter((url) => !/^https?:\/\/\S{4,2000}$/.test(url)),
    [images],
  );
  const invalidVideo = videoUrl.trim() && !/^https?:\/\/\S{4,2000}$/.test(videoUrl.trim());
  const canPublish = content.trim().length > 0 && invalidImages.length === 0 && !invalidVideo && !publishing;

  function updateImage(index: number, value: string) {
    setImageInputs((current) => current.map((url, i) => (i === index ? value : url)));
  }

  function addImageField() {
    setImageInputs((current) => (current.length >= MAX_IMAGES ? current : [...current, ""]));
  }

  function removeImageField(index: number) {
    setImageInputs((current) => (current.length <= 1 ? [""] : current.filter((_, i) => i !== index)));
  }

  async function publish() {
    if (!content.trim()) {
      setError("先写点什么吧");
      return;
    }
    if (invalidImages.length > 0) {
      setError("图片链接必须是 https 开头");
      return;
    }
    if (invalidVideo) {
      setError("视频链接必须是 https 开头");
      return;
    }
    setPublishing(true);
    setError("");
    try {
      await apiFetch("/moments", {
        method: "POST",
        body: {
          content: content.trim(),
          images: images.slice(0, MAX_IMAGES),
          videoUrl: videoUrl.trim() || undefined,
          tags: tagList,
        },
      });
      router.push("/moments");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="发布动态" backHref="/moments" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        <div className="rounded-3xl border border-line bg-[#F8FAFF] p-1 focus-within:ring-2 focus-within:ring-indigo-200">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="分享此刻的想法、旅行、美食、游戏……"
            maxLength={2000}
            rows={6}
            aria-label="动态内容"
            className="w-full resize-none rounded-3xl bg-transparent p-4 text-[13px] leading-6 outline-none"
          />
          <div className="flex items-center justify-between px-4 pb-3 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <Tag size={12} />
              {tagList.length > 0 ? tagList.map((tag) => `#${tag}`).join(" ") : "标签用空格分隔"}
            </span>
            <span>{content.length}/2000</span>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-line p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <ImagePlus size={15} className="text-[#6572D8]" />
            图片 <span className="text-[11px] font-normal text-muted">{images.length}/{MAX_IMAGES}</span>
          </p>
          <div className="mt-3 space-y-2">
            {imageInputs.map((url, index) => (
              <div key={index} className="flex gap-2">
                <input
                  value={url}
                  onChange={(event) => updateImage(index, event.target.value)}
                  placeholder="https://…"
                  aria-label={`图片链接${index + 1}`}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 text-[12px] outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {imageInputs.length > 1 ? (
                  <button
                    onClick={() => removeImageField(index)}
                    aria-label="删除图片链接"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-muted"
                  >
                    <X size={15} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {imageInputs.length < MAX_IMAGES ? (
            <button onClick={addImageField} className="mt-2 text-[12px] text-[#6572D8]">
              + 添加图片
            </button>
          ) : null}
          {images.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {images.slice(0, 9).map((src) => (
                <div key={src} className="relative aspect-square overflow-hidden rounded-xl bg-[#F1F3FF]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="预览" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <label className="mt-3 block rounded-3xl border border-line p-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Link2 size={14} className="text-[#6572D8}" />
            视频链接（可选）
          </span>
          <input
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            placeholder="https://… .mp4"
            aria-label="视频链接"
            className="mt-2 h-10 w-full rounded-xl border border-line px-3 text-[12px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>

        <label className="mt-3 block rounded-3xl border border-line p-4 text-[12px] text-muted">
          标签（空格或逗号分隔，最多 10 个）
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="旅行 美食 游戏"
            aria-label="标签"
            className="mt-2 h-10 w-full rounded-xl border border-line px-3 text-[12px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {tagList.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tagList.map((tag) => (
                <span key={tag} className="rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[11px] text-[#6572D8]">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </label>

        {error ? <p className="mt-3 text-[12px] text-red-500">{error}</p> : null}
        <GradientButton className="mt-6" onClick={() => void publish()} disabled={!canPublish}>
          {publishing ? "发布中…" : `发布${images.length ? ` · ${images.length}图` : ""}`}
        </GradientButton>
        <OutlineButton className="mb-1 mt-2 w-full" onClick={() => router.push("/moments/settings")}>
          管理同步平台
        </OutlineButton>
      </div>
    </PhoneShell>
  );
}
