import { useEffect, useState, type ComponentType } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiBaseUrl } from "../lib/config";

/**
 * 启动自检（**临时**，只为定位「装完打开白屏」）。
 *
 * ## 关键设计：它挂在**入口**上，不在 App 里面
 *
 * 第一版把它放在 `App.tsx` 里，那有个致命漏洞：如果 `App.tsx` 的 import 链在
 * **模块加载期**就抛错（原生模块缺失、循环依赖、初始化失败都属此类），那么 App
 * 根本没被渲染，挂在它里面的自检块自然也不会出现 —— 屏幕依然是白的，什么都没查到。
 *
 * 现在是 `index.ts` 注册这个 `DiagnosticsRoot`，它先用 `require()` **惰性**加载 App：
 *   - 加载成功 → App 渲染在下面，自检面板留在上面；
 *   - 加载失败 → 面板直接显示第 7 行「加载 App 失败：<错误>」，**这就是根因**。
 *
 * ## 其它约束
 *
 * 1. **只用 RN 内核**：`View` / `Text` / `Platform` / `StyleSheet` / `fetch`。
 *    没有 i18n、没有 SafeArea、没有图标字体 —— 它们正是被怀疑的对象。
 * 2. 可疑能力（安全存储、图标字体）用 `require()` 惰性探测 + try/catch，
 *    失败只显示一行字，不会把整个 App 拖死。
 * 3. 每行自检独立，前面失败不影响后面。
 *
 * ## 定位完之后
 *
 * 删除本文件、把 `index.ts` 恢复成 `import App from "./App"; registerRootComponent(App);`、
 * 并把 `app.json` 的名字从「TalkFirst 诊断」改回 `TalkFirst`。
 * （改名字是为了让你在桌面上就能确认装的是新包，不是旧包 —— 同名的话根本分不出来。）
 */
export function DiagnosticsRoot() {
  const [lines, setLines] = useState<string[]>(["1. JS 已运行 ✓"]);
  const [App, setApp] = useState<ComponentType | null>(null);

  useEffect(() => {
    const collected: string[] = ["1. JS 已运行 ✓"];

    // 2. 基址：如果这里不是 https://api.talkfirst.ccwu.cc/api/v1，装的就是旧包。
    try {
      collected.push(`2. API 基址：${apiBaseUrl()}`);
    } catch (error) {
      collected.push(`2. API 基址读取抛错：${String(error).slice(0, 80)}`);
    }

    // 3. 平台
    collected.push(`3. 平台：${Platform.OS} ${String(Platform.Version)}`);
    setLines([...collected]);

    // 4. 安全存储 —— 惰性 require + try
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
        await SecureStore.getItemAsync("talkfirst.diagnostics");
        collected.push("4. SecureStore ✓");
      } catch (error) {
        collected.push(`4. SecureStore ✗ ${String(error).slice(0, 90)}`);
      }
      setLines([...collected]);

      // 5. 图标字体（@expo/vector-icons 依赖 expo-font）
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("@expo/vector-icons");
        collected.push("5. 图标字体模块可加载 ✓");
      } catch (error) {
        collected.push(`5. 图标字体 ✗ ${String(error).slice(0, 90)}`);
      }
      setLines([...collected]);

      // 6. 接口可达性：这一行直接回答「是不是被挡在门外」
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(`${apiBaseUrl()}/health`, { signal: controller.signal });
        clearTimeout(timer);
        collected.push(`6. 接口 /health → HTTP ${response.status}`);
      } catch (error) {
        collected.push(`6. 接口不可达 ✗ ${String(error).slice(0, 90)}`);
      }
      setLines([...collected]);
    })();

    // 7. 加载 App —— 这一步能抓到「模块加载期抛错」这一类白屏根因
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require("../../App") as { default: ComponentType };
      setApp(() => loaded.default);
      collected.push("7. App 模块加载 ✓（下面应出现界面）");
    } catch (error) {
      collected.push(`7. App 加载失败 ✗ ${String(error).slice(0, 200)}`);
    }
    setLines([...collected]);
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.title}>TalkFirst 启动自检（诊断版）</Text>
        {lines.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}
        <Text style={styles.hint}>
          请把这一屏截图发我（真机没有控制台，这张图就是现场）。
        </Text>
      </ScrollView>

      <View style={styles.appArea}>{App ? <App /> : null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" },
  panel: {
    maxHeight: 260,
    backgroundColor: "#FEF3C7",
    borderBottomWidth: 2,
    borderBottomColor: "#F59E0B",
  },
  panelContent: { paddingTop: 44, paddingBottom: 10, paddingHorizontal: 12 },
  title: { fontSize: 13, fontWeight: "700", color: "#7C2D12", marginBottom: 4 },
  line: { fontSize: 12, lineHeight: 17, color: "#111827" },
  hint: { fontSize: 11, lineHeight: 16, color: "#7C2D12", marginTop: 6 },
  appArea: { flex: 1 },
});
