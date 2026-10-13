import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { ConnectionItem } from "../lib/types";
import { colors } from "../theme";
import { ProfilePreview } from "./ProfilePreview";
import { UserMomentsScreen } from "./UserMomentsScreen";

/**
 * 我的连接 —— 对齐 web 的 `/connections`（apps/web/src/app/connections/page.tsx）。
 *
 * `GET /connections` 返回一列已建立的连接（含对方资料与交换状态）。
 * 点头像/名字弹出移动端的 `ProfilePreview`，与 web 的 ProfilePreviewCard 同一个动作。
 *
 * ## 与 web 的差别
 *
 * web 行内有一条「查看交换」链接，跳到 `/messages/:conversationId/connect`；
 * 移动端没有路由库、tab 之间也没有深链，这条链接先不画 —— 交换状态（已交换/
 * 待处理/隐藏）本身已经在行内的状态条里，信息没有丢。
 */
export function ConnectionsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ConnectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  /* 「查看动态」开在资料卡之上：先把资料卡关掉再开它（不叠两层 Modal）。 */
  const [momentsUserId, setMomentsUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ConnectionItem[]>("/connections");
      setItems(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("connections.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.root}>
      <SubHeader title={t("connections.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t("connections.intro")}</Text>

        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.primary} />
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label={t("common.retry")} onPress={() => void load()} variant="ghost" />
          </View>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Icon name="people-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyTitle}>{t("connections.emptyTitle")}</Text>
            <Text style={styles.emptyBody}>{t("connections.emptyBody")}</Text>
          </View>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <View style={styles.list}>
            {items.map((item) => (
              <View key={item.id} style={styles.row}>
                <Pressable
                  onPress={() => setPreviewUserId(item.peer.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t("connections.viewProfile", {
                    name: item.peer.nickname ?? t("common.talkfirstUser"),
                  })}
                  style={styles.rowHead}
                >
                  <Avatar uri={item.peer.avatarUrl} nickname={item.peer.nickname} size={44} />
                  <View style={styles.rowHeadText}>
                    <Text style={styles.name}>{item.peer.nickname ?? t("common.talkfirstUser")}</Text>
                    <Text style={styles.meta}>
                      {t("connections.meta", {
                        country: item.peer.countryCode ?? t("common.global"),
                        date: new Date(item.createdAt).toLocaleDateString(),
                      })}
                    </Text>
                  </View>
                </Pressable>

                {item.peer.bio ? (
                  <Text style={styles.bio} numberOfLines={2}>
                    {item.peer.bio}
                  </Text>
                ) : null}

                {item.peer.interests.length > 0 ? (
                  <View style={styles.tagWrap}>
                    {item.peer.interests.slice(0, 4).map((interest) => (
                      <View key={interest.slug} style={styles.tag}>
                        <Text style={styles.tagText}>{interest.nameZh ?? interest.name}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.exchangeStrip}>
                  <ExchangeState item={item} />
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ProfilePreview
        userId={previewUserId}
        onClose={() => setPreviewUserId(null)}
        onOpenMoments={(id) => {
          setPreviewUserId(null);
          setMomentsUserId(id);
        }}
      />
      <UserMomentsScreen userId={momentsUserId} onClose={() => setMomentsUserId(null)} />
    </View>
  );
}

/**
 * 交换状态条：三个固定状态（与 web 同一组文案）。
 * 图标与颜色区分状态，同时状态词也写在文字里 —— 不靠颜色单独承载信息。
 */
function ExchangeState({ item }: { item: ConnectionItem }) {
  const { t } = useI18n();
  const status = item.exchange?.status;
  if (status === "ACCEPTED") {
    return (
      <>
        <Icon name="checkmark-circle" size={15} color={colors.success} />
        <Text style={styles.exchangeText}>
          {t("connections.exchangeDone", { platforms: item.exchange?.platforms.join("、") ?? "" })}
        </Text>
      </>
    );
  }
  if (status === "PENDING") {
    return (
      <>
        <Icon name="link-outline" size={15} color={colors.primary} />
        <Text style={styles.exchangeText}>{t("connections.exchangePending")}</Text>
      </>
    );
  }
  return (
    <>
      <Icon name="lock-closed-outline" size={15} color={colors.muted} />
      <Text style={styles.exchangeText}>{t("connections.exchangeHidden")}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  intro: { fontSize: 12, lineHeight: 18, color: colors.muted },
  center: { marginTop: 28 },
  errorBox: { alignItems: "center", marginTop: 24, gap: 10 },
  errorText: { fontSize: 13, color: colors.danger, textAlign: "center" },
  emptyBox: { alignItems: "center", marginTop: 36, gap: 8, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  emptyBody: { fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: "center" },
  list: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  row: { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 10 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowHeadText: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  bio: { fontSize: 12, lineHeight: 18, color: colors.muted },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    backgroundColor: colors.bgTint,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontSize: 11, color: colors.primaryDark },
  exchangeStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bgSoft,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  exchangeText: { flex: 1, fontSize: 12, color: colors.muted },
});
