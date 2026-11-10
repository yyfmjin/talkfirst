import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { useBackHandler } from "../lib/back-stack";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { ProfilePreview } from "./ProfilePreview";
import { colors, themed } from "../theme";
import { radii, sizes } from "../design/tokens";

type FriendGroup = { id: string; name: string; kind: string; sortOrder: number };
type FriendKind = "FRIEND" | "LOVER" | "PARTNER" | "FAMILY";
type Friend = {
  id: string;
  conversationId: string | null;
  createdAt: string;
  tag: { kind: string; groupId: string | null } | null;
  peer: { id: string; nickname: string | null; avatarUrl: string | null; bio: string | null };
};

const KINDS: FriendKind[] = ["FRIEND", "LOVER", "PARTNER", "FAMILY"];

/**
 * 我的好友（2026-11-10）。
 *
 * ## 为什么单独一屏、而不是继续塞进「我的」
 *
 * 好友是高频入口：改分组、看资料、去聊天都从这里进。「我的」是设置区，
 * 把好友列表放进去，等于每次都要先点「我」再点「好友」两步。消息 tab 的
 * 右上角一个图标直达，符合"和谁说话去哪找人"的直觉。
 *
 * ## 分组规则
 *
 * 每个用户自己一套分组（服务端 FriendGroup），同一条好友关系两个人可以分到
 * 不同组。内置「朋友 / 恋人 / 合作」；用户可以在右上角新建自定义分组。
 * 删分组不会删好友 —— 组里的好友回到「未分组」，这一点在确认框里写清楚。
 */
export function FriendsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const KIND_LABEL: Record<FriendKind, string> = {
    FRIEND: t("friends.kind.FRIEND"),
    LOVER: t("friends.kind.LOVER"),
    PARTNER: t("friends.kind.PARTNER"),
    FAMILY: t("friends.kind.FAMILY"),
  };
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** 当前筛的组：all / none（未分组）/ 具体 groupId。 */
  const [filter, setFilter] = useState<string>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** 长按后选中的好友（用于改分组 / 删好友的面板）。 */
  const [actionFor, setActionFor] = useState<Friend | null>(null);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);

  useBackHandler(previewId === null && actionFor === null && !creating, onBack);

  const load = useCallback(async () => {
    setError("");
    try {
      const [friendList, groupList] = await Promise.all([
        apiFetch<Friend[]>("/connections"),
        apiFetch<FriendGroup[]>("/connections/groups"),
      ]);
      setFriends(friendList);
      setGroups(groupList);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("friends.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupName = useCallback(
    (id: string | null) => groups.find((group) => group.id === id)?.name ?? t("friends.ungrouped"),
    [groups, t],
  );

  const visible = useMemo(() => {
    if (filter === "all") return friends;
    if (filter === "none") return friends.filter((friend) => !friend.tag?.groupId);
    return friends.filter((friend) => friend.tag?.groupId === filter);
  }, [filter, friends]);

  const countFor = (groupId: string) =>
    friends.filter((friend) => friend.tag?.groupId === groupId).length;

  async function tagFriend(friend: Friend, patch: { kind?: string; groupId?: string | null }) {
    setSaving(true);
    try {
      await apiFetch(`/connections/${friend.id}/tag`, {
        method: "PUT",
        body: JSON.stringify({
          kind: patch.kind ?? friend.tag?.kind ?? "FRIEND",
          groupId: patch.groupId === undefined ? friend.tag?.groupId ?? null : patch.groupId,
        }),
      });
      setActionFor(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("friends.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function removeFriend(friend: Friend) {
    Alert.alert(
      t("friends.removeTitle"),
      t("friends.removeBody", { name: friend.peer.nickname ?? t("common.talkfirstUser") }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("friends.removeConfirm"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await apiFetch(`/connections/${friend.id}`, { method: "DELETE" });
                setActionFor(null);
                await load();
              } catch (requestError) {
                setError(
                  requestError instanceof Error ? requestError.message : t("friends.removeFailed"),
                );
              }
            })();
          },
        },
      ],
    );
  }

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await apiFetch("/connections/groups", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCreating(false);
      setNewGroupName("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("friends.groupFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("friends.title")} onBack={onBack} />
      {/* 新建分组：顶部栏不接右侧元素，放在筛选条右端。 */}
      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        accessibilityLabel={t("friends.newGroup")}
        hitSlop={10}
        style={styles.newGroupButton}
      >
        <Icon name="add" size={16} color={colors.primary} />
        <Text style={styles.newGroupLabel}>{t("friends.newGroup")}</Text>
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {[
          { id: "all", label: t("friends.all"), count: friends.length },
          ...groups.map((group) => ({ id: group.id, label: group.name, count: countFor(group.id) })),
          { id: "none", label: t("friends.ungrouped"), count: friends.filter((f) => !f.tag?.groupId).length },
        ].map((tab) => {
          const active = filter === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setFilter(tab.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active ? styles.tabActive : null]}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                {tab.label}
                {tab.count > 0 ? ` ${tab.count}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {visible.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="people-outline" size={28} color={colors.muted} />
              <Text style={styles.emptyText}>
                {filter === "all" ? t("friends.empty") : t("friends.emptyGroup")}
              </Text>
            </View>
          ) : (
            visible.map((friend) => (
              <Pressable
                key={friend.id}
                onPress={() => setPreviewId(friend.peer.id)}
                onLongPress={() => setActionFor(friend)}
                delayLongPress={380}
                accessibilityRole="button"
                accessibilityLabel={friend.peer.nickname ?? t("common.talkfirstUser")}
                style={styles.row}
              >
                <Avatar uri={friend.peer.avatarUrl} nickname={friend.peer.nickname} size={46} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {friend.peer.nickname ?? t("common.talkfirstUser")}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {KIND_LABEL[(friend.tag?.kind ?? "FRIEND") as FriendKind]} · {groupName(friend.tag?.groupId ?? null)}
                  </Text>
                </View>
                <Icon name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      {/* 长按：改分组 / 删好友 */}
      <Modal visible={actionFor !== null} transparent animationType="slide" onRequestClose={() => setActionFor(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionFor(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{actionFor?.peer.nickname ?? t("friends.title")}</Text>
            <Text style={styles.sheetHint}>{t("friends.moveTo")}</Text>
            <View style={styles.sheetGroups}>
              {groups.map((group) => {
                const active = actionFor?.tag?.groupId === group.id;
                return (
                  <Pressable
                    key={group.id}
                    onPress={() => actionFor && void tagFriend(actionFor, { groupId: group.id })}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.sheetGroup, active ? styles.sheetGroupActive : null]}
                  >
                    <Text style={[styles.sheetGroupLabel, active ? styles.sheetGroupLabelActive : null]}>
                      {group.name}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => actionFor && void tagFriend(actionFor, { groupId: null })}
                disabled={saving}
                accessibilityRole="button"
                style={styles.sheetGroup}
              >
                <Text style={styles.sheetGroupLabel}>{t("friends.ungrouped")}</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => actionFor && removeFriend(actionFor)}
              disabled={saving}
              accessibilityRole="button"
              style={styles.sheetRemove}
            >
              <Text style={styles.sheetRemoveLabel}>{t("friends.remove")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 新建分组 */}
      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t("friends.newGroup")}</Text>
            <TextInput
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder={t("friends.groupNamePlaceholder")}
              placeholderTextColor={colors.muted}
              maxLength={24}
              style={styles.dialogInput}
              accessibilityLabel={t("friends.groupNamePlaceholder")}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setCreating(false)} accessibilityRole="button" style={styles.dialogCancel}>
                <Text style={styles.dialogCancelLabel}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => void createGroup()}
                disabled={!newGroupName.trim() || saving}
                accessibilityRole="button"
                style={[styles.dialogConfirm, !newGroupName.trim() ? styles.disabled : null]}
              >
                <Text style={styles.dialogConfirmLabel}>{t("common.save")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ProfilePreview userId={previewId} onClose={() => setPreviewId(null)} />
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  newGroupButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 4,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  newGroupLabel: { fontSize: sizes.caption, color: c.primary, fontWeight: "500" },
  root: { flex: 1, backgroundColor: c.bg },
  headerAction: {
    width: 32,
    height: 32,
    borderRadius: radii.control,
    backgroundColor: c.bgTint,
    alignItems: "center",
    justifyContent: "center",
  },
  tabs: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" },
  tab: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
    justifyContent: "center",
  },
  tabActive: { backgroundColor: c.primary, borderColor: c.primary },
  tabLabel: { fontSize: sizes.ui, color: c.ink },
  tabLabelActive: { color: c.white, fontWeight: "600" },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radii.control,
    backgroundColor: c.bgSolid,
    borderWidth: 1,
    borderColor: c.line,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  rowMeta: { fontSize: sizes.caption, color: c.muted },
  empty: { alignItems: "center", gap: 8, paddingVertical: 56 },
  emptyText: { fontSize: sizes.ui, color: c.muted },
  error: { fontSize: sizes.caption, color: c.danger, marginBottom: 6 },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,14,22,0.5)" },
  sheet: {
    backgroundColor: c.bgSolid,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  sheetTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  sheetHint: { fontSize: sizes.caption, color: c.muted, marginBottom: 4 },
  sheetGroups: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sheetGroup: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.bgSoft,
    justifyContent: "center",
  },
  sheetGroupActive: { backgroundColor: c.primary, borderColor: c.primary },
  sheetGroupLabel: { fontSize: sizes.ui, color: c.ink },
  sheetGroupLabelActive: { color: c.white, fontWeight: "600" },
  sheetRemove: { marginTop: 12, height: 44, justifyContent: "center", alignItems: "center" },
  sheetRemoveLabel: { fontSize: sizes.body, color: c.danger, fontWeight: "600" },
  dialogBackdrop: { flex: 1, backgroundColor: "rgba(10,14,22,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", borderRadius: radii.card, backgroundColor: c.bgSolid, padding: 20, gap: 12 },
  dialogTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  dialogInput: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.control,
    backgroundColor: c.bgSoft,
    paddingHorizontal: 12,
    height: 44,
    color: c.ink,
    fontSize: sizes.body,
  },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  dialogCancel: { paddingHorizontal: 14, height: 40, justifyContent: "center" },
  dialogCancelLabel: { fontSize: sizes.ui, color: c.muted },
  dialogConfirm: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: radii.control,
    backgroundColor: c.primary,
    justifyContent: "center",
  },
  dialogConfirmLabel: { fontSize: sizes.ui, color: c.white, fontWeight: "600" },
  disabled: { opacity: 0.5 },
}));
