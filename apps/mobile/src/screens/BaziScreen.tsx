import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type WebViewType from "react-native-webview";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { useBackHandler } from "../lib/back-stack";
import { useI18n } from "../lib/i18n-context";
import { colors, themed } from "../theme";

import { sizes } from "../design/tokens";

/**
 * 起中文名 / 八字工具页（自建部署，2026-11-08）。
 *
 * 原先指向 Railway 的 `bazi-app-production-b3f8.up.railway.app`；现在跑在我们自己
 * 的服务器上（容器 :3100，nginx 挂在主域 `/bazi/` 下），数据在宿主机
 * `/home/ubuntu/bazi-data/app.db`。
 *
 * 结尾的斜杠**不能省**：页面里的接口地址是相对路径 `./actions`，
 * 少了斜杠会解析到站点根（`/actions`）而不是 `/bazi/actions`。
 */
const BAZI_URL = "https://talkfirst.ccwu.cc/bazi/";

/**
 * App 内打开起名工具（2026-11-07）。
 *
 * ## 为什么用 WebView 而不是系统浏览器
 *
 * 之前是 `Linking.openURL`：点一下 App 就被切到浏览器，回来还得靠多任务。
 * 现在这是一层全屏子页，返回键先退网页历史、再退页面。
 *
 * ## 三个必须处理的细节
 *
 * 1. `setSupportMultipleWindows={false}`：页面里的 `target="_blank"` 不再
 *    唤起新窗口（在 Android 上会变成跳出 App）。
 * 2. 返回键走 `useBackHandler`：它按「最近可见」排序，所以本页注册的处理器
 *    会盖过「我的」那一层，先退网页再关页面。
 * 3. 失败要有出路：断网/证书错误时显示重试，而不是白屏。
 */
export function BaziScreen({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const webRef = useRef<WebViewType | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useBackHandler(true, () => {
    if (canGoBack) {
      webRef.current?.goBack();
      return;
    }
    onClose();
  });

  return (
    <View style={styles.root}>
      <SubHeader title={t("me.baziEntry")} onBack={onClose} />

      {failed ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t("me.baziOpenFailed")}</Text>
          <View style={styles.retryWrap}>
            <Button
              label={t("common.retry")}
              variant="ghost"
              onPress={() => {
                setFailed(false);
                setLoading(true);
                webRef.current?.reload();
              }}
            />
          </View>
          {/*
           * 网页加载失败时总得有条出路：WebView 里的失败（老设备、代理、证书）
           * 不该把人困在一个只有「重试」的页面上。
           */}
          <Pressable
            onPress={() => void Linking.openURL(BAZI_URL)}
            accessibilityRole="button"
            accessibilityLabel={t("me.baziOpenInBrowser")}
            hitSlop={8}
            style={styles.browserLink}
          >
            <Text style={styles.browserLinkText}>{t("me.baziOpenInBrowser")}</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: BAZI_URL }}
          style={styles.web}
          originWhitelist={["https://*"]}
          setSupportMultipleWindows={false}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onHttpError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onNavigationStateChange={(state: WebViewNavigation) => setCanGoBack(state.canGoBack)}
        />
      )}

      {loading && !failed ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  web: { flex: 1, backgroundColor: c.bgSolid },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  errorText: { fontSize: sizes.body, color: c.muted, textAlign: "center" },
  retryWrap: { marginTop: 16, minWidth: 120 },
  browserLink: { marginTop: 14, paddingVertical: 6 },
  browserLinkText: { fontSize: sizes.ui, color: c.primaryDark, fontWeight: "600" },
}));
