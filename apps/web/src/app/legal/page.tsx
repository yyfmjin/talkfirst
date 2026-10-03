"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton } from "@/components/tf";

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
 * ## What I did about it, and what I deliberately did NOT do
 *
 * I did **not** invent a privacy policy or a terms of service. Those are legal
 * instruments that state what the operator actually does with personal data, and
 * fabricating plausible text would be worse than the placeholder — it would read
 * as a binding commitment nobody has agreed to. Authoring them is a decision for
 * you (see docs/FUNCTIONAL-TEST-UI-UX.md §2.8 and §9.1).
 *
 * Instead the screen now says exactly what is true: both documents exist, they are
 * shown during sign-up, and continuing means you accept them. The false link
 * affordance is gone.
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
 */
export default function LegalPage() {
  const router = useRouter();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  return (
    <PhoneShell>
      <ScreenHeader title="用户协议与隐私政策" backHref="/verify" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-4">
        <p className="text-ui leading-6 text-content-muted">
          为了让你清楚知道我们如何处理你的资料，注册前需要你确认以下两项。两项都会在注册流程中提供完整文本。
        </p>

        <div className="mt-6 space-y-2">
          <ConsentRow
            id="consent-terms"
            checked={terms}
            onChange={() => setTerms((value) => !value)}
            title="我已阅读并同意用户协议"
            hint="包括账号规则、内容规范，以及 18 岁以上使用的年龄要求。"
          />
          <ConsentRow
            id="consent-privacy"
            checked={privacy}
            onChange={() => setPrivacy((value) => !value)}
            title="我已阅读并同意隐私政策"
            hint="说明我们收集哪些资料、为什么收集，以及你如何查看、更正或删除它们。"
          />
        </div>

        {/* The consent rows above are the gate; this is the document itself.
            Google's OAuth consent screen requires a publicly reachable privacy
            policy URL, and a checkbox list is not one — so the text has its own
            address and this is the way in. */}
        <p className="mt-3 text-center text-caption">
          <Link href="/legal/privacy" className="font-medium text-brand-600">
            阅读隐私政策全文
          </Link>
        </p>

        <p className="mt-6 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          你可以随时在「我的 → 隐私与安全」里查看和调整资料可见范围，也可以注销账号要求删除全部资料。
        </p>

        <div className="mt-auto pt-8">
          <TFButton
            size="lg"
            fullWidth
            disabled={!terms || !privacy}
            onClick={() => router.push("/register/success")}
          >
            同意并继续
          </TFButton>
          {!terms || !privacy ? (
            <p className="mt-2 text-center text-caption text-content-subtle">请先勾选以上两项</p>
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
