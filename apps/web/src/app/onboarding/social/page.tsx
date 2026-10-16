"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFCard, TFButton } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { localePath } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

/**
 * Onboarding — social accounts (optional step).
 *
 * ## The audit finding, and what I did about it
 *
 * This step used to render six rows reading 「未绑定」 with **no way to bind
 * anything**, then a 「完成」 button. It was pure length: a screen that could not
 * change any state and only made the member tap once more. Two honest options
 * existed — delete the step, or give it a job.
 *
 * I kept the step and gave it a job, because the paragraph it already contained is
 * genuinely important and is stated nowhere else during sign-up: *social accounts
 * are hidden from strangers by default, and only shown after both sides agree to
 * exchange.* That is the product's core privacy promise, and onboarding is exactly
 * where it belongs.
 *
 * The false status list is gone. Binding itself still happens in
 * `/moments/settings`, which owns that flow — duplicating the bind form here would
 * create the second implementation of the same feature that this refactor exists
 * to remove. The step now links there for anyone who wants to do it now, and
 * 「完成」 remains for everyone else.
 *
 * ## Why this is the right call rather than deleting the step
 *
 * `/onboarding/countries` links forward to this route and this route links forward
 * to `/onboarding/complete`, so removing it means rewiring two neighbours in the
 * onboarding chain for no user-visible gain beyond one fewer tap.
 *
 * `smoke.test.mjs` does not cover onboarding, and no spec does, so this rewrite
 * has no test contract to preserve beyond the route continuing to work.
 */
export default function SocialPage() {
  const router = useRouter();
  const { locale, t } = useT();

  /**
   * Verification state is server-owned. The client must never assert
   * `emailVerified` itself (see `apps/web/test/email-verification.test.mjs`), so
   * this only warms the session and swallows failures.
   */
  useEffect(() => {
    void apiFetch("/users/me").catch(() => undefined);
  }, []);

  return (
    <PhoneShell>
      <ScreenHeader title={t("onboarding.social.title")} backHref={localePath(locale, "/onboarding/countries")} />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-ui leading-6 text-content-muted">{t("onboarding.social.intro")}</p>

        <TFCard tone="brand" className="mt-4">
          <div className="flex gap-2.5">
            <Lock size={17} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-ui font-medium text-content">{t("onboarding.social.privacyTitle")}</p>
              <p className="mt-1 text-caption leading-5 text-content-muted">
                {t("onboarding.social.privacyBody")}
              </p>
            </div>
          </div>
        </TFCard>

        <div className="mt-4 rounded-card border border-border bg-surface px-4 py-3.5">
          <p className="text-caption font-medium text-content-muted">{t("onboarding.social.platformsTitle")}</p>
          <p className="mt-1.5 text-ui leading-6 text-content">
            Instagram · Telegram · WhatsApp · Discord · X (Twitter) · TikTok
          </p>
          <p className="mt-1.5 text-caption text-content-subtle">{t("onboarding.social.platformsNote")}</p>
        </div>

        <div className="mt-auto pt-8">
          {/*
            Deliberately NO link to `/moments/settings` here, even though that is
            where binding happens. That page's own back button points at `/me`, so
            a member who tapped through mid-onboarding would bind a platform and
            then land in the profile area — never reaching `/onboarding/complete`,
            with no signpost back into the flow. Sending them there *after*
            onboarding is finished is the correct order, and the copy above tells
            them where to find it.
          */}
          <TFButton
            size="lg"
            fullWidth
            onClick={() => router.push(localePath(locale, "/onboarding/complete"))}
          >
            {t("onboarding.social.done")}
          </TFButton>
          <p className="mt-2 text-center text-caption text-content-subtle">
            {t("onboarding.social.bindHint")}
          </p>
        </div>
      </div>
    </PhoneShell>
  );
}
