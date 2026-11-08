import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { AvatarViewer } from "../components/AvatarViewer";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { ModalScrim } from "../components/ModalScrim";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { PublicProfile } from "../lib/types";
import { colors, themed } from "../theme";

import { radii, sizes } from "../design/tokens";
export function ProfilePreview({
  userId,
  onClose,
  onOpenMoments,
}: {
  userId: string | null;
  onClose: () => void;
  /**
   * 「查看动态」——对齐 web `/profile/[id]` 上那个按钮（它指向 `/moments/user/[id]`）。
   *
   * 做成可选：这张资料卡在三个页面里共用（发现 / 我的连接 / 动态详情），而
   * 「某人的动态」那一屏要由各自的父级决定开在哪一层。不传就不显示这个按钮 ——
   * 宁可少一个入口，也不要一个点下去没反应的按钮。
   */
  onOpenMoments?: (userId: string) => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [helloSending, setHelloSending] = useState(false);
  const [helloDone, setHelloDone] = useState(false);
  /* 送花：与 web 同一个 toggle 接口，朵数以**响应**为准（同一对只有一条花）。 */
  const [flowerSent, setFlowerSent] = useState(false);
  const [flowerCount, setFlowerCount] = useState(0);
  const [flowerSending, setFlowerSending] = useState(false);
  /** 点头像看大图。别人的只有查看，自己的（isSelf）调用方可以再给「更换头像」。 */
  const [avatarOpen, setAvatarOpen] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    setHelloDone(false);
    try {
      const data = await apiFetch<PublicProfile>(`/users/${userId}`);
      setProfile(data);
      setFlowerSent(data.flowerFromViewer ?? false);
      setFlowerCount(data.flowerCount ?? 0);
    } catch (requestError) {
      setProfile(null);
      setError(requestError instanceof Error ? requestError.message : t("profile.errorLoading"));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    if (userId) {
      setProfile(null);
      void load();
    }
  }, [userId, load]);

  async function sayHello() {
    if (!profile || helloSending) return;
    setHelloSending(true);
    setError("");
    try {
      await apiFetch("/connections/requests", {
        method: "POST",
        body: { receiverId: profile.id, templateId: "language" },
      });
      setHelloDone(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("profile.errorSend"));
    } finally {
      setHelloSending(false);
    }
  }

  async function toggleFlower() {
    if (!profile || flowerSending) return;
    setFlowerSending(true);
    setError("");
    try {
      const result = await apiFetch<{ sent: boolean; flowerCount: number }>(
        `/users/${profile.id}/flowers`,
        { method: "POST" },
      );
      setFlowerSent(result.sent);
      setFlowerCount(result.flowerCount);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("profile.flowerFailed"));
    } finally {
      setFlowerSending(false);
    }
  }

  const showActions = profile && !profile.relationship.isSelf;
  const place = profile
    ? [profile.city, profile.region, profile.countryName ?? profile.countryCode].filter(Boolean).join(" · ")
    : "";

  return (
    <Modal visible={userId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ModalScrim />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t("profile.title")}</Text>
            <Pressable
              onPress={onClose}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
                hitSlop={10}
              >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
          ) : error && !profile ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Button label={t("common.retry")} onPress={() => void load()} variant="ghost" />
            </View>
          ) : profile ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.identity}>
                <Pressable
                  onPress={() => setAvatarOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t("profile.openAvatar")}
                  hitSlop={6}
                >
                  <Avatar uri={profile.avatarUrl} nickname={profile.nickname} size={84} />
                </Pressable>
                <Text style={styles.name}>
                  {profile.nickname ?? t("common.talkfirstUser")}
                  {profile.age !== null ? (
                    <Text style={styles.age}>{t("profile.age", { n: profile.age })}</Text>
                  ) : null}
                </Text>
                {place ? <Text style={styles.place}>🌎 {place}</Text> : null}
              </View>

              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

              <TagSection title={t("profile.sectionLanguages")}>
                {profile.languages.map((lang) => (
                  <Tag key={`${lang.code}-${lang.type}`}>
                    {lang.nativeName ?? lang.name}
                    <Text style={styles.tagSub}>
                      {lang.type === "NATIVE" ? t("profile.languageNative") : t("profile.languageLearning")}
                    </Text>
                  </Tag>
                ))}
              </TagSection>

              <TagSection title={t("profile.sectionInterests")}>
                {profile.interests.map((interest) => (
                  <Tag key={interest.slug}>{interest.nameZh ?? interest.name}</Tag>
                ))}
              </TagSection>

              <TagSection title={t("profile.sectionPurposes")}>
                {profile.purposes.map((purpose) => (
                  <Tag key={purpose.slug} tone="warm">
                    {purpose.nameZh ?? purpose.name}
                  </Tag>
                ))}
              </TagSection>

              {/*
                个人动态入口做成**一行**，而不是按钮。
                按钮混在「打招呼 / 送花」里会被当成第三个社交动作；
                这里是「去他的主页看看」，读起来是一行导航。
                对方关掉这个入口时（momentsVisible === false）整行不出现 ——
                自己看自己服务端永远给 true，所以不会连自己都找不到。
              */}
              {onOpenMoments && profile.momentsVisible !== false ? (
                <Pressable
                  onPress={() => onOpenMoments(profile.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t("profile.myMoments")}
                  style={styles.momentsRow}
                >
                  <View style={styles.momentsRowIcon}>
                    <Icon name="images-outline" size={16} color={colors.primary} />
                  </View>
                  <Text style={styles.momentsRowLabel}>{t("profile.myMoments")}</Text>
                  <Icon name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              ) : null}

              {error ? <Text style={styles.inlineError}>{error}</Text> : null}

              {/*
                web 上「查看动态」与「打招呼」是并排的两个按钮。移动端竖向叠：
                屏幕窄，两个并排的中文按钮会各自只剩一半宽度，读起来都不舒服。
              */}
              {showActions ? (
                <View style={styles.actions}>
                  {profile.relationship.isConnected ? (
                    <Button label={t("profile.connected")} onPress={() => undefined} disabled variant="ghost" />
                  ) : (
                    <Button
                      label={
                        helloDone
                          ? t("profile.helloDone")
                          : helloSending
                            ? t("profile.helloSending")
                            : t("profile.hello")
                      }
                      onPress={() => void sayHello()}
                      loading={helloSending}
                      disabled={helloDone}
                    />
                  )}
                  <Button
                    label={
                      flowerSent
                        ? `${t("profile.flowerSent")}${flowerCount > 0 ? ` · ${t("profile.flowersCount", { n: flowerCount })}` : ""}`
                        : `${t("profile.flower")}${flowerCount > 0 ? ` · ${t("profile.flowersCount", { n: flowerCount })}` : ""}`
                    }
                    variant="ghost"
                    onPress={() => void toggleFlower()}
                    loading={flowerSending}
                  />
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>

      {profile ? (
        <AvatarViewer
          visible={avatarOpen}
          uri={profile.avatarUrl}
          nickname={profile.nickname}
          onClose={() => setAvatarOpen(false)}
        />
      ) : null}
    </Modal>
  );
}

function TagSection({ title, children }: { title: string; children: ReactNode }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.tagWrap}>{children}</View>
    </View>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: "warm" }) {
  return (
    <View style={[styles.tag, tone === "warm" ? styles.tagWarm : null]}>
      <Text style={[styles.tagText, tone === "warm" ? styles.tagTextWarm : null]}>{children}</Text>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  backdrop: {
    flex: 1,
    /* 遮罩的观感交给 <ModalScrim />（虚化 + 压暗）。 */
    justifyContent: "flex-end",
  },
  card: {
    /* 实底（2026-11-07）：原来是 glassRaised，背后的人像/卡片会透进弹层。 */
    backgroundColor: c.bgSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "88%",
    padding: 24,
    paddingBottom: 40,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  close: {
    width: 32,
    height: 32,
    borderRadius: radii.control,
    backgroundColor: c.bgTint,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: c.primaryDark, fontSize: sizes.ui },
  identity: { alignItems: "center", marginTop: 20 },
  name: { fontSize: sizes.heading, fontWeight: "600", color: c.ink, marginTop: 12 },
  age: { fontSize: sizes.ui, fontWeight: "400", color: c.muted },
  place: { fontSize: sizes.caption, color: c.muted, marginTop: 4 },
  bio: {
    fontSize: sizes.ui,
    lineHeight: 20,
    color: c.muted,
    backgroundColor: c.bgSoft,
    borderRadius: radii.chip,
    padding: 12,
    marginTop: 16,
  },
  /*
   * 个人动态：一行导航，不是按钮。
   * 视觉与 Me 页的分组行一致（左侧浅底图标 + 文字 + 右侧箭头），
   * 让「资料卡」和「我的」两处点起来手感相同。
   */
  momentsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.control,
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
  },
  momentsRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.bgTint,
    alignItems: "center",
    justifyContent: "center",
  },
  momentsRowLabel: { flex: 1, fontSize: sizes.body, fontWeight: "500", color: c.ink },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: sizes.overline, fontWeight: "500", color: c.muted, marginBottom: 8 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { backgroundColor: c.bgTint, borderRadius: radii.control, paddingHorizontal: 12, paddingVertical: 6 },
  tagWarm: { backgroundColor: "#FFF4E5" },
  tagText: { fontSize: sizes.overline, color: c.primaryDark },
  tagTextWarm: { color: "#B26A00" },
  tagSub: { fontSize: 10, opacity: 0.7 },
  inlineError: { color: c.danger, fontSize: sizes.caption, textAlign: "center", marginTop: 12 },
  errorBox: { alignItems: "center", marginTop: 24 },
  errorText: { color: c.danger, fontSize: sizes.ui, textAlign: "center", marginBottom: 12 },
  actions: { marginTop: 24, gap: 8 },
}));
