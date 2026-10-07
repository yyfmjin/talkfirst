import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/lib/auth-context";
import { AuthScreen } from "./src/screens/AuthScreen";
import { DiscoverScreen } from "./src/screens/DiscoverScreen";
import { MeScreen } from "./src/screens/MeScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { colors } from "./src/theme";

type Tab = "discover" | "notifications" | "me";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "discover", label: "发现", icon: "🧭" },
  { id: "notifications", label: "通知", icon: "🔔" },
  { id: "me", label: "我的", icon: "👤" },
];

function Root() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("discover");

  if (loading) {
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="dark" />
        <View style={styles.body}>
          {tab === "discover" ? <DiscoverScreen /> : null}
          {tab === "notifications" ? <NotificationsScreen /> : null}
          {tab === "me" ? <MeScreen /> : null}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                style={styles.tabItem}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.tabIcon}>{item.icon}</Text>
                <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                  {item.label}
                </Text>
                {active ? <View style={styles.tabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
    paddingBottom: 8,
  },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 56, paddingTop: 8 },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  tabLabelActive: { color: colors.primary, fontWeight: "600" },
  tabIndicator: {
    position: "absolute",
    top: 0,
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});
