import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import { clearTokens } from "../lib/storage";
import { colors, themed } from "../theme";

import { radii, sizes } from "../design/tokens";
/**
 * 注销账号 —— 不可恢复，要求输入确认词（中文「注销」/ 英文「DELETE」）。
 *
 * 服务端 `DELETE /users/me` 本身不要求确认词，那是前端加的护栏：破坏性操作
 * 让用户把词打一遍，比只点一下按钮更能拦住手滑。确认词按当前界面语言取。
 *
 * 删除成功后本地直接清会话（`clearTokens` + `setUser(null)`）：账号已经没了，
 * 不能再走 `POST /auth/logout`（那会 401）。
 */
export function DeleteAccountScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const phrase = t("me.deleteConfirmPhrase");
  const confirmed = confirmText.trim() === phrase;

  async function confirmDelete() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await apiFetch("/users/me", { method: "DELETE" });
      await clearTokens();
      setUser(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.deleteFailed"));
      setDeleting(false);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("me.deleteAccount")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.warning}>{t("me.deleteAccountWarning")}</Text>
        <Text style={styles.hint}>{t("me.deleteAccountHint", { phrase })}</Text>

        <TextInput
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder={phrase}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("me.deleteAccountHint", { phrase })}
          placeholderTextColor={colors.muted}
          style={styles.input}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Button
          label={t("me.deleteConfirmButton")}
          onPress={() => void confirmDelete()}
          variant="danger"
          disabled={!confirmed}
          loading={deleting}
        />
      </ScrollView>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  body: { padding: 20, paddingBottom: 40, gap: 16 },
  warning: { fontSize: sizes.body, lineHeight: 22, color: c.danger, fontWeight: "600" },
  hint: { fontSize: sizes.ui, lineHeight: 20, color: c.muted },
  input: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.chip,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: sizes.body,
    color: c.ink,
    backgroundColor: c.glass,
  },
  errorText: { fontSize: sizes.ui, color: c.danger },
}));
