import { PhoneShell } from "@/components/phone-shell";
import { LogoMark } from "@/components/brand";
import { TFButton } from "@/components/tf";
import { currentLocale, t } from "@/lib/i18n";

/**
 * Account created.
 *
 * A Server Component (no `"use client"`) — nothing here is interactive except a
 * link, so there is no reason to ship it as a client bundle. It is also the point
 * where a brand-new member is most likely to bounce, which makes the copy matter
 * more than the decoration: the headline says what just happened, the line under
 * it says what happens next, and there is exactly one thing to tap.
 *
 * The old version used a 20px gradient disc with a literal `✓` character and a
 * `shadow-lg shadow-indigo-200` (an *indigo* shadow under a *brand* element). The
 * mark is now the real `LogoMark` at 80px, so the first thing a new member sees
 * after signing up is the product's actual identity rather than a checkmark.
 */
export default function RegisterSuccessPage() {
  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
        <LogoMark size={80} />

        <h1 className="mt-7 text-title font-semibold text-content">{t(currentLocale(), "rs.title")}</h1>
        <p className="mt-2 max-w-[280px] text-ui leading-6 text-content-muted">
          {t(currentLocale(), "rs.intro")}
        </p>

        {/* One step at a time: a three-item checklist would turn a celebration into
            a chore. The next screen handles the rest of onboarding. */}
        <ul className="mt-6 w-full max-w-[280px] space-y-2 text-left">
          {[t(currentLocale(), "rs.step1"), t(currentLocale(), "rs.step2"), t(currentLocale(), "rs.step3")].map((item, index) => (
            <li key={item} className="flex items-start gap-2.5 text-ui text-content-muted">
              <span
                aria-hidden="true"
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-overline font-semibold text-brand-600"
              >
                {index + 1}
              </span>
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-9 w-full max-w-[280px]">
          <TFButton href="/onboarding/avatar" size="lg" fullWidth>
            {t(currentLocale(), "rs.cta")}
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
