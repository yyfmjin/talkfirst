export type MomentAuthor = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  bio?: string | null;
};

export type MomentItem = {
  id: string;
  userId: string;
  author?: MomentAuthor;
  platform: string;
  platformName: string | null;
  content: string;
  images: string[];
  videoUrl: string | null;
  durationSec: number | null;
  tags: string[];
  likeCount: number;
  commentCount: number;
  liked: boolean;
  /** `DEMO` = placeholder content, not a real sync from the external platform. */
  source?: "USER" | "DEMO";
  isDemo?: boolean;
  syncedAt: string;
  createdAt: string;
};

export type MomentPlatform = {
  id: string;
  label: string;
  icon: string;
  color: string;
  connectedLabel: string;
};

export type MomentBinding = {
  platform: string;
  handle: string;
  displayName: string | null;
  syncEnabled: boolean;
};

export type MomentSetting = {
  syncEnabled: boolean;
  visibleTo: string;
  filterSensitive: boolean;
  showPhotos: boolean;
  showVideos: boolean;
  showTexts: boolean;
  showReels: boolean;
  showLives: boolean;
};

export function platformMeta(platforms: MomentPlatform[], id: string): MomentPlatform {
  return (
    platforms.find((item) => item.id === id) ?? {
      id,
      label: id,
      icon: id.slice(0, 2),
      /* Unknown platform: the brand blue, not the old accent purple. */
      color: "#3B82F6",
      connectedLabel: "",
    }
  );
}

import type { MsgKey, MsgParams } from "@/lib/i18n";

type Translate = (key: MsgKey, params?: MsgParams) => string;

/**
 * 相对时间。
 *
 * 接受一个 `t`，而不是把中文句子写在这里：这是模块级函数、拿不到当前语言，
 * 而它被动态列表、详情、评论、通知四处共用 —— 存中文会让英文界面出现「3分钟前」。
 */
export function timeAgo(iso: string, t: Translate) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t("mt.justNow");
  if (minutes < 60) return t("mt.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mt.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("mt.daysAgo", { count: days });
  return new Date(iso).toLocaleDateString();
}

export function relativeTime(value: string, t: Translate) {
  return timeAgo(value, t);
}

export function formatCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${value}`;
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
}
