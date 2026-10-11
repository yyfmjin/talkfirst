import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { BlockItem, ReportItem } from "../lib/types";
import { colors } from "../theme";

/**
 * 安全中心 —— 对齐 web 的 `/me/safety`。
 *
 * 两段：已拉黑列表（可解除，`DELETE /blocks/:userId`）与我的举报
 * （`GET /reports/mine`，只读）。举报/拉黑的**发起**入口在对话页与动态详情页
 * （web 也是这个布局），这里只管理历史记录。
 */

/** 举报状态 → 文案键；服务端新增状态时退回显示原始值（与 web 同一个兜底策略）。 */
const REPORT_STATUS_KEYS: Record<string, MsgKey> = {
  PENDING: "safety.statusPending",
  REVIEWED: "safety.statusReviewed",
  RESOLVED: "safety.statusResolved",
  DISMISSED: "safety.statusDismissed",
  ACTION_TAKEN: "safety.statusActionTaken",
};

export function SafetyScreen({
  onBack,
  onOpenSocial,
}: {
  onBack: () => void;
  onOpenSocial: () => void;
}) {
  const { t } = useI18n();
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [blockList, reportList] = await Promise.all([
        apiFetch<BlockItem[]>("/blocks"),
        apiFetch<ReportItem[]>("/reports/mine"),
      ]);
      setBlocks(blockList);
      setReports(reportList);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("safety.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(userId: string) {
    if (acting) return;
    setActing(userId);
    try {
      await apiFetch(`/blocks/${userId}`, { method: "DELETE" });
      setBlocks((current) => current.filter((item) => item.blockedId !== userId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("safety.errorUnblock"));
    } finally {
      setActing(null);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("safety.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t("safety.intro")}</Text>

        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.primary} />
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("safety.blockedCount", { n: blocks.length })}</Text>
              {blocks.length === 0 ? (
                <Text style={styles.emptyText}>{t("safety.noBlocks")}</Text>
              ) : (
                <View style={styles.blockList}>
                  {blocks.map((item) => (
                    <View key={item.blockedId} style={styles.blockRow}>
                      <Avatar uri={item.blocked.avatarUrl} nickname={item.blocked.nickname} size={40} />
                      <View style={styles.blockRowText}>
                        <Text style={styles.blockName}>{item.blocked.nickname ?? t("common.user")}</Text>
                        <Text style={styles.blockMeta}>{item.blocked.countryCode ?? t("common.global")}</Text>
                      </View>
                      <Pressable
                        onPress={() => void unblock(item.blockedId)}
                        disabled={acting !== null}
                        accessibilityRole="button"
                        /* 无障碍名要说清**给谁**解除：一排没有名字的「解除」对读屏毫无意义。 */
                        accessibilityLabel={t("safety.unblockLabel", {
                          name: item.blocked.nickname ?? t("common.user"),
                        })}
                        style={[styles.unblockButton, acting !== null ? styles.disabled : null]}
                      >
                        {acting === item.blockedId ? (
                          <ActivityIndicator size="small" color={colors.primaryDark} />
                        ) : (
                          <Text style={styles.unblockLabel}>{t("safety.unblock")}</Text>
                        )}
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("safety.reportsCount", { n: reports.length })}</Text>
              {reports.length === 0 ? (
                <Text style={styles.emptyText}>{t("safety.noReports")}</Text>
              ) : (
                <View style={styles.reportList}>
                  {reports.slice(0, 10).map((item) => (
                    <View key={item.id} style={styles.reportRow}>
                      <Text style={styles.reportTitle}>
                        {item.reportedUser.nickname ?? t("common.user")} · {item.reason}
                      </Text>
                      <Text style={styles.reportMeta}>
                        {reportStatusLabel(t, item.status)} · {new Date(item.createdAt).toLocaleString()}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}

        {error ? (
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Button label={t("safety.manageSocial")} onPress={onOpenSocial} variant="ghost" />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * 举报状态文案：已知状态用词典，服务端新增的状态退回显示原始值 ——
 * 与 web 的 `REPORT_STATUS_LABELS[status] ?? status` 同一个策略。
 */
function reportStatusLabel(
  t: (key: MsgKey, params?: Record<string, string | number>) => string,
  status: string,
): string {
  const key = REPORT_STATUS_KEYS[status];
  return key ? t(key) : status;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  intro: {
    borderRadius: 14,
    backgroundColor: colors.bgSoft,
    padding: 14,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  center: { marginTop: 28 },
  section: { marginTop: 22 },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  emptyText: { fontSize: 13, color: colors.muted, marginTop: 8 },
  blockList: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  blockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  blockRowText: { flex: 1 },
  blockName: { fontSize: 14, fontWeight: "500", color: colors.ink },
  blockMeta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  unblockButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: "center",
  },
  unblockLabel: { fontSize: 13, color: colors.primaryDark, fontWeight: "500" },
  disabled: { opacity: 0.5 },
  reportList: { marginTop: 10, gap: 8 },
  reportRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 12,
    gap: 4,
  },
  reportTitle: { fontSize: 14, fontWeight: "500", color: colors.ink },
  reportMeta: { fontSize: 12, color: colors.muted },
  errorText: { marginTop: 16, fontSize: 13, color: colors.danger, textAlign: "center" },
  footer: { marginTop: 24 },
});
