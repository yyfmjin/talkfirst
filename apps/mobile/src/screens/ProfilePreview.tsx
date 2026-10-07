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
import { Button } from "../components/Button";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { PublicProfile } from "../lib/types";
import { colors } from "../theme";

export function ProfilePreview({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [helloSending, setHelloSending] = useState(false);
  const [helloDone, setHelloDone] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    setHelloDone(false);
    try {
      const data = await apiFetch<PublicProfile>(`/users/${userId}`);
      setProfile(data);
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

  const showActions = profile && !profile.relationship.isSelf;
  const place = profile
    ? [profile.city, profile.region, profile.countryName ?? profile.countryCode].filter(Boolean).join(" · ")
    : "";

  return (
    <Modal visible={userId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t("profile.title")}</Text>
            <Pressable
              onPress={onClose}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
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
                <Avatar uri={profile.avatarUrl} nickname={profile.nickname} size={84} />
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

              {error ? <Text style={styles.inlineError}>{error}</Text> : null}

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
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  card: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "88%",
    padding: 24,
    paddingBottom: 40,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgTint,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: colors.primaryDark, fontSize: 14 },
  identity: { alignItems: "center", marginTop: 20 },
  name: { fontSize: 18, fontWeight: "600", color: colors.ink, marginTop: 12 },
  age: { fontSize: 13, fontWeight: "400", color: colors.muted },
  place: { fontSize: 12, color: colors.muted, marginTop: 4 },
  bio: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    backgroundColor: colors.bgSoft,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
  },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 11, fontWeight: "500", color: colors.muted, marginBottom: 8 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { backgroundColor: colors.bgTint, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  tagWarm: { backgroundColor: "#FFF4E5" },
  tagText: { fontSize: 11, color: colors.primaryDark },
  tagTextWarm: { color: "#B26A00" },
  tagSub: { fontSize: 10, opacity: 0.7 },
  inlineError: { color: colors.danger, fontSize: 12, textAlign: "center", marginTop: 12 },
  errorBox: { alignItems: "center", marginTop: 24 },
  errorText: { color: colors.danger, fontSize: 13, textAlign: "center", marginBottom: 12 },
  actions: { marginTop: 24 },
});
