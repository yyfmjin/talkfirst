"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { localePath, useT } from "@/lib/i18n";

/**
 * 用户协议（公开可读）。
 *
 * ## 为什么这一页必须存在
 *
 * `/legal` 是注册前的同意闸门，它让人勾选「我已阅读并同意用户协议」，
 * 并声称「两项都会在注册流程中提供完整文本」。在此之前**只有隐私政策**有正文，
 * 用户协议没有页面 —— 让人同意一份读不到的文件，等于没有同意。
 * （该页自身的注释里已经写过这条判断，这里是把缺的那一半补上。）
 *
 * ## DRAFT — needs review before launch
 *
 * 与 `/legal/privacy` 同一处境：文本由工程师起草，不是法律意见。
 * **事实部分**逐条对照实现写过 —— 年龄限制、用户名与昵称的区别、
 * 密码的存储方式（不可逆哈希）、Google 登录无密码、注销后发生什么、
 * 违规处理有哪些手段，都能在代码与 `docs/P0-01-*` / `docs/P0-04-*` 里找到对应。
 * 运营主体、联系方式与管辖地：2026-10-06 按运营方指示先填占位值 ——
 * 运营主体写作 TalkFirst，联系方式写作 support@talkfirst.ccwu.cc，管辖写成
 * 「运营主体注册地有管辖权的法院」。**注册完成后必须替换**；在此之前
 * 这两页不应被当作已生效的法律文件对外依赖（见 `docs/LEGAL-TEXTS.md`）。
 *
 * ## 双语（2026-10-13）
 *
 * 文案全在词典里（`legal.terms.*`）：`/legal/terms` 中文，`/en/legal/terms` 英文。
 * 英文是**忠实翻译**，不是另一个版本 —— 页首挂着 `legal.translationNote`，写明以
 * 中文原文为准。少了这句话，第 8 节（责任范围）与第 10 节（管辖）两处的措辞差异
 * 就会被当成两份各自有效的文本。
 *
 * 第 3 节密码那一条原文给「无法读回原文」加了粗，所以只能拆成 a/b/c 三段；拆点就在
 * 那个加粗位置，英文接起来仍是一句通顺的话（词典里有同样的注释）。
 *
 * 页脚的隐私政策正文还没译（下一批），所以那一条链接仍是中文路径。
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

export default function TermsPage() {
  const { locale, t } = useT();
  return (
    <PhoneShell>
      <ScreenHeader title={t("legal.terms.title")} backHref={localePath(locale, "/legal")} />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-caption text-content-subtle">{t("legal.terms.updated")}</p>
        <p className="mt-2 text-caption leading-5 text-content-subtle">
          {t("legal.translationNote")}
        </p>

        <p className="mt-4 text-ui leading-6 text-content-muted">{t("legal.terms.intro")}</p>

        <Section title={t("legal.terms.s1.title")}>
          <p>{t("legal.terms.s1.p1")}</p>
          <p>{t("legal.terms.s1.p2")}</p>
        </Section>

        <Section title={t("legal.terms.s2.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.terms.s2.i1")}</li>
            <li>{t("legal.terms.s2.i2")}</li>
            <li>{t("legal.terms.s2.i3")}</li>
          </ul>
        </Section>

        <Section title={t("legal.terms.s3.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.terms.s3.i1")}</li>
            <li>
              {t("legal.terms.s3.i2a")}
              <strong className="text-content">{t("legal.terms.s3.i2b")}</strong>
              {t("legal.terms.s3.i2c")}
            </li>
            <li>{t("legal.terms.s3.i3")}</li>
            <li>{t("legal.terms.s3.i4")}</li>
          </ul>
        </Section>

        <Section title={t("legal.terms.s4.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.terms.s4.i1")}</li>
            <li>{t("legal.terms.s4.i2")}</li>
            <li>{t("legal.terms.s4.i3")}</li>
            <li>{t("legal.terms.s4.i4")}</li>
          </ul>
        </Section>

        <Section title={t("legal.terms.s5.title")}>
          <p>{t("legal.terms.s5.p1")}</p>
          <p>{t("legal.terms.s5.p2")}</p>
        </Section>

        <Section title={t("legal.terms.s6.title")}>
          <p>{t("legal.terms.s6.p1")}</p>
          <p>{t("legal.terms.s6.p2")}</p>
        </Section>

        <Section title={t("legal.terms.s7.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.terms.s7.i1")}</li>
            <li>{t("legal.terms.s7.i2")}</li>
            <li>{t("legal.terms.s7.i3")}</li>
          </ul>
        </Section>

        <Section title={t("legal.terms.s8.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.terms.s8.i1")}</li>
            <li>{t("legal.terms.s8.i2")}</li>
            <li>{t("legal.terms.s8.i3")}</li>
          </ul>
        </Section>

        <Section title={t("legal.terms.s9.title")}>
          <p>{t("legal.terms.s9.p1")}</p>
        </Section>

        <Section title={t("legal.terms.s10.title")}>
          <p>{t("legal.terms.s10.p1")}</p>
        </Section>

        <p className="mt-8 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          {t("legal.terms.morePre")}
          <Link
            href={localePath(locale, "/legal/privacy")}
            className="mx-1 font-medium text-brand-600"
          >
            {t("legal.privacy.title")}
          </Link>
          {t("legal.terms.moreAnd")}
          <Link
            href={localePath(locale, "/legal/rules")}
            className="mx-1 font-medium text-brand-600"
          >
            {t("legal.rules.title")}
          </Link>
          {t("legal.terms.moreEnd")}
        </p>
      </div>
    </PhoneShell>
  );
}
