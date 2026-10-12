import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { apiFetch, apiFetchEnvelope, ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { saveTokens } from "../lib/storage";
import type { AccountLoginMethods } from "../lib/types";
import { colors } from "../theme";

type Mode = "loading" | "set" | "change";

/**
 * 这个端点能回的错误码 → 本地文案键。没映射到的降级成 `me.saveFailed`，
 * 而不是把服务端的英文原句摆在中文界面里。
 */
const PASSWORD_ERROR_KEYS: Record<string, MsgKey> = {
  PASSWORD_MISMATCH: "me.passwordMismatch",
  PASSWORD_UNCHANGED: "me.passwordErrorUnchanged",
  INVALID_CREDENTIALS: "me.passwordErrorCurrent",
  VALIDATION_ERROR: "me.passwordErrorValidation",
};

/**
 * 修改密码 —— 或给「只有 Google 登录、没有密码」的账号设置第一个密码。
 *
 * `GET /auth/oauth/me/methods` 的 `hasPassword` 决定走哪条：
 *  - 有密码 → 需要当前密码；
 *  - 没有 → 不渲染当前密码框，提交时 `currentPassword` 传 `-` 占位（服务端 DTO
 *    要求非空字符串，但该字段在这种账号上从头到尾不被读取）。
 *
 * `POST /auth/password` 会轮换 token 并把新 token 放在信封顶层 —— 和登录一样，
 * 必须用 `apiFetchEnvelope` 拿到并存进 SecureStore，否则当前设备的会话会失联。
 */
export function PasswordScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const [mode, setMode] = useState<Mode>("loading");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<AccountLoginMethods>("/auth/oauth/me/methods")
      .then((methods) => {
        if (alive) setMode(methods.hasPassword ? "change" : "set");
      })
      .catch(() => {
        /* 读不到就退回「修改」方向：有密码的人不会被塞一个不用验证当前密码的表单。 */
        if (alive) {
          setMode("change");
          setError(t("me.passwordLoadFailed"));
        }
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const settingFirstPassword = mode === "set";

  async function submit() {
    if (!settingFirstPassword && !currentPassword) {
      setError(t("me.passwordCurrentRequired"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("me.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("me.passwordMismatch"));
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const session = await apiFetchEnvelope("/auth/password", {
        method: "POST",
        body: {
          currentPassword: settingFirstPassword ? "-" : currentPassword,
          newPassword,
          confirmPassword,
        },
      });
      await saveTokens(session.accessToken, session.refreshToken);
      setUser(session.data);
      setMode("change");
      setSuccess(settingFirstPassword ? t("me.passwordSetSuccess") : t("me.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        const key = PASSWORD_ERROR_KEYS[requestError.code];
        setError(key ? t(key) : t("me.saveFailed"));
      } else {
        setError(t("me.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  }

  if (mode === "loading") {
    return (
      <View style={styles.root}>
        <SubHeader title={t("me.password")} onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SubHeader title={settingFirstPassword ? t("me.passwordSet") : t("me.password")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          {settingFirstPassword ? t("me.passwordSetHint") : t("me.passwordChangeHint")}
        </Text>

        {settingFirstPassword ? null : (
          <PasswordField
            label={t("me.passwordCurrent")}
            value={currentPassword}
            onChange={setCurrentPassword}
          />
        )}

        <PasswordField
          label={settingFirstPassword ? t("me.passwordNewSet") : t("me.passwordNew")}
          value={newPassword}
          onChange={setNewPassword}
        />

        <PasswordField
          label={t("me.passwordConfirm")}
          value={confirmPassword}
          onChange={setConfirmPassword}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {success ? <Text style={styles.okText}>{success}</Text> : null}

        <View style={styles.actions}>
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button label={t("me.save")} onPress={() => void submit()} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  body: { padding: 20, paddingBottom: 40, gap: 16 },
  hint: { fontSize: 13, lineHeight: 20, color: colors.muted },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  errorText: { fontSize: 13, color: colors.danger },
  okText: { fontSize: 13, color: colors.primary },
  actions: { marginTop: 4 },
});
