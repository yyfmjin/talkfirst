import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import {
LangProvider,
LangSwitch,
useLang,
elemLabel,
elemList,
signLabel,
signGroupLabel,
animalLabel,
strengthLabel,
traitLabel,
traitList,
pillarLabel,
dayMasterLabel,
BRANCH_PY,
type DictKey
} from "./i18n";
import { ShareCardModal, makeFortuneCard, makeMatchCard, makeNameCard } from "./share-card";

type Profile = NonNullable<ApiResponse<typeof api, "getMyProfile">["profile"]>;
type Candidate = ApiResponse<typeof api, "listCandidates">["candidates"][number];
type Chart = Profile["chart"];
type MatchData = ApiResponse<typeof api, "match">;
type MatchResult = MatchData["results"][number];
type Binding = ApiResponse<typeof api, "listBindings">["bindings"][number];
type ChatMsg = { id: number; sender: "me" | "them"; content: string; createdAt: string };
type Conversation = ApiResponse<typeof api, "listConversations">["conversations"][number];
type DmConversation = ApiResponse<typeof api, "listDmConversations">["conversations"][number];
type DmMessage = ApiResponse<typeof api, "listDmMessages">["messages"][number];
type DirectoryUser = ApiResponse<typeof api, "searchUsers">["users"][number];
type AiMessage = ApiResponse<typeof api, "listAiMessages">["messages"][number];
type Relation = "friend" | "lover" | "partner";

const TRAITS = [
  "温柔", "体贴", "幽默", "上进", "稳重", "乐观", "细心", "独立", "顾家",
  "浪漫", "诚实", "耐心", "热情", "包容", "理性", "文艺", "爱运动", "勤俭",
];

const ELEM_COLORS: Record<string, string> = {
  木: "#7d9b76",
  火: "#c08552",
  土: "#c8a24a",
  金: "#a8a29a",
  水: "#7d93a8",
};
const ELEM_ORDER = ["木", "火", "土", "金", "水"];

const REL_META: Record<Relation, { label: string; limit: string; hint: string }> = {
  friend: { label: "朋友", limit: "上限 10 人", hint: "益友贵精不贵多" },
  lover: { label: "恋人", limit: "限 1 人", hint: "与伴侣互斥 · 专一" },
  partner: { label: "伴侣", limit: "限 1 人", hint: "与恋人互斥 · 专一" },
};

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;
const relKey = (r: Relation): DictKey =>
  r === "friend" ? "relFriend" : r === "lover" ? "relLover" : "relPartner";
const relHintKey = (r: Relation): DictKey =>
  r === "friend" ? "relFriendHint" : r === "lover" ? "relLoverHint" : "relPartnerHint";
const relName = (r: Relation, t: TFn) => t(relKey(r));

/* 真实在线状态：只对注册用户使用，按服务端记录的最近活跃时间计算。
   候选人档案不是真人账号，不计算也不显示任何在线状态。 */
function realPresence(
  lastActiveAt: string | null,
  t: (key: DictKey, params?: Record<string, string | number>) => string,
): { online: boolean; label: string } {
  if (!lastActiveAt) return { online: false, label: t("neverActive") };
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  if (diff < 5 * 60 * 1000) return { online: true, label: t("online") };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { online: false, label: t("activeMinsAgo", { m: Math.max(1, mins) }) };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { online: false, label: t("activeHoursAgo", { h: hours }) };
  return { online: false, label: t("activeDaysAgo", { d: Math.floor(hours / 24) }) };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/* 星空氛围层：细小星尘缓慢漂移闪烁 + 一组淡淡的星座连线。
   确定性伪随机布局（不随渲染跳动），只做装饰，性能开销可忽略。 */
function Starfield({ count = 24, lines = true }: { count?: number; lines?: boolean }) {
  let seed = 987654321;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const stars = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: rand() * 100,
    top: rand() * 100,
    size: 1 + rand() * 1.8,
    gold: rand() < 0.62,
    delay: rand() * 5,
    dur: 3.6 + rand() * 3.4,
  }));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {lines && (
        <svg className="constellation" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <polyline
            points="6,18 22,10 38,20 55,12 72,22 90,14"
            fill="none"
            stroke="var(--ink-blue)"
            strokeWidth="0.35"
            opacity="0.55"
          />
          <polyline points="12,78 30,86 48,76 66,88" fill="none" stroke="var(--ink-blue)" strokeWidth="0.35" opacity="0.4" />
          {[
            [6, 18], [22, 10], [38, 20], [55, 12], [72, 22], [90, 14],
            [12, 78], [30, 86], [48, 76], [66, 88],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="var(--gold-line)" opacity="0.8" />
          ))}
        </svg>
      )}
      {stars.map((s) => (
        <span
          key={s.id}
          className="star"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            backgroundColor: s.gold ? "var(--gold-line)" : "var(--ink-blue)",
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

/* 排盘仪式：缓慢旋转的星盘光圈（约 1.5 秒），之后四柱依次浮现。 */
function CastingOverlay() {
  const { t } = useLang();
  return (
    <div className="flex flex-col items-center py-10" role="status" aria-label={t("castingTitle")}>
      <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden>
        <g className="casting-ring-outer">
          <circle cx="84" cy="84" r="76" fill="none" stroke="var(--gold-line)" strokeWidth="1.4" strokeDasharray="10 14" opacity="0.85" />
          <circle cx="84" cy="10" r="3.2" fill="var(--gold-line)" />
          <circle cx="158" cy="84" r="2.4" fill="var(--ink-blue)" />
          <circle cx="84" cy="158" r="2.4" fill="var(--gold-line)" />
          <circle cx="10" cy="84" r="2.4" fill="var(--ink-blue)" />
        </g>
        <g className="casting-ring-inner">
          <circle cx="84" cy="84" r="56" fill="none" stroke="var(--ink-blue)" strokeWidth="1.1" strokeDasharray="4 9" opacity="0.7" />
          <circle cx="84" cy="28" r="2.2" fill="var(--ink-blue)" />
          <circle cx="140" cy="84" r="1.8" fill="var(--gold-line)" />
        </g>
        <circle cx="84" cy="84" r="34" fill="none" stroke="var(--border)" strokeWidth="1" />
        <text x="84" y="95" textAnchor="middle" fontSize="26" fill="var(--gold-line)" className="casting-core">✦</text>
      </svg>
      <p className="font-display mt-4 text-xl font-bold">{t("castingTitle")}</p>
      <p className="mt-1 text-sm text-[var(--dim)]">{t("castingHint")}</p>
    </div>
  );
}

function PresenceDot({ online, surface }: { online: boolean; surface?: boolean }) {
  const { lang } = useLang();
  return (
    <span
      role="img"
      aria-label={online ? (lang === "en" ? "Online" : "在线") : lang === "en" ? "Offline" : "离线"}
      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 ${
        surface ? "border-[var(--surface)]" : "border-[var(--bg)]"
      } ${online ? "bg-[var(--online)]" : "bg-[var(--dim)] opacity-60"}`}
    />
  );
}

/* ---------------- 小组件 ---------------- */

function ElementBars({ elements, compact }: { elements: number[]; compact?: boolean }) {
  const max = Math.max(...elements, 1);
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {ELEM_ORDER.map((el, i) => {
        const v = elements[i] ?? 0;
        return (
          <div key={el} className="flex items-center gap-2">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-xs font-bold text-white"
              style={{ backgroundColor: ELEM_COLORS[el] }}
            >
              {el}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-alt)]">
              <div
                className="bar-fill h-full rounded-full"
                style={{
                  width: `${Math.round((v / max) * 100)}%`,
                  backgroundColor: ELEM_COLORS[el],
                }}
              />
            </div>
            <span className="w-7 text-right text-xs text-[var(--dim)]">{v.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PillarTiles({ chart, animate }: { chart: Chart; animate?: boolean }) {
  const { t, lang } = useLang();
  const tiles: Array<{ label: string; pillar: Chart["pillars"]["year"] | null; isDay?: boolean }> = [
    { label: t("yearPillar"), pillar: chart.pillars.year },
    { label: t("monthPillar"), pillar: chart.pillars.month },
    { label: t("dayPillar"), pillar: chart.pillars.day, isDay: true },
    { label: t("hourPillar"), pillar: chart.pillars.hour },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className={`${animate ? "reveal-up " : ""}rounded-lg border px-1 py-2 text-center ${
            tile.isDay
              ? "border-[var(--seal)] bg-[var(--surface-alt)]"
              : "border-[var(--border)] bg-[var(--surface)]"
          }`}
          style={animate ? { animationDelay: `${i * 140}ms` } : undefined}
        >
          <div className="text-[11px] tracking-widest text-[var(--dim)]">
            {tile.label}
            {tile.isDay ? ` · ${t("dayMasterMark")}` : ""}
          </div>
          <div className="font-display mt-0.5 text-2xl font-bold leading-tight">
            {tile.pillar ? pillarLabel(tile.pillar, lang) : "— —"}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--dim)]">
            {tile.pillar
              ? lang === "en"
                ? `${elemLabel(tile.pillar.element, lang)} · ${BRANCH_PY[tile.pillar.branch] ?? tile.pillar.branch}`
                : `${tile.pillar.element} · ${tile.pillar.branch}`
              : t("hourUnknown")}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartDetail({ chart, animate }: { chart: Chart; animate?: boolean }) {
  const { t, lang } = useLang();
  return (
    <div className="space-y-3">
      <PillarTiles chart={chart} animate={animate} />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
          {signLabel(chart.zodiacSign, lang)} · {signGroupLabel(chart.zodiacElement, lang)}
        </span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
          {t("animalChip", { animal: animalLabel(chart.zodiacAnimal, lang) })}
        </span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5">
          {t("dayMasterChip", {
            dm: dayMasterLabel(chart.dayMaster, chart.dayMasterElement, lang),
            strength: strengthLabel(chart.strength, lang),
          })}
        </span>
      </div>
      <ElementBars elements={chart.elements} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-[var(--dim)]">{t("favorable")}</span>
        {chart.favorable.map((e) => (
          <span
            key={`f-${e}`}
            className="rounded-sm px-1.5 py-0.5 font-bold text-white"
            style={{ backgroundColor: ELEM_COLORS[e] }}
          >
            {elemLabel(e, lang)}
          </span>
        ))}
        <span className="ml-2 text-[var(--dim)]">{t("avoid")}</span>
        {chart.avoid.map((e) => (
          <span
            key={`a-${e}`}
            className="rounded-sm border px-1.5 py-0.5"
            style={{ borderColor: ELEM_COLORS[e], color: ELEM_COLORS[e] }}
          >
            {elemLabel(e, lang)}
          </span>
        ))}
      </div>
      {!chart.chartComplete && <p className="text-xs text-[var(--seal)]">{t("incompleteNote")}</p>}
    </div>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-[var(--dim)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-alt)]">
        <div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${Math.round((value / max) * 100)}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium">
        {value}/{max}
      </span>
    </div>
  );
}

/* ---------------- 中文起名（面向外国朋友，依据本人命盘） ---------------- */

type NameData = ApiResponse<typeof api, "suggestChineseNames">;
type NameSuggestion = NameData["names"][number];

const NAME_STYLE_KEYS: Array<{ key: string; labelKey: "styleAny" | "styleElegant" | "styleGrand" | "styleFresh" | "styleSteady" | "styleVivid" }> = [
  { key: "any", labelKey: "styleAny" },
  { key: "文雅", labelKey: "styleElegant" },
  { key: "大气", labelKey: "styleGrand" },
  { key: "清新", labelKey: "styleFresh" },
  { key: "稳重", labelKey: "styleSteady" },
  { key: "灵动", labelKey: "styleVivid" },
];

function NameCard({
  n,
  siteTitle,
  index,
  selected,
  onSelect,
}: {
  n: NameSuggestion;
  siteTitle: string;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, lang } = useLang();
  const [shareCanvas, setShareCanvas] = useState<HTMLCanvasElement | null>(null);
  return (
    <article
      onClick={onSelect}
      aria-pressed={selected}
      className={`reveal-up cursor-pointer rounded-[var(--radius)] border bg-[var(--surface)] p-4 ${
        selected ? "name-halo border-[var(--gold-line)]" : "border-[var(--border)]"
      }`}
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="font-display text-3xl font-black tracking-wide">{n.fullName}</span>
          {n.pinyin && <span className="ml-2 text-sm text-[var(--dim)]">{n.pinyin}</span>}
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {selected && <span className="text-xs font-bold text-[var(--gold-line)]">{t("nameSelected")}</span>}
          <span className="rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-bold">
            {t("fitScore", { score: n.score })}
          </span>
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {n.chars.map((c) => (
          <div key={`${c.role}-${c.char}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="font-display flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] text-xl font-bold">
                {c.char}
              </span>
              <span
                className="mt-1 rounded-sm px-1 text-[10px] font-bold text-white"
                style={{ backgroundColor: ELEM_COLORS[c.element] ?? "#999" }}
              >
                {elemLabel(c.element, lang)}
              </span>
            </div>
            <div className="min-w-0 flex-1 text-sm leading-relaxed">
              <p>
                <span className="font-medium">{c.role}</span>
                {c.pinyin && <span className="text-[var(--dim)]"> · {c.pinyin}</span>}
                <span className="text-[var(--dim)]"> · {t("strokesSuffix", { n: c.strokes })}</span>
              </p>
              <p className="text-[var(--dim)]">{t("charMeaning")}{c.meaning}</p>
              <p>
                <span className="text-[var(--gold-line)]">✦</span> {c.reason}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3 text-sm leading-relaxed">
        <p>
          <span className="font-medium">{t("nameElementRelation")}</span>
          {n.elementSummary}
        </p>
        <p>
          <span className="font-medium">{t("nameMeaningLabel")}</span>
          {n.meaningSummary}
        </p>
        <p className="text-[var(--dim)]">{n.toneNote}</p>
        <p className="text-xs text-[var(--dim)]">
          {t("wugeLine", { t: n.wuge.tian, r: n.wuge.ren, d: n.wuge.di, w: n.wuge.wai, z: n.wuge.zong })}
          {n.wuge.lucky.length > 0 && <span className="ml-1">（{n.wuge.lucky.join(lang === "en" ? ", " : "、")}）</span>}
        </p>
      </div>

      <button
        type="button"
        onClick={() =>
          setShareCanvas(
            makeNameCard({
              siteTitle,
              lang,
              fullName: n.fullName,
              pinyin: n.pinyin,
              meaningLine: n.meaningSummary,
              elementLine: n.elementSummary,
            }),
          )
        }
        className="mt-3 w-full rounded-lg border border-[var(--gold-line)] py-2 text-sm font-medium text-[var(--gold-line)]"
      >
        ✦ {t("shareCard")}
      </button>
      {shareCanvas && (
        <ShareCardModal
          canvas={shareCanvas}
          filename={`chinese-name-${n.fullName}.png`}
          onClose={() => setShareCanvas(null)}
        />
      )}
    </article>
  );
}

function NamingPanel({
  data,
  pending,
  error,
  surname,
  setSurname,
  style,
  setStyle,
  batch,
  onGenerate,
  siteTitle,
}: {
  data: NameData | null;
  pending: boolean;
  error: string;
  surname: string;
  setSurname: (v: string) => void;
  style: string;
  setStyle: (v: string) => void;
  batch: number;
  onGenerate: (batch: number) => void;
  siteTitle: string;
}) {
  const { t, lang } = useLang();
  const basis = data?.basis ?? null;
  const names = data?.names ?? [];
  const [selectedName, setSelectedName] = useState<string | null>(null);
  return (
    <article className="plate-frame rounded-[var(--radius)] bg-[var(--surface)] p-4">
      <h3 className="font-display text-xl font-bold">{t("namingTitle")}</h3>
      <p className="mt-0.5 text-xs tracking-wide text-[var(--dim)]">
        A CHINESE NAME FROM YOUR BIRTH CHART
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">{t("namingIntro")}</p>

      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
        <div>
          <label htmlFor="cn-surname" className="mb-1 block text-sm font-medium">
            {t("surnameLabel")}
          </label>
          <input
            id="cn-surname"
            aria-label={t("surnameLabel")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
            value={surname}
            maxLength={1}
            onChange={(e) => setSurname(e.target.value)}
            placeholder={t("surnamePlaceholder")}
          />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onGenerate(0)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-[var(--accent-ink)] disabled:opacity-50"
        >
          {pending ? t("generating") : names.length > 0 ? t("regenerate") : t("generateNames")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("styleGroupLabel")}>
        {NAME_STYLE_KEYS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={style === s.key}
            onClick={() => setStyle(s.key)}
            className={`rounded-full border px-2.5 py-1 text-sm ${
              style === s.key
                ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold"
                : "border-[var(--border)] text-[var(--dim)]"
            }`}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-[var(--seal)]">{error}</p>}

      {basis && names.length > 0 && (
        <div className="mt-4 rounded-lg bg-[var(--surface-alt)] p-3 text-sm leading-relaxed">
          <p className="font-medium">{t("basisTitle")}</p>
          <p className="mt-1">{basis.explanation}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5">
              {t("dayMasterChip", {
                dm: dayMasterLabel(basis.dayMaster, basis.dayMasterElement, lang),
                strength: strengthLabel(basis.strength, lang),
              })}
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5">
              {t("basisFavorable", { list: elemList(basis.favorable, lang) })}
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5">
              {t("basisWeakest", { el: elemLabel(basis.weakest, lang), v: basis.weakestValue })}
              {basis.missing.length > 0 ? t("basisMissing", { list: elemList(basis.missing, lang) }) : ""}
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5">
              {signLabel(basis.zodiacSign, lang)}
            </span>
          </div>
        </div>
      )}

      {names.length > 0 && (
        <>
          <div className="mt-4 space-y-3">
            {names.map((n, i) => (
              <NameCard
                key={n.fullName}
                n={n}
                siteTitle={siteTitle}
                index={i}
                selected={selectedName === n.fullName}
                onSelect={() => setSelectedName(n.fullName)}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => onGenerate(batch + 1)}
            className="mt-4 w-full rounded-lg border border-[var(--border)] py-2 text-sm disabled:opacity-50"
          >
            {pending ? t("generating") : t("moreNames")}
          </button>
          <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">{t("namingDisclaimer")}</p>
        </>
      )}
    </article>
  );
}

/* ---------------- 档案表单（本人 / 候选人共用） ---------------- */

interface PersonValues {
  name: string;
  gender: "male" | "female";
  birthDate: string;
  birthTime: string | null;
  traits: string[];
  notes: string;
}

/**
 * 出生日期：三个原生下拉拼成 `YYYY-MM-DD`（2026-11-08）。
 *
 * 为什么不用 `<input type="date">`：在 Android WebView 里，系统日期选择器的
 * 命中区实测整体偏移一行 —— 点「2 号」选到的是 2 号下面那个数。原生控件不归
 * 页面管，赌系统版本没有意义；换成三个原生 select 后，点哪一项就是哪一项。
 *
 * 三格都选齐才向外发值：只选了年/月时表单仍会提示「请选择出生日期」，
 * 不会巧巧用 1 月 1 日代替真实生日。
 */
function BirthdaySelect({
  idPrefix,
  value,
  onChange,
  ariaLabel,
}: {
  idPrefix: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const { t } = useLang();
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const resolvedYear = parsed ? Number(parsed[1]) : 0;
  const resolvedMonth = parsed ? Number(parsed[2]) : 0;
  const resolvedDay = parsed ? Number(parsed[3]) : 0;

  /**
   * 三格各自的选择**先落在本地**（2026-11-11 修）。
   *
   * 以前是「三格选齐才向外发值」，而三个 select 又都是受控的（`value` 来自 props）：
   * 用户选完年 → 不发值 → props 没变 → select 立即回弹到「年」。界面上看起来就是
   * 「选了，但什么都没改」。半成品必须有个地方待着 —— 待在这里。
   */
  const [draft, setDraft] = useState({
    year: resolvedYear,
    month: resolvedMonth,
    day: resolvedDay,
  });

  /** 外部值变了（比如切换命盘档案、或被动回填）时，把草稿重新对齐。 */
  useEffect(() => {
    setDraft({ year: resolvedYear, month: resolvedMonth, day: resolvedDay });
  }, [resolvedYear, resolvedMonth, resolvedDay]);

  const { year, month, day } = draft;

  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = thisYear; y >= 1920; y -= 1) years.push(y);

  const daysInMonth = month ? new Date(year || thisYear, month, 0).getDate() : 31;
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);

  const cls =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-base text-[var(--text)]";

  /**
   * 只改一格，其余保持草稿里的值；三格齐了才向外发。
   *
   * 向外的值仍然要「完整」—— 只选了年/月时表单依旧提示「请选择出生日期」，
   * 不会偷偷用 1 月 1 日代替真实生日。区别在于：现在界面能看见你刚选的那一格。
   */
  const update = (nextYear: number, nextMonth: number, nextDay: number) => {
    const merged = { year: nextYear, month: nextMonth, day: nextDay };
    if (merged.year && merged.month && merged.day) {
      const maxDay = new Date(merged.year, merged.month, 0).getDate();
      merged.day = Math.min(merged.day, maxDay);
    }
    setDraft(merged);
    if (!merged.year || !merged.month || !merged.day) return;
    onChange(
      `${merged.year}-${String(merged.month).padStart(2, "0")}-${String(merged.day).padStart(2, "0")}`,
    );
  };

  return (
    <div className="flex gap-2" role="group" aria-label={ariaLabel}>
      <select
        id={`${idPrefix}-year`}
        aria-label={`${ariaLabel} ${t("birthYear")}`}
        className={cls}
        value={year || ""}
        onChange={(e) => update(Number(e.target.value), month, day)}
      >
        <option value="">{t("birthYear")}</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        id={`${idPrefix}-month`}
        aria-label={`${ariaLabel} ${t("birthMonth")}`}
        className={cls}
        value={month || ""}
        onChange={(e) => update(year, Number(e.target.value), day)}
      >
        <option value="">{t("birthMonth")}</option>
        {Array.from({ length: 12 }, (_, index) => index + 1).map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        id={`${idPrefix}-day`}
        aria-label={`${ariaLabel} ${t("birthDay")}`}
        className={cls}
        value={day || ""}
        onChange={(e) => update(year, month, Number(e.target.value))}
      >
        <option value="">{t("birthDay")}</option>
        {days.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </div>
  );
}

function PersonForm({
  initial,
  withTraits,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial?: Partial<PersonValues>;
  withTraits: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (v: PersonValues) => void;
}) {
  const { t, lang } = useLang();
  const [name, setName] = useState(initial?.name ?? "");
  const [gender, setGender] = useState<"male" | "female">(initial?.gender ?? "female");
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [birthTime, setBirthTime] = useState(initial?.birthTime ?? "");
  const [noTime, setNoTime] = useState(initial?.birthTime === null);
  const [traits, setTraits] = useState<string[]>(initial?.traits ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const uid = useRef(`pf-${Math.random().toString(36).slice(2, 8)}`).current;

  const toggleTrait = (tr: string) =>
    setTraits((prev) => (prev.includes(tr) ? prev.filter((x) => x !== tr) : [...prev, tr]));

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t("errName"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return setError(t("errDate"));
    if (!noTime && !/^\d{2}:\d{2}$/.test(birthTime)) return setError(t("errTime"));
    setError("");
    onSubmit({
      name: name.trim(),
      gender,
      birthDate,
      birthTime: noTime ? null : birthTime,
      traits,
      notes: notes.trim(),
    });
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";
  const labelCls = "mb-1 block text-sm font-medium";

  return (
    <form onSubmit={handle} className="space-y-3">
      <div>
        <label htmlFor={`${uid}-name`} className={labelCls}>{t("nameLabel")}</label>
        <input
          id={`${uid}-name`}
          aria-label={t("nameLabel")}
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          maxLength={20}
        />
      </div>
      <div>
        <span className={labelCls}>{t("genderLabel")}</span>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("genderLabel")}>
          {(["female", "male"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={gender === g}
              onClick={() => setGender(g)}
              className={`rounded-lg border py-2 text-base ${
                gender === g
                  ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold"
                  : "border-[var(--border)]"
              }`}
            >
              {g === "female" ? t("female") : t("male")}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${uid}-date-year`} className={labelCls}>{t("birthDateLabel")}</label>
          <BirthdaySelect
            idPrefix={`${uid}-date`}
            value={birthDate}
            onChange={setBirthDate}
            ariaLabel={t("birthDateLabel")}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-time`} className={labelCls}>{t("birthTimeLabel")}</label>
          <input
            id={`${uid}-time`}
            aria-label={t("birthTimeLabel")}
            type="time"
            className={inputCls}
            value={birthTime}
            disabled={noTime}
            onChange={(e) => setBirthTime(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--dim)]">
        <input
          type="checkbox"
          aria-label={t("noTimeLabel")}
          checked={noTime}
          onChange={(e) => setNoTime(e.target.checked)}
          className="h-4 w-4"
        />
        {t("noTimeLabel")}
      </label>
      {withTraits && (
        <>
          <div>
            <span className={labelCls}>{t("traitsLabel")}</span>
            <div className="flex flex-wrap gap-1.5">
              {TRAITS.map((tr) => (
                <button
                  key={tr}
                  type="button"
                  aria-pressed={traits.includes(tr)}
                  onClick={() => toggleTrait(tr)}
                  className={`rounded-full border px-2.5 py-1 text-sm ${
                    traits.includes(tr)
                      ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold"
                      : "border-[var(--border)] text-[var(--dim)]"
                  }`}
                >
                  {traitLabel(tr, lang)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-notes`} className={labelCls}>{t("notesLabel")}</label>
            <input
              id={`${uid}-notes`}
              aria-label={t("notesLabel")}
              className={inputCls}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesPlaceholder")}
              maxLength={200}
            />
          </div>
        </>
      )}
      {error && <p className="text-sm text-[var(--seal)]">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[var(--accent)] py-2.5 text-base font-bold text-[var(--accent-ink)] disabled:opacity-50"
      >
        {pending ? t("saving") : submitLabel}
      </button>
    </form>
  );
}

/* ---------------- 匹配结果卡 ---------------- */

function MatchCard({
  result,
  rank,
  relation,
  bindings,
  onBind,
  myName,
  mySign,
  siteTitle,
}: {
  result: MatchResult;
  rank: number;
  relation: Relation;
  bindings: Binding[];
  onBind: (relation: Relation, candidateId: number) => void;
  myName: string;
  mySign: string;
  siteTitle: string;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [shareCanvas, setShareCanvas] = useState<HTMLCanvasElement | null>(null);
  const c = result.candidate;
  const boundHere = bindings.some(
    (b) => b.relationType === relation && b.targetId === c.id,
  );
  return (
    <article className="plate-frame rounded-[var(--radius)] bg-[var(--surface)] p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--gold-line)] text-xl italic text-[var(--gold-line)]"
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display truncate text-xl font-bold">{c.name}</h3>
            <div className="relative shrink-0" role="img" aria-label={`${result.total} ${t("scoreUnit")}`}>
              <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
                <circle cx="32" cy="32" r="26" fill="none" stroke="var(--surface-alt)" strokeWidth="5" />
                <circle
                  cx="32"
                  cy="32"
                  r="26"
                  fill="none"
                  stroke="var(--gold-line)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  className="score-ring"
                  strokeDasharray={2 * Math.PI * 26}
                  strokeDashoffset={2 * Math.PI * 26 * (1 - Math.min(100, Math.max(0, result.total)) / 100)}
                  transform="rotate(-90 32 32)"
                />
              </svg>
              <span className="absolute inset-0 flex items-baseline justify-center pt-[19px]">
                <span className="font-display text-[22px] font-black leading-none text-[var(--accent)]">{result.total}</span>
                <span className="text-[10px] text-[var(--dim)]">{t("scoreUnit")}</span>
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            {c.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: c.age })} ·{" "}
            {signLabel(c.chart.zodiacSign, lang)} · {t("animalChip", { animal: animalLabel(c.chart.zodiacAnimal, lang) })} ·{" "}
            {t("dayMasterChip", { dm: dayMasterLabel(c.chart.dayMaster, c.chart.dayMasterElement, lang), strength: strengthLabel(c.chart.strength, lang) })}
          </p>
          <p className="mt-1">
            <span className="rounded-full border border-[var(--gold-line)] px-2 py-0.5 text-xs font-medium text-[var(--gold-line)]">
              ✦ {result.verdict}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <ScoreBar label={t("scoreZodiac")} value={result.subScores.zodiac} max={25} />
        <ScoreBar label={t("scoreBazi")} value={result.subScores.bazi} max={45} />
        <ScoreBar label={t("scoreDetail")} value={result.subScores.detail} max={30} />
      </div>

      {result.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {result.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="shrink-0 text-[var(--gold-line)]">✦</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {result.concerns.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {result.concerns.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="shrink-0 text-[var(--seal)]">☾</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {open ? t("collapseChart") : t("viewFullChart")}
        </button>
        <button
          type="button"
          disabled={boundHere}
          onClick={() => onBind(relation, c.id)}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-[var(--accent-ink)] disabled:opacity-50"
        >
          {boundHere
            ? t("boundAs", { rel: relName(relation, t) })
            : t("bindAs", { rel: relName(relation, t) })}
        </button>
        <button
          type="button"
          onClick={() =>
            setShareCanvas(
              makeMatchCard({
                siteTitle,
                lang,
                myName,
                theirName: c.name,
                mySign: signLabel(mySign, lang),
                theirSign: signLabel(c.chart.zodiacSign, lang),
                total: result.total,
                verdict: result.verdict,
                subScores: result.subScores,
                subLabels: { zodiac: t("scoreZodiac"), bazi: t("scoreBazi"), detail: t("scoreDetail") },
              }),
            )
          }
          className="rounded-lg border border-[var(--gold-line)] px-3 py-1.5 text-sm font-medium text-[var(--gold-line)]"
        >
          ✦ {t("shareCard")}
        </button>
      </div>
      {shareCanvas && (
        <ShareCardModal
          canvas={shareCanvas}
          filename={`match-${myName}-${c.name}.png`}
          onClose={() => setShareCanvas(null)}
        />
      )}

      {open && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <ChartDetail chart={c.chart} />
          {c.traits.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="text-[var(--dim)]">{t("traitsLine")}</span>
              {traitList(c.traits, lang)}
            </p>
          )}
          {c.notes && (
            <p className="mt-1 text-sm">
              <span className="text-[var(--dim)]">{t("notesLine")}</span>
              {c.notes}
            </p>
          )}
          <p className="mt-1 text-xs text-[var(--dim)]">
            {t("bornLine", { date: c.birthDate })}
            {c.birthTime ? ` ${c.birthTime}` : t("bornTimeUnknownSuffix")}
          </p>
        </div>
      )}
    </article>
  );
}

/* ---------------- 后台小组件 ---------------- */

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs text-[var(--dim)]">{label}</p>
      <p className="font-display mt-1 text-3xl font-black leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-[var(--dim)]">{sub}</p>}
    </div>
  );
}

function DistList({ title, items }: { title: string; items: Array<{ name: string; count: number }> }) {
  const { t } = useLang();
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-[var(--dim)]">{t("noData")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.slice(0, 12).map((it) => (
            <li key={it.name} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 truncate">{it.name}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((it.count / max) * 100)}%` }} />
              </span>
              <span className="w-6 text-right text-xs text-[var(--dim)]">{it.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsForm({ settings, pending, onSave }: { settings: SettingsData; pending: boolean; onSave: (v: SettingsData) => void }) {
  const { t, locale } = useLang();
  const [siteTitle, setSiteTitle] = useState(settings.siteTitle);
  const [siteSubtitle, setSiteSubtitle] = useState(settings.siteSubtitle);
  const [announcement, setAnnouncement] = useState(settings.announcement);
  const [friendLimit, setFriendLimit] = useState(String(settings.friendLimit));
  const [loverLimit, setLoverLimit] = useState(String(settings.loverLimit));
  const [partnerLimit, setPartnerLimit] = useState(String(settings.partnerLimit));
  const [excl, setExcl] = useState(settings.enforceExclusivity);
  const [allowReg, setAllowReg] = useState(settings.allowRegistration);
  const [adminNote, setAdminNote] = useState(settings.adminNote);
  const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";
  const labelCls = "mb-1 block text-sm font-medium";
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          siteTitle: siteTitle.trim() || settings.siteTitle,
          siteSubtitle: siteSubtitle.trim(),
          announcement: announcement.trim(),
          friendLimit: Math.min(50, Math.max(1, Number(friendLimit) || 10)),
          loverLimit: Math.min(10, Math.max(1, Number(loverLimit) || 1)),
          partnerLimit: Math.min(10, Math.max(1, Number(partnerLimit) || 1)),
          enforceExclusivity: excl,
          allowRegistration: allowReg,
          adminNote: adminNote.trim(),
          updatedAt: settings.updatedAt,
        });
      }}
    >
      <div><label htmlFor="st-title" className={labelCls}>{t("stTitle")}</label><input id="st-title" aria-label={t("stTitle")} className={inputCls} value={siteTitle} maxLength={40} onChange={(e) => setSiteTitle(e.target.value)} /></div>
      <div><label htmlFor="st-sub" className={labelCls}>{t("stSubtitle")}</label><input id="st-sub" aria-label={t("stSubtitle")} className={inputCls} value={siteSubtitle} maxLength={80} onChange={(e) => setSiteSubtitle(e.target.value)} /></div>
      <div><label htmlFor="st-ann" className={labelCls}>{t("stAnnouncement")}</label><textarea id="st-ann" aria-label={t("stAnnouncement")} className={inputCls} rows={2} value={announcement} maxLength={300} onChange={(e) => setAnnouncement(e.target.value)} placeholder={t("annPlaceholder")} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label htmlFor="st-fl" className={labelCls}>{t("friendLimit")}</label><input id="st-fl" aria-label={t("friendLimit")} type="number" min={1} max={50} className={inputCls} value={friendLimit} onChange={(e) => setFriendLimit(e.target.value)} /></div>
        <div><label htmlFor="st-ll" className={labelCls}>{t("loverLimit")}</label><input id="st-ll" aria-label={t("loverLimit")} type="number" min={1} max={10} className={inputCls} value={loverLimit} onChange={(e) => setLoverLimit(e.target.value)} /></div>
        <div><label htmlFor="st-pl" className={labelCls}>{t("partnerLimit")}</label><input id="st-pl" aria-label={t("partnerLimit")} type="number" min={1} max={10} className={inputCls} value={partnerLimit} onChange={(e) => setPartnerLimit(e.target.value)} /></div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" aria-label={t("exclLabel")} checked={excl} onChange={(e) => setExcl(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>{t("exclLabel")}<span className="block text-xs text-[var(--dim)]">{t("exclHint")}</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" aria-label={t("regLabel")} checked={allowReg} onChange={(e) => setAllowReg(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>{t("regLabel")}<span className="block text-xs text-[var(--dim)]">{t("regHint")}</span></span>
      </label>
      <div><label htmlFor="st-note" className={labelCls}>{t("adminNoteLabel")}</label><textarea id="st-note" aria-label={t("adminNoteLabel")} className={inputCls} rows={3} value={adminNote} maxLength={500} onChange={(e) => setAdminNote(e.target.value)} placeholder={t("adminNotePlaceholder")} /></div>
      {settings.updatedAt && <p className="text-xs text-[var(--dim)]">{t("lastSaved", { date: new Date(settings.updatedAt).toLocaleString(locale) })}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-ink)] disabled:opacity-50">{pending ? t("savingSettings") : t("saveSettings")}</button>
    </form>
  );
}

/* ---------------- 主应用 ---------------- */

/** TalkFirst 单点登录成功过的痕迹：有它就不再显示「改密码 / 注销」这类本机账号操作。 */
const TF_LINKED_KEY = "bazi.tfLinked";

type Tab = "today" | "chart" | "match" | "people" | "friends" | "chat" | "bonds" | "admin" | "account";
type AdminSection = "overview" | "users" | "profile" | "candidates" | "bonds" | "chats" | "settings" | "data";
type SettingsData = ApiResponse<typeof api, "adminGetSettings">["settings"];
type OverviewData = ApiResponse<typeof api, "adminOverview">;
type MeUser = NonNullable<ApiResponse<typeof api, "me">["user"]>;
type AdminCandidateRow = ApiResponse<typeof api, "adminListAllCandidates">["candidates"][number];

/**
 * 内置后台入口（2026-11-08 关闭）。
 *
 * 运营管理已经整体搬到 TalkFirst 后台（admin.talkfirst.ccwu.cc → 灵游空间）：
 * 两边各有一套后台，权限口径和「谁能删数据」必然会漂移；这里保留实现与动作
 * 但不再暴露入口 —— 需要临时排障时把它改回 true 即可。
 */
const SHOW_BUILT_IN_ADMIN = false;

const TOKEN_KEY = "destiny-atlas-token";
const GUEST_KEY = "destiny-atlas-guest-profile";
const GUEST_AI_KEY = "destiny-atlas-guest-ai-key";


/** 主导航：4 个主入口 + 「更多」。
 *
 * ## 为什么收起来
 *
 * 之前是 8 个胶囊平铺（今日 / 命盘 / 合盘 / 候选 / 好友 / 私聊 / 关系 / 账号），
 * 在 390px 的屏上会折成两行，每次找东西都要先扫一遍全部标签；「账号」这种
 * 一年点两次的入口和「今日」抢同一个视觉层级。
 *
 * 现在：最常用的四个常驻，其余收进「更多」。选中了里面的某项时，「更多」按钮
 * 显示那一项的名字 —— 不然用户会不知道自己现在在哪一页。
 */
const PRIMARY_TABS: Tab[] = ["today", "chart", "match", "chat"];

function TabNav({
  tabs,
  tab,
  onChange,
  moreLabel,
  navLabel,
}: {
  tabs: Array<{ key: Tab; label: string }>;
  tab: Tab;
  onChange: (next: Tab) => void;
  moreLabel: string;
  navLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const primary = tabs.filter((item) => PRIMARY_TABS.includes(item.key));
  const overflow = tabs.filter((item) => !PRIMARY_TABS.includes(item.key));
  const activeOverflow = overflow.find((item) => item.key === tab);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const itemCls = (active: boolean) =>
    `flex-1 whitespace-nowrap rounded-full px-2 py-2 text-[13px] ${
      active ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "text-[var(--dim)]"
    }`;

  return (
    <nav aria-label={navLabel} className="sticky top-0 z-20 -mx-4 bg-[var(--bg)] px-4 pb-2 pt-2">
      <div className="relative">
        <div className="flex gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {primary.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => onChange(item.key)}
              className={itemCls(tab === item.key)}
            >
              {item.label}
            </button>
          ))}
          {overflow.length > 0 && (
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="menu"
              aria-pressed={Boolean(activeOverflow)}
              onClick={() => setOpen((value) => !value)}
              className={`${itemCls(Boolean(activeOverflow))} flex items-center justify-center gap-0.5`}
            >
              {activeOverflow ? activeOverflow.label : moreLabel}
              <span aria-hidden className="text-[10px] opacity-70">▾</span>
            </button>
          )}
        </div>

        {open && overflow.length > 0 && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
          >
            {overflow.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(item.key);
                  setOpen(false);
                }}
                className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${
                  tab === item.key ? "bg-[var(--surface-alt)] font-semibold" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

export function App() {
  return (
    <LangProvider>
      <AppInner />
    </LangProvider>
  );
}

function AppInner() {
  const { t, lang, locale } = useLang();
  const queryClient = useQueryClient();
  const [authToken, setAuthToken] = useState<string>(() => {
    try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
  });
  /**
   * 这个会话是不是由 TalkFirst 带进来的。
   *
   * 是的话，账号的「改密码 / 注销」不该出现在这里 —— 密码在 TalkFirst 那边，
   * 在起名站再放一份只会让用户以为有两套账号（这也是运营说的「串线」）。
   */
  const [tfLinked, setTfLinked] = useState<boolean>(() => {
    try { return localStorage.getItem(TF_LINKED_KEY) === "1"; } catch { return false; }
  });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [editingProfile, setEditingProfile] = useState(false);
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [expandedCandidate, setExpandedCandidate] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  /*
   * TalkFirst 单点登录（2026-11-08）。
   *
   * TalkFirst App 的 WebView 打开本页时，把访问令牌放在 fragment（`#tf=…`）里带进来
   * —— fragment 不会发给服务端，也不会进访问日志。这里拿它换本应用的会话令牌，
   * 然后立刻从地址栏抹掉，避免留在历史记录里。
   *
   * 换失败不弹大错：正常登录/注册入口就在下面，用户仍然可以手动登。
   */
  useEffect(() => {
    const match = /(?:^#|&)tf=([^&]+)/.exec(window.location.hash);
    if (!match) return;
    const tfToken = decodeURIComponent(match[1]);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void (async () => {
      try {
        const res = await api.loginWithTalkFirst({ tfToken, lang });
        if (res.ok && res.token) {
          try {
            localStorage.setItem(TOKEN_KEY, res.token);
          } catch {
            /* 隐私模式下 localStorage 可能不可用：本次会话仍然有效，只是刷新后要重新换。 */
          }
          setAuthToken(res.token);
          setTfLinked(true);
          try {
            localStorage.setItem(TF_LINKED_KEY, "1");
          } catch {
            /* 隐私模式：本次会话内仍然按已绑定处理。 */
          }
          setAuthError("");
        }
      } catch {
        /* 网络失败：忽略，保留手动登录入口。 */
      }
    })();
  }, [lang]);

  // 后台管理状态
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");
  const [adminSearch, setAdminSearch] = useState("");
  const [adminGender, setAdminGender] = useState<"all" | "male" | "female">("all");
  const [adminBoundFilter, setAdminBoundFilter] = useState<"all" | "bound" | "unbound" | "chatted">("all");
  const [adminSort, setAdminSort] = useState<"new" | "old" | "ageAsc" | "ageDesc" | "name">("new");
  const [adminSelected, setAdminSelected] = useState<number[]>([]);
  const [adminEditingId, setAdminEditingId] = useState<number | null>(null);
  const [adminDmConvId, setAdminDmConvId] = useState<number | null>(null);
  const [adminMsgSearch, setAdminMsgSearch] = useState("");
  const [adminBondFilter, setAdminBondFilter] = useState<"all" | Relation>("all");
  const [confirmScope, setConfirmScope] = useState<"chat" | "bindings" | "candidates" | "all" | null>(null);
  const [exportJson, setExportJson] = useState("");
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [adminUserDetailId, setAdminUserDetailId] = useState<number | null>(null);
  const [adminResetPw, setAdminResetPw] = useState<Record<number, string>>({});
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [deleteAccountPw, setDeleteAccountPw] = useState("");
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  // 匹配表单状态
  const [relation, setRelation] = useState<Relation>("friend");
  const [wants, setWants] = useState<string[]>([]);
  const [surname, setSurname] = useState("");
  const [nameContains, setNameContains] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [focusCandidate, setFocusCandidate] = useState<Candidate | null>(null);
  const [matchData, setMatchData] = useState<MatchData | null>(null);

  // 中文起名状态（命盘页签内，按本人命盘生成）
  const [cnSurname, setCnSurname] = useState("");
  const [cnStyle, setCnStyle] = useState("any");
  const [cnBatch, setCnBatch] = useState(0);
  const [cnData, setCnData] = useState<NameData | null>(null);
  const [cnError, setCnError] = useState("");

  // 访客试用状态（只存本机 localStorage，不写服务器）
  const [guestInput, setGuestInput] = useState<PersonValues | null>(() => {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersonValues;
      return parsed && parsed.birthDate ? parsed : null;
    } catch {
      return null;
    }
  });
  const [guestEditing, setGuestEditing] = useState(false);
  const [guestCnData, setGuestCnData] = useState<NameData | null>(null);
  const [guestCnError, setGuestCnError] = useState("");
  const [guestThem, setGuestThem] = useState<PersonValues | null>(null);
  const [guestThemEditing, setGuestThemEditing] = useState(true);
  const [guestMeEditing, setGuestMeEditing] = useState(false);
  type GuestMatchData = ApiResponse<typeof api, "guestMatch">;
  const [guestMatchData, setGuestMatchData] = useState<GuestMatchData | null>(null);
  const [guestShareCanvas, setGuestShareCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fortuneShareCanvas, setFortuneShareCanvas] = useState<HTMLCanvasElement | null>(null);

  // 聊天状态：真实私聊（注册用户之间）+ 旧模拟记录（只读）+ AI 助手
  const [activeDm, setActiveDm] = useState<{
    conversationId: number;
    otherUserId: number;
    otherUsername: string;
  } | null>(null);
  const [activeLegacy, setActiveLegacy] = useState<{
    conversationId: number;
    candidateName: string;
  } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [dmError, setDmError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiError, setAiError] = useState("");
  const [guestAiKey] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(GUEST_AI_KEY);
      if (saved) return saved;
      const k = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(GUEST_AI_KEY, k);
      return k;
    } catch {
      return "guest-fallback-key";
    }
  });
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const aiEndRef = useRef<HTMLDivElement | null>(null);

  // 排盘仪式状态：提交档案后先转 1.5 秒星盘光圈，再揭晓命盘
  const [casting, setCasting] = useState(false);
  const castingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runCasting = () => {
    if (prefersReducedMotion()) return;
    setCasting(true);
    if (castingTimer.current) clearTimeout(castingTimer.current);
    castingTimer.current = setTimeout(() => setCasting(false), 1500);
  };

  const meQ = useQuery({
    queryKey: ["me", authToken],
    queryFn: () => api.me({ token: authToken }),
    enabled: authToken !== "",
  });
  const me: MeUser | null = authToken ? (meQ.data?.user ?? null) : null;
  const loggedIn = !!me;
  const isAdmin = me?.role === "admin";

  const siteQ = useQuery({ queryKey: ["site-settings"], queryFn: () => api.getSiteSettings({}) });

  const guestChartQ = useQuery({
    queryKey: ["guest-chart", guestInput],
    queryFn: () =>
      api.guestChart({
        name: guestInput?.name ?? "",
        gender: guestInput?.gender ?? "female",
        birthDate: guestInput?.birthDate ?? "",
        birthTime: guestInput?.birthTime ?? null,
      }),
    enabled: !loggedIn && guestInput !== null,
  });
  const guestProfile: Profile | null = guestChartQ.data?.profile ?? null;

  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getMyProfile({ token: authToken }),
    enabled: loggedIn,
  });
  const candidatesQ = useQuery({
    queryKey: ["candidates"],
    queryFn: () => api.listCandidates({ token: authToken }),
    enabled: loggedIn,
  });
  const bindingsQ = useQuery({
    queryKey: ["bindings"],
    queryFn: () => api.listBindings({ token: authToken }),
    enabled: loggedIn,
  });
  // 旧模拟会话（只读历史）
  const conversationsQ = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.listConversations({ token: authToken }),
    enabled: loggedIn,
  });
  const legacyMessagesQ = useQuery({
    queryKey: ["legacy-messages", activeLegacy?.conversationId ?? 0],
    queryFn: () => api.listMessages({ token: authToken, conversationId: activeLegacy?.conversationId ?? 0 }),
    enabled: loggedIn && activeLegacy !== null,
  });
  // 真实私聊：会话列表 4 秒轮询（未读数及时更新）
  const dmConvsQ = useQuery({
    queryKey: ["dm-conversations"],
    queryFn: () => api.listDmConversations({ token: authToken }),
    enabled: loggedIn,
    refetchInterval: loggedIn ? 4000 : false,
  });
  // 站内用户目录 / 搜索（聊天与好友页签共用）
  const directoryQ = useQuery({
    queryKey: ["directory", userSearch],
    queryFn: () => api.searchUsers({ token: authToken, query: userSearch }),
    enabled: loggedIn && (tab === "chat" || tab === "friends"),
    refetchInterval: loggedIn && (tab === "chat" || tab === "friends") ? 30000 : false,
  });
  // 当前私聊消息：3 秒轮询，接近实时
  const dmMessagesQ = useQuery({
    queryKey: ["dm-messages", activeDm?.conversationId ?? 0],
    queryFn: () => api.listDmMessages({ token: authToken, conversationId: activeDm?.conversationId ?? 0 }),
    enabled: loggedIn && activeDm !== null,
    refetchInterval: 3000,
  });
  // AI 助手对话记录
  const aiMessagesQ = useQuery({
    queryKey: ["ai-messages", loggedIn ? "user" : guestAiKey],
    queryFn: () => api.listAiMessages({ token: authToken, guestKey: guestAiKey }),
    enabled: aiOpen,
  });
  const settingsQ = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminGetSettings({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const overviewQ = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api.adminOverview({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const adminUsersQ = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.adminListUsers({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const adminAllCandidatesQ = useQuery({
    queryKey: ["admin-all-candidates"],
    queryFn: () => api.adminListAllCandidates({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const adminAllBindingsQ = useQuery({
    queryKey: ["admin-all-bindings"],
    queryFn: () => api.adminListAllBindings({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const adminAllConvsQ = useQuery({
    queryKey: ["admin-all-conversations"],
    queryFn: () => api.adminListAllConversations({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const adminUserDetailQ = useQuery({
    queryKey: ["admin-user-detail", adminUserDetailId ?? 0],
    queryFn: () => api.adminGetUserDetail({ token: authToken, userId: adminUserDetailId ?? 0 }),
    enabled: isAdmin && tab === "admin" && adminUserDetailId !== null,
  });
  const adminDmConvsQ = useQuery({
    queryKey: ["admin-dm-conversations"],
    queryFn: () => api.adminListDmConversations({ token: authToken }),
    enabled: isAdmin && tab === "admin",
  });
  const adminDmMessagesQ = useQuery({
    queryKey: ["admin-dm-messages", adminDmConvId ?? 0],
    queryFn: () => api.adminListDmMessages({ token: authToken, conversationId: adminDmConvId ?? 0 }),
    enabled: isAdmin && tab === "admin" && adminDmConvId !== null,
  });

  const conversations: Conversation[] = conversationsQ.data?.conversations ?? [];
  const legacyMessages: ChatMsg[] = legacyMessagesQ.data?.messages ?? [];
  const dmConversations: DmConversation[] = dmConvsQ.data?.conversations ?? [];
  const dmTotalUnread = dmConvsQ.data?.totalUnread ?? 0;
  const dmMessages: DmMessage[] = dmMessagesQ.data?.messages ?? [];
  const dmOther = dmMessagesQ.data?.other ?? null;
  const directoryUsers: DirectoryUser[] = directoryQ.data?.users ?? [];
  const aiMessages: AiMessage[] = aiMessagesQ.data?.messages ?? [];

  useEffect(() => {
    if (tab === "chat" && (activeDm || activeLegacy)) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [dmMessages.length, legacyMessages.length, tab, activeDm, activeLegacy]);

  useEffect(() => {
    if (aiOpen) {
      aiEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [aiMessages.length, aiOpen]);

  // 活跃心跳：登录期间每 30 秒报一次活跃，在线状态据此计算
  useEffect(() => {
    if (!loggedIn) return;
    void api.heartbeat({ token: authToken }).catch(() => undefined);
    const id = setInterval(() => {
      void api.heartbeat({ token: authToken }).catch(() => undefined);
    }, 30000);
    return () => clearInterval(id);
  }, [loggedIn, authToken]);

  const profile = profileQ.data?.profile ?? null;

  // 每日运势：登录用户用本人档案，访客用本机试排档案；日期取用户本地今天
  const todayDateStr = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const fortuneBirth = loggedIn
    ? profile
      ? { birthDate: profile.birthDate, birthTime: profile.birthTime }
      : null
    : guestProfile
      ? { birthDate: guestProfile.birthDate, birthTime: guestProfile.birthTime }
      : null;
  const fortuneQ = useQuery({
    queryKey: ["daily-fortune", lang, todayDateStr, fortuneBirth?.birthDate ?? "", fortuneBirth?.birthTime ?? ""],
    queryFn: () =>
      api.dailyFortune({
        token: loggedIn ? authToken : "",
        date: todayDateStr,
        ...(fortuneBirth ? { birthDate: fortuneBirth.birthDate, birthTime: fortuneBirth.birthTime } : {}),
        lang,
      }),
    enabled: !!fortuneBirth,
  });
  const otdQ = useQuery({
    queryKey: ["on-this-day", lang, todayDateStr.slice(5)],
    queryFn: () => api.onThisDay({ mmdd: todayDateStr.slice(5), lang }),
    staleTime: 1000 * 60 * 60,
  });
  const fortune = fortuneQ.data?.fortune ?? null;
  const candidates = candidatesQ.data?.candidates ?? [];
  const bindings = bindingsQ.data?.bindings ?? [];
  const limits = bindingsQ.data?.limits ?? { friend: 10, lover: 1, partner: 1 };

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
    void queryClient.invalidateQueries({ queryKey: ["candidates"] });
    void queryClient.invalidateQueries({ queryKey: ["bindings"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["directory"] });
    void queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-all-candidates"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-all-bindings"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-all-conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-user-detail"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-dm-conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-dm-messages"] });
  };

  const siteSettings: SettingsData | null = siteQ.data?.settings ?? null;
  const adminSettings: SettingsData | null = settingsQ.data?.settings ?? null;
  const overview: OverviewData | undefined = overviewQ.data;

  const saveSettingsM = useMutation({
    mutationFn: (v: SettingsData) =>
      api.adminSaveSettings({ token: authToken, 
        siteTitle: v.siteTitle, siteSubtitle: v.siteSubtitle, announcement: v.announcement,
        friendLimit: v.friendLimit, loverLimit: v.loverLimit, partnerLimit: v.partnerLimit,
        enforceExclusivity: v.enforceExclusivity, allowRegistration: v.allowRegistration, adminNote: v.adminNote,
      }),
    onSuccess: () => { invalidateAll(); setNotice(t("settingsSavedNotice")); },
  });
  const updateCandidateM = useMutation({
    mutationFn: (args: { id: number; v: PersonValues }) =>
      api.adminUpdateCandidate({ token: authToken,  id: args.id, name: args.v.name, gender: args.v.gender, birthDate: args.v.birthDate, birthTime: args.v.birthTime, traits: args.v.traits, notes: args.v.notes }),
    onSuccess: () => { invalidateAll(); setAdminEditingId(null); setNotice(t("candidateUpdatedNotice")); },
  });
  const deleteProfileM = useMutation({
    mutationFn: (userId: number) => api.adminDeleteProfile({ token: authToken, userId }),
    onSuccess: () => { invalidateAll(); setNotice(t("profileDeletedNotice")); },
  });
  const deleteConversationM = useMutation({
    mutationFn: (conversationId: number) => api.adminDeleteDmConversation({ token: authToken, conversationId }),
    onSuccess: () => { invalidateAll(); setAdminDmConvId(null); setNotice(t("conversationDeletedNotice")); },
  });
  const deleteMessageM = useMutation({
    mutationFn: (messageId: number) => api.adminDeleteDmMessage({ token: authToken, messageId }),
    onSuccess: (_d, messageId) => {
      void messageId;
      invalidateAll();
      if (adminDmConvId) void queryClient.invalidateQueries({ queryKey: ["admin-dm-messages", adminDmConvId] });
      setNotice(t("messageDeletedNotice"));
    },
  });
  const bulkDeleteM = useMutation({
    mutationFn: (ids: number[]) => api.adminBulkDeleteCandidates({ token: authToken,  ids }),
    onSuccess: (d) => { invalidateAll(); setAdminSelected([]); setNotice(t("bulkDeletedNotice", { n: d.deleted })); },
  });
  const clearDataM = useMutation({
    mutationFn: (scope: "chat" | "bindings" | "candidates" | "all") => api.adminClearData({ token: authToken, scope }),
    onSuccess: (d) => { invalidateAll(); setConfirmScope(null); setAdminSelected([]); setAdminDmConvId(null); setActiveDm(null); setActiveLegacy(null); setNotice(d.message); },
  });
  const exportM = useMutation({
    mutationFn: () => api.adminExportData({ token: authToken }),
    onSuccess: (d) => setExportJson(d.json),
  });

  const applySession = (token: string) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
    setAuthToken(token);
    queryClient.clear();
    setTab("chart");
    setActiveDm(null);
    setActiveLegacy(null);
    setAiOpen(false);
  };
  // 登录/注册成功后：把访客试算时填的命盘一并存进新账号（若有）
  const afterAuth = (token: string, message: string) => {
    setAuthError("");
    setAuthPassword("");
    applySession(token);
    if (guestInput) {
      void api
        .saveMyProfile({
          token,
          name: guestInput.name,
          gender: guestInput.gender,
          birthDate: guestInput.birthDate,
          birthTime: guestInput.birthTime,
        })
        .then(() => {
          setNotice(`${message} ${t("guestSavedNotice")}`);
          void queryClient.invalidateQueries({ queryKey: ["profile"] });
        })
        .catch(() => setNotice(message));
    } else {
      setNotice(message);
    }
  };
  const registerM = useMutation({
    mutationFn: () => api.register({ username: authUsername.trim(), password: authPassword, lang }),
    onSuccess: (d) => {
      if (!d.ok || !d.token) { setAuthError(d.message); return; }
      afterAuth(d.token, d.message);
    },
    onError: () => setAuthError(t("registerFail")),
  });
  const loginM = useMutation({
    mutationFn: () => api.login({ username: authUsername.trim(), password: authPassword, lang }),
    onSuccess: (d) => {
      if (!d.ok || !d.token) { setAuthError(d.message); return; }
      afterAuth(d.token, d.message);
    },
    onError: () => setAuthError(t("loginFail")),
  });
  const logoutM = useMutation({
    mutationFn: () => api.logout({ token: authToken }),
    onSettled: () => {
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      setAuthToken("");
      queryClient.clear();
      setActiveDm(null);
      setActiveLegacy(null);
      setAiOpen(false);
      setTab("chart");
      setNotice("");
    },
  });
  const setUserStatusM = useMutation({
    mutationFn: (args: { userId: number; status: "active" | "disabled" }) => api.adminSetUserStatus({ token: authToken, ...args }),
    onSuccess: (d) => { setNotice(d.message); invalidateAll(); },
  });
  const setUserRoleM = useMutation({
    mutationFn: (args: { userId: number; role: "admin" | "user" }) => api.adminSetUserRole({ token: authToken, ...args }),
    onSuccess: (d) => { setNotice(d.message); invalidateAll(); },
  });
  const resetUserPwM = useMutation({
    mutationFn: (args: { userId: number; newPassword: string }) => api.adminResetUserPassword({ token: authToken, ...args }),
    onSuccess: (d, args) => {
      setNotice(d.message);
      setAdminResetPw((prev) => ({ ...prev, [args.userId]: "" }));
      invalidateAll();
    },
  });
  const deleteUserM = useMutation({
    mutationFn: (userId: number) => api.adminDeleteUser({ token: authToken, userId }),
    onSuccess: (d) => { setNotice(d.message); setConfirmDeleteUserId(null); setAdminUserDetailId(null); invalidateAll(); },
  });
  const adminUnbindM = useMutation({
    mutationFn: (id: number) => api.adminUnbind({ token: authToken, id }),
    onSuccess: () => { invalidateAll(); setNotice(t("unbindDoneNotice")); },
  });
  const changePwM = useMutation({
    mutationFn: () => api.changeMyPassword({ token: authToken, oldPassword: oldPw, newPassword: newPw }),
    onSuccess: (d) => {
      setNotice(d.message);
      if (d.ok) { setOldPw(""); setNewPw(""); }
    },
  });
  const deleteMyAccountM = useMutation({
    mutationFn: () => api.deleteMyAccount({ token: authToken, password: deleteAccountPw }),
    onSuccess: (d) => {
      if (!d.ok) { setNotice(d.message); return; }
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      setAuthToken("");
      queryClient.clear();
      setShowDeleteAccount(false);
      setDeleteAccountPw("");
    },
  });

  const suggestNamesM = useMutation({
    mutationFn: (batch: number) =>
      api.suggestChineseNames({
        token: authToken,
        surname: cnSurname.trim(),
        style: cnStyle as "any" | "文雅" | "大气" | "清新" | "稳重" | "灵动",
        batch,
        lang,
      }),
    onSuccess: (d, batch) => {
      if (!d.ok) {
        setCnError(d.message);
        return;
      }
      setCnError("");
      setCnData(d);
      setCnBatch(batch);
    },
    onError: () => setCnError(t("namingFail")),
  });

  // 访客试用 mutations（不带 token、不写库）
  const guestNamesM = useMutation({
    mutationFn: (batch: number) =>
      api.guestNames({
        gender: guestInput?.gender ?? "female",
        birthDate: guestInput?.birthDate ?? "",
        birthTime: guestInput?.birthTime ?? null,
        surname: cnSurname.trim(),
        style: cnStyle as "any" | "文雅" | "大气" | "清新" | "稳重" | "灵动",
        batch,
        lang,
      }),
    onSuccess: (d, batch) => {
      if (!d.ok) {
        setGuestCnError(d.message);
        return;
      }
      setGuestCnError("");
      setGuestCnData(d);
      setCnBatch(batch);
    },
    onError: () => setGuestCnError(t("namingFail")),
  });

  const guestMatchM = useMutation({
    mutationFn: (args: { me: PersonValues; them: PersonValues }) =>
      api.guestMatch({
        relationType: relation,
        wants,
        lang,
        me: { name: args.me.name, gender: args.me.gender, birthDate: args.me.birthDate, birthTime: args.me.birthTime },
        them: {
          name: args.them.name,
          gender: args.them.gender,
          birthDate: args.them.birthDate,
          birthTime: args.them.birthTime,
          traits: args.them.traits,
        },
      }),
    onSuccess: (d) => setGuestMatchData(d),
  });

  const saveGuestInput = (v: PersonValues) => {
    setGuestInput(v);
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(v)); } catch { /* ignore */ }
    setGuestEditing(false);
    setGuestCnData(null);
    setCnBatch(0);
    runCasting();
  };

  const saveProfileM = useMutation({
    mutationFn: (v: PersonValues) =>
      api.saveMyProfile({ token: authToken, 
        name: v.name,
        gender: v.gender,
        birthDate: v.birthDate,
        birthTime: v.birthTime,
      }),
    onSuccess: () => {
      invalidateAll();
      setEditingProfile(false);
      setCnData(null);
      setCnBatch(0);
      runCasting();
      setNotice(t("profileSaved"));
    },
  });

  const addCandidateM = useMutation({
    mutationFn: (v: PersonValues) =>
      api.addCandidate({ token: authToken, 
        name: v.name,
        gender: v.gender,
        birthDate: v.birthDate,
        birthTime: v.birthTime,
        traits: v.traits,
        notes: v.notes,
      }),
    onSuccess: () => {
      invalidateAll();
      setShowAddCandidate(false);
      setNotice(t("candidateAdded"));
    },
  });

  const deleteCandidateM = useMutation({
    mutationFn: (id: number) => api.deleteCandidate({ token: authToken,  id }),
    onSuccess: () => {
      invalidateAll();
      setNotice(t("candidateDeleted"));
    },
  });

  const matchM = useMutation({
    mutationFn: (candidateId: number | null) =>
      api.match({ token: authToken,
        relationType: relation,
        wants,
        surname: surname.trim(),
        nameContains: nameContains.trim(),
        ageMin: ageMin === "" ? null : Number(ageMin),
        ageMax: ageMax === "" ? null : Number(ageMax),
        candidateId,
        lang,
      }),
    onSuccess: (data) => setMatchData(data),
  });

  const bindM = useMutation({
    mutationFn: (args: { relationType: Relation; candidateId: number }) => api.bind({ ...args, token: authToken, lang }),
    onSuccess: (data) => {
      setNotice(data.message);
      invalidateAll();
    },
  });

  const openDmM = useMutation({
    mutationFn: (otherUserId: number) => api.openDmConversation({ token: authToken, otherUserId, lang }),
    onSuccess: (data) => {
      if (!data.ok || data.conversationId == null) {
        setNotice(data.message || (lang === "en" ? "Could not open the chat." : "打开聊天失败。"));
        return;
      }
      setDmError("");
      setActiveLegacy(null);
      setAiOpen(false);
      setActiveDm({
        conversationId: data.conversationId,
        otherUserId: data.otherUserId,
        otherUsername: data.otherUsername,
      });
      setTab("chat");
      void queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["dm-messages", data.conversationId] });
    },
  });

  const openDmWith = (u: { id: number; username: string }) => {
    setDmError("");
    setActiveLegacy(null);
    setAiOpen(false);
    openDmM.mutate(u.id);
  };

  const sendDmM = useMutation({
    mutationFn: (args: { conversationId: number; content: string }) =>
      api.sendDmMessage({ token: authToken, conversationId: args.conversationId, content: args.content, lang }),
    onSuccess: (data, args) => {
      if (!data.ok) {
        setDmError(data.message);
        return;
      }
      setDmError("");
      void queryClient.invalidateQueries({ queryKey: ["dm-messages", args.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
    },
    onError: () => setDmError(lang === "en" ? "Sending failed — please retry." : "发送失败，请重试。"),
  });

  const blockM = useMutation({
    mutationFn: (args: { userId: number; blocked: boolean }) =>
      api.setBlock({ token: authToken, userId: args.userId, blocked: args.blocked, lang }),
    onSuccess: (data) => {
      setNotice(data.message);
      void queryClient.invalidateQueries({ queryKey: ["directory"] });
      void queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["dm-messages"] });
    },
  });

  const askAiM = useMutation({
    mutationFn: (question: string) =>
      api.askAiAssistant({ token: authToken, guestKey: guestAiKey, question, lang }),
    onSuccess: (data) => {
      if (!data.ok) {
        setAiError(data.message || t("aiSendFail"));
        return;
      }
      setAiError("");
      void queryClient.invalidateQueries({ queryKey: ["ai-messages"] });
    },
    onError: () => setAiError(t("aiSendFail")),
  });

  const clearAiM = useMutation({
    mutationFn: () => api.clearAiMessages({ token: authToken, guestKey: guestAiKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-messages"] });
    },
  });

  const clearConversationM = useMutation({
    mutationFn: (conversationId: number) => api.clearConversation({ token: authToken, conversationId }),
    onSuccess: (_d, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: ["legacy-messages", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setNotice(t("chatCleared"));
    },
  });

  const unbindM = useMutation({
    mutationFn: (id: number) => api.unbind({ token: authToken,  id }),
    onSuccess: () => {
      invalidateAll();
      setNotice(t("unboundNotice"));
    },
  });

  const toggleWant = (t: string) =>
    setWants((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const soloMatch = (c: Candidate) => {
    setFocusCandidate(c);
    setMatchData(null);
    setTab("match");
    matchM.mutate(c.id);
  };

  const tabs: Array<{ key: Tab; label: string }> = loggedIn
    ? [
        { key: "today", label: t("tabToday") },
        { key: "chart", label: t("tabChart") },
        { key: "match", label: t("tabMatch") },
        { key: "people", label: `${t("tabPeople")}${candidates.length ? ` ${candidates.length}` : ""}` },
        { key: "friends", label: `${t("tabFriends")}${candidates.length ? ` ${candidates.length}` : ""}` },
        { key: "chat", label: `${t("tabChat")}${dmTotalUnread ? ` (${dmTotalUnread})` : ""}` },
        { key: "bonds", label: t("tabBonds") },
        { key: "account", label: t("tabAccount") },
        ...(isAdmin && SHOW_BUILT_IN_ADMIN ? [{ key: "admin" as Tab, label: t("tabAdmin") }] : []),
      ]
    : [
        { key: "today" as Tab, label: t("tabToday") },
        { key: "chart" as Tab, label: t("tabChart") },
        { key: "match" as Tab, label: t("tabMatch") },
        { key: "people" as Tab, label: t("tabPeople") },
        { key: "friends" as Tab, label: t("tabFriends") },
        { key: "chat" as Tab, label: t("tabChat") },
        { key: "bonds" as Tab, label: t("tabBonds") },
        { key: "account" as Tab, label: t("tabAccount") },
      ];

  const inputCls =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";

  const siteTitleText = siteSettings?.siteTitle ?? "Destiny Atlas";
  const DEFAULT_SUB_ZH = "星座 · 八字 · 五行 —— 遇见合拍的人";
  const DEFAULT_SUB_EN = "Zodiac · BaZi · Five Elements — meet people you're in tune with";
  const rawSubtitle = siteSettings?.siteSubtitle ?? DEFAULT_SUB_ZH;
  const subtitleText = lang === "en" && rawSubtitle === DEFAULT_SUB_ZH ? DEFAULT_SUB_EN : rawSubtitle;

  /* ---------- AI 命理助手（聊天页签置顶入口 + 独立对话视图，访客与登录共用） ---------- */
  const aiAvatar = (size: "sm" | "md") => (
    <span
      aria-hidden
      className={`ai-halo font-display flex shrink-0 items-center justify-center rounded-full bg-[var(--ink-blue)] font-bold text-white ${
        size === "sm" ? "h-8 w-8 text-[11px]" : "h-11 w-11 text-[13px]"
      }`}
    >
      AI✦
    </span>
  );

  const renderAiPinnedCard = () => (
    <button
      type="button"
      onClick={() => { setAiOpen(true); setActiveDm(null); setActiveLegacy(null); }}
      className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--gold-line)] bg-[var(--surface)] px-4 py-3 text-left"
    >
      {aiAvatar("md")}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display truncate text-lg font-bold">{t("aiAssistantName")}</span>
          <span className="shrink-0 rounded-full bg-[var(--ink-blue)] px-1.5 py-px text-[10px] font-bold text-white">{t("aiBadge")}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--dim)]">{t("aiPinnedHint")}</span>
      </span>
      <span aria-hidden className="shrink-0 text-[var(--gold-line)]">✦</span>
    </button>
  );

  const renderAiView = () => (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <button
          type="button"
          onClick={() => setAiOpen(false)}
          aria-label={t("backToListAria")}
          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-sm"
        >
          {t("backToList")}
        </button>
        {aiAvatar("sm")}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold leading-tight">
            <span className="truncate">{t("aiAssistantName")}</span>
            <span className="shrink-0 rounded-full bg-[var(--ink-blue)] px-1.5 py-px text-[10px] font-bold text-white">{t("aiBadge")}</span>
          </p>
          <p className="truncate text-xs text-[var(--dim)]">{t("aiPinnedHint")}</p>
        </div>
        {aiMessages.length > 0 && (
          <button
            type="button"
            onClick={() => clearAiM.mutate()}
            className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--dim)]"
          >
            {t("aiClear")}
          </button>
        )}
      </div>

      <div className="border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2.5">
        <p className="text-xs leading-relaxed text-[var(--dim)]">{t("aiIntro")}</p>
        {!loggedIn && <p className="mt-1 text-xs leading-relaxed text-[var(--gold-line)]">{t("aiGuestNote")}</p>}
      </div>

      <div className="h-[44vh] space-y-2.5 overflow-y-auto bg-[var(--bg)] px-3 py-3">
        {aiMessagesQ.isPending && aiMessages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--dim)]">{t("connecting")}</p>
        ) : aiMessages.length === 0 && !askAiM.isPending ? (
          <div className="py-6 text-center">
            <p aria-hidden className="text-[var(--gold-line)]">✦ ☾</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-[var(--dim)]">{t("aiEmptyHint")}</p>
            <p className="mt-4 text-xs text-[var(--dim)]">{t("aiSuggestionsLabel")}</p>
            <div className="mx-auto mt-2 flex max-w-md flex-col gap-2">
              {[t("aiQ1"), t("aiQ2"), t("aiQ3")].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => askAiM.mutate(q)}
                  className="rounded-full border border-[var(--gold-line)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          aiMessages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="msg-in flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[var(--ink-blue)] px-3.5 py-2 text-[15px] leading-relaxed text-white">
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ) : (
              <div key={m.id} className="msg-in flex items-start gap-2">
                {aiAvatar("sm")}
                <div className="max-w-[78%] rounded-2xl rounded-bl-md border border-[var(--gold-line)] bg-[var(--surface)] px-3.5 py-2 text-[15px] leading-relaxed">
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className="mt-0.5 text-right text-[10px] text-[var(--dim)]">
                    {new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ),
          )
        )}
        {askAiM.isPending && (
          <div className="flex items-start gap-2" aria-live="polite">
            {aiAvatar("sm")}
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--gold-line)]" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--gold-line)]" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--gold-line)]" />
              <span className="ml-1.5 text-xs text-[var(--dim)]">{t("aiThinking")}</span>
            </div>
          </div>
        )}
        <div ref={aiEndRef} />
      </div>

      {aiError && <p role="alert" className="border-t border-[var(--border)] px-4 py-2 text-sm text-[var(--seal)]">{aiError}</p>}
      <form
        className="flex items-end gap-2 border-t border-[var(--border)] px-3 py-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const q = aiInput.trim();
          if (!q || askAiM.isPending) return;
          setAiInput("");
          setAiError("");
          askAiM.mutate(q);
        }}
      >
        <label htmlFor="ai-input" className="sr-only">{t("aiAssistantName")}</label>
        <textarea
          id="ai-input"
          aria-label={t("aiAssistantName")}
          rows={1}
          maxLength={500}
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          placeholder={t("aiPlaceholder")}
          className="max-h-28 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base text-[var(--text)]"
        />
        <button
          type="submit"
          disabled={!aiInput.trim() || askAiM.isPending}
          className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--accent-ink)] disabled:opacity-40"
        >
          {t("send")}
        </button>
      </form>
      <p className="border-t border-[var(--border)] px-4 py-2 text-center text-[11px] text-[var(--dim)]">{t("aiFooterNote")}</p>
    </article>
  );

  /* ---------- 站内真实用户行（搜索结果 / 好友页签共用） ---------- */
  const renderUserRow = (u: DirectoryUser) => {
    const p = realPresence(u.lastActiveAt, t);
    return (
      <div
        key={u.id}
        className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      >
        <span className="relative shrink-0">
          <span aria-hidden className="font-display flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-alt)] text-lg italic">
            {u.username.slice(0, 1)}
          </span>
          <PresenceDot online={p.online} surface />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{u.username}</span>
            <span className="shrink-0 rounded-full border border-[var(--ink-blue)] px-1.5 py-px text-[10px] text-[var(--ink-blue)]">{t("realUserChip")}</span>
            {u.role === "admin" && (
              <span className="shrink-0 rounded-full bg-[var(--surface-alt)] px-1.5 py-px text-[10px] text-[var(--dim)]">{t("adminBadge")}</span>
            )}
            {u.iBlocked && (
              <span className="shrink-0 rounded-full bg-[var(--surface-alt)] px-1.5 py-px text-[10px] text-[var(--seal)]">{t("blockUser")}</span>
            )}
          </span>
          <span className={`mt-0.5 block truncate text-xs ${p.online ? "text-[var(--online)]" : "text-[var(--dim)]"}`}>
            {p.label}
            {u.hasProfile && u.zodiacSign ? ` · ${signLabel(u.zodiacSign, lang)}` : ""}
            {u.profileName ? ` · ${u.profileName}` : ""}
          </span>
        </span>
        {u.blockedMe ? (
          <span className="shrink-0 text-xs text-[var(--dim)]">{t("blockedYouShort")}</span>
        ) : (
          <button
            type="button"
            onClick={() => openDmWith(u)}
            className="shrink-0 rounded-lg border border-[var(--ink-blue)] px-3 py-1.5 text-sm font-medium text-[var(--ink-blue)]"
          >
            {t("startDmChat")}
          </button>
        )}
      </div>
    );
  };

  /* ---------- 今日页签：每日运势 + 历史上的今天（登录/访客共用） ---------- */
  const renderTodaySection = () => {
    const otd = otdQ.data;
    const hasOtd = !!otd && (otd.events.length > 0 || otd.births.length > 0);
    return (
      <section className="mt-3 space-y-4">
        {!fortuneBirth ? (
          <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
            <p className="text-3xl" aria-hidden>☾</p>
            <h2 className="font-display mt-2 text-xl font-black">{t("todayTitle")}</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[var(--dim)]">{t("todayNeedChart")}</p>
            <button
              type="button"
              onClick={() => setTab("chart")}
              className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-bold text-[var(--accent-ink)]"
            >
              {t("todayGoChart")}
            </button>
          </article>
        ) : fortuneQ.isPending || !fortune ? (
          <p className="py-10 text-center text-[var(--dim)]">{t("todayLoading")}</p>
        ) : (
          <>
            <article className="plate-frame relative overflow-hidden rounded-[var(--radius)] bg-[var(--surface)] p-4">
              <Starfield count={14} lines={false} />
              <div className="relative">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-2xl font-black">{t("todayTitle")}</h2>
                  <span className="text-sm text-[var(--dim)]">{fortune.date}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {fortune.todayPillar.label} · {fortune.shiShen}
                  {lang === "zh" ? "日" : " day"}
                </p>
                <div className="mt-3 flex items-end justify-center gap-3 py-1">
                  <span className="font-display text-7xl font-black leading-none">{fortune.score}</span>
                  <span className="pb-1.5 text-base font-semibold text-[var(--seal,#b4552d)]">✦ {fortune.band}</span>
                </div>
                <p className="text-center text-sm text-[var(--dim)]">{t("fortuneScoreLabel")}</p>
                <p className="mx-auto mt-3 max-w-sm text-center font-display text-lg font-semibold leading-relaxed">
                  「{fortune.dailyWord}」
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{t("yiTitle")}</h3>
                    <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
                      {fortune.yi.map((x) => (
                        <li key={x}>· {x}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400">{t("jiTitle")}</h3>
                    <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
                      {fortune.ji.map((x) => (
                        <li key={x}>· {x}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-[var(--border)] p-3 text-center">
                    <h3 className="text-sm font-bold">{t("luckyNumbersLabel")}</h3>
                    <p className="font-display mt-1 text-2xl font-black tracking-widest">{fortune.luckyNumbers.join(" · ")}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-3 text-center">
                    <h3 className="text-sm font-bold">{t("luckyColorsLabel")}</h3>
                    <p className="mt-1.5 flex items-center justify-center gap-2 text-sm">
                      {fortune.luckyColors.map((c) => (
                        <span key={c.hex} className="inline-flex items-center gap-1">
                          <span
                            aria-hidden
                            className="inline-block h-4 w-4 rounded-full border border-[var(--border)]"
                            style={{ backgroundColor: c.hex }}
                          />
                          {c.name}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                  <h3 className="text-sm font-bold">{t("matchTodayLabel")}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed">
                    {t("matchSignWord")}：<b>{fortune.matchSign.sign}</b>（{fortune.matchSign.group}） · {t("matchAnimalWord")}：
                    <b>{fortune.matchAnimal.primary}</b>
                    {fortune.matchAnimal.alternatives.length > 0 &&
                      ` · ${t("trineWord")} ${fortune.matchAnimal.alternatives.join("、")}`}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                    {fortune.matchSign.reason}；{fortune.matchAnimal.reason}
                  </p>
                </div>
                <details className="mt-3 rounded-lg border border-[var(--border)] p-3">
                  <summary className="cursor-pointer text-sm font-bold">{t("fortuneWhy")}</summary>
                  <p className="mt-1.5 text-xs text-[var(--dim)]">{t("baseScoreNote")}</p>
                  <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
                    {fortune.reasons.map((r, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3">
                        <span>{r.text}</span>
                        <b className={r.delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                          {r.delta >= 0 ? `+${r.delta}` : r.delta}
                        </b>
                      </li>
                    ))}
                  </ul>
                </details>
                <button
                  type="button"
                  onClick={() =>
                    setFortuneShareCanvas(
                      makeFortuneCard({
                        siteTitle: siteTitleText,
                        lang,
                        dateLine: fortune.date,
                        pillarLine: `${fortune.todayPillar.label} · ${fortune.shiShen}${lang === "zh" ? "日" : " day"}`,
                        score: fortune.score,
                        band: fortune.band,
                        dailyWord: fortune.dailyWord,
                        yiLine: fortune.yi.join(" · "),
                        jiLine: fortune.ji.join(" · "),
                        luckyLine: `${t("luckyNumbersLabel")} ${fortune.luckyNumbers.join(" · ")} · ${t("luckyColorsLabel")} ${fortune.luckyColors.map((c) => c.name).join(" / ")}`,
                        matchLine: `${t("matchSignWord")} ${fortune.matchSign.sign} · ${t("matchAnimalWord")} ${fortune.matchAnimal.primary}`,
                      }),
                    )
                  }
                  className="mt-4 w-full rounded-lg border border-[var(--border)] py-2 text-sm"
                >
                  ✦ {t("shareCard")}
                </button>
              </div>
            </article>
            <p className="px-1 text-xs leading-relaxed text-[var(--dim)]">{t("fortuneNote")}</p>
          </>
        )}

        {hasOtd && (
          <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="font-display text-lg font-black">{t("onThisDayLabel")}</h3>
            <ul className="mt-2 space-y-2.5">
              {otd.events.map((e, i) => (
                <li key={`e${i}`} className="text-sm leading-relaxed">
                  <b className="font-display mr-2">{e.year}</b>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
                      {e.text}
                    </a>
                  ) : (
                    e.text
                  )}
                </li>
              ))}
            </ul>
            {otd.births.length > 0 && (
              <>
                <h4 className="mt-4 text-sm font-bold">{t("onThisDayBirths")}</h4>
                <ul className="mt-1.5 space-y-2">
                  {otd.births.map((b, i) => (
                    <li key={`b${i}`} className="text-sm leading-relaxed">
                      <b className="font-display mr-2">{b.year}</b>
                      {b.url ? (
                        <a href={b.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
                          {b.text}
                        </a>
                      ) : (
                        b.text
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-xs text-[var(--dim)]">{t("onThisDaySource")}</p>
          </article>
        )}

        {fortuneShareCanvas && (
          <ShareCardModal canvas={fortuneShareCanvas} filename="daily-fortune.png" onClose={() => setFortuneShareCanvas(null)} />
        )}
      </section>
    );
  };

  /* ---------- 未登录：访客试用 + 登录 / 注册 ---------- */
  if (!loggedIn) {
    const allowReg = siteSettings?.allowRegistration ?? true;
    if (authToken && meQ.isPending) {
      return (
        <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
          <SafeAreaTopScrim backgroundColor="var(--bg)" />
          <main className="mx-auto w-full max-w-md px-4 pb-10">
            <div className="flex justify-end pt-4"><LangSwitch /></div>
            <p className="py-16 text-center text-[var(--dim)]">{t("checkingLogin")}</p>
          </main>
        </div>
      );
    }
    const gatePrompt = (featureKey: "featureCandidates" | "featureFriends" | "featureChat" | "featureBonds") => (
      <article className="plate-frame mt-3 rounded-[var(--radius)] bg-[var(--surface)] p-5 text-center">
        <p aria-hidden className="text-[var(--gold-line)]">✦</p>
        <h2 className="font-display mt-1 text-xl font-bold">{t("gateTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--dim)]">
          {t("gateText", { feature: t(featureKey) })}
        </p>
        <button
          type="button"
          onClick={() => setTab("account")}
          className="mt-4 rounded-lg bg-[var(--accent)] px-5 py-2.5 font-bold text-[var(--accent-ink)]"
        >
          {t("gateCta")}
        </button>
      </article>
    );
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="mx-auto w-full max-w-2xl px-4 pb-10">
          <header className="relative pb-1 pt-5">
            <Starfield count={22} />
            <div className="relative flex items-baseline justify-between gap-2">
              <p className="font-display text-2xl italic tracking-wide">{siteTitleText}</p>
              <p aria-hidden className="text-sm tracking-[0.5em] text-[var(--gold-line)]">✦ ☾</p>
            </div>
            <div className="relative mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--dim)]">{subtitleText}</p>
              <p className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-[var(--gold-line)] px-2.5 py-1 text-xs font-medium text-[var(--gold-line)]">
                  {t("guestChip")}
                </span>
                <LangSwitch />
              </p>
            </div>
            <div aria-hidden className="mt-3 h-px bg-gradient-to-r from-transparent via-[var(--gold-line)] to-transparent opacity-50" />
            {siteSettings?.announcement && (
              <p role="status" className="mt-3 rounded-lg border border-[var(--gold-line)] bg-[var(--surface)] px-3 py-2 text-sm">{siteSettings.announcement}</p>
            )}
          </header>

          <TabNav tabs={tabs} tab={tab} onChange={setTab} moreLabel={t("tabMore")} navLabel={t("mainNav")} />

          {notice && (
            <p role="status" className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">{notice}</p>
          )}

          {tab !== "account" && (
            <p role="status" className="mt-2 rounded-lg border border-[var(--gold-line)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed">
              <strong>{t("guestBannerTitle")}</strong> · {t("guestBannerText")}{" "}
              <button type="button" onClick={() => setTab("account")} className="font-medium text-[var(--ink-blue)] underline">
                {t("guestBannerCta")}
              </button>
            </p>
          )}

          {/* 访客 · 今日运势 */}
          {tab === "today" && renderTodaySection()}

          {/* 访客 · 命盘试用 */}
          {tab === "chart" && (
            <section className="mt-3 space-y-4">
              {!guestInput || guestEditing ? (
                <article className="plate-frame rounded-[var(--radius)] bg-[var(--surface)] p-4">
                  <h2 className="font-display text-xl font-bold">{t("trialChartTitle")}</h2>
                  <p className="mb-3 mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("trialChartIntro")}</p>
                  <PersonForm
                    withTraits={false}
                    submitLabel={t("trialSubmit")}
                    pending={false}
                    initial={guestInput ?? undefined}
                    onSubmit={saveGuestInput}
                  />
                  {guestInput && (
                    <button type="button" onClick={() => setGuestEditing(false)} className="mt-2 w-full rounded-lg border border-[var(--border)] py-2 text-sm">
                      {t("cancelEdit")}
                    </button>
                  )}
                </article>
              ) : guestChartQ.isPending || !guestProfile ? (
                <p className="py-10 text-center text-[var(--dim)]">{t("loadingChart")}</p>
              ) : casting ? (
                <article className="plate-frame relative overflow-hidden rounded-[var(--radius)] bg-[var(--surface)] p-4">
                  <Starfield count={18} lines={false} />
                  <CastingOverlay />
                </article>
              ) : (
                <>
                  <article className="plate-frame relative overflow-hidden rounded-[var(--radius)] bg-[var(--surface)] p-4">
                    <Starfield count={16} lines={false} />
                    <div className="relative flex items-baseline justify-between gap-2">
                      <h2 className="font-display text-2xl font-black">{t("chartOf", { name: guestProfile.name })}</h2>
                      <span className="text-sm text-[var(--dim)]">
                        {guestProfile.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: guestProfile.age })}
                      </span>
                    </div>
                    <p className="relative mb-3 mt-1 text-sm text-[var(--dim)]">
                      {guestProfile.birthTime
                        ? t("bornAt", { date: guestProfile.birthDate, time: guestProfile.birthTime })
                        : t("bornNoTime", { date: guestProfile.birthDate })}
                    </p>
                    <div className="relative">
                      <ChartDetail chart={guestProfile.chart} animate />
                    </div>
                    <button
                      type="button"
                      onClick={() => setGuestEditing(true)}
                      className="relative mt-4 w-full rounded-lg border border-[var(--border)] py-2 text-sm"
                    >
                      {t("editProfile")}
                    </button>
                    <p className="relative mt-2 text-center text-xs text-[var(--dim)]">{t("savedOnDevice")}</p>
                  </article>
                  <p className="px-1 text-xs leading-relaxed text-[var(--dim)]">{t("chartMethodNote")}</p>
                  <NamingPanel
                    data={guestCnData}
                    pending={guestNamesM.isPending}
                    error={guestCnError}
                    surname={cnSurname}
                    setSurname={setCnSurname}
                    style={cnStyle}
                    setStyle={setCnStyle}
                    batch={cnBatch}
                    onGenerate={(b) => guestNamesM.mutate(b)}
                    siteTitle={siteTitleText}
                  />
                  <article className="rounded-[var(--radius)] border border-[var(--gold-line)] bg-[var(--surface)] p-4">
                    <h3 className="font-display text-lg font-bold">{t("saveThisChartTitle")}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("saveThisChartText")}</p>
                    <button
                      type="button"
                      onClick={() => setTab("account")}
                      className="mt-3 w-full rounded-lg bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-ink)]"
                    >
                      {t("registerToSave")}
                    </button>
                  </article>
                </>
              )}
            </section>
          )}

          {/* 访客 · 合盘试算 */}
          {tab === "match" && (
            <section className="mt-3 space-y-4">
              <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="font-display text-lg font-bold">{t("guestMatchTitle")}</h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("guestMatchIntro")}</p>

                <h3 className="mt-4 text-sm font-medium">{t("matchTitle")}</h3>
                <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label={t("relationGroup")}>
                  {(Object.keys(REL_META) as Relation[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={relation === r}
                      onClick={() => setRelation(r)}
                      className={`rounded-lg border px-2 py-2 text-left ${relation === r ? "border-[var(--accent)] bg-[var(--surface-alt)]" : "border-[var(--border)]"}`}
                    >
                      <span className="font-display block text-lg font-bold">{relName(r, t)}</span>
                      <span className="block text-[11px] text-[var(--dim)]">{t(relHintKey(r))}</span>
                    </button>
                  ))}
                </div>

                <h3 className="mt-4 text-sm font-medium">{t("wantsLabel")}</h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TRAITS.map((tr) => (
                    <button
                      key={tr}
                      type="button"
                      aria-pressed={wants.includes(tr)}
                      onClick={() => toggleWant(tr)}
                      className={`rounded-full border px-2.5 py-1 text-sm ${wants.includes(tr) ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold" : "border-[var(--border)] text-[var(--dim)]"}`}
                    >
                      {traitLabel(tr, lang)}
                    </button>
                  ))}
                </div>

                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <h3 className="font-display text-base font-bold">{t("meHeading")}</h3>
                  {guestMeEditing || !guestInput ? (
                    <div className="mt-2">
                      <PersonForm
                        withTraits={false}
                        submitLabel={t("saveMyInfo")}
                        pending={false}
                        initial={guestInput ?? undefined}
                        onSubmit={(v) => { saveGuestInput(v); setGuestMeEditing(false); }}
                      />
                    </div>
                  ) : (
                    <p className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm">
                      <span>{guestInput.name} · {guestInput.gender === "female" ? t("female") : t("male")} · {guestInput.birthDate}{guestInput.birthTime ? ` ${guestInput.birthTime}` : ""}</span>
                      <button type="button" onClick={() => setGuestMeEditing(true)} className="shrink-0 font-medium text-[var(--ink-blue)] underline">{t("editBtn")}</button>
                    </p>
                  )}
                </div>

                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <h3 className="font-display text-base font-bold">{t("themHeading")}</h3>
                  {guestThemEditing || !guestThem ? (
                    <div className="mt-2">
                      <PersonForm
                        withTraits
                        submitLabel={t("saveTheirInfo")}
                        pending={false}
                        initial={guestThem ?? undefined}
                        onSubmit={(v) => { setGuestThem(v); setGuestThemEditing(false); }}
                      />
                    </div>
                  ) : (
                    <p className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm">
                      <span>{guestThem.name} · {guestThem.gender === "female" ? t("female") : t("male")} · {guestThem.birthDate}{guestThem.birthTime ? ` ${guestThem.birthTime}` : ""}</span>
                      <button type="button" onClick={() => setGuestThemEditing(true)} className="shrink-0 font-medium text-[var(--ink-blue)] underline">{t("editBtn")}</button>
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!guestInput || !guestThem || guestMatchM.isPending}
                  onClick={() => guestInput && guestThem && guestMatchM.mutate({ me: guestInput, them: guestThem })}
                  className="mt-5 w-full rounded-lg bg-[var(--accent)] py-2.5 text-base font-bold text-[var(--accent-ink)] disabled:opacity-50"
                >
                  {guestMatchM.isPending ? t("matching") : t("guestMatchSubmit")}
                </button>
              </article>

              {guestMatchData && (
                <div className="space-y-3">
                  <article className="plate-frame rounded-[var(--radius)] bg-[var(--surface)] p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-display text-xl font-bold">
                        {guestMatchData.me.name} × {guestMatchData.them.name}
                      </h3>
                      <div className="shrink-0 text-right">
                        <span className="font-display text-4xl font-black">{guestMatchData.total}</span>
                        <span className="text-xs text-[var(--dim)]"> {t("scoreUnit")}</span>
                      </div>
                    </div>
                    <p className="mt-1">
                      <span className="rounded-full border border-[var(--gold-line)] px-2 py-0.5 text-xs font-medium text-[var(--gold-line)]">
                        ✦ {guestMatchData.verdict}
                      </span>
                    </p>
                    <div className="mt-3 space-y-1.5">
                      <ScoreBar label={t("scoreZodiac")} value={guestMatchData.subScores.zodiac} max={25} />
                      <ScoreBar label={t("scoreBazi")} value={guestMatchData.subScores.bazi} max={45} />
                      <ScoreBar label={t("scoreDetail")} value={guestMatchData.subScores.detail} max={30} />
                    </div>
                    {guestMatchData.reasons.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm">
                        {guestMatchData.reasons.map((r) => (
                          <li key={r} className="flex gap-2">
                            <span aria-hidden className="shrink-0 text-[var(--gold-line)]">✦</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {guestMatchData.concerns.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {guestMatchData.concerns.map((r) => (
                          <li key={r} className="flex gap-2">
                            <span aria-hidden className="shrink-0 text-[var(--seal)]">☾</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setGuestShareCanvas(
                          makeMatchCard({
                            siteTitle: siteTitleText,
                            lang,
                            myName: guestMatchData.me.name,
                            theirName: guestMatchData.them.name,
                            mySign: signLabel(guestMatchData.me.chart.zodiacSign, lang),
                            theirSign: signLabel(guestMatchData.them.chart.zodiacSign, lang),
                            total: guestMatchData.total,
                            verdict: guestMatchData.verdict,
                            subScores: guestMatchData.subScores,
                            subLabels: { zodiac: t("scoreZodiac"), bazi: t("scoreBazi"), detail: t("scoreDetail") },
                          }),
                        )
                      }
                      className="mt-3 w-full rounded-lg border border-[var(--gold-line)] py-2 text-sm font-medium text-[var(--gold-line)]"
                    >
                      ✦ {t("shareCard")}
                    </button>
                  </article>
                  <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <h3 className="font-display mb-2 text-base font-bold">{t("myChartCard")} · {guestMatchData.me.name}</h3>
                    <ChartDetail chart={guestMatchData.me.chart} />
                  </article>
                  <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <h3 className="font-display mb-2 text-base font-bold">{t("theirChartCard")} · {guestMatchData.them.name}</h3>
                    <ChartDetail chart={guestMatchData.them.chart} />
                  </article>
                  <article className="rounded-[var(--radius)] border border-[var(--gold-line)] bg-[var(--surface)] p-4">
                    <h3 className="font-display text-lg font-bold">{t("registerPromptTitle")}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("registerPromptText")}</p>
                    <button
                      type="button"
                      onClick={() => setTab("account")}
                      className="mt-3 w-full rounded-lg bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-ink)]"
                    >
                      {t("registerToSave")}
                    </button>
                  </article>
                </div>
              )}
              {guestShareCanvas && (
                <ShareCardModal
                  canvas={guestShareCanvas}
                  filename="destiny-match.png"
                  onClose={() => setGuestShareCanvas(null)}
                />
              )}
            </section>
          )}

          {tab === "people" && gatePrompt("featureCandidates")}
          {tab === "friends" && gatePrompt("featureFriends")}
          {tab === "chat" && (
            <section className="mt-3 space-y-3">
              {aiOpen ? renderAiView() : renderAiPinnedCard()}
              {gatePrompt("featureChat")}
            </section>
          )}
          {tab === "bonds" && gatePrompt("featureBonds")}

          {/*
            访客 · 账号（2026-11-10）
            本应用不再有自己的注册/登录：账号只来自 TalkFirst 单点登录
            （App 打开本页时用 `#tf=<token>` 换会话）。所以这里只说明怎么进来，
            不再摆一套用户名字段 —— 两套账号正是之前"串线"的来源。
          */}
          {tab === "account" && (
            <article className="plate-frame mx-auto mt-3 w-full max-w-md rounded-[var(--radius)] bg-[var(--surface)] p-6 text-center">
              <p aria-hidden className="font-display text-3xl">✦</p>
              <h2 className="font-display mt-2 text-xl font-bold">{t("tfOnlyTitle")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">{t("tfOnlyBody")}</p>
              <a
                href="https://talkfirst.ccwu.cc"
                className="mt-5 inline-block w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-base font-bold text-[var(--accent-ink)]"
              >
                {t("tfOnlyCta")}
              </a>
              <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">{t("tfOnlyHint")}</p>
            </article>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-2xl px-4 pb-10">
        {/* 顶部：极简刊头，一缕星尘线点到为止 */}
        <header className="relative pb-1 pt-5">
          <Starfield count={22} />
          <div className="relative flex items-baseline justify-between gap-2">
            <p className="font-display text-2xl italic tracking-wide">{siteTitleText}</p>
            <p aria-hidden className="text-sm tracking-[0.5em] text-[var(--gold-line)]">✦ ☾</p>
          </div>
          <div className="relative mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--dim)]">{subtitleText}</p>
            <p className="flex shrink-0 items-center gap-2 text-xs">
              <LangSwitch />
              <button type="button" onClick={() => setTab("account")} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-medium">
                {me.nickname ?? me.username}{isAdmin ? ` · ${t("adminBadge")}` : ""}
              </button>
              <button type="button" onClick={() => logoutM.mutate()} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[var(--dim)]">{t("signOut")}</button>
            </p>
          </div>
          <div aria-hidden className="mt-3 h-px bg-gradient-to-r from-transparent via-[var(--gold-line)] to-transparent opacity-50" />
          {siteSettings?.announcement && (
            <p role="status" className="mt-3 rounded-lg border border-[var(--gold-line)] bg-[var(--surface)] px-3 py-2 text-sm">{siteSettings.announcement}</p>
          )}
        </header>

        {/* 页签 */}
        <TabNav tabs={tabs} tab={tab} onChange={setTab} moreLabel={t("tabMore")} navLabel={t("mainNav")} />

        {notice && (
          <p role="status" className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            {notice}
          </p>
        )}

        {/* ---------- 今日运势 ---------- */}
        {tab === "today" && renderTodaySection()}

        {/* ---------- 我的命盘 ---------- */}
        {tab === "chart" && (
          <section className="mt-3 space-y-4">
            {profileQ.isPending ? (
              <p className="py-10 text-center text-[var(--dim)]">{t("loadingChart")}</p>
            ) : profile && !editingProfile ? (
              <>
                <article className="plate-frame relative overflow-hidden rounded-[var(--radius)] bg-[var(--surface)] p-4">
                  <Starfield count={16} lines={false} />
                  {casting ? (
                    <CastingOverlay />
                  ) : (
                    <div className="relative">
                      <div className="flex items-baseline justify-between gap-2">
                        <h2 className="font-display text-2xl font-black">{t("chartOf", { name: profile.name })}</h2>
                        <span className="text-sm text-[var(--dim)]">
                          {profile.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: profile.age })}
                        </span>
                      </div>
                      <p className="mb-3 mt-1 text-sm text-[var(--dim)]">
                        {profile.birthTime
                          ? t("bornAt", { date: profile.birthDate, time: profile.birthTime })
                          : t("bornNoTime", { date: profile.birthDate })}
                      </p>
                      <ChartDetail chart={profile.chart} animate />
                      <button
                        type="button"
                        onClick={() => setEditingProfile(true)}
                        className="mt-4 w-full rounded-lg border border-[var(--border)] py-2 text-sm"
                      >
                        {t("editProfile")}
                      </button>
                    </div>
                  )}
                </article>
                <p className="px-1 text-xs leading-relaxed text-[var(--dim)]">{t("chartMethodNote")}</p>
                <NamingPanel
                  data={cnData}
                  pending={suggestNamesM.isPending}
                  error={cnError}
                  surname={cnSurname}
                  setSurname={setCnSurname}
                  style={cnStyle}
                  setStyle={setCnStyle}
                  batch={cnBatch}
                  onGenerate={(b) => suggestNamesM.mutate(b)}
                  siteTitle={siteTitleText}
                />
              </>
            ) : (
              <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="font-display text-xl font-bold">
                  {profile ? t("editChartTitle") : t("createChartTitle")}
                </h2>
                <p className="mb-3 mt-1 text-sm text-[var(--dim)]">{t("chartIntro")}</p>
                <PersonForm
                  withTraits={false}
                  submitLabel={profile ? t("saveAndRecast") : t("createChart")}
                  pending={saveProfileM.isPending}
                  initial={
                    profile
                      ? {
                          name: profile.name,
                          gender: profile.gender,
                          birthDate: profile.birthDate,
                          birthTime: profile.birthTime,
                        }
                      : undefined
                  }
                  onSubmit={(v) => saveProfileM.mutate(v)}
                />
                {profile && (
                  <button
                    type="button"
                    onClick={() => setEditingProfile(false)}
                    className="mt-2 w-full rounded-lg border border-[var(--border)] py-2 text-sm"
                  >
                    {t("cancelEdit")}
                  </button>
                )}
              </article>
            )}
          </section>
        )}

        {/* ---------- 匹配 ---------- */}
        {tab === "match" && (
          <section className="mt-3 space-y-4">
            {!profile ? (
              <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                <p className="text-sm text-[var(--dim)]">{t("matchNeedProfile")}</p>
                <button
                  type="button"
                  onClick={() => setTab("chart")}
                  className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-[var(--accent-ink)]"
                >
                  {t("goCreateChart")}
                </button>
              </article>
            ) : (
              <>
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h2 className="font-display text-lg font-bold">{t("matchTitle")}</h2>
                  <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label={t("relationGroup")}>
                    {(Object.keys(REL_META) as Relation[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={relation === r}
                        onClick={() => setRelation(r)}
                        className={`rounded-lg border px-2 py-2 text-left ${
                          relation === r
                            ? "border-[var(--accent)] bg-[var(--surface-alt)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <span className="font-display block text-lg font-bold">
                          {relName(r, t)}
                        </span>
                        <span className="block text-[11px] text-[var(--dim)]">
                          {limits[r] === 1 ? t("relSingleLimit") : t("relFriendLimit", { n: limits[r] })} · {t(relHintKey(r))}
                        </span>
                      </button>
                    ))}
                  </div>

                  <h3 className="mt-4 text-sm font-medium">{t("wantsLabel")}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {TRAITS.map((tr) => (
                      <button
                        key={tr}
                        type="button"
                        aria-pressed={wants.includes(tr)}
                        onClick={() => toggleWant(tr)}
                        className={`rounded-full border px-2.5 py-1 text-sm ${
                          wants.includes(tr)
                            ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold"
                            : "border-[var(--border)] text-[var(--dim)]"
                        }`}
                      >
                        {traitLabel(tr, lang)}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="m-surname" className="mb-1 block text-sm font-medium">
                        {t("surnameReqLabel")}
                      </label>
                      <input
                        id="m-surname"
                        aria-label={t("surnameReqLabel")}
                        className={inputCls}
                        value={surname}
                        maxLength={1}
                        onChange={(e) => setSurname(e.target.value)}
                        placeholder={t("surnameReqPlaceholder")}
                      />
                    </div>
                    <div>
                      <label htmlFor="m-contains" className="mb-1 block text-sm font-medium">
                        {t("nameContainsLabel")}
                      </label>
                      <input
                        id="m-contains"
                        aria-label={t("nameContainsLabel")}
                        className={inputCls}
                        value={nameContains}
                        maxLength={4}
                        onChange={(e) => setNameContains(e.target.value)}
                        placeholder={t("nameContainsPlaceholder")}
                      />
                    </div>
                    <div>
                      <label htmlFor="m-agemin" className="mb-1 block text-sm font-medium">
                        {t("ageMinLabel")}
                      </label>
                      <input
                        id="m-agemin"
                        aria-label={t("ageMinLabel")}
                        type="number"
                        inputMode="numeric"
                        className={inputCls}
                        value={ageMin}
                        onChange={(e) => setAgeMin(e.target.value)}
                        placeholder={t("unlimited")}
                      />
                    </div>
                    <div>
                      <label htmlFor="m-agemax" className="mb-1 block text-sm font-medium">
                        {t("ageMaxLabel")}
                      </label>
                      <input
                        id="m-agemax"
                        aria-label={t("ageMaxLabel")}
                        type="number"
                        inputMode="numeric"
                        className={inputCls}
                        value={ageMax}
                        onChange={(e) => setAgeMax(e.target.value)}
                        placeholder={t("unlimited")}
                      />
                    </div>
                  </div>

                  {focusCandidate && (
                    <p className="mt-3 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm">
                      {t("soloTarget")}<strong>{focusCandidate.name}</strong>
                      <button
                        type="button"
                        onClick={() => setFocusCandidate(null)}
                        className="ml-2 text-[var(--seal)] underline"
                      >
                        {t("soloReset")}
                      </button>
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={matchM.isPending}
                    onClick={() => matchM.mutate(focusCandidate?.id ?? null)}
                    className="mt-4 w-full rounded-lg bg-[var(--accent)] py-2.5 text-base font-bold text-[var(--accent-ink)] disabled:opacity-50"
                  >
                    {matchM.isPending ? t("matching") : t("startMatch")}
                  </button>
                  {candidates.length === 0 && (
                    <p className="mt-2 text-center text-xs text-[var(--dim)]">{t("candidatesEmptyHint")}</p>
                  )}
                </article>

                {matchData && (
                  <div className="space-y-3">
                    <p
                      role="status"
                      className={`rounded-lg px-3 py-2 text-sm ${
                        matchData.exact
                          ? "border border-[var(--border)] bg-[var(--surface)]"
                          : "border border-[var(--seal)] bg-[var(--surface)]"
                      }`}
                    >
                      {matchData.message}
                    </p>
                    {matchData.results.map((r, i) => (
                      <MatchCard
                        key={r.candidate.id}
                        result={r}
                        rank={i + 1}
                        relation={relation}
                        bindings={bindings}
                        onBind={(rel, cid) => bindM.mutate({ relationType: rel, candidateId: cid })}
                        myName={profile.name}
                        mySign={profile.chart.zodiacSign}
                        siteTitle={siteTitleText}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ---------- 候选库 ---------- */}
        {tab === "people" && (
          <section className="mt-3 space-y-3">
            <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              {!showAddCandidate ? (
                <>
                  <h2 className="font-display text-lg font-bold">{t("peopleTitle")}</h2>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("peopleIntro")}</p>
                  <button
                    type="button"
                    onClick={() => setShowAddCandidate(true)}
                    className="mt-3 w-full rounded-lg bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-ink)]"
                  >
                    {t("addCandidate")}
                  </button>
                </>
              ) : (
                <>
                  <h2 className="font-display mb-3 text-lg font-bold">{t("addCandidate")}</h2>
                  <PersonForm
                    withTraits
                    submitLabel={t("addCandidateSubmit")}
                    pending={addCandidateM.isPending}
                    onSubmit={(v) => addCandidateM.mutate(v)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddCandidate(false)}
                    className="mt-2 w-full rounded-lg border border-[var(--border)] py-2 text-sm"
                  >
                    {t("cancel")}
                  </button>
                </>
              )}
            </article>

            {candidatesQ.isPending ? (
              <p className="py-8 text-center text-[var(--dim)]">{t("loadingCandidates")}</p>
            ) : candidates.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--dim)]">{t("candidatesEmpty")}</p>
            ) : (
              candidates.map((c) => (
                <article
                  key={c.id}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-xl font-bold">{c.name}</h3>
                    <span className="text-sm text-[var(--dim)]">
                      {c.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: c.age })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--dim)]">
                    {signLabel(c.chart.zodiacSign, lang)} · {t("animalChip", { animal: animalLabel(c.chart.zodiacAnimal, lang) })} · {t("pillarsLine")}{" "}
                    {pillarLabel(c.chart.pillars.year, lang)} {pillarLabel(c.chart.pillars.month, lang)}{" "}
                    {pillarLabel(c.chart.pillars.day, lang)}
                    {c.chart.pillars.hour ? ` ${pillarLabel(c.chart.pillars.hour, lang)}` : ""} ·{" "}
                    {t("dayMasterChip", { dm: dayMasterLabel(c.chart.dayMaster, c.chart.dayMasterElement, lang), strength: strengthLabel(c.chart.strength, lang) })}
                  </p>
                  {c.traits.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.traits.map((tr) => (
                        <span
                          key={tr}
                          className="rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-xs"
                        >
                          {traitLabel(tr, lang)}
                        </span>
                      ))}
                    </div>
                  )}
                  {expandedCandidate === c.id && (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <ChartDetail chart={c.chart} />
                      {c.notes && <p className="mt-2 text-sm">{t("notesLine")}{c.notes}</p>}
                      <p className="mt-1 text-xs text-[var(--dim)]">
                        {t("bornLine", { date: c.birthDate })}
                        {c.birthTime ? ` ${c.birthTime}` : t("bornTimeUnknownSuffix")}
                      </p>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-expanded={expandedCandidate === c.id}
                      onClick={() => setExpandedCandidate(expandedCandidate === c.id ? null : c.id)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                    >
                      {expandedCandidate === c.id ? t("collapseChart") : t("fullChartBtn")}
                    </button>
                    <button
                      type="button"
                      onClick={() => soloMatch(c)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-[var(--accent-ink)]"
                    >
                      {t("soloTest")}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCandidateM.mutate(c.id)}
                      className="rounded-lg border border-[var(--seal)] px-3 py-1.5 text-sm text-[var(--seal)]"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        )}

        {/* ---------- 好友列表 ---------- */}
        {tab === "friends" && (
          <section className="mt-3 space-y-3">
            <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-bold">{t("friendsTitle")}</h2>
                <span className="text-sm text-[var(--dim)]">{t("friendsCount", { n: candidates.length })}</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("friendsIntro")}</p>
            </article>

            <h3 className="px-1 pt-1 text-sm font-semibold text-[var(--dim)]">{t("friendsUsersTitle")}</h3>
            {directoryQ.isPending ? (
              <p className="py-4 text-center text-sm text-[var(--dim)]">{t("loadingFriends")}</p>
            ) : directoryUsers.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--dim)]">{t("noUsersYet")}</p>
            ) : (
              <div className="space-y-2">
                {[...directoryUsers]
                  .sort((a, b) => Number(realPresence(b.lastActiveAt, t).online) - Number(realPresence(a.lastActiveAt, t).online))
                  .map((u) => renderUserRow(u))}
              </div>
            )}

            <h3 className="px-1 pt-2 text-sm font-semibold text-[var(--dim)]">{t("friendsProfilesTitle")}</h3>
            {candidatesQ.isPending ? (
              <p className="py-4 text-center text-[var(--dim)]">{t("loadingFriends")}</p>
            ) : candidates.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-[var(--dim)]">{t("friendsEmpty")}</p>
                <button
                  type="button"
                  onClick={() => setTab("people")}
                  className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 font-bold text-[var(--accent-ink)]"
                >
                  {t("goAddFriends")}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.map((c) => {
                  const rel = bindings.find((b) => b.targetId === c.id);
                  const conv = conversations.find((cv) => cv.candidateId === c.id);
                  return (
                    <article
                      key={c.id}
                      className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                    >
                      <span
                        aria-hidden
                        className="font-display flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-lg italic"
                      >
                        {c.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="shrink-0 rounded-full bg-[var(--surface-alt)] px-1.5 py-px text-[10px] text-[var(--dim)]">{t("profileChip")}</span>
                          {rel && (
                            <span className="shrink-0 rounded-full border border-[var(--gold-line)] px-1.5 py-px text-[11px] text-[var(--gold-line)]">
                              {relName(rel.relationType, t)}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--dim)]">
                          {signLabel(c.chart.zodiacSign, lang)} · {t("animalChip", { animal: animalLabel(c.chart.zodiacAnimal, lang) })} · {t("yearsOld", { age: c.age })}
                          {conv && conv.messageCount > 0 ? ` · ${t("chattedCount", { n: conv.messageCount })}` : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => soloMatch(c)}
                        className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                      >
                        {t("soloTest")}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            <p className="px-1 text-xs leading-relaxed text-[var(--dim)]">{t("friendsNote")}</p>
          </section>
        )}

        {/* ---------- 聊天（真实用户私聊 + AI 助手 + 历史模拟记录） ---------- */}
        {tab === "chat" && (
          <section className="mt-3 space-y-3">
            {aiOpen ? (
              renderAiView()
            ) : activeDm ? (
              <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setActiveDm(null)}
                    aria-label={t("backToListAria")}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-sm"
                  >
                    {t("backToList")}
                  </button>
                  <span className="relative shrink-0">
                    <span aria-hidden className="font-display flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-alt)] italic">
                      {activeDm.otherUsername.slice(0, 1)}
                    </span>
                    <PresenceDot online={realPresence(dmOther?.lastActiveAt ?? null, t).online} surface />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold leading-tight">
                      <span className="truncate">{activeDm.otherUsername}</span>
                      <span className="shrink-0 rounded-full border border-[var(--ink-blue)] px-1.5 py-px text-[10px] font-normal text-[var(--ink-blue)]">{t("realUserChip")}</span>
                    </p>
                    <p className={`text-xs ${realPresence(dmOther?.lastActiveAt ?? null, t).online ? "text-[var(--online)]" : "text-[var(--dim)]"}`}>
                      {realPresence(dmOther?.lastActiveAt ?? null, t).label}
                    </p>
                  </div>
                  {dmOther && (
                    <button
                      type="button"
                      onClick={() => blockM.mutate({ userId: dmOther.userId, blocked: !dmOther.iBlocked })}
                      className={`shrink-0 rounded-md border px-2 py-1 text-xs ${dmOther.iBlocked ? "border-[var(--border)] text-[var(--dim)]" : "border-[var(--seal)] text-[var(--seal)]"}`}
                    >
                      {dmOther.iBlocked ? t("unblockUser") : t("blockUser")}
                    </button>
                  )}
                </div>

                {dmOther?.blockedMe && (
                  <p role="alert" className="border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2 text-sm text-[var(--seal)]">{t("blockedYouNotice")}</p>
                )}
                {dmOther?.iBlocked && (
                  <p role="status" className="border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2 text-sm text-[var(--dim)]">{t("youBlockedNotice")}</p>
                )}

                <div className="h-[46vh] space-y-2.5 overflow-y-auto bg-[var(--bg)] px-3 py-3">
                  {dmMessagesQ.isPending && dmMessages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[var(--dim)]">{t("connecting")}</p>
                  ) : dmMessages.length === 0 ? (
                    <div className="py-8 text-center">
                      <p aria-hidden className="text-[var(--gold-line)]">✦</p>
                      <p className="mt-1 text-sm text-[var(--dim)]">{t("chatEmptyHint")}</p>
                    </div>
                  ) : (
                    dmMessages.map((m) => (
                      <div key={m.id} className={`msg-in flex ${m.mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                            m.mine
                              ? "rounded-br-md bg-[var(--ink-blue)] text-white"
                              : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)]"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <p className={`mt-0.5 text-right text-[10px] ${m.mine ? "text-white/60" : "text-[var(--dim)]"}`}>
                            {new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {dmError && <p role="alert" className="border-t border-[var(--border)] px-4 py-2 text-sm text-[var(--seal)]">{dmError}</p>}
                <form
                  className="flex items-end gap-2 border-t border-[var(--border)] px-3 py-3"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    const content = chatInput.trim();
                    if (!content || !activeDm || sendDmM.isPending) return;
                    setChatInput("");
                    sendDmM.mutate({ conversationId: activeDm.conversationId, content });
                  }}
                >
                  <label htmlFor="dm-input" className="sr-only">{t("inputMessage")}</label>
                  <textarea
                    id="dm-input"
                    aria-label={t("inputMessage")}
                    rows={1}
                    maxLength={1000}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                      }
                    }}
                    placeholder={t("messagePlaceholder")}
                    disabled={!!dmOther?.blockedMe || !!dmOther?.iBlocked}
                    className="max-h-28 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base text-[var(--text)] disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || sendDmM.isPending || !!dmOther?.blockedMe || !!dmOther?.iBlocked}
                    className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--accent-ink)] disabled:opacity-40"
                  >
                    {sendDmM.isPending ? t("sending") : t("send")}
                  </button>
                </form>
                <p className="border-t border-[var(--border)] px-4 py-2 text-center text-[11px] text-[var(--dim)]">
                  {t("dmFooterNote")}
                </p>
              </article>
            ) : activeLegacy ? (
              <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setActiveLegacy(null)}
                    aria-label={t("backToListAria")}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-sm"
                  >
                    {t("backToList")}
                  </button>
                  <span aria-hidden className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] italic">
                    {activeLegacy.candidateName.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">{activeLegacy.candidateName}</p>
                    <p className="text-xs text-[var(--dim)]">{t("legacyViewOnly")} · {t("profileChip")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearConversationM.mutate(activeLegacy.conversationId)}
                    className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--dim)]"
                  >
                    {t("clearHistory")}
                  </button>
                </div>
                <p className="border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2 text-xs leading-relaxed text-[var(--dim)]">
                  {t("chatDisclaimer")}
                </p>
                <div className="h-[46vh] space-y-2.5 overflow-y-auto bg-[var(--bg)] px-3 py-3">
                  {legacyMessagesQ.isPending ? (
                    <p className="py-8 text-center text-sm text-[var(--dim)]">{t("connecting")}</p>
                  ) : legacyMessages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[var(--dim)]">{t("noMessagesYet")}</p>
                  ) : (
                    legacyMessages.map((m) => (
                      <div key={m.id} className={`flex ${m.sender === "me" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                            m.sender === "me"
                              ? "rounded-br-md bg-[var(--ink-blue)] text-white"
                              : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)]"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <p className={`mt-0.5 text-right text-[10px] ${m.sender === "me" ? "text-white/60" : "text-[var(--dim)]"}`}>
                            {new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </article>
            ) : (
              <>
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h2 className="text-lg font-semibold">{t("messagesTitle")}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("chatIntro")}</p>
                </article>

                {renderAiPinnedCard()}

                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-base font-bold">{t("searchUsersTitle")}</h3>
                  <label htmlFor="user-search" className="sr-only">{t("searchUsersLabel")}</label>
                  <input
                    id="user-search"
                    aria-label={t("searchUsersLabel")}
                    className={`${inputCls} mt-2`}
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder={t("searchUsersPlaceholder")}
                    maxLength={20}
                  />
                  <div className="mt-3 space-y-2">
                    {directoryQ.isPending ? (
                      <p className="py-3 text-center text-sm text-[var(--dim)]">{t("loadingConversations")}</p>
                    ) : directoryUsers.length === 0 ? (
                      <p className="py-3 text-center text-sm text-[var(--dim)]">
                        {userSearch.trim() ? t("noUsersFound") : t("noUsersYet")}
                      </p>
                    ) : (
                      directoryUsers.map((u) => renderUserRow(u))
                    )}
                  </div>
                </article>

                {dmConvsQ.isPending ? (
                  <p className="py-6 text-center text-[var(--dim)]">{t("loadingConversations")}</p>
                ) : dmConversations.length === 0 ? (
                  <p className="py-4 text-center text-sm text-[var(--dim)]">{t("noChatsYet")}</p>
                ) : (
                  <div className="space-y-2">
                    {dmConversations.map((conv) => {
                      const p = realPresence(conv.otherLastActiveAt, t);
                      return (
                        <button
                          key={conv.id}
                          type="button"
                          onClick={() =>
                            setActiveDm({
                              conversationId: conv.id,
                              otherUserId: conv.otherUserId,
                              otherUsername: conv.otherUsername,
                            })
                          }
                          className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left"
                        >
                          <span className="relative shrink-0">
                            <span aria-hidden className="font-display flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-alt)] text-lg italic">
                              {conv.otherUsername.slice(0, 1)}
                            </span>
                            <PresenceDot online={p.online} surface />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium">{conv.otherUsername}</span>
                                <span className="shrink-0 rounded-full border border-[var(--ink-blue)] px-1.5 py-px text-[10px] text-[var(--ink-blue)]">{t("realUserChip")}</span>
                              </span>
                              {conv.lastAt && (
                                <span className="shrink-0 text-[11px] text-[var(--dim)]">
                                  {new Date(conv.lastAt).toLocaleString(locale, {
                                    month: "numeric",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-sm text-[var(--dim)]">
                              {conv.lastMessage
                                ? `${conv.lastSenderId === me.id ? t("mePrefix") : ""}${conv.lastMessage}`
                                : t("noMessagesYet")}
                            </span>
                          </span>
                          {conv.unread > 0 && (
                            <span
                              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--seal)] px-1 text-[11px] font-bold text-white"
                              aria-label={t("unreadCount", { n: conv.unread })}
                            >
                              {conv.unread}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {conversations.length > 0 && (
                  <>
                    <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                      <h3 className="font-display text-base font-bold">{t("legacyTitle")}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("legacyIntro")}</p>
                    </article>
                    <div className="space-y-2">
                      {conversations.map((conv) => (
                        <button
                          key={conv.id}
                          type="button"
                          onClick={() => setActiveLegacy({ conversationId: conv.id, candidateName: conv.candidateName })}
                          className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left"
                        >
                          <span aria-hidden className="font-display flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-lg italic">
                            {conv.candidateName.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{conv.candidateName}</span>
                              <span className="shrink-0 rounded-full bg-[var(--surface-alt)] px-1.5 py-px text-[10px] text-[var(--dim)]">{t("legacyViewOnly")}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-sm text-[var(--dim)]">
                              {conv.lastMessage
                                ? `${conv.lastSender === "me" ? t("mePrefix") : ""}${conv.lastMessage}`
                                : t("noMessagesYet")}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-medium text-[var(--ink-blue)]">{t("viewHistory")}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* ---------- 我的绑定 ---------- */}
        {tab === "bonds" && (
          <section className="mt-3 space-y-3">
            <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="font-display text-lg font-bold">{t("bondRulesTitle")}</h2>
              <ul className="mt-2 space-y-1 text-sm text-[var(--dim)]">
                <li>{t("bondRulePartner")}</li>
                <li>{t("bondRuleLover")}</li>
                <li>{t("bondRuleFriend", { n: limits.friend })}</li>
                <li>{t("bondRuleRelease")}</li>
              </ul>
            </article>
            {(Object.keys(REL_META) as Relation[]).map((r) => {
              const list = bindings.filter((b) => b.relationType === r);
              return (
                <article
                  key={r}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-display text-lg font-bold">{relName(r, t)}</h3>
                    <span className="text-sm text-[var(--dim)]">
                      {list.length}/{limits[r]}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <p className="mt-2 text-sm text-[var(--dim)]">
                      {t("notBoundYet", { rel: relName(r, t) })}
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {list.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2"
                        >
                          <span>
                            <span className="font-display font-bold">{b.targetName}</span>
                            <span className="ml-2 text-xs text-[var(--dim)]">
                              {t("boundOn", { date: new Date(b.createdAt).toLocaleDateString(locale) })}
                            </span>
                          </span>
                          <span className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => unbindM.mutate(b.id)}
                              className="rounded-md border border-[var(--seal)] px-2 py-1 text-xs text-[var(--seal)]"
                            >
                              {t("unbind")}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {/* ---------- 我的账号 ---------- */}
        {tab === "account" && (
          <section className="mt-3 space-y-3">
            <article className="plate-frame rounded-[var(--radius)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-3">
                {me.avatarUrl ? (
                <img src={me.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <span aria-hidden className="font-display flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xl italic">{(me.nickname ?? me.username).slice(0, 1)}</span>
              )}
                <div className="min-w-0">
                  <h2 className="font-display truncate text-2xl font-black">{me.nickname ?? me.username}</h2>
                  <p className="text-sm text-[var(--dim)]">
                    {isAdmin ? t("adminBadge") : t("userRole")} · {me.status === "active" ? t("statusActive") : t("statusDisabled")}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-[var(--surface-alt)] px-3 py-2"><dt className="text-xs text-[var(--dim)]">{t("registeredAt")}</dt><dd className="mt-0.5">{new Date(me.createdAt).toLocaleString(locale)}</dd></div>
                <div className="rounded-lg bg-[var(--surface-alt)] px-3 py-2"><dt className="text-xs text-[var(--dim)]">{t("lastLogin")}</dt><dd className="mt-0.5">{me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString(locale) : "—"}</dd></div>
                <div className="rounded-lg bg-[var(--surface-alt)] px-3 py-2"><dt className="text-xs text-[var(--dim)]">{t("myCandidates")}</dt><dd className="font-display mt-0.5 text-xl font-bold">{t("peopleUnit", { n: candidates.length })}</dd></div>
                <div className="rounded-lg bg-[var(--surface-alt)] px-3 py-2"><dt className="text-xs text-[var(--dim)]">{t("myBondsChats")}</dt><dd className="font-display mt-0.5 text-xl font-bold">{bindings.length} / {conversations.length + dmConversations.length}</dd></div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">{t("accountPrivacy")}</p>
              <button type="button" onClick={() => logoutM.mutate()} className="mt-3 w-full rounded-lg border border-[var(--border)] py-2.5 text-sm font-medium">{t("signOutBtn")}</button>
            </article>

            {tfLinked ? (
              /* 账号来自 TalkFirst：密码、注销都在那边改，这里只说明一句，不再摆第二套表单。 */
              <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="font-display text-lg font-bold">{t("tabAccount")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{t("tfAccountManaged")}</p>
              </article>
            ) : (
            <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-display text-lg font-bold">{t("changePassword")}</h3>
              <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); changePwM.mutate(); }}>
                <div><label htmlFor="acc-oldpw" className="mb-1 block text-sm font-medium">{t("oldPassword")}</label><input id="acc-oldpw" aria-label={t("oldPassword")} type="password" autoComplete="current-password" className={inputCls} value={oldPw} onChange={(e) => setOldPw(e.target.value)} /></div>
                <div><label htmlFor="acc-newpw" className="mb-1 block text-sm font-medium">{t("newPassword")}</label><input id="acc-newpw" aria-label={t("newPassword")} type="password" autoComplete="new-password" className={inputCls} value={newPw} onChange={(e) => setNewPw(e.target.value)} /></div>
                <button type="submit" disabled={!oldPw || newPw.length < 6 || changePwM.isPending} className="w-full rounded-lg bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-ink)] disabled:opacity-50">{changePwM.isPending ? t("changingPassword") : t("saveNewPassword")}</button>
              </form>
            </article>
            )}

            {!isAdmin && !tfLinked && (
              <article className="rounded-[var(--radius)] border border-[var(--seal)] bg-[var(--surface)] p-4">
                <h3 className="font-display text-lg font-bold text-[var(--seal)]">{t("deleteAccount")}</h3>
                {!showDeleteAccount ? (
                  <>
                    <p className="mt-1 text-sm text-[var(--dim)]">{t("deleteAccountText")}</p>
                    <button type="button" onClick={() => setShowDeleteAccount(true)} className="mt-3 rounded-lg border border-[var(--seal)] px-3 py-2 text-sm text-[var(--seal)]">{t("iWantDelete")}</button>
                  </>
                ) : (
                  <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); deleteMyAccountM.mutate(); }}>
                    <div><label htmlFor="acc-delpw" className="mb-1 block text-sm font-medium">{t("deleteConfirmLabel")}</label><input id="acc-delpw" aria-label={t("deleteConfirmLabel")} type="password" className={inputCls} value={deleteAccountPw} onChange={(e) => setDeleteAccountPw(e.target.value)} /></div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={!deleteAccountPw || deleteMyAccountM.isPending} className="flex-1 rounded-lg bg-[var(--seal)] py-2.5 font-bold text-white disabled:opacity-50">{t("confirmDelete")}</button>
                      <button type="button" onClick={() => setShowDeleteAccount(false)} className="rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm">{t("cancel")}</button>
                    </div>
                  </form>
                )}
              </article>
            )}
            {isAdmin && <p className="px-1 text-xs text-[var(--dim)]">{t("adminNoSelfDelete")}</p>}
          </section>
        )}

        {/* ---------- 后台管理 ---------- */}
        {tab === "admin" && isAdmin && (
          <section className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("adminNavLabel")}>
              {([
                { key: "overview", label: t("adminOverview") },
                { key: "users", label: `${t("adminUsers")}${overview ? ` ${overview.totalUsers}` : ""}` },
                { key: "profile", label: t("adminProfile") },
                { key: "candidates", label: t("adminCandidates") },
                { key: "bonds", label: t("adminBonds") },
                { key: "chats", label: t("adminChats") },
                { key: "settings", label: t("adminSettingsSec") },
                { key: "data", label: t("adminData") },
              ] as Array<{ key: AdminSection; label: string }>).map((s) => (
                <button key={s.key} type="button" aria-pressed={adminSection === s.key} onClick={() => setAdminSection(s.key)} className={`rounded-full border px-3 py-1.5 text-sm ${adminSection === s.key ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold" : "border-[var(--border)] text-[var(--dim)]"}`}>{s.label}</button>
              ))}
            </div>

            {adminSection === "overview" && (
              overviewQ.isPending || !overview ? (
                <p className="py-10 text-center text-[var(--dim)]">{t("loadingOverview")}</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <StatCard label={t("statUsers")} value={overview.totalUsers} sub={t("statUsersSub", { a: overview.newUsersToday, b: overview.adminUsers, c: overview.disabledUsers })} />
                    <StatCard label={t("statCandidates")} value={overview.totalCandidates} sub={t("statCandSub", { a: overview.candidatesToday, f: overview.genderCounts.female, m: overview.genderCounts.male })} />
                    <StatCard label={t("statBindings")} value={overview.totalBindings} sub={t("statBindSub", { f: overview.bindingsByType.friend, l: overview.bindingsByType.lover, p: overview.bindingsByType.partner })} />
                    <StatCard label={t("statConversations")} value={overview.totalConversations} sub={t("statConvSub", { n: overview.avgMessagesPerConversation })} />
                    <StatCard label={t("statMessages")} value={overview.totalMessages} sub={t("statMsgSub", { t: overview.messagesToday, me: overview.messagesBySender.me, them: overview.messagesBySender.them })} />
                    <StatCard label={t("statCompleteness")} value={`${overview.completeCharts}/${overview.totalCandidates}`} sub={t("statCompSub", { n: overview.incompleteCharts })} />
                  </div>
                  <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <DistList title={t("distZodiac")} items={overview.zodiacCounts.map((i) => ({ name: signLabel(i.name, lang), count: i.count }))} />
                      <DistList title={t("distAnimal")} items={overview.animalCounts.map((i) => ({ name: lang === "en" ? animalLabel(i.name.replace(/^属/, ""), lang) : i.name, count: i.count }))} />
                      <DistList title={t("distDayMaster")} items={overview.dayMasterCounts.map((i) => ({ name: lang === "en" && i.name.length === 2 ? dayMasterLabel(i.name.charAt(0), i.name.charAt(1), lang) : i.name, count: i.count }))} />
                      <DistList title={t("distAge")} items={overview.ageBuckets} />
                    </div>
                    <div className="mt-5"><DistList title={t("distTraits")} items={overview.traitCounts.map((i) => ({ name: traitLabel(i.name, lang), count: i.count }))} /></div>
                  </article>
                  <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <h4 className="text-sm font-semibold">{t("recentCandidates")}</h4>
                    {overview.recentCandidates.length === 0 ? <p className="mt-1 text-xs text-[var(--dim)]">{t("noneYet")}</p> : (
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {overview.recentCandidates.map((c) => (
                          <li key={c.id} className="flex justify-between gap-2"><span>{c.name} · {signLabel(c.zodiacSign, lang)} · {t("yearsOld", { age: c.age })}</span><span className="shrink-0 text-xs text-[var(--dim)]">{new Date(c.createdAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></li>
                        ))}
                      </ul>
                    )}
                    <h4 className="mt-4 text-sm font-semibold">{t("recentMessages")}</h4>
                    {overview.recentMessages.length === 0 ? <p className="mt-1 text-xs text-[var(--dim)]">{t("noneYet")}</p> : (
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {overview.recentMessages.map((m) => (
                          <li key={m.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{m.candidateName} · {m.sender === "me" ? t("senderUser") : t("senderThem")}{m.content}</span><span className="shrink-0 text-xs text-[var(--dim)]">{new Date(m.createdAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></li>
                        ))}
                      </ul>
                    )}
                    <h4 className="mt-4 text-sm font-semibold">{t("recentBindings")}</h4>
                    {overview.recentBindings.length === 0 ? <p className="mt-1 text-xs text-[var(--dim)]">{t("noneYet")}</p> : (
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {overview.recentBindings.map((b) => (
                          <li key={b.id} className="flex justify-between gap-2"><span>{relName(b.relationType, t)} · {b.targetName}</span><span className="shrink-0 text-xs text-[var(--dim)]">{new Date(b.createdAt).toLocaleDateString(locale)}</span></li>
                        ))}
                      </ul>
                    )}
                  </article>
                </div>
              )
            )}

            {adminSection === "users" && (
              <div className="space-y-3">
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-lg font-bold">{t("usersTitle")}</h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("usersIntro")}</p>
                  <label htmlFor="au-search" className="sr-only">{t("searchUsersLabel")}</label>
                  <input id="au-search" aria-label={t("searchUsersLabel")} className={`${inputCls} mt-3`} value={adminUserSearch} onChange={(e) => setAdminUserSearch(e.target.value)} placeholder={t("searchUsers")} />
                </article>
                {adminUsersQ.isPending ? (
                  <p className="py-8 text-center text-[var(--dim)]">{t("loadingUsers")}</p>
                ) : (
                  (adminUsersQ.data?.users ?? []).filter((u) => !adminUserSearch.trim() || u.username.includes(adminUserSearch.trim())).map((u) => (
                    <article key={u.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] italic">{u.username.slice(0, 1)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 font-medium">
                            <span className="truncate">{u.username}</span>
                            {u.role === "admin" && <span className="rounded-full border border-[var(--gold-line)] px-1.5 py-px text-[11px] text-[var(--gold-line)]">{t("adminBadge")}</span>}
                            {u.status === "disabled" && <span className="rounded-full border border-[var(--seal)] px-1.5 py-px text-[11px] text-[var(--seal)]">{t("disabledBadge")}</span>}
                            {me.id === u.id && <span className="rounded-full bg-[var(--surface-alt)] px-1.5 py-px text-[11px] text-[var(--dim)]">{t("meBadge")}</span>}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--dim)]">
                            {t("userDataLine", { profile: u.profileName ?? t("notCreated"), c: u.candidateCount, b: u.bindingCount, v: u.conversationCount, m: u.messageCount })}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--dim)]">{t("registeredShort", { date: new Date(u.createdAt).toLocaleDateString(locale), last: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : t("never") })}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button type="button" aria-expanded={adminUserDetailId === u.id} onClick={() => setAdminUserDetailId(adminUserDetailId === u.id ? null : u.id)} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{adminUserDetailId === u.id ? t("hideDetail") : t("viewDetail")}</button>
                        {me.id !== u.id && (
                          <>
                            <button type="button" onClick={() => setUserStatusM.mutate({ userId: u.id, status: u.status === "active" ? "disabled" : "active" })} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{u.status === "active" ? t("disable") : t("enable")}</button>
                            <button type="button" onClick={() => setUserRoleM.mutate({ userId: u.id, role: u.role === "admin" ? "user" : "admin" })} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{u.role === "admin" ? t("removeAdmin") : t("makeAdmin")}</button>
                            {confirmDeleteUserId === u.id ? (
                              <>
                                <button type="button" onClick={() => deleteUserM.mutate(u.id)} className="rounded-md bg-[var(--seal)] px-2.5 py-1.5 text-xs font-bold text-white">{t("confirmDeleteUser")}</button>
                                <button type="button" onClick={() => setConfirmDeleteUserId(null)} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{t("cancel")}</button>
                              </>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteUserId(u.id)} className="rounded-md border border-[var(--seal)] px-2.5 py-1.5 text-xs text-[var(--seal)]">{t("deleteUser")}</button>
                            )}
                          </>
                        )}
                      </div>
                      {me.id !== u.id && (
                        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const pw = (adminResetPw[u.id] ?? "").trim(); if (pw.length >= 6) resetUserPwM.mutate({ userId: u.id, newPassword: pw }); }}>
                          <label htmlFor={`au-pw-${u.id}`} className="sr-only">{t("resetPwFor", { name: u.username })}</label>
                          <input id={`au-pw-${u.id}`} aria-label={t("resetPwFor", { name: u.username })} type="text" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm" placeholder={t("resetPwPlaceholder")} value={adminResetPw[u.id] ?? ""} onChange={(e) => setAdminResetPw((prev) => ({ ...prev, [u.id]: e.target.value }))} />
                          <button type="submit" disabled={(adminResetPw[u.id] ?? "").trim().length < 6 || resetUserPwM.isPending} className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs disabled:opacity-40">{t("resetPassword")}</button>
                        </form>
                      )}
                      {adminUserDetailId === u.id && (
                        <div className="mt-3 border-t border-[var(--border)] pt-3">
                          {adminUserDetailQ.isPending || !adminUserDetailQ.data ? (
                            <p className="text-sm text-[var(--dim)]">{t("loadingDetail")}</p>
                          ) : !adminUserDetailQ.data.ok ? (
                            <p className="text-sm text-[var(--seal)]">{adminUserDetailQ.data.message}</p>
                          ) : (
                            <div className="space-y-3 text-sm">
                              {adminUserDetailQ.data.profile ? (
                                <div>
                                  <p className="font-medium">{adminUserDetailQ.data.profile.name} · {signLabel(adminUserDetailQ.data.profile.chart.zodiacSign, lang)} · {t("animalChip", { animal: animalLabel(adminUserDetailQ.data.profile.chart.zodiacAnimal, lang) })} · {t("dayMasterChip", { dm: dayMasterLabel(adminUserDetailQ.data.profile.chart.dayMaster, adminUserDetailQ.data.profile.chart.dayMasterElement, lang), strength: strengthLabel(adminUserDetailQ.data.profile.chart.strength, lang) })}</p>
                                  <div className="mt-2"><ChartDetail chart={adminUserDetailQ.data.profile.chart} /></div>
                                  <button type="button" onClick={() => deleteProfileM.mutate(u.id)} className="mt-2 rounded-md border border-[var(--seal)] px-2.5 py-1.5 text-xs text-[var(--seal)]">{t("deleteUserProfile")}</button>
                                </div>
                              ) : <p className="text-[var(--dim)]">{t("noUserProfile")}</p>}
                              <div>
                                <p className="font-medium">{t("candidatesHead", { n: adminUserDetailQ.data.candidates.length })}</p>
                                {adminUserDetailQ.data.candidates.length === 0 ? <p className="text-[var(--dim)]">{t("noneYet")}</p> : (
                                  <ul className="mt-1 space-y-1">{adminUserDetailQ.data.candidates.map((c) => (<li key={c.id}>{c.name} · {c.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: c.age })} · {signLabel(c.chart.zodiacSign, lang)} · {t("animalChip", { animal: animalLabel(c.chart.zodiacAnimal, lang) })}</li>))}</ul>
                                )}
                              </div>
                              <div>
                                <p className="font-medium">{t("bindingsHead", { n: adminUserDetailQ.data.bindings.length, v: adminUserDetailQ.data.conversationCount, m: adminUserDetailQ.data.messageCount })}</p>
                                {adminUserDetailQ.data.bindings.length > 0 && (
                                  <ul className="mt-1 space-y-1">{adminUserDetailQ.data.bindings.map((b) => (<li key={b.id}>{relName(b.relationType, t)} · {b.targetName} <span className="text-xs text-[var(--dim)]">{t("boundOn", { date: new Date(b.createdAt).toLocaleDateString(locale) })}</span></li>))}</ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  ))
                )}
                {(adminUsersQ.data?.users ?? []).length === 0 && !adminUsersQ.isPending && (
                  <p className="py-6 text-center text-sm text-[var(--dim)]">{t("noUsers")}</p>
                )}
              </div>
            )}

            {adminSection === "profile" && (
              <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="font-display text-lg font-bold">{t("adminProfileTitle")}</h3>
                {profile ? (
                  <>
                    <p className="mt-1 text-sm text-[var(--dim)]">{profile.name} · {profile.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: profile.age })} · {profile.birthDate}{profile.birthTime ? ` ${profile.birthTime}` : t("bornTimeUnknownSuffix")}</p>
                    <div className="mt-3"><ChartDetail chart={profile.chart} /></div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setTab("chart")} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">{t("goEditProfile")}</button>
                      <button type="button" onClick={() => deleteProfileM.mutate(me.id)} className="rounded-lg border border-[var(--seal)] px-3 py-2 text-sm text-[var(--seal)]">{t("deleteMyProfile")}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-[var(--dim)]">{t("noMyProfile")}</p>
                    <button type="button" onClick={() => setTab("chart")} className="mt-3 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-[var(--accent-ink)]">{t("goCreateProfile")}</button>
                  </>
                )}
                <p className="mt-4 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-[var(--dim)]">{t("adminProfileNote")}</p>
              </article>
            )}

            {adminSection === "candidates" && (
              <div className="space-y-3">
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-lg font-bold">{t("adminCandTitle")}</h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("adminCandIntro")}</p>
                  <div className="mt-3 space-y-2">
                    <label htmlFor="ac-search" className="sr-only">{t("searchCandidatesLabel")}</label>
                    <input id="ac-search" aria-label={t("searchCandidatesLabel")} className={inputCls} value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)} placeholder={t("searchCandidates")} />
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("candFilterLabel")}>
                      {([["all", t("genderAll")], ["female", t("genderFOnly")], ["male", t("genderMOnly")]] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={adminGender === k} onClick={() => setAdminGender(k)} className={`rounded-full border px-2.5 py-1 text-xs ${adminGender === k ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold" : "border-[var(--border)] text-[var(--dim)]"}`}>{label}</button>
                      ))}
                      {([["all", t("statusAll")], ["bound", t("statusBound")], ["unbound", t("statusUnbound")], ["chatted", t("statusChatted")]] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={adminBoundFilter === k} onClick={() => setAdminBoundFilter(k)} className={`rounded-full border px-2.5 py-1 text-xs ${adminBoundFilter === k ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold" : "border-[var(--border)] text-[var(--dim)]"}`}>{label}</button>
                      ))}
                      <label htmlFor="ac-sort" className="sr-only">{t("sortLabel")}</label>
                      <select id="ac-sort" aria-label={t("sortLabel")} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs" value={adminSort} onChange={(e) => setAdminSort(e.target.value as typeof adminSort)}>
                        <option value="new">{t("sortNew")}</option><option value="old">{t("sortOld")}</option><option value="ageAsc">{t("sortAgeAsc")}</option><option value="ageDesc">{t("sortAgeDesc")}</option><option value="name">{t("sortName")}</option>
                      </select>
                    </div>
                    {adminSelected.length > 0 && (
                      <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm">
                        <span>{t("selectedCount", { n: adminSelected.length })}</span>
                        <button type="button" onClick={() => bulkDeleteM.mutate(adminSelected)} disabled={bulkDeleteM.isPending} className="rounded-md bg-[var(--seal)] px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50">{t("bulkDelete")}</button>
                        <button type="button" onClick={() => setAdminSelected([])} className="text-xs text-[var(--dim)] underline">{t("cancelSelection")}</button>
                      </div>
                    )}
                  </div>
                </article>
                {adminAllCandidatesQ.isPending ? (
                  <p className="py-8 text-center text-[var(--dim)]">{t("loadingAllCandidates")}</p>
                ) : (() => {
                  const allC: AdminCandidateRow[] = adminAllCandidatesQ.data?.candidates ?? [];
                  const boundIds = new Set((adminAllBindingsQ.data?.bindings ?? []).map((b) => b.targetId));
                  const chattedIds = new Set((adminAllConvsQ.data?.conversations ?? []).map((c) => c.candidateId));
                  const q = adminSearch.trim();
                  let list = allC.filter((c) =>
                    (adminGender === "all" || c.gender === adminGender) &&
                    (adminBoundFilter === "all" || (adminBoundFilter === "bound" ? boundIds.has(c.id) : adminBoundFilter === "unbound" ? !boundIds.has(c.id) : chattedIds.has(c.id))) &&
                    (!q || c.name.includes(q) || c.ownerName.includes(q) || c.notes.includes(q) || c.traits.some((t) => t.includes(q))),
                  );
                  list = [...list].sort((a, b) => adminSort === "old" ? a.id - b.id : adminSort === "ageAsc" ? a.age - b.age : adminSort === "ageDesc" ? b.age - a.age : adminSort === "name" ? a.name.localeCompare(b.name, locale) : b.id - a.id);
                  if (list.length === 0) return <p className="py-8 text-center text-sm text-[var(--dim)]">{t("noCandidatesMatch")}</p>;
                  return list.map((c) => (
                    <article key={c.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-start gap-2.5">
                        <input type="checkbox" aria-label={t("selectCandidate", { name: c.name })} checked={adminSelected.includes(c.id)} onChange={(e) => setAdminSelected((prev) => e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id))} className="mt-1.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="font-display truncate text-lg font-bold">{c.name}</h4>
                            <span className="shrink-0 text-xs text-[var(--dim)]">{t("ownerLabel", { name: c.ownerName })}</span>
                          </div>
                          <p className="mt-0.5 text-sm text-[var(--dim)]">{c.gender === "female" ? t("female") : t("male")} · {t("yearsOld", { age: c.age })} · {signLabel(c.chart.zodiacSign, lang)} · {t("animalChip", { animal: animalLabel(c.chart.zodiacAnimal, lang) })} · {t("dayMasterChip", { dm: dayMasterLabel(c.chart.dayMaster, c.chart.dayMasterElement, lang), strength: strengthLabel(c.chart.strength, lang) })} · {boundIds.has(c.id) ? t("statusBound") : t("statusUnbound")}{chattedIds.has(c.id) ? ` · ${t("statusChatted")}` : ""}</p>
                          {c.traits.length > 0 && <p className="mt-1 text-xs text-[var(--dim)]">{t("traitsLine")}{traitList(c.traits, lang)}</p>}
                          {c.notes && <p className="mt-0.5 text-xs text-[var(--dim)]">{t("notesLine")}{c.notes}</p>}
                          <p className="mt-0.5 text-xs text-[var(--dim)]">{t("bornPrefix", { date: c.birthDate })}{c.birthTime ? ` ${c.birthTime}` : t("bornTimeUnknownSuffix")}</p>
                        </div>
                      </div>
                      {adminEditingId === c.id ? (
                        <div className="mt-3 border-t border-[var(--border)] pt-3">
                          <PersonForm key={c.id} withTraits submitLabel={t("saveChanges")} pending={updateCandidateM.isPending} initial={{ name: c.name, gender: c.gender, birthDate: c.birthDate, birthTime: c.birthTime, traits: c.traits, notes: c.notes }} onSubmit={(v) => updateCandidateM.mutate({ id: c.id, v })} />
                          <button type="button" onClick={() => setAdminEditingId(null)} className="mt-2 w-full rounded-lg border border-[var(--border)] py-2 text-sm">{t("cancelEditBtn")}</button>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => setAdminEditingId(c.id)} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{t("editProfileBtn")}</button>
                          <button type="button" aria-expanded={expandedCandidate === c.id} onClick={() => setExpandedCandidate(expandedCandidate === c.id ? null : c.id)} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{expandedCandidate === c.id ? t("hideChartBtn") : t("viewChartBtn")}</button>
                          <button type="button" onClick={() => bulkDeleteM.mutate([c.id])} className="rounded-md border border-[var(--seal)] px-2.5 py-1.5 text-xs text-[var(--seal)]">{t("delete")}</button>
                        </div>
                      )}
                      {expandedCandidate === c.id && adminEditingId !== c.id && (
                        <div className="mt-3 border-t border-[var(--border)] pt-3"><ChartDetail chart={c.chart} /></div>
                      )}
                    </article>
                  ));
                })()}
              </div>
            )}

            {adminSection === "bonds" && (
              <div className="space-y-3">
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-lg font-bold">{t("adminBondsTitle")}</h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("adminBondsIntro", { f: limits.friend, l: adminSettings?.loverLimit ?? 1, p: adminSettings?.partnerLimit ?? 1, state: (adminSettings?.enforceExclusivity ?? true) ? t("exclOn") : t("exclOff") })}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("bondFilterLabel")}>
                    {([["all", t("filterAll")], ["friend", t("relFriend")], ["lover", t("relLover")], ["partner", t("relPartner")]] as const).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={adminBondFilter === k} onClick={() => setAdminBondFilter(k)} className={`rounded-full border px-2.5 py-1 text-xs ${adminBondFilter === k ? "border-[var(--accent)] bg-[var(--surface-alt)] font-bold" : "border-[var(--border)] text-[var(--dim)]"}`}>{label}</button>
                    ))}
                  </div>
                </article>
                {adminAllBindingsQ.isPending ? (
                  <p className="py-8 text-center text-[var(--dim)]">{t("loadingAllBindings")}</p>
                ) : (() => {
                  const list = (adminAllBindingsQ.data?.bindings ?? []).filter((b) => adminBondFilter === "all" || b.relationType === adminBondFilter);
                  if (list.length === 0) return <p className="py-8 text-center text-sm text-[var(--dim)]">{t("noBindingsMatch")}</p>;
                  return (
                    <ul className="space-y-2">
                      {list.map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                          <span className="min-w-0 text-sm">
                            <span className="rounded-full border border-[var(--gold-line)] px-1.5 py-px text-[11px] text-[var(--gold-line)]">{relName(b.relationType, t)}</span>{" "}
                            <span className="font-medium">{b.targetName}</span>
                            <span className="block truncate text-xs text-[var(--dim)]">{t("ownerLine", { name: b.ownerName, date: new Date(b.createdAt).toLocaleDateString(locale) })}</span>
                          </span>
                          <button type="button" onClick={() => adminUnbindM.mutate(b.id)} className="shrink-0 rounded-md border border-[var(--seal)] px-2.5 py-1.5 text-xs text-[var(--seal)]">{t("unbind")}</button>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}

            {adminSection === "chats" && (
              <div className="space-y-3">
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-lg font-bold">{t("adminChatsTitle")}</h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("adminChatsIntro")}</p>
                  <label htmlFor="ach-search" className="sr-only">{t("msgFilterLabel")}</label>
                  <input id="ach-search" aria-label={t("msgFilterLabel")} className={`${inputCls} mt-3`} value={adminMsgSearch} onChange={(e) => setAdminMsgSearch(e.target.value)} placeholder={t("msgFilterPlaceholder")} />
                </article>
                {adminDmConvsQ.isPending ? (
                  <p className="py-8 text-center text-[var(--dim)]">{t("loadingAllConvs")}</p>
                ) : (() => {
                  const kw = adminMsgSearch.trim();
                  const allConvs = adminDmConvsQ.data?.conversations ?? [];
                  const convs = kw
                    ? allConvs.filter((c) => c.userAName.includes(kw) || c.userBName.includes(kw) || (c.lastMessage ?? "").includes(kw))
                    : allConvs;
                  if (convs.length === 0) {
                    return <p className="py-8 text-center text-sm text-[var(--dim)]">{allConvs.length === 0 ? t("noConvsYet") : t("noMessagesMatch")}</p>;
                  }
                  return convs.map((conv) => (
                    <article key={conv.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {conv.userAName} <span className="text-[var(--dim)]">↔</span> {conv.userBName}{" "}
                            <span className="rounded-full border border-[var(--ink-blue)] px-1.5 py-px text-[10px] font-normal text-[var(--ink-blue)]">{t("realUserChip")}</span>
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[var(--dim)]">{t("convMsgCount", { n: conv.messageCount })}{conv.lastMessage ? ` · ${t("convLast")}${conv.lastMessage}` : ""}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button type="button" aria-expanded={adminDmConvId === conv.id} onClick={() => setAdminDmConvId(adminDmConvId === conv.id ? null : conv.id)} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs">{adminDmConvId === conv.id ? t("hideMessages") : t("viewMessages")}</button>
                          <button type="button" onClick={() => deleteConversationM.mutate(conv.id)} className="rounded-md border border-[var(--seal)] px-2.5 py-1.5 text-xs text-[var(--seal)]">{t("deleteConversation")}</button>
                        </div>
                      </div>
                      {adminDmConvId === conv.id && (
                        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto border-t border-[var(--border)] pt-3">
                          {adminDmMessagesQ.isPending ? (
                            <p className="py-4 text-center text-sm text-[var(--dim)]">{t("loadingMessages")}</p>
                          ) : (() => {
                            const msgs = (adminDmMessagesQ.data?.messages ?? []).filter((m) => !kw || m.content.includes(kw));
                            if (msgs.length === 0) return <p className="py-4 text-center text-sm text-[var(--dim)]">{t("noMessagesMatch")}</p>;
                            return msgs.map((m) => (
                              <div key={m.id} className={`flex items-start gap-2 ${m.senderId === conv.userAId ? "" : "flex-row-reverse"}`}>
                                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.senderId === conv.userAId ? "border border-[var(--border)] bg-[var(--bg)]" : "bg-[var(--ink-blue)] text-white"}`}>
                                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                  <p className={`mt-0.5 text-[10px] ${m.senderId === conv.userAId ? "text-[var(--dim)]" : "text-white/60"}`}>{m.senderName} · {new Date(m.createdAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                                </div>
                                <button type="button" aria-label={t("deleteMessageAria", { id: m.id })} onClick={() => deleteMessageM.mutate(m.id)} className="shrink-0 rounded-md border border-[var(--seal)] px-1.5 py-1 text-[11px] text-[var(--seal)]">{t("deleteMsgBtn")}</button>
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </article>
                  ));
                })()}
              </div>
            )}

            {adminSection === "settings" && (
              <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="font-display text-lg font-bold">{t("adminSettingsTitle")}</h3>
                <p className="mb-3 mt-1 text-sm text-[var(--dim)]">{t("adminSettingsIntro")}</p>
                {adminSettings ? (
                  <SettingsForm key={adminSettings.updatedAt ?? "init"} settings={adminSettings} pending={saveSettingsM.isPending} onSave={(v) => saveSettingsM.mutate(v)} />
                ) : (
                  <p className="py-6 text-center text-[var(--dim)]">{t("loadingSettings")}</p>
                )}
              </article>
            )}

            {adminSection === "data" && (
              <div className="space-y-3">
                <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-lg font-bold">{t("exportTitle")}</h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("exportIntro")}</p>
                  <button type="button" onClick={() => exportM.mutate()} disabled={exportM.isPending} className="mt-3 w-full rounded-lg bg-[var(--accent)] py-2.5 font-bold text-[var(--accent-ink)] disabled:opacity-50">{exportM.isPending ? t("exporting") : t("exportBtn")}</button>
                  {exportJson && (
                    <div className="mt-3 space-y-2">
                      <label htmlFor="ad-export" className="sr-only">{t("exportContentLabel")}</label>
                      <textarea id="ad-export" aria-label={t("exportContentLabel")} readOnly rows={10} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs" value={exportJson} />
                      <button
                        type="button"
                        className="w-full rounded-lg border border-[var(--border)] py-2 text-sm"
                        onClick={() => {
                          const blob = new Blob([exportJson], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `destiny-atlas-backup-${new Date().toISOString().slice(0, 10)}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        {t("downloadJson")}
                      </button>
                    </div>
                  )}
                </article>
                <article className="rounded-[var(--radius)] border border-[var(--seal)] bg-[var(--surface)] p-4">
                  <h3 className="font-display text-lg font-bold text-[var(--seal)]">{t("dangerTitle")}</h3>
                  <p className="mt-1 text-sm text-[var(--dim)]">{t("dangerIntro")}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {([
                      { scope: "chat", label: t("clearChat") },
                      { scope: "bindings", label: t("clearBindings") },
                      { scope: "candidates", label: t("clearCandidates") },
                      { scope: "all", label: t("clearAll") },
                    ] as const).map((it) => (
                      <button key={it.scope} type="button" onClick={() => setConfirmScope(it.scope)} className="rounded-lg border border-[var(--seal)] px-3 py-2 text-sm text-[var(--seal)]">{it.label}</button>
                    ))}
                  </div>
                  {confirmScope && (
                    <div className="mt-3 rounded-lg bg-[var(--surface-alt)] px-3 py-3">
                      <p className="text-sm font-medium">{confirmScope === "chat" ? t("confirmChat") : confirmScope === "bindings" ? t("confirmBindings") : confirmScope === "candidates" ? t("confirmCandidates") : t("confirmAll")}</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={clearDataM.isPending} onClick={() => clearDataM.mutate(confirmScope)} className="flex-1 rounded-lg bg-[var(--seal)] py-2 font-bold text-white disabled:opacity-50">{clearDataM.isPending ? t("confirmExecuting") : t("confirmExecute")}</button>
                        <button type="button" onClick={() => setConfirmScope(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">{t("cancel")}</button>
                      </div>
                    </div>
                  )}
                </article>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
