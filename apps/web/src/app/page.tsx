import { PhoneShell } from "@/components/phone-shell";
import { LogoMark, Wordmark } from "@/components/brand";
import { TFButton } from "@/components/tf";

/**
 * The launch screen.
 *
 * ## What it is for
 *
 * Not a logo page. It answers one question in the time it takes to read two
 * lines: *what is this, and why would I talk to a stranger here?* So the order is
 * mark → the one-sentence promise → the single action. Nothing else competes.
 *
 * ## Why the old hero was removed
 *
 * It was a 430px decorative gradient landscape (an SVG of hills and a sun) that
 * pushed the one action below the fold at 320×568 and said nothing about the
 * product. Replaced by the bubble motif, which is the shape the product's whole
 * meaning rests on: two offset bubbles, one lighter, implying a reply rather than
 * a single utterance.
 *
 * ## Motion
 *
 * None on entry. A launch screen that performs on every load is the first thing a
 * returning user resents, and the brief asks for no complex animation. The only
 * motion on this page is the press state of the button.
 *
 * ## Server component
 *
 * No `"use client"`, so the hero is real HTML in the first byte instead of a
 * skeleton. It is one of only a handful of routes in the app that renders content
 * without JavaScript — which also makes it the one page that is genuinely
 * indexable.
 */
export default function WelcomePage() {
  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
        {/* Hero: the mark over the bubble motif. */}
        <div className="relative flex shrink-0 flex-col items-center pb-8 pt-16">
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-12 h-20 w-28 -translate-x-[130%] rounded-card bg-brand-50"
          />
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-24 h-16 w-20 translate-x-[40%] rounded-card bg-brand-100"
          />
          <div className="relative">
            <LogoMark size={76} />
          </div>
          <div className="relative mt-5">
            <Wordmark />
          </div>
        </div>

        {/* The promise. This is the page's h1 — the mark above is aria-hidden, so
            a screen reader hears exactly one heading, and it is the sentence that
            explains the product. */}
        <h1 className="mt-2 text-center text-display font-semibold text-content">
          先聊聊，
          <br />
          再成为朋友
        </h1>
        <p className="mx-auto mt-4 max-w-[280px] text-center text-body text-content-muted">
          在 TalkFirst，你不必先成为朋友才开口。从一句「你好」开始，聊得来，再决定要不要认识。
        </p>

        {/* One primary action, one escape hatch. Registration is a ghost button
            rather than a second primary because a new member's first need is an
            account, and two filled buttons would make neither of them the answer. */}
        <div className="mt-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-10">
          <TFButton href="/login" size="lg" fullWidth>
            开始
          </TFButton>
          <TFButton href="/register" variant="ghost" size="md" fullWidth className="mt-1">
            我还没有账号，去注册
          </TFButton>
          <p className="mt-4 text-center text-caption text-content-subtle">仅限 18 岁以上使用</p>
        </div>
      </div>
    </PhoneShell>
  );
}
