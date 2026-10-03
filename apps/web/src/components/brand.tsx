/**
 * Brand marks.
 *
 * ## Phase B
 *
 * The mark is still a speech bubble — it is the one shape the product's meaning
 * is built on ("talk first") — but it now sits on the brand token colour and its
 * corner radius comes from the radius scale (`rounded-control`, 18px) instead of
 * an arbitrary 22px. The two dots inside take the brand colour rather than the
 * old accent purple, so the mark and the primary CTA are visibly the same
 * material.
 *
 * `Wordmark` is a pure visual lockup: it no longer renders an `<h1>`. It was the
 * only heading on the launch screen, which meant the page's accessible name was
 * "TalkFirst / 先聊聊，再成为朋友。 Talk First. Connect Later." in three different
 * type sizes. The launch screen now owns its own `<h1>` and pulls the taglines
 * into it; this stays a decorative lockup with `aria-hidden`, so a screen reader
 * hears the headline once, not twice.
 */
export const LogoMark = ({ size = 56 }: { size?: number }) => {
  return (
    <div
      className="grid place-items-center rounded-control bg-brand-500 shadow-brand"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 48 48" fill="none">
        <path
          d="M10 18c0-5.5 6.3-9 14-9s14 3.5 14 9-6.3 9-14 9c-1.4 0-2.7-.1-4-.4L14 32l1.6-5.2C11.8 24.8 10 21.6 10 18Z"
          fill="white"
        />
        <circle cx="20" cy="18" r="2" fill="#3B82F6" />
        <circle cx="28" cy="18" r="2" fill="#3B82F6" />
      </svg>
    </div>
  );
};

export const Wordmark = () => (
  <span aria-hidden="true" className="text-center">
    <span className="block text-title font-semibold tracking-tight text-content">TalkFirst</span>
    <span className="mt-1 block text-caption text-content-muted">Talk First. Connect Later.</span>
  </span>
);

/**
 * The slogan lockup — 「先聊聊，再成为朋友。」
 *
 * Separate from `Wordmark` because it is copy, not branding: it is the product's
 * one-line explanation and it needs to be readable at body size, not shrunk into
 * a logo caption. The launch screen and the empty states both want it.
 */
export const Slogan = ({ className }: { className?: string }) => (
  <p className={className}>先聊聊，再成为朋友。</p>
);
