"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { localePath, useT } from "@/lib/i18n";

/**
 * 公开的「删除账号」说明页。
 *
 * ## 为什么需要它（不是给用户看的，是给商店看的）
 *
 * Google Play 的「数据删除」政策要求：**允许注册的应用**必须
 *   1. 在应用内提供删除入口（我们有：我的 → 注销账号）；
 *   2. 在 Data safety 表单里填一个**不需要登录**就能打开的网页地址。
 *
 * 原来的删除入口只在 `/me` 里，而 `/me` 要登录 —— 用户如果登不进去（忘记密码、
 * 换手机），就找不到任何关于删除的说明，商城里那条 URL 也就填不出来。
 * 这一页就是那个地址：讲清楚三条路径，且不需要登录。
 */
const SUPPORT_EMAIL = "support@talkfirst.ccwu.cc";

export default function DeleteAccountPage() {
  const { locale, t } = useT();

  return (
    <PhoneShell>
      <ScreenHeader title={t("da.title")} backHref={localePath(locale, "/")} />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-ui leading-6 text-content-muted">{t("da.intro")}</p>

        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="text-ui font-semibold text-content">{t("da.howTitle")}</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-ui leading-6 text-content-muted">
            <li>{t("da.stepApp")}</li>
            <li>{t("da.stepWeb")}</li>
            <li>{t("da.stepEmail")}</li>
          </ol>
        </section>

        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="text-ui font-semibold text-content">{t("da.scopeTitle")}</h2>
          <p className="mt-2 text-ui leading-6 text-content-muted">{t("da.scope")}</p>
        </section>

        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=Account%20deletion%20request`}
          className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand-500 px-5 text-ui font-semibold text-white"
        >
          {t("da.emailCta")}
        </a>

        <p className="text-caption leading-5 text-content-muted">
          {t("da.note")}{" "}
          <Link href={localePath(locale, "/legal/privacy")} className="font-medium text-brand-600">
            {t("da.privacyLink")}
          </Link>
        </p>
      </div>
    </PhoneShell>
  );
}
