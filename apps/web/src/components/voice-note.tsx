"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n/use-locale";

/**
 * 语音条（2026-10-28）。与手机端 `apps/mobile/src/components/VoiceNote.tsx` 同一套规矩：
 *
 * ## 为什么不是 `<audio controls>`
 *
 * 浏览器自带的播放器是一个**控件**，不是一条消息：每个浏览器长得不一样、
 * 在信息流里高度和留白都对不齐，而且它把「播放」这件事说成了「一条媒体文件」。
 * 微信的语音条只说三件事：多长、在不在放、点一下。
 *
 * ## 宽度随时长走
 *
 * 1 秒最短、60 秒封顶。时长要等 `loadedmetadata` 才知道，所以先用一个
 * 占位的默认值（8 秒）撑住，元数据到了再调整宽度 —— 比「等加载完才出现」
 * 少一次布局跳动之外的空档。
 *
 * ## 没有进度条
 *
 * 时长本身就是全部信息。播放中的反馈是喇叭旁边三根声波在跳
 * （`.tf-voice-wave`，见 `globals.css`，`prefers-reduced-motion` 下不动）。
 */
const MIN_WIDTH = 104;
const MAX_WIDTH = 232;
const WIDTH_CAP_SECONDS = 60;
const PLACEHOLDER_SECONDS = 8;
const WAVE_HEIGHTS = [7, 13, 9];

export function VoiceNote({
  src,
  durationSec,
}: {
  src: string;
  durationSec?: number | null;
}) {
  const { t } = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(() =>
    Math.max(1, Math.round(durationSec ?? PLACEHOLDER_SECONDS)),
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setSeconds(Math.max(1, Math.round(audio.duration)));
      }
    };
    /* 播放状态以元素自己的事件为准：系统媒体键、耳机线控都会绕过 onClick。 */
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleEnded = () => setPlaying(false);

    syncDuration();
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      /* play() 返回 promise：被浏览器自动播放策略拦下时不能留下「在放」的假象。 */
      void audio.play().catch(() => setPlaying(false));
      return;
    }
    audio.pause();
  }

  const width = Math.round(
    MIN_WIDTH +
      (Math.min(WIDTH_CAP_SECONDS, seconds) / WIDTH_CAP_SECONDS) * (MAX_WIDTH - MIN_WIDTH),
  );

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={t(playing ? "moments.voicePause" : "moments.voicePlay")}
        data-playing={playing ? "true" : "false"}
        style={{ width }}
        className={`tf-voice flex h-10 max-w-full items-center gap-2 rounded-[10px] px-3.5 transition-colors duration-instant ${
          playing ? "bg-brand-100" : "bg-brand-50 hover:bg-brand-100"
        }`}
      >
        <Volume2 size={17} className="shrink-0 text-brand-500" aria-hidden="true" />
        <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
          {WAVE_HEIGHTS.map((height, index) => (
            <span key={index} className="tf-voice-wave w-[2.5px]" style={{ height }} />
          ))}
        </span>
        <span className="ml-auto text-[13px] font-semibold tabular-nums text-content">
          {formatVoiceDuration(seconds)}
        </span>
      </button>
      <audio ref={audioRef} src={src} preload="metadata" className="sr-only" />
    </>
  );
}

/**
 * 微信的写法：60 秒内是 `6″`，一分钟以上是 `1′05″`。
 * 与手机端 `formatVoiceDuration` 保持一致 —— 两端不一致的话，同一条动态
 * 在手机和网页上会显示成两种时长格式。
 */
export function formatVoiceDuration(value: number) {
  const safe = Math.max(1, Math.round(value));
  if (safe < 60) return `${safe}″`;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return seconds === 0 ? `${minutes}′` : `${minutes}′${String(seconds).padStart(2, "0")}″`;
}
