import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type {
  AttributeDefinition,
  AttributeGroups,
  AttributeKind,
  AttributeView,
  VisibilityTier,
} from "../lib/types";
import { colors } from "../theme";

/** 镜像 `ATTRIBUTE_MAX_PER_KIND`（profile-attributes.service.ts）。 */
const MAX_PER_KIND = 10;
/** 镜像 `ATTRIBUTE_LABEL_MAX_LENGTH`。 */
const LABEL_MAX = 32;
/** 镜像 `ATTRIBUTE_VALUE_MAX_LENGTH`。 */
const VALUE_MAX = 80;

const KIND_SECTIONS: Array<{
  kind: AttributeKind;
  titleKey: MsgKey;
  hintKey: MsgKey;
  exampleKey: MsgKey;
}> = [
  {
    kind: "ABOUT_ME",
    titleKey: "me.attributesAboutMe",
    hintKey: "me.attributesAboutMeHint",
    exampleKey: "me.attributesAboutMeExample",
  },
  {
    kind: "LOOKING_FOR",
    titleKey: "me.attributesLookingFor",
    hintKey: "me.attributesLookingForHint",
    exampleKey: "me.attributesLookingForExample",
  },
];

const VISIBILITY_CHIPS: Array<{ tier: VisibilityTier; labelKey: MsgKey }> = [
  { tier: "PUBLIC", labelKey: "visibility.chipPublic" },
  { tier: "CONNECTIONS", labelKey: "visibility.chipConnections" },
  { tier: "PRIVATE", labelKey: "visibility.chipPrivate" },
];

function attributeLabel(attribute: AttributeView): string {
  return attribute.source === "SYSTEM" ? attribute.labelZh ?? attribute.label : attribute.label;
}

function definitionLabel(definition: AttributeDefinition): string {
  return definition.labelZh ?? definition.label;
}

function listOf(groups: AttributeGroups, kind: AttributeKind): AttributeView[] {
  return kind === "ABOUT_ME" ? groups.aboutMe : groups.lookingFor;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * 交友属性 —— 对齐 web 的 `/me/attributes`。
 *
 * 两栏（我的介绍 ABOUT_ME / 交友需求 LOOKING_FOR），每栏最多 10 个标签。
 * 系统标签直接选、没收录的可以自定义；每个标签可改可见范围、可上移/下移、可删除。
 * 每次改动后都重新读服务端，屏幕只展示数据库里真实存在的状态。
 */
export function AttributesScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<AttributeGroups>({ aboutMe: [], lookingFor: [] });
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerKind, setPickerKind] = useState<AttributeKind | null>(null);
  const [editing, setEditing] = useState<AttributeView | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [mine, catalog] = await Promise.all([
        apiFetch<AttributeGroups>("/users/me/attributes"),
        apiFetch<AttributeDefinition[]>("/meta/attributes"),
      ]);
      setGroups(mine);
      setDefinitions(catalog);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.loadingFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 每次写操作：执行 → 重读 → 提示；成功后把打开的 sheet 关掉。 */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, successMessage: string, onDone?: () => void) => {
      if (busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        await action();
        await load();
        setNotice(successMessage);
        onDone?.();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : t("me.saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [busy, load, t],
  );

  const createSystem = useCallback(
    (definition: AttributeDefinition) => {
      void mutate(
        () =>
          apiFetch("/users/me/attributes", {
            method: "POST",
            body: { kind: definition.kind, definitionId: definition.id },
          }),
        t("me.attributesAdded", { label: definitionLabel(definition) }),
        () => setPickerKind(null),
      );
    },
    [mutate, t],
  );

  const createCustom = useCallback(
    (kind: AttributeKind, label: string, value: string) => {
      const body: { kind: AttributeKind; label: string; value?: string } = { kind, label };
      if (value) body.value = value;
      void mutate(
        () => apiFetch("/users/me/attributes", { method: "POST", body }),
        t("me.attributesAdded", { label }),
        () => setPickerKind(null),
      );
    },
    [mutate, t],
  );

  const saveAttribute = useCallback(
    (id: string, patch: { label?: string; value?: string; visibility?: VisibilityTier }) => {
      void mutate(
        () => apiFetch(`/users/me/attributes/${id}`, { method: "PATCH", body: patch }),
        t("me.saved"),
        () => setEditing(null),
      );
    },
    [mutate, t],
  );

  const removeAttribute = useCallback(
    (attribute: AttributeView) => {
      void mutate(
        () => apiFetch(`/users/me/attributes/${attribute.id}`, { method: "DELETE" }),
        t("me.attributesDeleted", { label: attributeLabel(attribute) }),
        () => setEditing(null),
      );
    },
    [mutate, t],
  );

  /** 重排：把整栏从 0 重新编号，只 patch 真正变化的行。 */
  const move = useCallback(
    (kind: AttributeKind, index: number, delta: number) => {
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
      void mutate(
        () =>
          Promise.all(
            changed.map((entry) =>
              apiFetch(`/users/me/attributes/${entry.attribute.id}`, {
                method: "PATCH",
                body: { sortOrder: entry.position },
              }),
            ),
          ),
        t("me.attributesOrderUpdated"),
      );
    },
    [groups, mutate, t],
  );

  const usedDefinitionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const attribute of [...groups.aboutMe, ...groups.lookingFor]) {
      if (attribute.definitionId) ids.add(attribute.definitionId);
    }
    return ids;
  }, [groups]);

  if (pickerKind) {
    return (
      <AttributePicker
        kind={pickerKind}
        definitions={definitions}
        usedDefinitionIds={usedDefinitionIds}
        busy={busy}
        error={error}
        onBack={() => setPickerKind(null)}
        onPickSystem={createSystem}
        onPickCustom={(label, value) => createCustom(pickerKind, label, value)}
      />
    );
  }

  if (editing) {
    return (
      <AttributeEditor
        attribute={editing}
        busy={busy}
        onBack={() => setEditing(null)}
        onSave={(patch) => void saveAttribute(editing.id, patch)}
        onDelete={() => void removeAttribute(editing)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("me.attributes")} onBack={onBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.intro}>{t("me.attributesIntro")}</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {notice ? <Text style={styles.okText}>{notice}</Text> : null}

          {KIND_SECTIONS.map((section) => (
            <AttributeSection
              key={section.kind}
              kind={section.kind}
              attributes={listOf(groups, section.kind)}
              busy={busy}
              onAdd={() => setPickerKind(section.kind)}
              onSelect={(attribute) => setEditing(attribute)}
              onMove={(index, delta) => void move(section.kind, index, delta)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function AttributeSection({
  kind,
  attributes,
  busy,
  onAdd,
  onSelect,
  onMove,
}: {
  kind: AttributeKind;
  attributes: AttributeView[];
  busy: boolean;
  onAdd: () => void;
  onSelect: (attribute: AttributeView) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const { t } = useI18n();
  const section = KIND_SECTIONS.find((item) => item.kind === kind);
  const full = attributes.length >= MAX_PER_KIND;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionHeadText}>
          <Text style={styles.sectionTitle}>{t(section?.titleKey ?? "me.attributes")}</Text>
          <Text style={styles.sectionHint}>{t(section?.hintKey ?? "me.attributesIntro")}</Text>
        </View>
        <View style={[styles.count, full ? styles.countFull : null]}>
          <Text style={[styles.countText, full ? styles.countFullText : null]}>
            {t("me.attributesCount", { current: attributes.length, max: MAX_PER_KIND })}
          </Text>
        </View>
      </View>

      {attributes.length === 0 ? (
        <Text style={styles.example}>{t(section?.exampleKey ?? "me.attributesAboutMeExample")}</Text>
      ) : (
        <View style={styles.list}>
          {attributes.map((attribute, index) => (
            <View key={attribute.id} style={styles.row}>
              <Pressable
                onPress={() => onSelect(attribute)}
                accessibilityRole="button"
                accessibilityLabel={attributeLabel(attribute)}
                style={styles.rowMain}
              >
                <Text style={styles.rowLabel}>{attributeLabel(attribute)}</Text>
                <Text style={styles.rowMeta}>
                  {attribute.value ? `${attribute.value} · ` : ""}
                  {attribute.source === "CUSTOM" ? `${t("me.attributesCustom")} · ` : ""}
                  {attribute.definitionActive === false ? `${t("me.attributesDisabled")} · ` : ""}
                  {t(VISIBILITY_CHIPS.find((chip) => chip.tier === attribute.visibility)?.labelKey ?? "visibility.chipPublic")}
                </Text>
              </Pressable>
              <View style={styles.rowActions}>
                <Pressable
                  onPress={() => onMove(index, -1)}
                  disabled={index === 0 || busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("me.attributesMoveUp")}
                  style={[styles.moveBtn, (index === 0 || busy) ? styles.moveBtnDisabled : null]}
                >
                  <Icon name="chevron-up" size={16} color={colors.muted} />
                </Pressable>
                <Pressable
                  onPress={() => onMove(index, 1)}
                  disabled={index === attributes.length - 1 || busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("me.attributesMoveDown")}
                  style={[styles.moveBtn, (index === attributes.length - 1 || busy) ? styles.moveBtnDisabled : null]}
                >
                  <Icon name="chevron-down" size={16} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.addRow}>
        <Button
          label={full ? t("me.attributesLimit", { n: MAX_PER_KIND }) : t("me.attributesAdd")}
          onPress={onAdd}
          disabled={full || busy}
          variant="ghost"
        />
      </View>
    </View>
  );
}

/** 添加标签：系统标签（chip 直选）或自定义（名称 + 补充说明）。 */
function AttributePicker({
  kind,
  definitions,
  usedDefinitionIds,
  busy,
  error,
  onBack,
  onPickSystem,
  onPickCustom,
}: {
  kind: AttributeKind;
  definitions: AttributeDefinition[];
  usedDefinitionIds: Set<string>;
  busy: boolean;
  /*
   * 写入失败的提示（2026-10-24 用户反馈「有的标签点了没反应」）。
   * 失败时原来只把错误写到上层页面，而这一页是全屏接管的 —— 用户看到的就是
   * 「按了没反应」。现在把错误直接显示在 chip 上方。
   */
  error: string;
  onBack: () => void;
  onPickSystem: (definition: AttributeDefinition) => void;
  onPickCustom: (label: string, value: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"system" | "custom">("system");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState("");

  const section = KIND_SECTIONS.find((item) => item.kind === kind);
  const available = useMemo(
    () => definitions.filter((def) => def.kind === kind && !usedDefinitionIds.has(def.id)),
    [definitions, kind, usedDefinitionIds],
  );

  function submitCustom() {
    const trimmedLabel = label.trim();
    const trimmedValue = value.trim();
    if (!trimmedLabel) {
      setLocalError(t("me.attributesLabelRequired"));
      return;
    }
    if (codePointLength(trimmedLabel) > LABEL_MAX) {
      setLocalError(t("me.attributesLabelTooLong", { n: LABEL_MAX }));
      return;
    }
    if (codePointLength(trimmedValue) > VALUE_MAX) {
      setLocalError(t("me.attributesValueTooLong", { n: VALUE_MAX }));
      return;
    }
    setLocalError("");
    onPickCustom(trimmedLabel, trimmedValue);
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("me.attributesAdd")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t("me.attributesPickHint")}</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.segmented}>
          {([
            ["system", t("me.attributesSystem")],
            ["custom", t("me.attributesCustom")],
          ] as const).map(([id, text]) => (
            <Pressable
              key={id}
              onPress={() => {
                setTab(id);
                setLocalError("");
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === id }}
              style={[styles.segment, tab === id ? styles.segmentActive : null]}
            >
              <Text style={[styles.segmentLabel, tab === id ? styles.segmentLabelActive : null]}>
                {text}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "system" ? (
          available.length === 0 ? (
            <Text style={styles.example}>{t("me.attributesSystemEmpty")}</Text>
          ) : (
            <View style={styles.chipWrap}>
              {available.map((definition) => (
                <Pressable
                  key={definition.id}
                  onPress={() => onPickSystem(definition)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  style={[styles.chip, busy ? styles.chipBusy : null]}
                >
                  <Text style={styles.chipLabel}>{definitionLabel(definition)}</Text>
                </Pressable>
              ))}
            </View>
          )
        ) : (
          <View style={styles.form}>
            <Field
              label={t("me.attributesLabelNameHint", { n: LABEL_MAX })}
              value={label}
              onChange={setLabel}
              maxLength={LABEL_MAX}
              placeholder={section?.exampleKey ? t(section.exampleKey).replace("例如：", "") : undefined}
            />
            <Field
              label={t("me.attributesValueHint", { n: VALUE_MAX })}
              value={value}
              onChange={setValue}
              maxLength={VALUE_MAX}
              placeholder={t("me.attributesValuePlaceholder")}
            />
            {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
            <View style={styles.actions}>
              <Button
                label={t("me.attributesAdd")}
                onPress={submitCustom}
                loading={busy}
                disabled={busy}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** 编辑/删除标签：自定义标签可改名，两者都能改可见范围。 */
function AttributeEditor({
  attribute,
  busy,
  onBack,
  onSave,
  onDelete,
}: {
  attribute: AttributeView;
  busy: boolean;
  onBack: () => void;
  onSave: (patch: { label?: string; value?: string; visibility?: VisibilityTier }) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
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
        setLocalError(t("me.attributesLabelRequired"));
        return;
      }
      if (codePointLength(trimmedLabel) > LABEL_MAX) {
        setLocalError(t("me.attributesLabelTooLong", { n: LABEL_MAX }));
        return;
      }
      if (codePointLength(value.trim()) > VALUE_MAX) {
        setLocalError(t("me.attributesValueTooLong", { n: VALUE_MAX }));
        return;
      }
      if (trimmedLabel !== attribute.label) patch.label = trimmedLabel;
      if (value.trim() !== (attribute.value ?? "")) patch.value = value.trim();
    }
    if (visibility !== attribute.visibility) patch.visibility = visibility;
    if (Object.keys(patch).length === 0) {
      setLocalError(t("me.attributesNoChange"));
      return;
    }
    setLocalError("");
    onSave(patch);
  }

  return (
    <View style={styles.root}>
      <SubHeader
        title={isCustom ? t("me.attributesEditCustom") : t("me.attributesEditSystem")}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          {isCustom ? t("me.attributesEditCustomHint") : t("me.attributesEditSystemHint")}
        </Text>

        <View style={styles.currentRow}>
          <Text style={styles.currentLabel}>{attributeLabel(attribute)}</Text>
          <Text style={styles.currentMeta}>
            {attribute.source === "CUSTOM"
              ? t("me.attributesCustom")
              : `${t("me.attributesSystem")}${attribute.key ? ` · ${attribute.key}` : ""}`}
            {attribute.definitionActive === false ? ` · ${t("me.attributesDisabled")}` : ""}
          </Text>
        </View>

        {isCustom ? (
          <View style={styles.form}>
            <Field
              label={t("me.attributesLabelNameHint", { n: LABEL_MAX })}
              value={label}
              onChange={setLabel}
              maxLength={LABEL_MAX}
            />
            <Field
              label={t("me.attributesValueHint", { n: VALUE_MAX })}
              value={value}
              onChange={setValue}
              maxLength={VALUE_MAX}
            />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t("me.attributesVisibility")}</Text>
        <View style={styles.chipWrap}>
          {VISIBILITY_CHIPS.map((chip) => {
            const active = visibility === chip.tier;
            return (
              <Pressable
                key={chip.tier}
                onPress={() => setVisibility(chip.tier)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                {active ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
                <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
                  {t(chip.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

        <View style={styles.actions}>
          <Button label={t("me.save")} onPress={submit} loading={busy} disabled={busy} />
        </View>

        <View style={styles.deleteBlock}>
          {confirmingDelete ? (
            <View style={styles.deleteConfirm}>
              <Text style={styles.deleteConfirmText}>
                {t("me.attributesDeleteConfirm", { label: attributeLabel(attribute) })}
              </Text>
              <View style={styles.deleteConfirmActions}>
                <View style={styles.deleteConfirmBtn}>
                  <Button
                    label={t("me.attributesCancel")}
                    onPress={() => setConfirmingDelete(false)}
                    variant="ghost"
                    disabled={busy}
                  />
                </View>
                <View style={styles.deleteConfirmBtn}>
                  <Button
                    label={t("me.attributesConfirmDelete")}
                    onPress={onDelete}
                    loading={busy}
                    disabled={busy}
                  />
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setConfirmingDelete(true)}
              disabled={busy}
              accessibilityRole="button"
              style={styles.deleteLink}
            >
              <Text style={styles.deleteLinkText}>{t("me.attributesDelete")}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** 一个带标签的输入行。 */
function Field({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        placeholder={placeholder}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  body: { padding: 20, paddingBottom: 40, gap: 12 },
  intro: { fontSize: 13, lineHeight: 20, color: colors.muted },
  errorText: { fontSize: 13, color: colors.danger },
  okText: { fontSize: 13, color: colors.primary },

  section: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 16,
    marginTop: 8,
  },
  sectionHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sectionHeadText: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  sectionHint: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  count: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.bgTint,
  },
  countFull: { backgroundColor: colors.dangerSoft },
  countText: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  countFullText: { color: colors.danger },
  example: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    padding: 12,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  list: { marginTop: 12, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
    gap: 4,
  },
  rowMain: { flex: 1 },
  rowLabel: { fontSize: 15, color: colors.ink },
  rowMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  rowActions: { flexDirection: "row", alignItems: "center" },
  moveBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  moveBtnDisabled: { opacity: 0.35 },
  chipBusy: { opacity: 0.5 },
  addRow: { marginTop: 12 },

  segmented: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 9,
  },
  segmentActive: { backgroundColor: colors.white },
  segmentLabel: { fontSize: 13, color: colors.muted },
  segmentLabelActive: { color: colors.primary, fontWeight: "600" },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: 13, color: colors.ink },
  chipLabelActive: { color: colors.white, fontWeight: "600" },

  form: { gap: 12, marginTop: 4 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
  },

  currentRow: {
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    padding: 12,
  },
  currentLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  currentMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },

  actions: { marginTop: 4 },

  deleteBlock: { marginTop: 20, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  deleteLink: { alignItems: "center", paddingVertical: 10 },
  deleteLinkText: { fontSize: 15, color: colors.danger, fontWeight: "500" },
  deleteConfirm: {
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
    padding: 14,
  },
  deleteConfirmText: { fontSize: 13, color: colors.danger },
  deleteConfirmActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  deleteConfirmBtn: { flex: 1 },
});
