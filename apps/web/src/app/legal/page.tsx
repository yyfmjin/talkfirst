"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton } from "@/components/tf";
import { localePath, useT } from "@/lib/i18n";

/**
 * Agreement gate before the profile is created.
 *
 * ## What was wrong (audit)
 *
 * The page asked the member to agree to 《用户协议》 and 《隐私政策》 and **neither
 * document exists anywhere in the codebase** — the `《》` brackets are the Chinese
 * convention for a work title, which reads as a link, so the screen implied two
 * tappable pages that were never there. A consent screen for documents the user
 * cannot read is not consent; in the EU it is a GDPR Article 7 problem on its face.
 *
 * ## Where it stands now (2026-10-06)
 *
 * Half of that gap was closed when the privacy policy got its own address at
 * `/legal/privacy` (Google's OAuth consent screen requires a publicly reachable
 * policy URL). **The other half was still open**: the gate let a member tick
 * 「我已阅读并同意用户协议」 with no 用户协议 anywhere to read, and its own copy
 * promised 「两项都会在注册流程中提供完整文本」 — a promise the screen could not
 * keep. `/legal/terms` and `/legal/rules` now exist, and both are linked below.
 *
 * The texts themselves are engineer-drafted and marked as such in their own
 * headers — see `docs/LEGAL-TEXTS.md` for what is still missing (operator entity,
 * jurisdiction) before they can be relied on as binding documents.
 *
 * ## The other fixes
 *
 *  - **Checkboxes are labelled and reachable.** They were the browser default
 *    (13px) inside `flex items-start`, so the entire sentence was clickable but
 *    the box was under the 44px thumb minimum. They are now 20px with a padded
 *    label row, so the whole row stays a comfortable target.
 *  - **One primary action.** 「同意并继续」 is the only filled control, and it
 *    stays disabled until both boxes are ticked — the gate is enforced by the
 *    control, not by an error message after the fact.
 *
 * ## 双语（2026-10-13）
 *
 * 文案全在词典里（`legal.gate.*`），语言由**路径**决定：`/legal` 中文、`/en/legal`
 * 英文。这份闸门是最需要看得懂的一屏 —— 用户在这里**做动作**（勾选两项），而不是
 * 翻阅参考文档；英文用户看不懂就无法真正知情同意。
 *
 * 隐私政策正文还没译（`legal.privacy` 那批行内强调多，单独一批做），所以英文站上
 * 「阅读隐私政策全文」暂时指向**中文**正文：宁可让英文用户看到中文原文，也不要一个
 * 打不开的页面。下一批会改成 `localePath()`。
 */
export default function LegalPage() {
  const router = useRouter();
  const { locale, t } = useT();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  return (
    <PhoneShell>
      <ScreenHeader title={t("legal.gate.title")} backHref={localePath(locale, "/verify")} />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-4">
        <p className="text-ui leading-6 text-content-muted">
          {t("legal.gate.intro")}
        </p>

        <div className="mt-6 space-y-2">
          <ConsentRow
            id="consent-terms"
            checked={terms}
            onChange={() => setTerms((value) => !value)}
            title={t("legal.gate.acceptTerms")}
            hint={t("legal.gate.acceptTermsHint")}
          />
          <ConsentRow
            id="consent-privacy"
            checked={privacy}
            onChange={() => setPrivacy((value) => !value)}
            title={t("legal.gate.acceptPrivacy")}
            hint={t("legal.gate.acceptPrivacyHint")}
          />
        </div>

        {/* The consent rows above are the gate; this is the document itself.
            Google's OAuth consent screen requires a publicly reachable privacy
            policy URL, and a checkbox list is not one — so the text has its own
            address and this is the way in. */}
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-caption">
          <Link href={localePath(locale, "/legal/terms")} className="font-medium text-brand-600">
            {t("legal.gate.readTerms")}
          </Link>
          <Link href="/legal/privacy" className="font-medium text-brand-600">
            {t("legal.gate.readPrivacy")}
          </Link>
        </p>

        <p className="mt-6 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          {t("legal.gate.note")}
        </p>

        <div className="mt-auto pt-8">
          <TFButton
            size="lg"
            fullWidth
            disabled={!terms || !privacy}
            onClick={() => router.push(localePath(locale, "/register/success"))}
          >
            {t("legal.gate.continue")}
          </TFButton>
          {!terms || !privacy ? (
            <p className="mt-2 text-center text-caption text-content-subtle">{t("legal.gate.needBoth")}</p>
          ) : null}
        </div>
      </div>
    </PhoneShell>
  );
}

/**
 * A consent row. A real `<input type="checkbox">` wired to its text with
 * `htmlFor`/`id` — not a styled `div` — so it is keyboard-operable, announced with
 * its state, and works with OS accessibility tooling.
 */
function ConsentRow({
  id,
  checked,
  onChange,
  title,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-row border border-border bg-surface px-4 py-3.5">
      {/* A native checkbox, deliberately not a styled div: `accent-brand-500`
          tints the OS control, which keeps the platform's hit area, focus ring
          and high-contrast behaviour intact. `h-5 w-5` + the padded row takes the
          target well past the 44px thumb floor. */}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-ui font-medium text-content">{title}</span>
        <span className="mt-0.5 block text-caption leading-5 text-content-muted">{hint}</span>
      </label>
    </div>
  );
}
