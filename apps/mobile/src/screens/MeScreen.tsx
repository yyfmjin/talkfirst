import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { AvatarViewer } from "../components/AvatarViewer";
import { Switch } from "../components/Switch";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { applyUpdate, checkForUpdate } from "../lib/update-check";
import { formatAppVersion } from "../lib/app-info";
import { useBackHandler } from "../lib/back-stack";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n, type LocalePreference } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { SessionUser } from "../lib/types";
import { colors, themed } from "../theme";
import { ConnectionsScreen } from "./ConnectionsScreen";
import { SafetyScreen } from "./SafetyScreen";
import { SocialScreen } from "./SocialScreen";
import { VisibilityScreen } from "./VisibilityScreen";
import { InterestsScreen } from "./InterestsScreen";
import { AttributesScreen } from "./AttributesScreen";
import { BaziScreen } from "./BaziScreen";
import { PasswordScreen } from "./PasswordScreen";
import { DeleteAccountScreen } from "./DeleteAccountScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { VerifyScreen } from "./VerifyScreen";
import { MomentsSettingsScreen } from "./MomentsSettingsScreen";
import { EditProfileScreen } from "./EditProfileScreen";
import { LegalScreen } from "./LegalScreen";

import { radii, sizes } from "../design/tokens";
/**
 * 界面语言选项。
 *
 * 存的是**偏好**而不是当前语言：选了「跟随系统」以后，用户在手机设置里把语言
 * 改成英文，下次启动就该是英文 —— 不需要再进来手动改一次（见 `i18n-context`）。
 */
const LANGUAGE_OPTIONS = [
  { value: "system", labelKey: "me.languageSystem" },
  { value: "zh", labelKey: "me.languageZh" },
  { value: "en", labelKey: "me.languageEn" },
] as const satisfies readonly { value: LocalePreference; labelKey: MsgKey }[];

/**
 * 「我的」里的入口，**分组方式与 web 端 `/me` 一致**（内容 / 帮助与反馈）。
 *
 * web 那边把入口分了组而不是平铺一列按钮 —— 六个一模一样的大按钮等于没有重点。
 * 这里沿用同样的分组与图标语义，让两端看起来是同一个产品。
 *
 * 入口按 web `/me` 的五组放：内容（编辑基本资料 / 语言·兴趣·交友目的 / 交友属性）、关系
 * （我的连接 / 管理社交账号）、隐私与安全（资料可见范围 / 安全中心）、帮助与反馈（意见反馈）、
 * 账号（修改密码 / 注销账号），再补一组「关于（条款与隐私）」—— web 只在注册页链到
 * 社区规则，三份正文散在 `/legal/*`；Google Play 要求隐私政策在**应用内**可达，
 * 所以 App 这边给一个能看全三份文档的入口。
 */
type MeEntry = {
  key:
    | "edit"
    | "interests"
    | "attributes"
    | "feedback"
    | "connections"
    | "social"
    | "visibility"
    | "safety"
    | "password"
    | "deleteAccount"
    | "legal"
    /* 不在 `ME_GROUPS` 里：入口是自定义的「小工具」那一行。 */
    | "bazi"
    /* 不在 `ME_GROUPS` 里：它的入口是「管理社交账号」页底部那一个按钮
       （与 web `/me/social` → `/moments/settings` 同一条路径），不是「我的」下的一行。 */
    | "momentsSettings";
  labelKey: MsgKey;
  icon: IconName;
};
type MeGroup = { titleKey: MsgKey; entries: MeEntry[] };

const ME_GROUPS: MeGroup[] = [
  {
    titleKey: "me.groupContent",
    entries: [
      { key: "edit", labelKey: "me.editProfile", icon: "create-outline" },
      { key: "interests", labelKey: "me.interests", icon: "sparkles-outline" },
      { key: "attributes", labelKey: "me.attributes", icon: "pricetags-outline" },
    ],
  },
  {
    titleKey: "me.groupRelations",
    entries: [
      { key: "connections", labelKey: "me.connections", icon: "people-outline" },
      { key: "social", labelKey: "me.social", icon: "globe-outline" },
    ],
  },
  {
    titleKey: "me.groupPrivacy",
    entries: [
      { key: "visibility", labelKey: "me.visibility", icon: "eye-outline" },
      { key: "safety", labelKey: "me.safety", icon: "shield-checkmark-outline" },
    ],
  },
  {
    titleKey: "me.groupHelp",
    entries: [{ key: "feedback", labelKey: "me.feedback", icon: "chatbox-ellipses-outline" }],
  },
  {
    titleKey: "me.groupAccount",
    entries: [
      { key: "password", labelKey: "me.password", icon: "key-outline" },
      { key: "deleteAccount", labelKey: "me.deleteAccount", icon: "trash-outline" },
    ],
  },
  {
    titleKey: "me.groupAbout",
    entries: [{ key: "legal", labelKey: "me.legal", icon: "document-text-outline" }],
  },
];

export function MeScreen() {
  const { user, signOut, setUser } = useAuth();
  const { t, preference, setPreference } = useI18n();
  const [open, setOpen] = useState<MeEntry["key"] | null>(null);
  /** 未验证邮箱时的验证屏（自己从「我的」能找得到，不依赖登录页）。 */
  const [verifying, setVerifying] = useState(false);
  /* 引导不放在 `open` 里：它不是「我的」的一个子页，而是一个会盖住底部导航的
     独立流程（与「注册后马上走一遍」是同一个组件）。 */
  const [onboarding, setOnboarding] = useState(false);
  /** 正在检查/下载更新（按钮期间转圈，避免连点）。 */
  const [updating, setUpdating] = useState(false);
  /** 点头像看大图（自己的这张还能直接换）。 */
  const [avatarOpen, setAvatarOpen] = useState(false);
  /** 「资料卡展示个人动态」的开关状态：以服务端为准，点下去先乐观更新。 */
  const [momentsOn, setMomentsOn] = useState(user?.showMomentsOnProfile ?? true);
  const [savingMoments, setSavingMoments] = useState(false);

  /* 系统返回键：引导 → 子页 → （没有任何子页时退出 app，交由系统默认）。 */
  useBackHandler(open !== null, () => setOpen(null));
  useBackHandler(verifying, () => setVerifying(false));
  useBackHandler(onboarding, () => setOnboarding(false));

  /**
   * 应用内检查更新：检查 →（有就）下载 → 问用户要不要现在重启。
   *
   * 四种结果都要说清楚，尤其是 **unsupported**：那是「安装包本身不支持」，
   * 重试多少次都没用，只能重新装一次包（说法在 `update-check.ts` 文件头）。
   */
  /**
   * 「资料卡展示个人动态」开关。
   *
   * 乐观更新：点下去先动，失败再翻回来并说明原因 —— 一个开关如果点完要等 1 秒
   * 才动，用户会以为没点上而连点。服务端是唯一的真相来源，所以失败时以它为准。
   */
  async function toggleMoments(next: boolean) {
    if (savingMoments) return;
    const previous = momentsOn;
    setMomentsOn(next);
    setSavingMoments(true);
    try {
      const updated = await apiFetch<SessionUser>("/users/me", {
        method: "PATCH",
        body: { showMomentsOnProfile: next },
      });
      setUser(updated);
      setMomentsOn(updated.showMomentsOnProfile ?? next);
    } catch {
      setMomentsOn(previous);
      Alert.alert(t("me.showMomentsFailedTitle"), t("me.showMomentsFailedBody"));
    } finally {
      setSavingMoments(false);
    }
  }

  async function runUpdateCheck() {
    if (updating) return;
    setUpdating(true);
    const result = await checkForUpdate();
    setUpdating(false);

    /* 弹窗里带上版本号与渠道：这两条是判断「到底是包的问题还是网的问题」的
       全部依据，不显示出来就永远只能让用户说一句「更新失败」。 */
    const version = formatAppVersion();
    const channel = result.channel ?? "—";

    if (result.status === "unsupported") {
      Alert.alert(
        t("me.updateUnsupportedTitle"),
        t("me.updateUnsupportedBody", { version, channel }),
      );
      return;
    }
    if (result.status === "latest") {
      Alert.alert(t("me.updateLatest"), t("me.updateLatestBody", { version }));
      return;
    }
    if (result.status === "failed") {
      Alert.alert(
        t("me.updateFailedTitle"),
        t("me.updateFailedBody", {
          version,
          channel,
          /* 原始报错可能很长（服务端整段 HTML），截一下，弹窗不要被撑爆。 */
          detail: (result.detail ?? "—").slice(0, 160),
        }),
      );
      return;
    }
    // ready：已经下载完，问用户什么时候重启（重启时机交给用户，不偷袭他）。
    Alert.alert(t("me.updateReadyTitle"), t("me.updateReadyBody"), [
      { text: t("me.updateLater"), style: "cancel" },
      { text: t("me.updateNow"), onPress: () => void applyUpdate() },
    ]);
  }

  if (!user) return null;

  /*
   * 未验证邮箱的会话（例如注册到一半把 App 杀了）不能只靠登录页兜底：
   * 服务端对未验证账号是 deny-by-default，除了 /users/me 与几个 auth 接口
   * 其余一律 403，界面上每个页面都会报错。这里给一个自己找得到的入口。
   */
  if (verifying) {
    return (
      <VerifyScreen
        email={user.email}
        onVerified={() => setVerifying(false)}
        onSkip={() => setVerifying(false)}
      />
    );
  }

  if (onboarding) {
    return (
      <OnboardingScreen
        onExit={() => setOnboarding(false)}
        /* 从「我的」进来的话，两条出口都回到「我的」：这里没有权限去切底部 tab，
           用户看到「名片完成」之后抬手就能自己点「发现」。 */
        onFinish={() => setOnboarding(false)}
      />
    );
  }

  if (open === "edit") {
    return <EditProfileScreen user={user} onDone={() => setOpen(null)} onUserChange={setUser} />;
  }
  if (open === "interests") {
    return <InterestsScreen onBack={() => setOpen(null)} />;
  }
  if (open === "attributes") {
    return <AttributesScreen onBack={() => setOpen(null)} />;
  }
  if (open === "password") {
    return <PasswordScreen onBack={() => setOpen(null)} />;
  }
  if (open === "legal") {
    return <LegalScreen onBack={() => setOpen(null)} />;
  }
  if (open === "deleteAccount") {
    return <DeleteAccountScreen onBack={() => setOpen(null)} />;
  }
  if (open === "feedback") {
    return <FeedbackScreen onDone={() => setOpen(null)} />;
  }
  if (open === "bazi") {
    return <BaziScreen onClose={() => setOpen(null)} />;
  }
  if (open === "connections") {
    return <ConnectionsScreen onBack={() => setOpen(null)} />;
  }
  if (open === "social") {
    return (
      <SocialScreen
        onBack={() => setOpen(null)}
        /* 与 web `/me/social` 底部那个按钮同一个去处：这一页管授权，动态设置
           管「绑了哪些平台、聚合了哪些内容」。两页分开，但联得上。 */
        footer={
          <Button
            label={t("momentsSettings.title")}
            variant="ghost"
            onPress={() => setOpen("momentsSettings")}
          />
        }
      />
    );
  }
  if (open === "momentsSettings") {
    return <MomentsSettingsScreen onBack={() => setOpen(null)} />;
  }
  if (open === "visibility") {
    return <VisibilityScreen onBack={() => setOpen(null)} />;
  }
  if (open === "safety") {
    /* 安全中心底部的「管理社交账号可见性」直达社交账号页 —— 与 web 的
       href="/me/social" 同一个跳转，全屏接管状态下就是换个 open 值。 */
    return <SafetyScreen onBack={() => setOpen(null)} onOpenSocial={() => setOpen("social")} />;
  }

  const place = [user.city, user.region, user.countryName ?? user.countryCode]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("me.title")}</Text>
      </View>

      {!user.emailVerified ? (
        <View style={styles.group}>
          <Pressable
            onPress={() => setVerifying(true)}
            accessibilityRole="button"
            accessibilityLabel={t("me.verifyEmailCta")}
            style={styles.ctaRow}
          >
            <Icon name="mail-unread-outline" size={18} color={colors.primary} />
            <Text style={styles.ctaLabel}>{t("me.verifyEmailTitle")}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <Pressable
          onPress={() => setAvatarOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("me.avatarChange")}
          hitSlop={6}
        >
          <Avatar uri={user.avatarUrl} nickname={user.nickname} size={72} />
        </Pressable>
        <Text style={styles.name}>{user.nickname ?? t("common.talkfirstUser")}</Text>
        {/* 登录账户名（2026-11-12）。用户名登录上线后，这里是用户能看见自己登录名的唯一位置。 */}
        <Text style={styles.username}>@{user.username}</Text>
        <Text style={styles.email}>{user.email}</Text>
        {place ? <Text style={styles.place}>{place}</Text> : null}
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {user.profileCompleted ? t("me.profileComplete") : t("me.profileIncomplete")}
            </Text>
          </View>
        </View>
      </View>

      {/* 小工具：放在资料卡下方第一屏，不用滚到底部才看得到。 */}
      <View style={styles.group}>
        <Text style={styles.groupTitle}>{t("me.groupTools")}</Text>
        <View style={styles.groupCard}>
          <Pressable
            onPress={() => setOpen("bazi")}
            accessibilityRole="button"
            accessibilityLabel={t("me.baziEntry")}
            style={styles.row}
          >
            <Icon name="brush-outline" size={18} color={colors.primary} />
            <Text style={styles.rowLabel}>{t("me.baziEntry")}</Text>
            <Icon name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {/*
        资料卡上的「个人动态」入口开关。

        放在「我的」而不是「隐私」子页里：它只影响别人点开你头像时看到的那一行，
        不是一个需要进二级页才能理解的权限；而且和资料卡就在同一屏，改了立刻能
        回到上面点头像验证。
      */}
      <View style={styles.group}>
        <Text style={styles.groupTitle}>{t("me.groupMomentsCard")}</Text>
        <View style={styles.groupCard}>
          <View style={styles.switchRow}>
            <Icon name="images-outline" size={18} color={colors.primary} />
            <View style={styles.switchText}>
              <Text style={styles.rowLabel}>{t("me.showMomentsTitle")}</Text>
              <Text style={styles.rowHint}>{t("me.showMomentsHint")}</Text>
            </View>
            <Switch
              checked={momentsOn}
              label={t("me.showMomentsTitle")}
              disabled={savingMoments}
              onChange={(next) => void toggleMoments(next)}
            />
          </View>
        </View>
      </View>

      {!user.profileCompleted ? (
        /* 资料不完整的人应该能自己找到补的入口 —— 引导本来只在注册后出现一次，
           而那次跳过的人当时还什么都不知道。 */
        <View style={styles.group}>
          <Pressable
            onPress={() => setOnboarding(true)}
            accessibilityRole="button"
            accessibilityLabel={t("me.completeCard")}
            style={styles.ctaRow}
          >
            <Icon name="sparkles-outline" size={18} color={colors.primary} />
            <Text style={styles.ctaLabel}>{t("me.completeCard")}</Text>
            <Icon name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        </View>
      ) : null}

      {ME_GROUPS.map((group) => (
        <View key={group.titleKey} style={styles.group}>
          <Text style={styles.groupTitle}>{t(group.titleKey)}</Text>
          <View style={styles.groupCard}>
            {group.entries.map((entry) => (
              <Pressable
                key={entry.key}
                onPress={() => setOpen(entry.key)}
                accessibilityRole="button"
                accessibilityLabel={t(entry.labelKey)}
                style={styles.row}
              >
                <Icon name={entry.icon} size={18} color={colors.primary} />
                <Text style={styles.rowLabel}>{t(entry.labelKey)}</Text>
                <Icon name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <View style={styles.group}>
        <Text style={styles.groupTitle}>{t("me.groupUpdate")}</Text>
        <View style={styles.groupCard}>
          <Pressable
            onPress={() => void runUpdateCheck()}
            disabled={updating}
            accessibilityRole="button"
            accessibilityLabel={t("me.checkUpdate")}
            accessibilityState={{ busy: updating }}
            style={styles.row}
          >
            <Icon name="cloud-download-outline" size={18} color={colors.primary} />
            <Text style={styles.rowLabel}>
              {updating ? t("me.checkingUpdate") : t("me.checkUpdate")}
            </Text>
            {updating ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <Icon name="chevron-forward" size={16} color={colors.muted} />
            )}
          </Pressable>
          {/* 版本号（2026-10-28）：不可点，只读。放在「检查更新」下面是因为
              它回答的正是失败时第一个要问的问题——你现在装的是哪一版。 */}
          <View style={styles.versionRow}>
            <Icon name="information-circle-outline" size={18} color={colors.muted} />
            <Text style={styles.versionLabel}>
              {t("me.versionLabel", { version: formatAppVersion() })}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.moreSoon}>{t("me.moreSoon")}</Text>

      <View style={styles.actions}>
        <Text style={styles.sectionTitle}>{t("me.language")}</Text>
        <View style={styles.languageRow}>
          {LANGUAGE_OPTIONS.map((option) => {
            const active = preference === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setPreference(option.value)}
                accessibilityRole="button"
                /* 颜色不应当独自承载「选中」，所以同时给出 selected 状态。 */
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(option.labelKey)}
                style={[styles.languageChip, active ? styles.languageChipActive : null]}
              >
                <Text style={[styles.languageLabel, active ? styles.languageLabelActive : null]}>
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.languageNote}>{t("me.languageNote")}</Text>
      </View>

      <View style={styles.actions}>
        <Button label={t("me.signOut")} onPress={() => void signOut()} variant="ghost" />
      </View>

      <AvatarViewer
        visible={avatarOpen}
        uri={user.avatarUrl}
        nickname={user.nickname}
        onClose={() => setAvatarOpen(false)}
        actionLabel={t("me.avatarChange")}
        onAction={() => {
          setAvatarOpen(false);
          setOpen("edit");
        }}
      />
    </ScrollView>
  );
}

/** 一条已提交的反馈（`GET /feedback/mine`）。 */
type FeedbackItem = {
  id: string;
  kind: string;
  body: string;
  status: string;
  replyBody: string | null;
  repliedAt: string | null;
  createdAt: string;
};

/**
 * 意见反馈：提交走 `POST /feedback`，历史走 `GET /feedback/mine`
 * （与 web 的 `/me/feedback` 同一套接口）。
 *
 * 2026-10-21：App 之前只能提交、看不到自己提过什么 —— 用户不知道有没有人处理、
 * 官方回了什么，而服务端一直有 `mine` 这个接口。
 */
function FeedbackScreen({ onDone }: { onDone: () => void }) {
  const { t, locale } = useI18n();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: FeedbackItem[] }>("/feedback/mine?pageSize=20");
      setHistory(data.items);
    } catch {
      // 历史拉不到不影响提交：保持为空，不拿一个错误盖住输入框。
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      await apiFetch("/feedback", { method: "POST", body: { content: trimmed } });
      setSent(true);
      setContent("");
      // 刚提交的那条要立刻出现在下面，不能让用户以为没发出去。
      void loadHistory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.loadingFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.page}>
      <SubHeader title={t("me.feedback")} onBack={onDone} />
      <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder={t("me.feedbackPlaceholder")}
          placeholderTextColor={colors.muted}
          style={styles.textArea}
          multiline
          maxLength={2000}
          accessibilityLabel={t("me.feedbackPlaceholder")}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {sent ? <Text style={styles.okText}>{t("me.feedbackSent")}</Text> : null}
        <View style={styles.pageActions}>
          {sending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button label={t("me.feedbackSubmit")} onPress={() => void submit()} />
          )}
        </View>

        {/* 历史：提过什么、处理到哪一步、官方回了什么。 */}
        <Text style={styles.groupTitle}>{t("me.feedbackHistory")}</Text>
        {historyLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : history.length === 0 ? (
          <Text style={styles.historyEmpty}>{t("me.feedbackEmpty")}</Text>
        ) : (
          history.map((item) => (
            <View key={item.id} style={styles.historyItem}>
              <Text style={styles.historyBody}>{item.body}</Text>
              <Text style={styles.historyMeta}>
                {new Date(item.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}
                {" · "}
                {item.replyBody ? t("me.feedbackReplied") : t("me.feedbackHandling")}
              </Text>
              {item.replyBody ? (
                <View style={styles.historyReply}>
                  <Text style={styles.historyReplyLabel}>{t("me.feedbackOfficialReply")}</Text>
                  <Text style={styles.historyBody}>{item.replyBody}</Text>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  content: { paddingBottom: 40 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  title: { fontSize: sizes.title, fontWeight: "600", color: c.ink },
  card: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: radii.card,
    backgroundColor: c.bgSoft,
    alignItems: "center",
    padding: 24,
  },
  name: { fontSize: sizes.title, fontWeight: "600", color: c.ink, marginTop: 12 },
  email: { fontSize: sizes.ui, color: c.muted, marginTop: 4 },
  username: { fontSize: sizes.ui, fontWeight: "600", color: c.ink, marginTop: 4 },
  place: { fontSize: sizes.caption, color: c.muted, marginTop: 4 },
  bio: { fontSize: sizes.ui, color: c.muted, lineHeight: 20, textAlign: "center", marginTop: 12 },
  badgeRow: { flexDirection: "row", marginTop: 16 },
  badge: {
    backgroundColor: c.bgTint,
    borderRadius: radii.control,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { fontSize: sizes.overline, color: c.primary, fontWeight: "500" },

  group: { marginTop: 22, paddingHorizontal: 20 },
  groupTitle: { fontSize: sizes.ui, fontWeight: "600", color: c.muted, marginBottom: 8 },
  groupCard: {
    borderRadius: radii.control,
    backgroundColor: c.glass,
    borderWidth: 1,
    borderColor: c.line,
    overflow: "hidden",
  },
  /* 开关行：图标 + 两行文字 + 右侧开关。文字区 flex:1，短屏也不会把开关挤出去。 */
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  switchText: { flex: 1, gap: 2 },
  rowHint: { fontSize: sizes.caption, color: c.muted, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { flex: 1, fontSize: sizes.body, color: c.ink },
  /* 版本号行：与上面的可点行同构，但没有箭头、没有按压反馈 —— 它只是信息。 */
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
  },
  versionLabel: { flex: 1, fontSize: sizes.ui, color: c.muted },
  moreSoon: { marginTop: 14, paddingHorizontal: 20, fontSize: sizes.caption, color: c.muted },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: c.primary,
    backgroundColor: c.bgTint,
  },
  ctaLabel: { flex: 1, fontSize: sizes.body, color: c.primary, fontWeight: "600" },

  actions: { paddingHorizontal: 20, marginTop: 24 },
  sectionTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  languageRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  languageChip: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.control,
    paddingVertical: 9,
  },
  languageChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  languageLabel: { fontSize: sizes.ui, color: c.muted },
  languageLabelActive: { color: c.white, fontWeight: "600" },
  languageNote: { fontSize: sizes.caption, color: c.muted, lineHeight: 18, marginTop: 8 },

  page: { flex: 1, backgroundColor: c.bg },
  pageBody: { padding: 20, gap: 16 },
  pageActions: { marginTop: 4 },
  textArea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.chip,
    padding: 14,
    fontSize: sizes.body,
    lineHeight: 22,
    color: c.ink,
    backgroundColor: c.glass,
    textAlignVertical: "top",
  },
  errorText: { fontSize: sizes.ui, color: c.danger },
  okText: { fontSize: sizes.ui, color: c.primary },
  historyEmpty: { fontSize: sizes.ui, color: c.muted },
  historyItem: {
    borderTopWidth: 1,
    borderTopColor: c.line,
    paddingTop: 12,
    gap: 6,
  },
  historyBody: { fontSize: sizes.ui, lineHeight: 21, color: c.ink },
  historyMeta: { fontSize: sizes.caption, color: c.muted },
  historyReply: {
    marginTop: 4,
    padding: 12,
    borderRadius: radii.chip,
    backgroundColor: c.bgTint,
    gap: 4,
  },
  historyReplyLabel: { fontSize: sizes.caption, fontWeight: "600", color: c.primaryDark },
}));
