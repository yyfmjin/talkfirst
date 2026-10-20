import { useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Input } from "../components/Input";
import { KeyboardAware } from "../components/KeyboardAware";
import { Logo } from "../components/Logo";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import { legalUrl } from "../lib/legal";
import { ResetPasswordScreen } from "./ResetPasswordScreen";
import { VerifyScreen } from "./VerifyScreen";
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

/**
 * 服务端的错误码 → 本地化文案。
 *
 * 来自线上的一条真实反馈（2026-10-08）：密码填错时，屏幕上出现的是接口给的英文原句
 * `Email, username or password is incorrect` —— 中文界面里冒出一句英文，用户只会得到
 * 「登录失败」这种模糊印象，不知道该改什么。
 *
 * 只映射**已知**的码；未知错误仍然显示服务端原话 —— 宁可让人看到一句不准的英文，
 * 也不要把他真正的错误盖成一句模糊的“失败”。
 */
const AUTH_ERROR_KEYS = {
  INVALID_CREDENTIALS: "auth.errorInvalidCredentials",
  EMAIL_TAKEN: "auth.errorEmailTaken",
} as const;

export function AuthScreen({ onRegistered }: { onRegistered?: () => void } = {}) {
  const { signIn, signUp } = useAuth();
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  /** 需要验证邮箱的地址；非 null 时整屏交给 `VerifyScreen`。 */
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /* 注册专用的同意勾选。登录不参与：老账号注册时的那次同意已经发生过，
     再拦一次只会让已经同意过的人重新勾一遍。 */
  const [consent, setConsent] = useState(false);

  function openLegal(path: string) {
    Linking.openURL(legalUrl(locale, path)).catch(() => setError(t("legal.openFailed")));
  }

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
    /* 同意闸门放在最后一道：格式都不对时先说格式，别让用户先去勾一个空表单。 */
    if (mode === "register" && !consent) {
      setError(t("auth.errorConsentRequired"));
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") await signIn(trimmed, password);
      else {
        await signUp(trimmed, password);
        /*
         * 注册后**必须**先验证邮箱，不能直接进引导。
         *
         * 线上开着 `ENFORCE_EMAIL_VERIFICATION`，未验证的账号除了 `/users/me`
         * 和几个 auth 接口，其它一律 403 —— 直接放进主界面的话，用户看到的是
         * 「每个页面都报错」，而屏幕上没有任何地方能补验证码。
         */
        setVerifyEmail(trimmed);
      }
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.code === "EMAIL_NOT_VERIFIED") {
        // 老账号（在网页注册但没验证，或者验证状态丢失）：直接推验证屏。
        setVerifyEmail(trimmed);
        setError(t("auth.errorEmailNotVerified"));
        return;
      }
      const key =
        requestError instanceof ApiRequestError
          ? AUTH_ERROR_KEYS[requestError.code as keyof typeof AUTH_ERROR_KEYS]
          : undefined;
      setError(
        key
          ? t(key)
          : requestError instanceof ApiRequestError
            ? requestError.message
            : t("common.actionFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  }

  if (resetting) {
    return (
      <ResetPasswordScreen
        initialEmail={email.trim().toLowerCase()}
        onBack={() => setResetting(false)}
      />
    );
  }

  if (verifyEmail) {
    return (
      <VerifyScreen
        email={verifyEmail}
        onVerified={() => {
          setVerifyEmail(null);
          onRegistered?.();
        }}
      />
    );
  }

  return (
    <KeyboardAware style={styles.root}>
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
          {mode === "login" ? (
            <Pressable
              onPress={() => setResetting(true)}
              accessibilityRole="button"
              accessibilityLabel={t("reset.forgot")}
              hitSlop={10}
              style={styles.forgot}
            >
              <Text style={styles.forgotText}>{t("reset.forgot")}</Text>
            </Pressable>
          ) : null}
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
          {mode === "register" ? (
            <View style={styles.consent}>
              {/* 同意是注册的前置条件（对齐 web `/register` 的说明，但这里必须可点）：
                  Google Play 对含用户生成内容的应用要求「注册前明确同意条款」，
                  界面上只写一行字、点不进去，等于没给用户读过条款的机会。 */}
              <Pressable
                onPress={() => setConsent(!consent)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consent }}
                accessibilityLabel={t("auth.consent")}
                hitSlop={8}
                style={styles.consentRow}
              >
                <Icon
                  name={consent ? "checkbox" : "square-outline"}
                  size={20}
                  color={consent ? colors.primary : colors.muted}
                />
                <Text style={styles.consentText}>{t("auth.consent")}</Text>
              </Pressable>
              <View style={styles.consentLinks}>
                <Pressable
                  onPress={() => openLegal("/legal/terms")}
                  accessibilityRole="link"
                  accessibilityLabel={t("auth.consentTerms")}
                  hitSlop={8}
                >
                  <Text style={styles.consentLink}>{t("auth.consentTerms")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => openLegal("/legal/privacy")}
                  accessibilityRole="link"
                  accessibilityLabel={t("auth.consentPrivacy")}
                  hitSlop={8}
                >
                  <Text style={styles.consentLink}>{t("auth.consentPrivacy")}</Text>
                </Pressable>
              </View>
            </View>
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
    </KeyboardAware>
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
  consent: { marginBottom: 14 },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  consentText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  consentLinks: { flexDirection: "row", gap: 14, marginTop: 6, marginLeft: 28 },
  consentLink: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  forgot: { alignSelf: "flex-end", marginTop: -4, marginBottom: 12 },
  forgotText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
});
