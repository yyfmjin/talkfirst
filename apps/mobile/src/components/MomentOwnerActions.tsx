import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { ComposeScreen } from "../screens/ComposeScreen";
import { colors } from "../theme";
import { Icon } from "./Icon";

/**
 * 「自己发的动态」的管理入口：编辑 / 删除。
 *
 * ## 为什么做成一个组件
 *
 * 同一个动作要在三个地方出现（信息流卡片、某人的动态列表、动态详情页），
 * 各写一遍的结果是「有的地方能删、有的地方不能」。这里收口：判定、确认弹窗、
 * 请求、编辑页都在内部。
 *
 * ## 两种形态
 *
 * - `menu`（默认）：卡片角上一个「⋯」，点开系统 ActionSheet（信息流里空间宝贵）。
 * - `row`：详情页里两个带文字的按钮（那里是用户认真看一条动态的地方，说得明白点）。
 *
 * ## 编辑走的是同一个发布页
 *
 * `ComposeScreen` 传 `editMoment` 就变成编辑态（同一套选图/上传/门禁）。
 * 保存成功后**重新拉一次这条动态**再回调 —— 服务端是唯一真相（它可能改了标签、
 * 媒体处理结果），与仓库里其它「以服务端返回为准」的地方一致。
 */

/** 只有管理自己动态真正需要的字段：这样列表项（没有嵌套 author）也能直接用。 */
export type ManageableMoment = {
  id: string;
  userId: string;
  content: string;
  images: string[];
  videoUrl: string | null;
  durationSec: number | null;
};

export function MomentOwnerActions({
  moment,
  variant = "menu",
  onEdited,
  onDeleted,
}: {
  moment: ManageableMoment;
  variant?: "menu" | "row";
  /** 保存成功后回调（带服务端重新拉回来的那一条）。 */
  onEdited: (updated: ManageableMoment) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/moments/${moment.id}`, { method: "DELETE" });
      onDeleted();
    } catch (error) {
      Alert.alert(
        t("moments.deleteFailed"),
        error instanceof Error ? error.message : "",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(t("moments.deleteTitle"), t("moments.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("moments.delete"), style: "destructive", onPress: () => void remove() },
    ]);
  }

  /** 保存成功：重新拉一次（标签、媒体可能被服务端改过），拿不到就用原值。 */
  async function reloadAfterEdit() {
    setEditing(false);
    try {
      const updated = await apiFetch<ManageableMoment>(`/moments/${moment.id}`);
      onEdited(updated);
    } catch {
      onEdited(moment);
    }
  }

  /* 编辑态直接接管整屏：它自带取消与保存，不需要再叠一层。 */
  if (editing) {
    return (
      <ComposeScreen
        editMoment={moment}
        onCancel={() => setEditing(false)}
        onPublished={() => void reloadAfterEdit()}
      />
    );
  }

  if (variant === "row") {
    return (
      <View style={styles.row}>
        <Pressable
          onPress={() => setEditing(true)}
          accessibilityRole="button"
          accessibilityLabel={t("moments.edit")}
          style={styles.rowButton}
        >
          <Icon name="create-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.rowLabel}>{t("moments.edit")}</Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("moments.delete")}
          style={[styles.rowButton, styles.rowButtonDanger]}
        >
          <Icon name="trash-outline" size={16} color={colors.danger} />
          <Text style={[styles.rowLabel, styles.rowLabelDanger]}>{t("moments.delete")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() =>
        Alert.alert(t("moments.manage"), undefined, [
          { text: t("moments.edit"), onPress: () => setEditing(true) },
          { text: t("moments.delete"), style: "destructive", onPress: confirmDelete },
          { text: t("common.cancel"), style: "cancel" },
        ])
      }
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={t("moments.manage")}
      hitSlop={10}
      style={styles.menuButton}
    >
      <Icon name="ellipsis-horizontal" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menuButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  rowButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.bgTint,
  },
  rowButtonDanger: { backgroundColor: colors.dangerSoft },
  rowLabel: { fontSize: 13, fontWeight: "600", color: colors.primaryDark },
  rowLabelDanger: { color: colors.danger },
});
