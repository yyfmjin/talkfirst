"use client";

import { useEffect, useState } from "react";
import { TFSheet } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n/use-locale";
import type { MsgKey } from "@/lib/i18n";

/**
 * 每日占卜小卡片（2026-10-30）。与手机端 `DailyFortuneCard` 同一份数据：
 *
 *   GET /fortune/today?lang=…
 *
 * ## 内容由服务端按语言出好
 *
 * 宜忌、幸运色、运势、紫微四化都是服务端算的成品字符串（`apps/api/src/fortune`）。
 * 两端共用一张文案表，不会出现手机和网页说两套话。这里只渲染。
 *
 * ## 确定性
 *
 * 同一个人同一天刷新永远是同一张卡（服务端用 `userId|date` 做种子）。所以前端
 * **不做**任何重抽/缓存失效逻辑 —— 多刷一次也不会变，这正是它可信的原因。
 *
 * ## 失败就整块不显示
 *
 * 首页的主角是动态。接口挂了、没登录态，静默隐藏即可，不要用一块红色错误把
 * 信息流顶下去。
 */

type FortuneCard = {
  date: string;
  weekday: number;
  sign: string | null;
  luckyNumbers: number[];
  luckyColor: { name: string; hex: string };
  dos: string[];
  donts: string[];
  horoscope: string;
  ziwei: {
    lunar: string | null;
    ganzhi: string;
    soul: string;
    body: string;
    palaceStar: string | null;
    lu: string;
    quan: string;
    ke: string;
    ji: string;
    assumedHour: boolean;
  } | null;
};

const WEEKDAY_KEYS = [
  "weekday.sun",
  "weekday.mon",
  "weekday.tue",
  "weekday.wed",
  "weekday.thu",
  "weekday.fri",
  "weekday.sat",
] as const satisfies readonly MsgKey[];

export function DailyFortuneCard() {
  const { t, locale } = useT();
  const [card, setCard] = useState<FortuneCard | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        /* 用**浏览器本地**日期：接口按北京时间兜底，海外用户夜里会看到「明天」。 */
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate(),
        ).padStart(2, "0")}`;
        const data = await apiFetch<FortuneCard>(
          `/fortune/today?lang=${locale === "en" ? "en" : "zh-CN"}&date=${today}`,
        );
        if (!alive) return;
        /* 与手机端同一道校验：形状不对就整块不显示，不能把首页拖挂。 */
        if (!data || typeof data.date !== "string" || !Array.isArray(data.dos)) {
          setHidden(true);
          return;
        }
        setCard(data);
      } catch {
        if (alive) setHidden(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale]);

  if (hidden) return null;
  if (!card) {
    return (
      <div className="mx-4 mt-2 h-20 animate-pulse rounded-card bg-surface-sunken" aria-hidden="true" />
    );
  }

  const [, month, day] = card.date.split("-");
  const dateLabel =
    locale === "en" ? `${Number(month)}/${Number(day)}` : `${Number(month)}月${Number(day)}日`;
  const weekdayLabel = t(WEEKDAY_KEYS[card.weekday] ?? "weekday.sun");

  return (
    <section
      aria-label={t("fortune.title")}
      className="px-4 pb-4 pt-1"
    >
      {/* 标题由弹层提供（TFSheet），这里只留日期，避免同一句话出现两遍。 */}
      <p className="text-caption text-content-muted">
        {dateLabel} · {weekdayLabel}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-content-muted">
        {card.sign ? <span className="font-semibold text-brand-600">{card.sign}</span> : null}
        <span>
          {t("fortune.lucky")} {card.luckyNumbers.join(" · ")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: card.luckyColor.hex }}
            aria-hidden="true"
          />
          {card.luckyColor.name}
        </span>
      </div>

      <dl className="mt-2 space-y-1">
        <div className="flex items-start gap-2">
          <dt className="mt-0.5 shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-overline font-semibold text-brand-600">
            {t("fortune.do")}
          </dt>
          <dd className="text-caption leading-5 text-content">{card.dos.join(" · ")}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="mt-0.5 shrink-0 rounded-md bg-danger-50 px-1.5 py-0.5 text-overline font-semibold text-danger-700">
            {t("fortune.dont")}
          </dt>
          <dd className="text-caption leading-5 text-content">{card.donts.join(" · ")}</dd>
        </div>
      </dl>

      <p className="mt-2 text-caption leading-5 text-content">{card.horoscope}</p>

      {card.ziwei ? (
        <p className="mt-1.5 text-overline leading-4 text-content-subtle">
          {t("fortune.ziwei", {
            ganzhi: card.ziwei.ganzhi,
            soul: card.ziwei.soul,
            lu: card.ziwei.lu,
            quan: card.ziwei.quan,
            ke: card.ziwei.ke,
            ji: card.ziwei.ji,
          })}
          {card.ziwei.assumedHour ? ` · ${t("fortune.assumedHour")}` : ""}
        </p>
      ) : null}
    </section>
  );
}

/**
 * 「每日占卜」的入口按钮 + 弹层（2026-10-31）。
 *
 * 卡片原来是常驻在信息流顶部的：它抢在第一条动态前面，而用户打开这个页面是来
 * 看人的。一块每天都一样、一天只值得看一次的板子压在最上面，视觉上就是突兀。
 *
 * 改成按钮后还顺手省掉一次请求 —— `DailyFortuneCard` 只在弹层挂载后才去拉
 * `/fortune/today`，首页加载不再连带这个接口。
 *
 * 关闭方式：右上角 ✕、点遮罩、Esc（`TFSheet` 的焦点陷阱里已绑定）。
 */
/**
 * 「带太极的魔盒」图标（2026-10-31）。
 *
 * 源文件是 `store/brand/fortune-icon.svg`：网页这里内联（矢量、跟随 currentColor），
 * 手机端用同一份 SVG 渲染出来的 `apps/mobile/assets/fortune-icon.png`
 * （手机不引 react-native-svg，见 `DailyFortuneSheet`）。
 * 改图形只改 SVG，然后重新渲染 PNG —— 两处不要各画一遍。
 */
function FortuneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="3.6" y="7.2" width="16.8" height="12.6" rx="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.6 10.8h16.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 9.4v2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15.4" r="3.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 11.9a3.5 3.5 0 0 1 0 7 1.75 1.75 0 0 0 0-3.5 1.75 1.75 0 0 1 0-3.5z" fill="currentColor" />
      <circle cx="12" cy="13.65" r="0.85" fill="white" />
      <circle cx="12" cy="17.15" r="0.85" fill="currentColor" />
    </svg>
  );
}

export function DailyFortuneEntry() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("fortune.entry")}
        aria-haspopup="dialog"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600 transition-colors duration-instant hover:bg-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <FortuneIcon size={19} />
      </button>
      <TFSheet open={open} onClose={() => setOpen(false)} title={t("fortune.title")}>
        {open ? <DailyFortuneCard /> : null}
      </TFSheet>
    </>
  );
}
