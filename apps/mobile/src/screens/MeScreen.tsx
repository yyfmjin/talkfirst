import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth-context";
import { colors } from "../theme";

export function MeScreen() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  const place = [user.city, user.region, user.countryName ?? user.countryCode]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>我的</Text>
      </View>

      <View style={styles.card}>
        <Avatar uri={user.avatarUrl} nickname={user.nickname} size={72} />
        <Text style={styles.name}>{user.nickname ?? "TalkFirst 用户"}</Text>
        <Text style={styles.email}>{user.email}</Text>
        {place ? <Text style={styles.place}>🌎 {place}</Text> : null}
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{user.profileCompleted ? "资料已完善" : "资料待完善"}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="退出登录" onPress={() => void signOut()} variant="ghost" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: "600", color: colors.ink },
  card: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 24,
    backgroundColor: colors.bgSoft,
    alignItems: "center",
    padding: 24,
  },
  name: { fontSize: 20, fontWeight: "600", color: colors.ink, marginTop: 12 },
  email: { fontSize: 13, color: colors.muted, marginTop: 4 },
  place: { fontSize: 12, color: colors.muted, marginTop: 4 },
  bio: { fontSize: 13, color: colors.muted, lineHeight: 20, textAlign: "center", marginTop: 12 },
  badgeRow: { flexDirection: "row", marginTop: 16 },
  badge: { backgroundColor: colors.bgTint, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontSize: 11, color: colors.primary, fontWeight: "500" },
  actions: { paddingHorizontal: 20, marginTop: 24 },
});
