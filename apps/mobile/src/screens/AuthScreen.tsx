import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Logo } from "../components/Logo";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";

/**
 * Mirrors `RegisterDto` in apps/api/src/auth/auth.dto.ts (8-72 characters).
 * Login is deliberately NOT length-checked here: `LoginDto` only requires 1-72,
 * so rejecting a legacy short password on the login screen would lock out users
 * whose password predates the rule. The server stays the authority -- these
 * checks only save a round trip and give a faster message.
 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) {
      setError(t("auth.errorMissingFields"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("auth.errorInvalidEmail"));
      return;
    }
    if (mode === "register" && password.length < PASSWORD_MIN_LENGTH) {
      setError(t("auth.errorPasswordTooShort", { n: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setError(t("auth.errorPasswordTooLong", { n: PASSWORD_MAX_LENGTH }));
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") await signIn(trimmed, password);
      else await signUp(trimmed, password);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError ? requestError.message : t("common.actionFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <Logo size={60} />
          <Text style={styles.title}>
            {mode === "login" ? t("auth.welcomeBack") : t("auth.createAccount")}
          </Text>
          <Text style={styles.subtitle}>
            {mode === "login" ? t("auth.loginSubtitle") : t("auth.registerSubtitle")}
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            placeholder={t("auth.emailPlaceholder")}
            keyboardType="email-address"
            maxLength={254}
          />
          <Input
            label={t("auth.password")}
            value={password}
            onChangeText={setPassword}
            placeholder={t("auth.passwordPlaceholder")}
            secureTextEntry
            maxLength={PASSWORD_MAX_LENGTH}
          />
          {error ? (
            // Failure arrives after an await, so nothing on screen changes focus
            // or is focused: without a live region screen readers announce
            // nothing at all. "alert" gives iOS VoiceOver the same behaviour.
            <Text
              style={styles.error}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              {error}
            </Text>
          ) : null}
          <Button
            label={mode === "login" ? t("auth.login") : t("auth.register")}
            onPress={() => void handleSubmit()}
            loading={loading}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}
          </Text>
          {/* Was a bare <Text onPress>: no button role and a hit target the size
              of the glyphs, which fails the 44x44 minimum for touch and is
              invisible to screen readers as a control. */}
          <Pressable
            onPress={toggleMode}
            accessibilityRole="button"
            accessibilityLabel={mode === "login" ? t("auth.toRegister") : t("auth.toLogin")}
            hitSlop={12}
          >
            <Text style={styles.footerLink}>
              {mode === "login" ? t("auth.toRegister") : t("auth.toLogin")}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: 28 },
  header: { alignItems: "center", marginBottom: 40 },
  title: { fontSize: 26, fontWeight: "600", color: colors.ink, marginTop: 20 },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 8 },
  form: { width: "100%" },
  error: { color: colors.danger, fontSize: 12, marginBottom: 12 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 28 },
  footerText: { color: colors.muted, fontSize: 13 },
  footerLink: { color: colors.primary, fontSize: 13, fontWeight: "600" },
});
