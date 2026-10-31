"use client";

import { useEffect, useState } from "react";
import { TFSheet } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n/use-locale";
import type { MsgKey } from "@/lib/i18n";

/**
 * 每日运势（2026-10-31 第二版，内容加强）。
 *
 * 数据全部由 `GET /fortune/today?lang=…&date=…` 给出，服务端按 iztro 排盘：
 * 流日/流月/流年四化、命宫星、五行局都是**算出来的**；宜忌按四化的星曜对应，
 * 幸运数字按日柱的河图数，幸运色按日干五行。没有任何一项是随机抽的。
 *
 * 客户端只做排版。改内容去 `apps/api/src/fortune`，两端口径自然一致。
 */

type FourItem = { star: string; theme: string; hint: string };
type PeriodItem = { ganzhi: string; stars: string[] };

type FortuneCard = {
  date: string;
  weekday: number;
  lunar: string | null;
  ganzhi: string;
  element: string;
  sign: string | null;
  luckyNumbers: number[];
  luckyColor: { name: string; hex: string };
  dos: string[];
  donts: string[];
  four: { lu: FourItem; quan: FourItem; ke: FourItem; ji: FourItem } | null;
  month: PeriodItem | null;
  year: PeriodItem | null;
  chart: { palaceStars: string[]; soul: string; body: string; fiveElements: string } | null;
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

const FOUR_KEYS = ["lu", "quan", "ke", "ji"] as const;

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
      <div className="mx-4 mt-2 h-28 animate-pulse rounded-card bg-surface-sunken" aria-hidden="true" />
    );
  }

  const [, month, day] = card.date.split("-");
  const dateLabel =
    locale === "en" ? `${Number(month)}/${Number(day)}` : `${Number(month)}月${Number(day)}日`;
  const weekdayLabel = t(WEEKDAY_KEYS[card.weekday] ?? "weekday.sun");

  return (
    <div className="space-y-3 px-4 pb-5 pt-1">
      <p className="text-caption text-content-muted">
        {dateLabel} · {weekdayLabel}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-content-muted">
        {card.lunar ? <span>{t("fortune.lunar", { text: card.lunar })}</span> : null}
        <span>{t("fortune.ganzhi", { ganzhi: card.ganzhi, element: card.element })}</span>
        {card.sign ? <span className="font-semibold text-brand-600">{card.sign}</span> : null}
      </div>

      {card.four ? (
        <section>
          <p className="text-overline font-semibold tracking-wider text-content-subtle">
            {t("fortune.four")}
          </p>
          <ul className="mt-1 space-y-1">
            {FOUR_KEYS.map((key) => {
              const item = card.four![key];
              return (
                <li key={key} className="flex items-baseline gap-2 text-caption">
                  <span
                    className={`w-5 shrink-0 text-center font-semibold ${
                      key === "ji" ? "text-danger-700" : "text-brand-600"
                    }`}
                  >
                    {t(`fortune.${key}` as MsgKey)}
                  </span>
                  <span className="shrink-0 font-semibold text-content">{item.star}</span>
                  <span className="min-w-0 truncate text-content-muted">{item.theme}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1.5">
        <Row label={t("fortune.do")} tone="do" items={card.dos} />
        <Row label={t("fortune.dont")} tone="dont" items={card.donts} />
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-content-muted">
        <span>
          {t("fortune.lucky")} {card.luckyNumbers.join(" · ")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: card.luckyColor.hex }} aria-hidden="true" />
          {card.luckyColor.name}
        </span>
      </div>

      {card.month || card.year ? (
        <section className="space-y-1 border-t border-border pt-2 text-caption text-content-muted">
          {card.month ? (
            <p>
              <span className="text-content-subtle">{t("fortune.month")} </span>
              <span className="font-semibold text-content">{card.month.ganzhi}</span> ·{" "}
              {card.month.stars.join(" · ")}
            </p>
          ) : null}
          {card.year ? (
            <p>
              <span className="text-content-subtle">{t("fortune.year")} </span>
              <span className="font-semibold text-content">{card.year.ganzhi}</span> ·{" "}
              {card.year.stars.join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {card.chart ? (
        <p className="border-t border-border pt-2 text-caption text-content-muted">
          <span className="text-content-subtle">{t("fortune.chart")} </span>
          {t("fortune.palace")} {card.chart.palaceStars.join("·")} · {t("fortune.soul")}{" "}
          {card.chart.soul} · {t("fortune.body")} {card.chart.body} · {card.chart.fiveElements}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, tone, items }: { label: string; tone: "do" | "dont"; items: string[] }) {
  const badge =
    tone === "do" ? "bg-brand-100 text-brand-700" : "bg-danger-50 text-danger-700";
  return (
    <div className="flex items-start gap-2 text-caption">
      <span className={`mt-0.5 w-5 shrink-0 rounded text-center font-semibold ${badge}`}>{label}</span>
      <span className="min-w-0 flex-1 leading-5 text-content">{items.join(" · ")}</span>
    </div>
  );
}

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

/**
 * 入口按钮 + 弹层。卡片原来是常驻在信息流顶部的 —— 它抢在第一条动态前面，
 * 而用户打开这个页面是来看人的（2026-10-31 改成点开看）。
 */
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
        {open ? (
          <div className="max-h-[70vh] overflow-y-auto tf-scroll">
            <DailyFortuneCard />
          </div>
        ) : null}
      </TFSheet>
    </>
  );
}
