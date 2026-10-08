import { PhoneShell } from "@/components/phone-shell";
import { LogoMark, Wordmark } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { TFButton } from "@/components/tf";
import { localePath, t, type Locale } from "@/lib/i18n";

/**
 * 启动屏 —— 中英文共用一份实现，文案与链接由 `locale` 决定。
 *
 * ## 为什么是共用组件 + 两个薄路由，而不是复制一份英文页面
 *
 * 复制一份的话，以后改版式要改两处，而且必然会漂移（"英文那版还是旧的"）。
 * 现在两边的差别只有词典里的文案和 `localePath()` 算出来的地址。
 *
 * ## 位置：语言切换放在最上面
 *
 * 启动屏是**没登录的人**看到的第一页，也是一个走错语言的人最想立刻离开的页面。
 * 所以切换入口放在最上沿（`pt-6` 那一行），而不是藏进"我的 → 设置"。
 */
export function LaunchScreen({ locale }: { locale: Locale }) {
  /*
   * 英文站的登录/注册页还没做（下一步）。在那之前，英文启动屏的两个按钮指向中文页面：
   * 一个能用的中文登录页，好过一个 404。`/en/login` 做出来之后，这两行直接换成
   * `localePath(locale, "/login")` / `localePath(locale, "/register")` 并删掉注释。
   */
  const loginHref = locale === "en" ? "/login" : localePath(locale, "/login");
  const registerHref = locale === "en" ? "/register" : localePath(locale, "/register");

  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
        {/* 语言切换：这一页是陌生人的第一屏，切换入口必须在第一屏上。 */}
        <div className="flex justify-end pt-6">
          <LocaleSwitcher locale={locale} path="/" />
        </div>

        {/* Hero: the mark over the bubble motif. */}
        <div className="relative flex shrink-0 flex-col items-center pb-8 pt-10">
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-6 h-20 w-28 -translate-x-[130%] rounded-card bg-brand-50"
          />
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-[4.5rem] h-16 w-20 translate-x-[40%] rounded-card bg-brand-100"
          />
          <div className="relative">
            <LogoMark size={76} />
          </div>
          <div className="relative mt-5">
            <Wordmark />
          </div>
        </div>

        {/* The promise. This is the page's h1 — the mark above is aria-hidden, so
            a screen reader hears exactly one heading, and it is the sentence that
            explains the product. */}
        <h1 className="mt-2 text-center text-display font-semibold text-content">
          {t(locale, "welcome.headlineLine1")}
          <br />
          {t(locale, "welcome.headlineLine2")}
        </h1>
        <p className="mx-auto mt-4 max-w-[280px] text-center text-body text-content-muted">
          {t(locale, "welcome.body")}
        </p>

        {/* One primary action, one escape hatch. Registration is a ghost button
            rather than a second primary because a new member's first need is an
            account, and two filled buttons would make neither of them the answer. */}
        <div className="mt-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-10">
          <TFButton href={loginHref} size="lg" fullWidth>
            {t(locale, "welcome.start")}
          </TFButton>
          <TFButton href={registerHref} variant="ghost" size="md" fullWidth className="mt-1">
            {t(locale, "welcome.register")}
          </TFButton>
          <p className="mt-4 text-center text-caption text-content-subtle">
            {t(locale, "welcome.ageNotice")}
          </p>
        </div>
      </div>
    </PhoneShell>
  );
}
