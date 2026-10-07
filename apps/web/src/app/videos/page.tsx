"use client";

/**
 * 视频流（2026-10-06）—— 全屏沉浸，上下滑切换。
 *
 * ## 为什么单独一页而不是弹层
 *
 * 需求是「点击视频 → 变成短视频那种形式，可以上下滑切换随机视频」。这需要
 * **整屏 + 竖向吸附滚动**，而仓库里的弹层原语（TFSheet / TFDialog / TFMenu）
 * 都是为「选择」与「确认」设计的：底部弹起、会遮住内容、锁定背景滚动。
 * 沉浸式流要的是相反的东西（占满、不锁滚动、滚动本身就是交互），
 * 所以这里按 phone-shell 里的 `absolute inset-0` 惯例另起一层，
 * 但焦点陷阱与 Escape 退出仍然照 `overlay.tsx` 的规矩来。
 *
 * ## 播放策略（每条都对应一个真实的坑）
 *
 * · **只播可见的那一条**：用 IntersectionObserver 决定，而不是让所有 `<video>`
 *   一起播 —— 后者在手机上会解码 N 路视频，直接卡死。
 * · **静音起步**：浏览器的自动播放策略要求如此（带声音的 autoplay 会被拒绝，
 *   表现是「一片黑，什么都不动」）。所以默认静音，并给一个显式的开声音按钮。
 * · **`preload="metadata"`**：只为当前条预载数据，其余只取元信息。
 * · **尊重 `prefers-reduced-motion`**：开启时默认暂停，让人自己点播放。
 * · **`playsInline`**：iOS Safari 缺了它会把视频弹成全屏播放器。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Heart, MessageCircle, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TFAvatar } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";

type VideoFeedItem = {
  id: string;
  userId: string;
  author: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
  content: string;
  videoUrl: string | null;
  likeCount: number;
  commentCount: number;
  liked: boolean;
};

type VideoFeedPage = { items: VideoFeedItem[]; exhausted: boolean };

const BATCH = 6;
/** 已看过的 id 最多带 50 个（服务端也只认最后 50 个）。 */
const SEEN_MAX = 50;

export default function VideosPage() {
  const router = useRouter();
  const params = useSearchParams();
  const startId = params.get("start");

  const [items, setItems] = useState<VideoFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const seenRef = useRef<string[]>([]);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);
  /** 首次载入时把 `?start=<id>` 指的那一条排到最前（从动态里点进来时用）。 */
  const startHandledRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    if (query.matches) setPaused(true);
  }, []);

  const loadBatch = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const exclude = reset ? "" : seenRef.current.slice(-SEEN_MAX).join(",");
        const data = await apiFetch<VideoFeedPage>(
          `/moments/videos?limit=${BATCH}${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ""}`,
        );
        exhaustedRef.current = data.exhausted;

        let incoming = data.items.filter((item) => Boolean(item.videoUrl));
        // 从动态卡片点进来：把指定那一条提到最前。它可能不在这一批里
        // （随机流），那就照常从这批开始 —— 不做额外请求去捞它。
        if (!reset || !startId || startHandledRef.current) {
          // 保持原顺序
        } else {
          startHandledRef.current = true;
          const index = incoming.findIndex((item) => item.id === startId);
          if (index > 0) incoming = [incoming[index], ...incoming.filter((_, i) => i !== index)];
        }

        if (reset) {
          seenRef.current = incoming.map((item) => item.id);
          setItems(incoming);
          setActiveIndex(0);
        } else {
          const known = new Set(itemsRef.current.map((item) => item.id));
          const fresh = incoming.filter((item) => !known.has(item.id));
          seenRef.current = [...seenRef.current, ...fresh.map((item) => item.id)].slice(-SEEN_MAX);
          if (fresh.length > 0) setItems((prev) => [...prev, ...fresh]);
        }
      } catch (requestError) {
        setError(friendlyErrorMessage(requestError, "视频加载失败，请稍后再试。"));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [startId],
  );

  // `itemsRef` 让 loadBatch 不必把 items 放进依赖（否则每次加载都重建回调）。
  const itemsRef = useRef<VideoFeedItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    void loadBatch(true);
  }, [loadBatch]);

  // 只播当前这一条。
  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      video.muted = muted;
      if (index === activeIndex && !paused) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [activeIndex, muted, paused, items.length]);

  // 每一条自己报告「我是不是主要在屏幕上」，而不是由父层算滚动位置。
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index ?? "0");
          setActiveIndex(index);
        }
      },
      { root: scroller, threshold: 0.6 },
    );
    const nodes = scroller.querySelectorAll<HTMLElement>("[data-index]");
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items.length, loading]);

  const goTo = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      const target = scroller.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
      target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    },
    [items.length, reducedMotion],
  );

  // 键盘上下切换（a11y：滑动是手势，键盘用户也得能翻）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        goTo(activeIndex + 1);
      } else if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        goTo(activeIndex - 1);
      } else if (event.key === "Escape") {
        router.push("/moments");
      } else if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, goTo, router]);

  return (
    <PhoneShell>
      <div className="absolute inset-0 bg-black">
        {/* 顶部：返回 + 静音开关。背景是视频，所以用纯白/黑底滚动条上的对比度。 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => router.push("/moments")}
            aria-label="返回动态"
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors duration-instant hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "打开声音" : "静音"}
            aria-pressed={!muted}
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors duration-instant hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
          >
            {muted ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
          </button>
        </div>

        {loading ? (
          <p className="grid h-full place-items-center text-ui text-white/80">加载中…</p>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <p className="text-heading font-semibold text-white">还没有视频</p>
              <p className="mt-2 text-caption leading-5 text-white/70">
                发布一条带视频的动态，它就会出现在这里。
              </p>
              <button
                type="button"
                onClick={() => router.push("/moments")}
                className="mt-5 rounded-full bg-white/15 px-5 py-2.5 text-ui font-medium text-white transition-colors duration-instant hover:bg-white/25 motion-reduce:transition-none"
              >
                回到动态
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={scrollerRef}
            data-testid="video-feed"
            className="tf-scroll h-full snap-y snap-mandatory overflow-y-scroll"
          >
            {items.map((item, index) => (
              <section
                key={item.id}
                data-index={index}
                /* 每条占满一屏并吸附：这就是「上下滑切换」的全部实现。 */
                className="relative h-full w-full snap-start snap-always"
                aria-label={`第 ${index + 1} 条视频，作者 ${item.author.nickname ?? "用户"}`}
              >
                {index === activeIndex || index === activeIndex + 1 ? (
                  <video
                    ref={(node) => {
                      videoRefs.current[index] = node;
                    }}
                    src={item.videoUrl ?? undefined}
                    className="h-full w-full object-contain"
                    playsInline
                    loop
                    muted={muted}
                    preload={index === activeIndex ? "auto" : "metadata"}
                    onClick={() => setPaused((value) => !value)}
                  />
                ) : (
                  /* 没轮到的条目不建 <video>：手机上同时解码多路视频会直接卡死。 */
                  <div className="grid h-full place-items-center text-caption text-white/40">
                    下滑查看
                  </div>
                )}

                {index === activeIndex && paused ? (
                  <button
                    type="button"
                    onClick={() => setPaused(false)}
                    aria-label="播放"
                    className="absolute inset-0 grid place-items-center"
                  >
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-black/50 text-white">
                      <Play size={28} aria-hidden="true" />
                    </span>
                  </button>
                ) : null}

                {/* 底部信息层：作者、正文、计数。用渐变而不是实心条，
                    免得把画面切掉一块。 */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                  <div className="flex items-center gap-2.5">
                    <TFAvatar src={item.author.avatarUrl} name={item.author.nickname ?? "用户"} size="sm" />
                    <span className="text-ui font-medium text-white">
                      {item.author.nickname ?? "用户"}
                    </span>
                  </div>
                  {item.content ? (
                    <p className="mt-2 line-clamp-3 text-caption leading-5 text-white/90">{item.content}</p>
                  ) : null}
                  <div className="mt-2.5 flex items-center gap-4 text-caption text-white/85">
                    <span className="inline-flex items-center gap-1.5">
                      <Heart size={16} aria-hidden="true" className={item.liked ? "fill-current" : ""} />
                      {item.likeCount}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MessageCircle size={16} aria-hidden="true" />
                      {item.commentCount}
                    </span>
                  </div>
                </div>
              </section>
            ))}

            {/* 触底加载下一批：`activeIndex` 变化时而不是 onScroll 里做，
                避免每次滚动都发请求。 */}
            {activeIndex >= items.length - 2 && !exhaustedRef.current ? (
              <button
                type="button"
                onClick={() => void loadBatch(false)}
                className="h-full w-full snap-start text-caption text-white/50"
              >
                继续下滑加载更多
              </button>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="absolute inset-x-0 bottom-4 z-20 mx-4 break-words text-center text-caption text-danger-200">
            {error}
          </p>
        ) : null}
      </div>
    </PhoneShell>
  );
}
