import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider, useAuth } from "./src/lib/auth-context";
import { AuthScreen } from "./src/screens/AuthScreen";
import { DiscoverScreen } from "./src/screens/DiscoverScreen";
import { MeScreen } from "./src/screens/MeScreen";
import { MessagesScreen } from "./src/screens/MessagesScreen";
import { MomentsScreen } from "./src/screens/MomentsScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { VideosScreen } from "./src/screens/VideosScreen";
import { colors } from "./src/theme";

/**
 * 底部导航。
 *
 * ## 为什么仍然是自研的
 *
 * 这个 app 从第一天就没有 router / react-navigation（依赖表里也没有）。
 * 五个 tab 的切换用状态足够，而引入导航库会拖进一整套原生依赖与深链配置 ——
 * 那不是这次要解决的问题。什么时候该换：需要**深链**（通知点进来直达某个会话）、
 * 需要返回手势栈、或者 tab 数量/层级再涨一层时。
 *
 * ## 为什么把 emoji 换成 Ionicons
 *
 * 原先的 tab 图标是 🧭 🔔 👤：emoji 在不同系统上字形、颜色、基线都不一样
 * （同一个「指南针」在 Android 与 iOS 上画出来不是一个东西），而且读屏会把它
 * 念成「指南针」这种与功能无关的词。`@expo/vector-icons` 随 expo 自带，
 * 不需要新增依赖。
 *
 * ## 视频流为什么不是一个 tab
 *
 * 它是**从一个视频进去**的上下文（点动态里的视频 → 全屏沉浸、上下滑切换），
 * 与 FB/IG 的路径一致；同时在动态顶部给一个入口保证可发现性。
 * 这样底部保持五个 tab，也避免「视频」与「动态」两个 tab 内容高度重叠。
 */
type Tab = "discover" | "moments" | "messages" | "notifications" | "me";

type TabSpec = {
  id: Tab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const TABS: TabSpec[] = [
  { id: "discover", label: "发现", icon: "compass-outline", iconActive: "compass" },
  { id: "moments", label: "动态", icon: "albums-outline", iconActive: "albums" },
  { id: "messages", label: "消息", icon: "chatbubble-outline", iconActive: "chatbubble" },
  { id: "notifications", label: "通知", icon: "notifications-outline", iconActive: "notifications" },
  { id: "me", label: "我的", icon: "person-outline", iconActive: "person" },
];

function Root() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("moments");
  /**
   * 视频流是覆盖层，不是 tab：`startId` 来自「点的是哪条视频」。
   * 关闭时它整个卸载 —— 这样视频播放器不会在后台继续解码。
   */
  const [videosOpen, setVideosOpen] = useState(false);
  const [videoStartId, setVideoStartId] = useState<string | null>(null);

  const openVideos = useCallback((momentId?: string) => {
    setVideoStartId(momentId ?? null);
    setVideosOpen(true);
  }, []);
  const closeVideos = useCallback(() => setVideosOpen(false), []);

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

  if (videosOpen) {
    return (
      <SafeAreaProvider>
        {/* 全屏视频：状态栏文字必须是浅色，否则在画面上看不见。 */}
        <StatusBar style="light" />
        <VideosScreen startId={videoStartId ?? undefined} onClose={closeVideos} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="dark" />
        <View style={styles.body}>
          {tab === "discover" ? <DiscoverScreen /> : null}
          {tab === "moments" ? <MomentsScreen onOpenVideo={openVideos} /> : null}
          {tab === "messages" ? <MessagesScreen /> : null}
          {tab === "notifications" ? <NotificationsScreen /> : null}
          {tab === "me" ? <MeScreen /> : null}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((item) => {
            const active = tab === item.id;
            const tint = active ? colors.primary : colors.muted;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                style={styles.tabItem}
                accessibilityRole="button"
                /* 读屏用：`selected` 让「当前在哪一页」可被朗读，
                   而不是只靠颜色（颜色不应当独自承载状态）。 */
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
              >
                <Ionicons
                  name={active ? item.iconActive : item.icon}
                  size={22}
                  color={tint}
                  /* 图标是装饰：名字已由 accessibilityLabel 给出，
                     否则读屏会念一遍图标名、再念一遍标签。 */
                  accessible={false}
                />
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
