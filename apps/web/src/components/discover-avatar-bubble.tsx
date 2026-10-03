"use client";

import type { CSSProperties } from "react";
import { avatarInitial } from "@/lib/profile";

/**
 * The only identity a Discover bubble is allowed to show.
 *
 * Discovery returns far more than this — bio, interests, languages, purposes,
 * match reasons — and the bubble deliberately cannot reach any of it: taking
 * this narrow shape instead of the raw `Recommendation` is what stops the wall
 * from growing back into the full profile card it replaced. Everything else
 * belongs to the shared profile card, which opens on tap.
 */
export type DiscoverBubbleUser = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  age: number | null;
};

/** Three steps of size and three of vertical drift: irregular, never a grid. */
const ORB_SIZES = [64, 72, 80] as const;
const ROW_OFFSETS = [0, 10, 20] as const;
/** Slack around the orb so the floating transform never lands on a neighbour. */
const ORB_SLACK = 8;

/**
 * FNV-1a. The same user always draws the same size, drift and float phase, so a
 * re-render (or a filter switch back) never re-rolls the wall.
 */
function stableHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function pick(seed: string, options: readonly number[]): number {
  return options[stableHash(seed) % options.length];
}

/**
 * One avatar bubble.
 *
 * The orbit is a `<div>` of fixed size and the float animation lives on the
 * orb *inside* the button, never on the button itself. Two reasons, both
 * load-bearing: the pointer target keeps the exact same box every frame (a
 * moving target also makes an automated click wait forever for a stable
 * position), and the pause-on-hover rule can stay a pure CSS concern.
 */
export function DiscoverAvatarBubble({
  user,
  onOpenProfile,
}: {
  user: DiscoverBubbleUser;
  onOpenProfile: (userId: string) => void;
}) {
  const orbSize = pick(`${user.id}:size`, ORB_SIZES);
  const rowOffset = pick(`${user.id}:row`, ROW_OFFSETS);
  const durationSeconds = 4 + (stableHash(`${user.id}:speed`) % 5);
  const delaySeconds = -((stableHash(`${user.id}:delay`) % 80) / 10);
  const rise = -(3 + (stableHash(`${user.id}:rise`) % 4));

  const name = user.nickname ?? "TalkFirst 用户";
  const meta = [user.age ? `${user.age} 岁` : null, user.countryName ?? user.countryCode]
    .filter(Boolean)
    .join(" · ");

  const orbStyle = {
    width: orbSize,
    height: orbSize,
    animationDuration: `${durationSeconds}s`,
    animationDelay: `${delaySeconds}s`,
    "--tf-bubble-rise": `${rise}px`,
  } as CSSProperties;

  return (
    <div
      data-testid="discover-bubble"
      data-user-id={user.id}
      className="flex w-[96px] flex-col items-center"
      style={{ marginTop: rowOffset }}
    >
      <button
        type="button"
        onClick={() => onOpenProfile(user.id)}
        aria-label={`查看 ${name} 的资料卡`}
        className="tf-bubble grid place-items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        style={{ width: orbSize + ORB_SLACK * 2, height: orbSize + ORB_SLACK * 2 }}
      >
        {user.avatarUrl ? (
          <span data-testid="discover-bubble-orb" className="tf-bubble-orb block rounded-full" style={orbStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={user.avatarUrl}
              alt={`${name} 的头像`}
              className="h-full w-full rounded-full object-cover ring-2 ring-white"
            />
          </span>
        ) : (
          <span
            data-testid="discover-bubble-orb"
            className="tf-bubble-orb tf-gradient grid place-items-center rounded-full text-[20px] font-semibold text-white ring-2 ring-white"
            style={orbStyle}
          >
            {avatarInitial(user.nickname)}
          </span>
        )}
      </button>

      <p className="mt-1.5 w-full truncate text-center text-caption font-medium leading-4 text-content">{name}</p>
      <p className="mt-0.5 w-full truncate text-center text-overline leading-4 text-content-muted">
        {meta ? `${user.countryFlag ?? "🌎"} ${meta}` : "\u00a0"}
      </p>
    </div>
  );
}
