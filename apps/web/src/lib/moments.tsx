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
      color: "#6B7CFF",
      connectedLabel: "",
    }
  );
}

export function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(iso).toLocaleDateString();
}

export function avatarColor(name: string | null) {
  const palette = ["#7B86FF", "#F472B6", "#2DD4BF", "#FBBF24", "#60A5FA", "#A78BFA"];
  const seed = (name ?? "?").charCodeAt(0) || 0;
  return palette[seed % palette.length];
}

export function relativeTime(value: string) {
  return timeAgo(value);
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
