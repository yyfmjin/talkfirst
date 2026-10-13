"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { localePath, useT } from "@/lib/i18n";

/**
 * 隐私政策（公开可读）。
 *
 * ## Why this page exists separately from `/legal`
 *
 * `/legal` is the registration consent gate — two checkboxes and a continue
 * button. That is not a privacy policy, and **Google's OAuth consent screen
 * requires a publicly reachable privacy-policy URL** that it will actually
 * check. Shipping only the checkbox gate is what makes "使用 Google 登录" fail
 * review, so the text lives here at its own address.
 *
 * ## DRAFT — needs review before launch
 *
 * The wording below is drafted by an engineer, not a lawyer. It is deliberately
 * specific about *what data* third-party sign-in receives, because that is the
 * part Google checks and the part a member would want to know. **It must be
 * reviewed (and localised, if the product targets more than one jurisdiction)
 * before this is relied on.** Everything factual in it — which fields, which
 * providers, what is stored — is accurate as implemented; the legal framing is
 * not a legal opinion.
 *
 * ## 双语（2026-10-13）
 *
 * 文案全在词典里（`legal.privacy.*`）：`/legal/privacy` 中文，`/en/legal/privacy`
 * 英文。英文是**忠实翻译**，不是另一个版本 —— 页首挂着 `legal.translationNote`，
 * 写明以中文原文为准。这是四份法律文本里行内强调最多的一页（13 处 <strong>、
 * 1 处 <b>、2 处 <code>），所以每处拆分都落在强调元素两侧；两种语言各自读起来
 * 都是完整的一句话（见词典里 `legal.privacy.*` 的注释）。
 *
 * `<code>` 里那两个技术术语（`User-Agent`、`sub`）也走词典：两种语言同一个值。
 * 它们不是句子、不需要翻译，但放进词典就能保证**页面上一个英文硬编码都没有** ——
 * `test/ui-copy.test.mjs` 的扫描器盯的就是这件事。
 */

/** Shared paragraph shape, so the page reads as one document. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-heading font-semibold text-content">{title}</h2>
      <div className="mt-2 space-y-2 text-ui leading-6 text-content-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  const { locale, t } = useT();
  return (
    <PhoneShell>
      <ScreenHeader title={t("legal.privacy.title")} backHref={localePath(locale, "/legal")} />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-caption text-content-subtle">{t("legal.privacy.updated")}</p>
        <p className="mt-2 text-caption leading-5 text-content-subtle">
          {t("legal.translationNote")}
        </p>

        <p className="mt-4 text-ui leading-6 text-content-muted">{t("legal.privacy.intro")}</p>

        <Section title={t("legal.privacy.s1.title")}>
          <p>
            <strong className="text-content">{t("legal.privacy.s1.a")}</strong>
            {t("legal.privacy.s1.b")}
          </p>
          <p>
            <strong className="text-content">{t("legal.privacy.s1.c")}</strong>
            {t("legal.privacy.s1.d")}
          </p>
          <p>
            <strong className="text-content">{t("legal.privacy.s1.e")}</strong>
            {t("legal.privacy.s1.f")}
            <code className="mx-1">{t("legal.privacy.s1.g")}</code>
            {t("legal.privacy.s1.h")}
            <strong className="text-content">{t("legal.privacy.s1.i")}</strong>
            {t("legal.privacy.s1.j")}
          </p>
        </Section>

        <Section title={t("legal.privacy.s2.title")}>
          <p>
            {t("legal.privacy.s2.p1a")}
            <strong className="text-content">{t("legal.privacy.s2.p1b")}</strong>
            {t("legal.privacy.s2.p1c")}
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              {t("legal.privacy.s2.i1a")}
              <strong className="text-content">{t("legal.privacy.s2.i1b")}</strong>
              {t("legal.privacy.s2.i1c")}
              <code>{t("legal.privacy.s2.i1code")}</code>
              {t("legal.privacy.s2.i1d")}
            </li>
            <li>
              {t("legal.privacy.s2.i2a")}
              <strong className="text-content">{t("legal.privacy.s2.i2b")}</strong>
              {t("legal.privacy.s2.i2c")}
              <strong className="text-content">{t("legal.privacy.s2.i2d")}</strong>
              {t("legal.privacy.s2.i2e")}
            </li>
            <li>
              {t("legal.privacy.s2.i3a")}
              <strong className="text-content">{t("legal.privacy.s2.i3b")}</strong>
              {t("legal.privacy.s2.i3c")}
            </li>
          </ul>
          <p>
            {t("legal.privacy.s2.p2a")}
            <b>{t("legal.privacy.s2.p2b")}</b>
            {t("legal.privacy.s2.p2c")}
            <strong className="text-content">{t("legal.privacy.s2.p2e")}</strong>
            {t("legal.privacy.s2.p2f")}
            <strong className="text-content">{t("legal.privacy.s2.p2g")}</strong>
            {t("legal.privacy.s2.p2h")}
          </p>
          <p>
            {t("legal.privacy.s2.p3a")}
            <strong className="text-content">{t("legal.privacy.s2.p3b")}</strong>
            {t("legal.privacy.s2.p3c")}
          </p>
          <p>{t("legal.privacy.s2.p4")}</p>
        </Section>

        <Section title={t("legal.privacy.s3.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.privacy.s3.i1")}</li>
            <li>{t("legal.privacy.s3.i2")}</li>
            <li>{t("legal.privacy.s3.i3")}</li>
            <li>{t("legal.privacy.s3.i4")}</li>
          </ul>
          <p>{t("legal.privacy.s3.p")}</p>
        </Section>

        <Section title={t("legal.privacy.s4.title")}>
          <p>{t("legal.privacy.s4.p")}</p>
        </Section>

        <Section title={t("legal.privacy.s5.title")}>
          <p>{t("legal.privacy.s5.p")}</p>
        </Section>

        <Section title={t("legal.privacy.s6.title")}>
          <p>
            {t("legal.privacy.s6.p1")}
            <strong className="text-content">{t("legal.privacy.s6.p2")}</strong>
            {t("legal.privacy.s6.p3")}
          </p>
        </Section>

        <Section title={t("legal.privacy.s7.title")}>
          <p>{t("legal.privacy.s7.p")}</p>
        </Section>

        <Section title={t("legal.privacy.s8.title")}>
          <p>{t("legal.privacy.s8.p")}</p>
        </Section>

        <Section title={t("legal.privacy.s9.title")}>
          <p>{t("legal.privacy.s9.p")}</p>
        </Section>

        <p className="mt-8 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          {t("legal.privacy.footerPre")}
          <Link
            href={localePath(locale, "/legal/terms")}
            className="mx-1 font-medium text-brand-600"
          >
            {t("legal.terms.title")}
          </Link>
          {t("legal.privacy.footerAnd")}
          <Link
            href={localePath(locale, "/legal/rules")}
            className="mx-1 font-medium text-brand-600"
          >
            {t("legal.rules.title")}
          </Link>
          {t("legal.privacy.footerEnd")}
        </p>
      </div>
    </PhoneShell>
  );
}
