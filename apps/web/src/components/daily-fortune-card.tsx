"use client";

import { useEffect, useState } from "react";
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
      <div className="mx-5 mt-3 h-24 animate-pulse rounded-card border border-border bg-surface-sunken" aria-hidden="true" />
    );
  }

  const [, month, day] = card.date.split("-");
  const dateLabel =
    locale === "en" ? `${Number(month)}/${Number(day)}` : `${Number(month)}月${Number(day)}日`;

  return (
    <section
      aria-label={t("fortune.title")}
      className="mx-5 mt-3 rounded-card border border-border bg-surface px-4 py-3.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ui font-semibold text-content">{t("fortune.title")}</h2>
        <span className="shrink-0 text-overline text-content-subtle">
          {dateLabel} · {t(WEEKDAY_KEYS[card.weekday] ?? "weekday.sun")}
        </span>
      </div>

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
