import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "../lib/i18n";
import { colors } from "../theme";

/**
 * 顶层错误边界。
 *
 * ## 为什么加了它
 *
 * 这个 app 在此之前**没有任何错误边界**：渲染期一崩，用户看到的是一片空白，
 * 没有任何文字 —— 2026-10-08 那次"装完打开是白屏"的排查里，最缺的就是
 * "机器能不能说一句人话"。
 *
 * 边界拦不住的两类错误要说清楚，免得它造成"已经防住了"的错觉：
 *
 *   1. **模块加载期的异常**（例如模块级 `throw`）—— 那时 React 还没开始渲染，
 *      边界根本不存在。那次白屏正是这一类，真修法在 `lib/config.ts`（不在模块级抛错）。
 *   2. **原生的启动失败**（比如缺少原生模块）—— JS 没跑起来时，React 也管不到。
 *
 * 它能拦的是渲染 / 生命周期里抛出的异常，也就是剩下的大多数。
 *
 * ## 为什么用模块级的 `t()` 而不是 `useI18n()`
 *
 * 类组件拿不到 hook，而且**边界自己崩的时候不能依赖任何还没建立起来的东西**
 * （Provider 也可能就是出问题的那一环）。模块级 `t()` 是最小依赖：读一个模块变量。
 * 代价是：如果崩在语言初始化之前，这一屏会用默认语言（英文）。
 */
type Props = { children: ReactNode };
type State = { error: Error | null; componentStack: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    /*
     * 组件栈是定位渲染崩溃最有用的信息：它直接点名「哪棵子树」出的问题。
     *
     * 真机上没有控制台，所以它不能只进日志 —— 要**显示到屏幕上**。
     * 2026-10-08 就是因为只显示了 `error.message`（"Element type is invalid ...
     * but got: undefined"），定位时多花了一整轮构建去猜是哪个组件。
     */
    const componentStack = (info?.componentStack ?? "").trim();
    this.setState({ componentStack });
    console.error("[ErrorBoundary]", error, componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    /* 只取前面几层：屏幕上放不下，而第一个组件名几乎总是答案。 */
    const stackLines = this.state.componentStack
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, 4)
      .join("\n");

    return (
      <View style={styles.root}>
        <Text style={styles.title}>{t("error.title")}</Text>
        <Text style={styles.body}>{t("error.body")}</Text>
        {/* 原始信息留在屏幕上：真机上没有控制台，截图就是唯一的现场。 */}
        <Text style={styles.detail} numberOfLines={6}>
          {this.state.error.message}
        </Text>
        {stackLines ? (
          <Text style={styles.stack} numberOfLines={10} selectable>
            {stackLines}
          </Text>
        ) : null}
        <Pressable
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  title: { fontSize: 18, fontWeight: "600", color: colors.ink, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: "center" },
  detail: { fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center" },
  stack: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.ink,
    textAlign: "left",
    alignSelf: "stretch",
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.bgSoft,
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  retryLabel: { fontSize: 14, fontWeight: "600", color: colors.white },
});
