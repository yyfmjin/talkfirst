import Link from "next/link";
import { LogoMark } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { TFBadge, TFButton, TFCard } from "@/components/tf";
import { localePath, t, type Locale, type MsgKey } from "@/lib/i18n";

/**
 * 官网主体（`/site` 与 `/en/site` 共用这一份实现）。
 *
 * ## 为什么是「一个组件 + 两个薄路由文件」
 *
 * 页面本体只写一遍，语言作为**参数**传进来；`app/site/page.tsx` 传 `"zh"`，
 * `app/en/site/page.tsx` 传 `"en"`。没有把整棵路由树搬进 `app/[locale]/`（那要动
 * 35 个目录和一堆内部跳转，而线上正在跑），所以每个翻译好的页面多一个几行的
 * 包装文件 —— 中文那棵树一行不动，风险为零。取舍写在 `lib/i18n/locales.ts`。
 *
 * ## 刻意没有的东西
 *
 * - **没有仿真状态栏**：手机预览图顶部不画时间 / 信号 / 电池。那条仿真件已从成员端
 *   外壳上删掉（见 `components/phone-shell.tsx`），官网再画一个只是同一个错误换地方。
 * - **没有渐变、没有动画**：主色是 `brand-500` 的实色，唯一动效是按钮按压态。
 * - **没有 emoji 当图标**：图标都是内联 SVG（`aria-hidden`）。
 * - **没有假数据**：不写「已有 100 万用户」这类编出来的数字。
 */

/**
 * Android 安装包地址（EAS 构建产物 —— `artifacts.buildUrl`）。
 *
 * 现在指向的是**双语版**那次构建（`a570e616`，2026-10-08）。这个地址是长期有效的，
 * 但它绑在某一次构建上：以后用 `eas build` 出了新的包，要把这里换成新的地址。
 *
 * 留空时下载按钮显示「生成中」并且**不可点**：摆一个 `#` 死链给用户看，比说
 * 「还在生成」更糟。
 */
const ANDROID_APK_URL = "https://expo.dev/artifacts/eas/ooGgbmoKR_6s3Rq4BYVO76oVoqNCQlDY5sP7AfhkrcM.apk";

export function OfficialSite({ locale }: { locale: Locale }) {
  const hasApk = ANDROID_APK_URL.length > 0;

  const features: { titleKey: MsgKey; bodyKey: MsgKey; icon: "language" | "spark" | "bubble" }[] = [
    { titleKey: "site.featureLanguagesTitle", bodyKey: "site.featureLanguagesBody", icon: "language" },
    { titleKey: "site.featureInterestsTitle", bodyKey: "site.featureInterestsBody", icon: "spark" },
    { titleKey: "site.featureTalkFirstTitle", bodyKey: "site.featureTalkFirstBody", icon: "bubble" },
  ];

  const steps: { titleKey: MsgKey; bodyKey: MsgKey }[] = [
    { titleKey: "site.howStep1Title", bodyKey: "site.howStep1Body" },
    { titleKey: "site.howStep2Title", bodyKey: "site.howStep2Body" },
    { titleKey: "site.howStep3Title", bodyKey: "site.howStep3Body" },
  ];

  const safety: MsgKey[] = [
    "site.safetyBullet1",
    "site.safetyBullet2",
    "site.safetyBullet3",
    "site.safetyBullet4",
  ];

  return (
    <div className="min-h-screen bg-surface-canvas">
      {/* ── 顶栏 ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
          <Link href={localePath(locale, "/site")} className="flex items-center gap-2.5" aria-label={t(locale, "site.homeLabel")}>
            <LogoMark size={32} />
            <span className="text-heading font-semibold tracking-tight text-content">TalkFirst</span>
          </Link>

          <nav aria-label={t(locale, "site.navLabel")} className="hidden items-center gap-7 md:flex">
            {(
              [
                ["#features", "site.navProduct"],
                ["#how", "site.navHow"],
                ["#safety", "site.navSafety"],
                ["#download", "site.navDownload"],
              ] as const
            ).map(([href, key]) => (
              <a key={href} href={href} className="text-ui text-content-muted transition-colors hover:text-content">
                {t(locale, key)}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-5">
            <LocaleSwitcher locale={locale} path="/site" className="hidden sm:inline-flex" />
            {/* 顶栏不放主按钮：整页只允许一个 primary（见 tf/index.ts 的规则）。 */}
            <Link
              href={localePath(locale, "/login")}
              className="text-ui font-medium text-brand-600 underline-offset-4 hover:underline"
            >
              {t(locale, "site.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── 主视觉 ─────────────────────────────────────────────────── */}
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-24">
          <div>
            <TFBadge tone="brand">{t(locale, "site.heroBadge")}</TFBadge>

            <h1 className="mt-5 text-display font-semibold tracking-tight text-content">
              {t(locale, "site.heroTitle")}
            </h1>

            <p className="mt-5 max-w-xl text-body text-content-muted">{t(locale, "site.heroBody")}</p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {hasApk ? (
                <TFButton variant="primary" size="lg" href={ANDROID_APK_URL}>
                  {t(locale, "site.downloadApk")}
                </TFButton>
              ) : (
                <TFButton variant="secondary" size="lg" disabled>
                  {t(locale, "site.apkBuilding")}
                </TFButton>
              )}
              <TFButton variant="secondary" size="lg" href={localePath(locale, "/login")}>
                {t(locale, "site.tryWeb")}
              </TFButton>
            </div>

            <p className="mt-4 text-caption text-content-subtle">{t(locale, "site.heroNote")}</p>
          </div>

          <PhonePreview locale={locale} />
        </section>

        {/* ── 产品 ───────────────────────────────────────────────────── */}
        <section id="features" className="border-t border-border bg-surface py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">{t(locale, "site.featuresTitle")}</h2>
            <p className="mt-3 max-w-2xl text-body text-content-muted">{t(locale, "site.featuresIntro")}</p>

            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {features.map((feature) => (
                <TFCard key={feature.titleKey} className="p-6">
                  <FeatureIcon name={feature.icon} />
                  <h3 className="mt-4 text-heading font-semibold text-content">{t(locale, feature.titleKey)}</h3>
                  <p className="mt-2 text-body text-content-muted">{t(locale, feature.bodyKey)}</p>
                </TFCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── 怎么用 ─────────────────────────────────────────────────── */}
        <section id="how" className="py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">{t(locale, "site.howTitle")}</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.titleKey}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-ui font-semibold text-brand-700">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-heading font-semibold text-content">{t(locale, step.titleKey)}</h3>
                  <p className="mt-2 text-body text-content-muted">{t(locale, step.bodyKey)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 安全 ───────────────────────────────────────────────────── */}
        <section id="safety" className="border-t border-border bg-surface py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">{t(locale, "site.safetyTitle")}</h2>
            <p className="mt-3 max-w-2xl text-body text-content-muted">{t(locale, "site.safetyIntro")}</p>
            <ul className="mt-8 grid gap-4 md:grid-cols-2">
              {safety.map((key) => (
                <li key={key} className="flex gap-3 text-body text-content-muted">
                  <CheckIcon />
                  <span>{t(locale, key)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 下载 ───────────────────────────────────────────────────── */}
        <section id="download" className="py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">{t(locale, "site.downloadTitle")}</h2>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <TFCard className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-heading font-semibold text-content">{t(locale, "site.androidName")}</span>
                  <TFBadge tone={hasApk ? "success" : "warning"} dot>
                    {t(locale, hasApk ? "site.available" : "site.building")}
                  </TFBadge>
                </div>
                <p className="mt-2 text-body text-content-muted">{t(locale, "site.androidBody")}</p>
                <div className="mt-5">
                  {hasApk ? (
                    <TFButton variant="primary" href={ANDROID_APK_URL}>
                      {t(locale, "site.downloadApkShort")}
                    </TFButton>
                  ) : (
                    <TFButton variant="secondary" disabled>
                      {t(locale, "site.apkBuilding")}
                    </TFButton>
                  )}
                </div>
              </TFCard>

              <TFCard tone="quiet" className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-heading font-semibold text-content">{t(locale, "site.iosName")}</span>
                  <TFBadge tone="neutral">{t(locale, "site.comingSoon")}</TFBadge>
                </div>
                <p className="mt-2 text-body text-content-muted">{t(locale, "site.iosBody")}</p>
                <div className="mt-5">
                  <TFButton variant="secondary" href={localePath(locale, "/login")}>
                    {t(locale, "site.useWeb")}
                  </TFButton>
                </div>
              </TFCard>
            </div>
          </div>
        </section>
      </main>

      {/* ── 页脚 ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-surface py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="text-ui font-medium text-content">TalkFirst</span>
            <span className="text-caption text-content-subtle">Talk First. Connect Later.</span>
          </div>

          <nav aria-label={t(locale, "site.footerNavLabel")} className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/legal/terms" className="text-caption text-content-muted hover:text-content">
              {t(locale, "site.legalTerms")}
            </Link>
            <Link href="/legal/privacy" className="text-caption text-content-muted hover:text-content">
              {t(locale, "site.legalPrivacy")}
            </Link>
            <Link href="/legal/rules" className="text-caption text-content-muted hover:text-content">
              {t(locale, "site.legalRules")}
            </Link>
            <a href="mailto:support@talkfirst.ccwu.cc" className="text-caption text-content-muted hover:text-content">
              support@talkfirst.ccwu.cc
            </a>
            <LocaleSwitcher locale={locale} path="/site" />
          </nav>

          <p className="text-caption text-content-subtle">© 2026 TalkFirst</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * 主视觉里的手机预览。
 *
 * 刻意**不画状态栏**（时间 / 信号 / 电池）：那是真机才有的东西，画在网页上的
 * 手机模型里就是一层假象。框子只表达「这是手机上的样子」—— 圆角、边框、一个
 * 真实的界面片段。
 */
function PhonePreview({ locale }: { locale: Locale }) {
  return (
    <div className="justify-self-center">
      <div className="w-[280px] rounded-frame border border-border bg-surface p-3 shadow-phone">
        <div className="overflow-hidden rounded-card border border-border">
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-caption font-semibold text-brand-700"
            >
              {Array.from(t(locale, "site.previewAuthor"))[0] ?? "T"}
            </span>
            <span className="text-ui font-medium text-content">{t(locale, "site.previewAuthor")}</span>
            <span className="text-caption text-content-subtle">{t(locale, "site.previewMeta")}</span>
          </div>
          <p className="px-4 py-3 text-body text-content">{t(locale, "site.previewBody")}</p>
          <div className="flex items-center gap-5 border-t border-border px-4 py-2.5 text-caption text-content-muted">
            <span>{t(locale, "site.previewLikes")}</span>
            <span>{t(locale, "site.previewComments")}</span>
          </div>

          <div className="space-y-2 border-t border-border bg-surface-sunken px-4 py-3">
            <p className="max-w-[80%] rounded-row bg-surface px-3 py-2 text-ui text-content">
              {t(locale, "site.previewBubble1")}
            </p>
            <p className="ml-auto max-w-[80%] rounded-row bg-brand-500 px-3 py-2 text-ui text-content-inverse">
              {t(locale, "site.previewBubble2")}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-caption text-content-subtle">{t(locale, "site.previewCaption")}</p>
    </div>
  );
}

/** 三个产品图标。内联 SVG，不用 emoji：emoji 的字形随系统变，也不受颜色令牌控制。 */
function FeatureIcon({ name }: { name: "language" | "spark" | "bubble" }) {
  const paths: Record<typeof name, string> = {
    language: "M4 6h10M9 4v2M6 6c0 4 3 7 7 8M12 6c-.5 3-3 6-6 7M13 20l3.5-8 3.5 8M15 17h5",
    spark:
      "M12 3l1.8 4.9L18.7 9l-4.9 1.8L12 15.7l-1.8-4.9L5.3 9l4.9-1.1L12 3ZM18 16l.9 2.1 2.1.9-2.1.9L18 22l-.9-2.1-2.1-.9 2.1-.9L18 16Z",
    bubble: "M4 11c0-3.9 3.6-7 8-7s8 3.1 8 7-3.6 7-8 7c-.8 0-1.6-.1-2.3-.3L6 20l1-3.2C5.1 15.6 4 13.4 4 11Z",
  };

  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 place-items-center rounded-control bg-surface-sunken text-brand-600"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
        <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="mt-0.5 h-4 w-4 shrink-0 text-success-600"
    >
      <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
