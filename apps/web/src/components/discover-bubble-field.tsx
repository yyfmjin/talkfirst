"use client";

import { DiscoverAvatarBubble, type DiscoverBubbleUser } from "@/components/discover-avatar-bubble";

/** Deliberately uneven, and in the same three sizes the bubbles themselves use. */
const SKELETON_SIZES = [72, 56, 64, 80, 60, 68, 76, 56, 72];

/**
 * The wall.
 *
 * A wrapping flex row rather than anything positioned: the bubbles must never
 * overlap and must never push the page sideways, and at 375px the only layout
 * that guarantees both is one where the browser decides the lines.
 */
export function DiscoverBubbleField({
  items,
  onOpenProfile,
}: {
  items: DiscoverBubbleUser[];
  onOpenProfile: (userId: string) => void;
}) {
  return (
    <div
      data-testid="discover-bubble-field"
      className="mt-5 flex flex-wrap items-start justify-center gap-x-1 gap-y-4"
    >
      {items.map((user) => (
        <DiscoverAvatarBubble key={user.id} user={user} onOpenProfile={onOpenProfile} />
      ))}
    </div>
  );
}

/** Loading looks like the wall that is coming, not like the card that is gone. */
export function DiscoverBubbleFieldSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div
      data-testid="discover-bubble-skeleton"
      aria-hidden
      className="mt-5 flex animate-pulse flex-wrap items-start justify-center gap-x-1 gap-y-4"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex w-[96px] flex-col items-center"
          style={{ marginTop: [0, 10, 20][index % 3] }}
        >
          <span
            className="rounded-full bg-indigo-100"
            style={{
              width: SKELETON_SIZES[index % SKELETON_SIZES.length],
              height: SKELETON_SIZES[index % SKELETON_SIZES.length],
            }}
          />
          <span className="mt-2 h-3 w-14 rounded bg-indigo-100" />
          <span className="mt-1 h-2.5 w-10 rounded bg-indigo-50" />
        </div>
      ))}
    </div>
  );
}
