"use client";

import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TFButton, TFCard } from "@/components/tf";
import type { MsgKey } from "@/lib/i18n";
import { localePath } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

/**
 * Onboarding finished — the hand-off into the product.
 *
 * This is the last screen before the member sees other people, so the job is to
 * answer "what now?" rather than to celebrate. The old version was a 40×40
 * decoration and a two-line exclamation; it told the member nothing about what
 * they had just built or what the app would now do with it.
 *
 * The three lines below are the actual contract of the product as built: you get
 * recommended to people, you say hello first, and contact details move only after
 * both sides agree. Setting that expectation here is cheaper than explaining it
 * later in a conversation.
 *
 * Client Component — the copy depends on the path's language, and only the links
 * are interactive.
 */
export default function CompletePage() {
  const { locale, t } = useT();

  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10">
        <div className="flex flex-col items-center text-center">
          {/* The brand mark, earned this time: onboarding is where the member
              learns that a reply is the point.

              用 `LogoMark` 而不是自己画气泡（2026-10-28）：正式标志换成弧环+笑脸，
              这里残留的旧气泡还带着写死的 `#3B82F6` 圆点，压在 #0B7FFF 的底上会
              显出两种蓝。 */}
          <LogoMark size={80} />
          <h1 className="mt-6 text-title font-semibold text-content">{t("onboarding.complete.title")}</h1>
          <p className="mt-2 max-w-[290px] text-ui leading-6 text-content-muted">
            {t("onboarding.complete.subtitle")}
          </p>
        </div>

        <TFCard tone="quiet" className="mt-7">
          <ul className="space-y-3">
            {(
              [
                { key: "onboarding.complete.item1Title", bodyKey: "onboarding.complete.item1Body" },
                { key: "onboarding.complete.item2Title", bodyKey: "onboarding.complete.item2Body" },
                { key: "onboarding.complete.item3Title", bodyKey: "onboarding.complete.item3Body" },
              ] satisfies Array<{ key: MsgKey; bodyKey: MsgKey }>
            ).map((item) => (
              <li key={item.key} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span className="min-w-0">
                  <span className="block text-ui font-medium text-content">{t(item.key)}</span>
                  <span className="mt-0.5 block text-caption leading-5 text-content-muted">
                    {t(item.bodyKey)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </TFCard>

        <div className="mt-auto pt-9">
          <TFButton href={localePath(locale, "/discover")} size="lg" fullWidth>
            {t("onboarding.complete.goDiscover")}
          </TFButton>
          <TFButton
            href={localePath(locale, "/me/edit")}
            variant="ghost"
            size="md"
            fullWidth
            className="mt-1"
          >
            {t("onboarding.complete.editCard")}
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
