import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { Icon } from "./src/components/Icon";
import { AuthProvider, useAuth } from "./src/lib/auth-context";
import { ErrorBoundary } from "./src/components/error-boundary";
import { I18nProvider, useI18n } from "./src/lib/i18n-context";
import type { MsgKey } from "./src/lib/messages";
import { AuthScreen } from "./src/screens/AuthScreen";
import { DiscoverScreen } from "./src/screens/DiscoverScreen";
import { MeScreen } from "./src/screens/MeScreen";
import { MessagesScreen } from "./src/screens/MessagesScreen";
import { MomentsScreen } from "./src/screens/MomentsScreen";
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
 * ## 视频流（已实现，但当前未接入）
 *
 * 全屏视频流（点动态里的视频进去、上下滑切换）在 web 端已经上线；移动端
 * 这版暂时没挂上去：它要 `expo-av` / `expo-video`，两者都是原生依赖，
 * 而现在这台机器上还没有 Android 工具链（无 JDK / SDK / gradle），加完依赖
 * 也无法重新出一版构建来验证 —— 先不引入，避免包变重却无法验证。
 * 构建链路通了之后：把 `VideosScreen` 加回来（它在提交 ce4015f 里），
 * 并在动态顶部挂回「看视频」入口。
 *
 * ## 语言
 *
 * tab 标签存的是**词典键**（`tab.discover` 之类），不是中文串 —— 标签在渲染时
 * 才翻译，所以用户在「我的」里改语言，底部导航会跟着变。
 * ## 通知去哪了
 *
 * 2026-10-08 运营方反馈：「通知界面跟消息界面有点重合，合并到一起」。确实 —— 消息是
 * 「人跟人的往来」、通知是「系统告诉你的动静」，分开两个 tab 对使用的人没有意义。
 * 现在它们是**消息页里的两个分段**（会话 / 通知），tab 从 5 个减到 4 个。
 */
type Tab = "discover" | "moments" | "messages" | "me";

type TabSpec = {
  id: Tab;
  labelKey: MsgKey;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const TABS: TabSpec[] = [
  { id: "discover", labelKey: "tab.discover", icon: "compass-outline", iconActive: "compass" },
  { id: "moments", labelKey: "tab.moments", icon: "albums-outline", iconActive: "albums" },
  { id: "messages", labelKey: "tab.messages", icon: "chatbubble-outline", iconActive: "chatbubble" },
  { id: "me", labelKey: "tab.me", icon: "person-outline", iconActive: "person" },
];

/** 启动/加载态的占位屏（字体未就绪、恢复会话时用同一屏）。 */
function Loading() {
  return (
    <View style={styles.splash}>
      <StatusBar style="dark" />
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

function Root() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("moments");

  if (loading) {
    return <Loading />;
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
        {/*
         * 每个 tab 各自一层错误边界：某一页渲染崩了，只挡住**那一页**，
         * 底部导航还能用、能切到别的页面继续。
         *
         * 2026-10-08：主界面一崩，顶层边界把整屏换成了错误页，用户连「换个 tab 试试」
         * 都做不到，也看不出是哪一页的问题。
         */}
        {/*
         * 顶部安全区交给 SafeAreaView（而不是各页自己写死 paddingTop: 56）：
         * 2026-10-08 运营方反馈「顶部把手机自带的时钟挡住了」—— 写死的 56px 在
         * 刘海/挖孔屏上不够，而每台机器的状态栏高度并不一样。这里统一按真实
         * 安全区留白，各页自己的那个写死值一并降下来。
         */}
        <SafeAreaView style={styles.body} edges={["top"]}>
          {tab === "discover" ? (
            <ErrorBoundary>
              <DiscoverScreen />
            </ErrorBoundary>
          ) : null}
          {tab === "moments" ? (
            <ErrorBoundary>
              <MomentsScreen />
            </ErrorBoundary>
          ) : null}
          {tab === "messages" ? (
            <ErrorBoundary>
              <MessagesScreen />
            </ErrorBoundary>
          ) : null}
          {tab === "me" ? (
            <ErrorBoundary>
              <MeScreen />
            </ErrorBoundary>
          ) : null}
        </SafeAreaView>
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
                accessibilityLabel={t(item.labelKey)}
              >
                <Icon name={active ? item.iconActive : item.icon} size={22} color={tint} />
                <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                  {t(item.labelKey)}
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
  /*
   * 图标字体：**只加载，不阻塞渲染**。
   *
   * 2026-10-08 运营方看到发布按钮「只有一个蓝色圆点」—— 根因是 `@expo/vector-icons`
   * 靠自带字体渲染，而字体没就位时**不报错、只是画不出字形**。
   *
   * 于是我先加了“字体就绪前显示加载态”。结果 2026-10-09 更糟：真机上那个字体**根本没
   * 被打进包里**（检查 APK：一个 .ttf 都没有），`fontsLoaded` 永远是 false，主界面永远
   * 不渲染 —— 用户看到的是一片空白。
   *
   * 教训：**加载失败的可选资源，绝不能挡在应用前面。** 字体是装饰性的（Icon 拿不到就
   * 不画，见 components/Icon.tsx），让它去后台加载；界面该出来就出来。
   */
  const ioniconFont = (Ionicons as unknown as { font: Record<string, string> }).font;
  useFonts({ ...ioniconFont });

  return (
    // I18nProvider 在最外层：未登录时的 AuthScreen 也要能翻译。
    <I18nProvider>
      {/* 边界放在 Provider 之内：语言先就位，崩溃屏才能说人话而不是又一片空白。 */}
      <ErrorBoundary>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ErrorBoundary>
    </I18nProvider>
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
