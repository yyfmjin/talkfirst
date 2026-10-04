"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { VisibilitySelect } from "@/components/visibility-select";
import { TFBadge, TFButton, TFChip, TFErrorState, TFInput, TFLoadingRegion, TFSkeleton } from "@/components/tf";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
// P0-03: `category` → section heading. Shared so the picker here and any future
// read-only grouping cannot disagree about which categories fold into 我的兴趣.
import { groupByAttributeSection } from "@/lib/attribute-sections";
import {
  attributeLabel,
  VISIBILITY_LABELS,
  type AttributeDefinition,
  type AttributeGroups,
  type AttributeKind,
  type AttributeView,
  type VisibilityTier,
} from "@/lib/profile";

/** Mirrors `ATTRIBUTE_MAX_PER_KIND` in `profile-attributes.service.ts`. */
const MAX_PER_KIND = 10;
/** Mirrors `ATTRIBUTE_LABEL_MAX_LENGTH`. */
const LABEL_MAX = 32;
/** Mirrors `ATTRIBUTE_VALUE_MAX_LENGTH`. */
const VALUE_MAX = 80;

const EMPTY_GROUPS: AttributeGroups = { aboutMe: [], lookingFor: [] };

const KIND_SECTIONS: Array<{ kind: AttributeKind; title: string; hint: string; example: string }> = [
  {
    kind: "ABOUT_ME",
    title: "我的介绍",
    hint: "用标签描述你自己：性格、爱好、生活方式都可以。",
    example: "例如：夜猫子、City Pop、慢热、摄影",
  },
  {
    kind: "LOOKING_FOR",
    title: "交友需求",
    hint: "写下你想认识什么样的人，系统标签和自定义标签都能用。",
    example: "例如：语言交换、游戏好友、同城朋友、旅行伙伴",
  },
];

function listOf(groups: AttributeGroups, kind: AttributeKind): AttributeView[] {
  return kind === "ABOUT_ME" ? groups.aboutMe : groups.lookingFor;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export default function ProfileAttributesPage() {
  const [groups, setGroups] = useState<AttributeGroups>(EMPTY_GROUPS);
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerKind, setPickerKind] = useState<AttributeKind | null>(null);
  const [editing, setEditing] = useState<AttributeView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [mine, catalog] = await Promise.all([
        apiFetch<AttributeGroups>("/users/me/attributes"),
        apiFetch<AttributeDefinition[]>("/meta/attributes"),
      ]);
      setGroups(mine);
      setDefinitions(catalog);
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "标签加载失败，请稍后再试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every mutation re-reads the server, so the screen only ever shows state the
   * database actually holds — an optimistic local list could hide a rejected
   * write and make a failed save look successful.
   */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        await action();
        await load();
        setNotice(successMessage);
        return true;
      } catch (requestError) {
        setError(friendlyErrorMessage(requestError, "保存失败，请稍后再试。"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const createSystem = useCallback(
    async (definition: AttributeDefinition) => {
      const done = await mutate(
        () =>
          apiFetch("/users/me/attributes", {
            method: "POST",
            body: { kind: definition.kind, definitionId: definition.id },
          }),
        `已添加「${definition.labelZh ?? definition.label}」。`,
      );
      if (done) setPickerKind(null);
    },
    [mutate],
  );

  const createCustom = useCallback(
    async (kind: AttributeKind, label: string, value: string) => {
      const body: { kind: AttributeKind; label: string; value?: string } = { kind, label };
      if (value) body.value = value;
      const done = await mutate(
        () => apiFetch("/users/me/attributes", { method: "POST", body }),
        `已添加「${label}」。`,
      );
      if (done) setPickerKind(null);
    },
    [mutate],
  );

  const saveAttribute = useCallback(
    async (id: string, patch: { label?: string; value?: string; visibility?: VisibilityTier }) => {
      const done = await mutate(
        () => apiFetch(`/users/me/attributes/${id}`, { method: "PATCH", body: patch }),
        "已保存。",
      );
      if (done) setEditing(null);
    },
    [mutate],
  );

  const removeAttribute = useCallback(
    async (attribute: AttributeView) => {
      const done = await mutate(
        () => apiFetch(`/users/me/attributes/${attribute.id}`, { method: "DELETE" }),
        `已删除「${attributeLabel(attribute)}」。`,
      );
      if (done) setEditing(null);
    },
    [mutate],
  );

  /**
   * Reordering renumbers the whole section from 0 and patches only the rows that
   * actually changed. A plain two-row swap of `sortOrder` would be a no-op while
   * every stored value is still the default 0, which is the common case.
   */
  const move = useCallback(
    async (kind: AttributeKind, index: number, delta: number) => {
      const list = listOf(groups, kind);
      const target = index + delta;
      if (target < 0 || target >= list.length) return;
      const reordered = [...list];
      const held = reordered[index];
      reordered[index] = reordered[target];
      reordered[target] = held;
      const changed = reordered
        .map((attribute, position) => ({ attribute, position }))
        .filter((entry) => entry.attribute.sortOrder !== entry.position);
      if (changed.length === 0) return;
      await mutate(
        () =>
          Promise.all(
            changed.map((entry) =>
              apiFetch(`/users/me/attributes/${entry.attribute.id}`, {
                method: "PATCH",
                body: { sortOrder: entry.position },
              }),
            ),
          ),
        "顺序已更新。",
      );
    },
    [groups, mutate],
  );

  const usedDefinitionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const attribute of [...groups.aboutMe, ...groups.lookingFor]) {
      if (attribute.definitionId) ids.add(attribute.definitionId);
    }
    return ids;
  }, [groups]);

  return (
    <PhoneShell>
      <ScreenHeader title="交友属性" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-ui leading-6 text-content-muted">
          标签让别人更快了解你。每一栏最多 10 个，设为「公开」后也会用于「发现」的推荐。
        </p>

        {loading ? (
          <TFLoadingRegion label="正在加载交友属性">
            <div className="mt-5 space-y-3">
              <TFSkeleton shape="block" className="h-40 w-full" />
              <TFSkeleton shape="block" className="h-40 w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && error ? (
          <div className="mt-5">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {!loading
          ? KIND_SECTIONS.map((section) => (
              <AttributeSection
                key={section.kind}
                kind={section.kind}
                title={section.title}
                hint={section.hint}
                example={section.example}
                attributes={listOf(groups, section.kind)}
                busy={busy}
                onAdd={() => setPickerKind(section.kind)}
                onSelect={(attribute) => setEditing(attribute)}
                onMove={(index, delta) => void move(section.kind, index, delta)}
              />
            ))
          : null}

        {notice ? (
          <p role="status" className="mt-4 text-center text-caption text-success-600">
            {notice}
          </p>
        ) : null}

        <div className="mt-6">
          <TFButton variant="secondary" fullWidth href="/me">
            返回我的
          </TFButton>
        </div>
      </div>

      {pickerKind ? (
        <PickerSheet
          kind={pickerKind}
          definitions={definitions}
          usedDefinitionIds={usedDefinitionIds}
          busy={busy}
          onClose={() => setPickerKind(null)}
          onPickSystem={(definition) => void createSystem(definition)}
          onPickCustom={(label, value) => void createCustom(pickerKind, label, value)}
        />
      ) : null}

      {editing ? (
        <AttributeEditorSheet
          attribute={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(patch) => void saveAttribute(editing.id, patch)}
          onDelete={() => void removeAttribute(editing)}
        />
      ) : null}
    </PhoneShell>
  );
}

function AttributeSection({
  kind,
  title,
  hint,
  example,
  attributes,
  busy,
  onAdd,
  onSelect,
  onMove,
}: {
  kind: AttributeKind;
  title: string;
  hint: string;
  example: string;
  attributes: AttributeView[];
  busy: boolean;
  onAdd: () => void;
  onSelect: (attribute: AttributeView) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const full = attributes.length >= MAX_PER_KIND;

  return (
    <section
      data-testid={`attribute-section-${kind}`}
      className="mt-5 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ui font-semibold text-content">{title}</p>
          <p className="mt-0.5 text-caption leading-4 text-content-muted">{hint}</p>
        </div>
        {/* `attribute-count-{kind}` is how `profile.spec.ts` waits for this page to
            load, so the testid stays on the visible count pill. */}
        <TFBadge
          tone={full ? "warning" : "brand"}
          className="shrink-0"
          data-testid={`attribute-count-${kind}`}
        >
          {attributes.length} / {MAX_PER_KIND}
        </TFBadge>
      </div>

      {attributes.length === 0 ? (
        <p className="mt-3 rounded-row bg-surface-sunken px-3 py-3 text-caption leading-5 text-content-muted">
          {example}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {attributes.map((attribute, index) => (
            <li
              key={attribute.id}
              data-testid={`attribute-row-${attribute.id}`}
              className="flex items-center gap-2 rounded-row bg-surface-sunken px-3 py-2"
            >
              <button type="button" onClick={() => onSelect(attribute)} className="min-w-0 flex-1 text-left">
                <span className="flex flex-wrap items-center gap-1 text-ui">
                  <span className="min-w-0 break-words">{attributeLabel(attribute)}</span>
                  {attribute.source === "CUSTOM" ? (
                    <TFBadge tone="neutral">自定义</TFBadge>
                  ) : null}
                  {attribute.definitionActive === false ? (
                    <TFBadge tone="warning">已停用</TFBadge>
                  ) : null}
                </span>
                <span className="mt-0.5 block break-words text-overline text-content-muted">
                  {attribute.value ? `${attribute.value} · ` : ""}
                  {VISIBILITY_LABELS[attribute.visibility]}
                </span>
              </button>
              <span className="flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => onMove(index, -1)}
                  disabled={index === 0 || busy}
                  aria-label={`把 ${attributeLabel(attribute)} 上移`}
                  className="grid h-6 w-7 place-items-center rounded-control bg-surface text-overline text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-40"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => onMove(index, 1)}
                  disabled={index === attributes.length - 1 || busy}
                  aria-label={`把 ${attributeLabel(attribute)} 下移`}
                  className="grid h-6 w-7 place-items-center rounded-control bg-surface text-overline text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-40"
                >
                  ▼
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* `aria-label="添加到{title}"` is how `profile.spec.ts` opens the picker:
          it looks for `添加到我的介绍` / `添加到交友需求`, so the label stays on the
          control and keeps the `{title}` interpolation. */}
      <TFButton
        variant="secondary"
        size="sm"
        fullWidth
        className="mt-3"
        onClick={onAdd}
        disabled={full || busy}
        aria-label={`添加到${title}`}
      >
        {full ? `已达上限 ${MAX_PER_KIND} 个` : "+ 添加"}
      </TFButton>
    </section>
  );
}

function SheetShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="tf-scroll max-h-[88%] w-full overflow-y-auto rounded-t-sheet bg-surface p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-[390px] sm:rounded-sheet">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-heading font-semibold text-content">{title}</h2>
            {description ? (
              <p className="mt-1 text-caption leading-5 text-content-muted">{description}</p>
            ) : null}
          </div>
          <TFButton variant="ghost" size="sm" className="shrink-0" onClick={onClose} aria-label="关闭面板">
            关闭
          </TFButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function PickerSheet({
  kind,
  definitions,
  usedDefinitionIds,
  busy,
  onClose,
  onPickSystem,
  onPickCustom,
}: {
  kind: AttributeKind;
  definitions: AttributeDefinition[];
  usedDefinitionIds: Set<string>;
  busy: boolean;
  onClose: () => void;
  onPickSystem: (definition: AttributeDefinition) => void;
  onPickCustom: (label: string, value: string) => void;
}) {
  const [tab, setTab] = useState<"system" | "custom">("system");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState("");

  // `/meta/attributes` returns only active tags, and anything already on the
  // profile is filtered out so the catalog can never offer a duplicate that the
  // API would then reject with 409.
  const available = useMemo(
    () => definitions.filter((definition) => definition.kind === kind && !usedDefinitionIds.has(definition.id)),
    [definitions, kind, usedDefinitionIds],
  );
  /**
   * `categories` used to live here — a `Set` of raw `category` values that the picker
   * iterated. P0-03 heads the picker by SECTION instead (我的性格 / 我的兴趣 / 交流方式),
   * and the render calls `groupByAttributeSection(available)` directly, so a memo would
   * only be a second name for the same value.
   */

  const section = KIND_SECTIONS.find((item) => item.kind === kind);

  function submitCustom() {
    const trimmedLabel = label.trim();
    const trimmedValue = value.trim();
    if (!trimmedLabel) {
      setLocalError("请填写标签名称。");
      return;
    }
    if (codePointLength(trimmedLabel) > LABEL_MAX) {
      setLocalError(`标签名称最多 ${LABEL_MAX} 个字符。`);
      return;
    }
    if (codePointLength(trimmedValue) > VALUE_MAX) {
      setLocalError(`补充说明最多 ${VALUE_MAX} 个字符。`);
      return;
    }
    setLocalError("");
    onPickCustom(trimmedLabel, trimmedValue);
  }

  return (
    <SheetShell
      title={`添加到${section?.title ?? "属性"}`}
      description="系统标签直接选择；系统没有收录的说法可以自己写。"
      onClose={onClose}
    >
      {/* A two-option segmented control. `role="tablist"` is NOT used here: these
          switch what the sheet below shows, and the sheet is not a tabpanel with
          an id, so `aria-pressed` on a toggle pair is the honest description. */}
      <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-control bg-surface-sunken p-1">
        {([
          ["system", "系统标签"],
          ["custom", "自定义"],
        ] as const).map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              setLocalError("");
            }}
            className={cn(
              "min-h-[2rem] rounded-control text-caption transition-colors duration-instant",
              tab === id
                ? "bg-surface font-medium text-brand-600 shadow-card"
                : "text-content-muted hover:text-content",
            )}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === "system" ? (
        <div className="mt-4" data-testid="system-picker">
          {available.length === 0 ? (
            <p className="rounded-row bg-surface-sunken px-3 py-3 text-caption text-content-muted">
              系统标签都已经用过了，试试自定义标签。
            </p>
          ) : (
            groupByAttributeSection(available).map((section) => (
              <div key={section.title} className="mb-4">
                {/*
                  P0-03: the heading is the SECTION the member thinks in
                  (我的性格 / 我的兴趣 / 交流方式), not the database's `category`
                  ("Personality" / "Hobby" …). Several categories fold into one
                  heading, which is why this groups rather than iterating categories
                  directly — otherwise 我的兴趣 would appear up to five times, once
                  per filing.
                */}
                <p className="mb-2 text-caption font-medium text-content-muted">{section.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  {section.entries.map((definition) => (
                      <TFChip
                        key={definition.id}
                        disabled={busy}
                        onClick={() => onPickSystem(definition)}
                      >
                        {definition.labelZh ?? definition.label}
                      </TFChip>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="mt-4" data-testid="custom-picker">
          <div>
            <label htmlFor="custom-attr-label" className="mb-1.5 block text-caption font-medium text-content-muted">
              标签名称（必填，最多 {LABEL_MAX} 字）
            </label>
            {/* `aria-label="自定义标签名称"` / `"自定义标签补充说明"` are asserted by
                `profile.spec.ts`, so they stay on the controls. */}
            <TFInput
              id="custom-attr-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={LABEL_MAX}
              placeholder={section?.example.replace("例如：", "") ?? "例如：夜猫子"}
              aria-label="自定义标签名称"
              invalid={Boolean(localError)}
            />
          </div>
          <div className="mt-3">
            <label htmlFor="custom-attr-value" className="mb-1.5 block text-caption font-medium text-content-muted">
              补充说明（可选，最多 {VALUE_MAX} 字）
            </label>
            <TFInput
              id="custom-attr-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={VALUE_MAX}
              placeholder="例如：想认识会日语的人"
              aria-label="自定义标签补充说明"
              invalid={Boolean(localError)}
            />
          </div>
          <p className="mt-2 text-caption leading-4 text-content-muted">
            名称会由服务器统一规格化（去空格、大小写不敏感）后判重，重复会提示已存在。
          </p>
          {localError ? (
            <p role="alert" className="mt-2 break-words text-caption text-danger-600">
              {localError}
            </p>
          ) : null}
          <TFButton
            size="lg"
            fullWidth
            className="mt-4"
            disabled={busy}
            loading={busy}
            loadingLabel="添加中…"
            onClick={submitCustom}
            aria-label="添加自定义标签"
          >
            添加
          </TFButton>
        </div>
      )}
    </SheetShell>
  );
}

function AttributeEditorSheet({
  attribute,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  attribute: AttributeView;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: { label?: string; value?: string; visibility?: VisibilityTier }) => void;
  onDelete: () => void;
}) {
  const isCustom = attribute.source === "CUSTOM";
  const [label, setLabel] = useState(attribute.label);
  const [value, setValue] = useState(attribute.value ?? "");
  const [visibility, setVisibility] = useState<VisibilityTier>(attribute.visibility);
  const [localError, setLocalError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submit() {
    const patch: { label?: string; value?: string; visibility?: VisibilityTier } = {};
    if (isCustom) {
      const trimmedLabel = label.trim();
      if (!trimmedLabel) {
        setLocalError("标签名称不能为空。");
        return;
      }
      if (codePointLength(trimmedLabel) > LABEL_MAX) {
        setLocalError(`标签名称最多 ${LABEL_MAX} 个字符。`);
        return;
      }
      if (codePointLength(value.trim()) > VALUE_MAX) {
        setLocalError(`补充说明最多 ${VALUE_MAX} 个字符。`);
        return;
      }
      if (trimmedLabel !== attribute.label) patch.label = trimmedLabel;
      if (value.trim() !== (attribute.value ?? "")) patch.value = value.trim();
    }
    if (visibility !== attribute.visibility) patch.visibility = visibility;
    if (Object.keys(patch).length === 0) {
      setLocalError("还没有任何修改。");
      return;
    }
    setLocalError("");
    onSave(patch);
  }

  return (
    <SheetShell
      title={isCustom ? "编辑自定义标签" : "编辑系统标签"}
      description={
        isCustom
          ? "名称和补充说明都可以改；名称改动同样会经过服务器归一化判重。"
          : "系统标签的名称由平台维护，只能调整可见范围和顺序。"
      }
      onClose={onClose}
    >
      <div className="mt-4 rounded-row bg-surface-sunken px-3 py-2.5">
        <p className="text-ui font-medium text-content">{attributeLabel(attribute)}</p>
        <p className="mt-0.5 text-caption text-content-muted">
          {attribute.source === "SYSTEM" ? `系统标签 · ${attribute.key ?? ""}` : "自定义标签"}
          {attribute.definitionActive === false ? " · 已停用" : ""}
        </p>
      </div>

      {isCustom ? (
        <>
          <div className="mt-4">
            <label htmlFor="edit-attr-label" className="mb-1.5 block text-caption font-medium text-content-muted">
              标签名称（最多 {LABEL_MAX} 字）
            </label>
            {/* `aria-label="标签名称"` / `"补充说明"` are the accessible names the
                editor's own flow uses; `TFInput` forwards them. */}
            <TFInput
              id="edit-attr-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={LABEL_MAX}
              aria-label="标签名称"
            />
          </div>
          <div className="mt-3">
            <label htmlFor="edit-attr-value" className="mb-1.5 block text-caption font-medium text-content-muted">
              补充说明（可选，最多 {VALUE_MAX} 字）
            </label>
            <TFInput
              id="edit-attr-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={VALUE_MAX}
              aria-label="补充说明"
            />
          </div>
        </>
      ) : null}

      <div className="mt-4">
        <p className="mb-1.5 text-caption font-medium text-content-muted">谁能看到这个标签</p>
        <VisibilitySelect
          value={visibility}
          onChange={setVisibility}
          disabled={busy}
          label={`${attributeLabel(attribute)} 的可见范围`}
        />
      </div>

      {localError ? (
        <p role="alert" className="mt-3 break-words text-caption text-danger-600">
          {localError}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <TFButton variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
          取消
        </TFButton>
        <TFButton
          className="flex-[2]"
          onClick={submit}
          disabled={busy}
          loading={busy}
          loadingLabel="保存中…"
          aria-label="保存标签"
        >
          保存
        </TFButton>
      </div>

      {/* In-sheet delete confirmation. Deliberately still a nested confirm rather
          than a `TFDialog`: the sheet already owns the screen and the focus trap,
          and stacking two trapped overlays is how a keyboard user gets stuck. */}
      <div className="mt-4 border-t border-border pt-3">
        {confirmingDelete ? (
          <div className="rounded-row bg-danger-50 p-3">
            <p className="text-caption text-danger-700">确定删除「{attributeLabel(attribute)}」？</p>
            <div className="mt-2 flex gap-2">
              <TFButton
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                再想想
              </TFButton>
              <TFButton
                variant="danger"
                className="flex-1"
                onClick={onDelete}
                disabled={busy}
                loading={busy}
                loadingLabel="删除中…"
                aria-label="确认删除标签"
              >
                确认删除
              </TFButton>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="w-full rounded-control px-3 py-2 text-center text-ui text-danger-600 transition-colors duration-instant hover:bg-danger-50 disabled:opacity-50"
          >
            删除这个标签
          </button>
        )}
      </div>
    </SheetShell>
  );
}
