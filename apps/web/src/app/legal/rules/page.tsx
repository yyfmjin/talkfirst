"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { localePath, useT } from "@/lib/i18n";

/**
 * 社区规则（公开可读）。
 *
 * ## 为什么这一页必须存在
 *
 * 注册页写着「注册即表示同意社区规则」，但**全仓库没有一份社区规则** ——
 * 一句指向空白页的同意，等于没有同意。`/legal` 的同意闸门同样把
 * 「账号规则、内容规范」作为勾选项的说明，而那份规范此前不存在。
 *
 * ## DRAFT — needs review before launch
 *
 * 与 `/legal/privacy` 同一处境：文本由工程师起草，不是法律意见。
 * 事实部分逐条对照**已实现**的审核能力写过：举报的四种目标
 * （动态 / 评论 / 消息 / 用户）、举报理由由服务端白名单校验、
 * 举报人会收到处理结果通知而不暴露举报人、处理手段包含
 * 临时暂停（到期自动解除）与永久封禁。运营主体与联系方式这两项
 * 只有运营方能提供，见 `docs/LEGAL-TEXTS.md`。
 *
 * ## 双语（2026-10-13）
 *
 * 文案全在词典里（`legal.rules.*`）：`/legal/rules` 中文，`/en/legal/rules` 英文。
 * 英文是忠实翻译，不是另一个版本（页首挂 `legal.translationNote`）。
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

export default function CommunityRulesPage() {
  const { locale, t } = useT();
  return (
    <PhoneShell>
      <ScreenHeader title={t("legal.rules.title")} backHref={localePath(locale, "/legal")} />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-caption text-content-subtle">{t("legal.rules.updated")}</p>
        <p className="mt-2 text-caption leading-5 text-content-subtle">
          {t("legal.translationNote")}
        </p>

        <p className="mt-4 text-ui leading-6 text-content-muted">{t("legal.rules.intro")}</p>

        <Section title={t("legal.rules.s1.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.rules.s1.i1")}</li>
            <li>{t("legal.rules.s1.i2")}</li>
            <li>{t("legal.rules.s1.i3")}</li>
          </ul>
        </Section>

        <Section title={t("legal.rules.s2.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.rules.s2.i1")}</li>
            <li>{t("legal.rules.s2.i2")}</li>
            <li>{t("legal.rules.s2.i3")}</li>
            <li>{t("legal.rules.s2.i4")}</li>
            <li>{t("legal.rules.s2.i5")}</li>
            <li>{t("legal.rules.s2.i6")}</li>
          </ul>
        </Section>

        <Section title={t("legal.rules.s3.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.rules.s3.i1")}</li>
            <li>{t("legal.rules.s3.i2")}</li>
            <li>{t("legal.rules.s3.i3")}</li>
            <li>{t("legal.rules.s3.i4")}</li>
          </ul>
        </Section>

        <Section title={t("legal.rules.s4.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.rules.s4.i1")}</li>
            <li>{t("legal.rules.s4.i2")}</li>
            <li>{t("legal.rules.s4.i3")}</li>
            <li>{t("legal.rules.s4.i4")}</li>
          </ul>
        </Section>

        <Section title={t("legal.rules.s5.title")}>
          <p>{t("legal.rules.s5.p1")}</p>
        </Section>

        <Section title={t("legal.rules.s6.title")}>
          <ul className="ml-4 list-disc space-y-1">
            <li>{t("legal.rules.s6.i1")}</li>
            <li>{t("legal.rules.s6.i2")}</li>
            <li>{t("legal.rules.s6.i3")}</li>
          </ul>
        </Section>

        <p className="mt-8 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          {t("legal.rules.footerPre")}
          <Link
            href={localePath(locale, "/legal/terms")}
            className="mx-1 font-medium text-brand-600"
          >
            {t("legal.terms.title")}
          </Link>
          {t("legal.rules.footerAnd")}
          <Link
            href={localePath(locale, "/legal/privacy")}
            className="mx-1 font-medium text-brand-600"
          >
            {t("legal.privacy.title")}
          </Link>
          {t("legal.rules.footerEnd")}
        </p>
      </div>
    </PhoneShell>
  );
}
