"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  Globe2,
  KeyRound,
  Languages,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { AttributeTagList } from "@/components/attribute-tags";
import {
  TFBadge,
  TFButton,
  TFCard,
  TFDialog,
  TFErrorState,
  TFInput,
  TFListRow,
  TFSectionHeader,
} from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { type AttributeGroups } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { AvatarActionSheet, ClickableAvatar } from "@/components/avatar-actions";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { localePath, type MsgKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

type FullProfile = {
  /**
   * P0-02 — the account name used to sign in. It is not optional: `GET /users/me`
   * returns it for every account, including the pre-existing ones the migration
   * backfilled.
   */
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  bio: string | null;
  isAdmin?: boolean;
  status?: string;
  languages: Array<{ code: string; name: string; nativeName: string | null; level: string }>;
  interests: Array<{ name: string; nameZh: string | null }>;
  attributes: AttributeGroups;
};

const EMPTY_ATTRIBUTES: AttributeGroups = { aboutMe: [], lookingFor: [] };

/**
 * The 「我的」 entry list, grouped the way the brief asks for it.
 *
 * Two things changed in Phase B beyond the visual pass:
 *
 *  1. **The list is grouped, not flat.** Six identical full-width primary
 *     buttons in a column destroyed the action hierarchy — every entry looked
 *     like the most important one, so none of them did. Groups (内容 / 账号 /
 *     隐私与安全) each with a heading and chevron rows reads as navigation
 *     instead of as a stack of CTAs.
 *  2. **连接 is reachable again.** It used to own a bottom-nav slot; when the nav
 *     was reduced to the brief's five slots, `/connections` became an orphan —
 *     `grep 'href="/connections"'` found no caller in the entire app, so the
 *     route (and the relationship list, and the entry point to contact exchange)
 *     was unreachable. It lives here now.
 */
const ENTRY_GROUPS: Array<{
  titleKey: MsgKey;
  entries: Array<{ href: string; labelKey: MsgKey; hintKey?: MsgKey; icon: typeof UserRound; localized?: boolean }>;
}> = [
  {
    titleKey: "me.groupContent",
    entries: [
      { href: "/me/edit", labelKey: "me.editBasic", icon: UserRound },
      { href: "/me/interests", labelKey: "me.interestLanguages", icon: Languages },
      { href: "/me/attributes", labelKey: "me.attributes", hintKey: "me.attributesHint", icon: Sparkles },
    ],
  },
  {
    titleKey: "me.groupRelations",
    entries: [
      { href: "/connections", labelKey: "me.connections", hintKey: "me.connectionsHint", icon: Users, localized: true },
      { href: "/me/social", labelKey: "me.social", icon: Globe2 },
    ],
  },
  {
    titleKey: "me.groupPrivacy",
    entries: [
      { href: "/me/visibility", labelKey: "me.visibility", icon: Eye },
      { href: "/me/safety", labelKey: "me.safety", hintKey: "me.safetyHint", icon: ShieldCheck },
    ],
  },
  {
    /**
     * A group of its own rather than one more row under 隐私与安全.
     *
     * The existing groups answer "who can see me" and "who can reach me". This answers
     * "how do I reach the team", which is neither: it is the one screen a member opens
     * when something is wrong, so it sits apart and is not competing for attention with
     * routine privacy settings.
     */
    titleKey: "me.groupHelp",
    entries: [
      { href: "/me/feedback", labelKey: "me.feedback", hintKey: "me.feedbackHint", icon: MessageSquare },
    ],
  },
];

export default function MePage() {
  const router = useRouter();
  const { setUser } = useSession();
  const { locale, t } = useT();
  const deletePhrase = t("me.deletePhrase");
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<FullProfile>("/users/me");
      setProfile(data);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.message.includes("Unauthorized")) {
        router.replace("/login");
        return;
      }
      setError(friendlyErrorMessage(requestError, t("me.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Sign out.
   *
   * The local session is cleared and the navigation happens in `finally`, not
   * only on success: once the user asked to leave, a failed
   * `POST /auth/logout` (server down, refresh cookie already expired) must not
   * strand them on a signed-in-looking screen with a token they can no longer
   * use. The server call is still worth making — it is what revokes the refresh
   * cookie — but it is not a precondition for forgetting the user locally.
   */
  async function logout() {
    setLoggingOut(true);
    setAccountError("");
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Deliberately ignored: nothing left on this device depends on it.
    } finally {
      setUser(null);
      setLoggingOut(false);
      router.replace("/login");
    }
  }

  /**
   * Delete the account.
   *
   * Unlike logout, this one is irreversible and is refused unless the user typed
   * the confirmation phrase — the button's `disabled` state is the guard, and
   * the API is never called while the phrase is wrong. Logout deliberately does
   * *not* ask for this: signing back in restores everything, so a typed
   * confirmation there would only train people to type it without reading.
   */
  async function deleteAccount() {
    if (confirmText.trim() !== deletePhrase) return;
    setDeleting(true);
    setAccountError("");
    try {
      await apiFetch("/users/me", { method: "DELETE" });
      setConfirmOpen(false);
      // The account no longer exists, so the cached user is cleared before
      // leaving: the landing page must not render as a signed-in visitor.
      setUser(null);
      router.replace("/");
    } catch (requestError) {
      // The dialog stays open with its text intact so the user can retry
      // without retyping the phrase.
      setAccountError(friendlyErrorMessage(requestError, t("me.deleteFailed")));
    } finally {
      setDeleting(false);
    }
  }

  const attributes = profile?.attributes ?? EMPTY_ATTRIBUTES;
  const place = [profile?.city, profile?.region, profile?.countryCode].filter(Boolean).join(" · ");

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto pb-6">
        {/* Identity. The avatar replaces a 72px logo mark: on your own profile the
            most important thing to see is *you*, and rendering the brand where a
            face belongs made every account look identical at a glance. */}
        <div className="flex flex-col items-center px-5 pt-8">
          <ClickableAvatar
            avatarUrl={profile?.avatarUrl ?? null}
            name={profile?.nickname ?? null}
            size="xl"
            onClick={() => setAvatarSheetOpen(true)}
          />
          <h1 className="mt-4 text-title font-semibold text-content">
            {profile?.nickname ?? (loading ? t("common.loading") : t("me.myCard"))}
          </h1>
          {place ? <p className="mt-1 text-caption text-content-muted">{place}</p> : null}
          {profile?.isAdmin ? (
            <TFBadge tone="warning" className="mt-2">
              {t("me.admin")}
            </TFBadge>
          ) : null}
          {profile?.bio ? (
            <p className="mt-3 max-w-[280px] text-center text-ui leading-6 text-content-muted">{profile.bio}</p>
          ) : null}

          {profile && profile.interests.length > 0 ? (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {profile.interests.map((item) => (
                <TFBadge key={item.name} tone="brand">
                  {item.nameZh ?? item.name}
                </TFBadge>
              ))}
            </div>
          ) : null}

          {profile ? (
            <p className="mt-4 text-center text-caption text-content-muted">
              {t("me.languagesLabel", { languages: profile.languages.map((item) => item.nativeName ?? item.name).join("、") || "—" })}
            </p>
          ) : null}
        </div>

        {/* Profile attributes. Kept in a quiet card rather than as another list of
            rows — they are content, not navigation, and the two are easy to
            confuse when both are plain text on the same background. */}
        {attributes.aboutMe.length > 0 || attributes.lookingFor.length > 0 ? (
          <div className="mt-5 px-5">
            <TFCard tone="quiet">
              {attributes.aboutMe.length > 0 ? (
                <div>
                  <p className="mb-2 text-caption font-medium text-content-muted">{t("me.aboutMe")}</p>
                  <AttributeTagList attributes={attributes.aboutMe} tone="about" limit={6} showRetired />
                </div>
              ) : null}
              {attributes.lookingFor.length > 0 ? (
                <div className={attributes.aboutMe.length > 0 ? "mt-4" : undefined}>
                  <p className="mb-2 text-caption font-medium text-content-muted">{t("me.lookingFor")}</p>
                  <AttributeTagList attributes={attributes.lookingFor} tone="looking" limit={6} showRetired />
                </div>
              ) : null}
            </TFCard>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {/* Navigation, grouped. See ENTRY_GROUPS for why this is not a flat list
            of six identical buttons any more. */}
        <div className="mt-5 px-5">
          <LocaleSwitcher locale={locale} path="/me" tone="muted" />
        </div>
        {ENTRY_GROUPS.map((group) => (
          <section key={group.titleKey} className="mt-5">
            <TFSectionHeader title={t(group.titleKey)} />
            <div className="mx-4 overflow-hidden rounded-card border border-border bg-surface">
              {group.entries.map((entry, index) => {
                const Icon = entry.icon;
                return (
                  <div key={entry.href} className={index > 0 ? "border-t border-border" : undefined}>
                    <TFListRow
                      icon={<Icon size={17} />}
                      title={t(entry.labelKey)}
                      subtitle={entry.hintKey ? t(entry.hintKey) : undefined}
                      href={entry.localized ? localePath(locale, entry.href) : entry.href}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Account-level settings that are not content, not relationships. */}
        <section className="mt-5">
          <TFSectionHeader title={t("me.account")} />
          <div className="mx-4 overflow-hidden rounded-card border border-border bg-surface">
            {/*
              P0-02 — the account name, and it is shown rather than edited.

              Shown because it is a sign-in identifier: a member who registered
              with an e-mail address may never have seen the name the system
              generated for them, and "what do I type to sign in" is not a question
              the account screen should leave open.

              Read-only because changing it is its own change: it needs a
              uniqueness check, the reserved-word rules, a rate limit and a decision
              about sessions already in flight. None of that is part of adding the
              field, so it is not smuggled in here.
            */}
            <TFListRow
              icon={<UserRound size={17} />}
              title={t("me.accountName")}
              subtitle={profile ? `@${profile.username}` : t("me.reading")}
            />
            <div className="border-t border-border">
              <TFListRow icon={<KeyRound size={17} />} title={t("me.changePassword")} href="/me/password" />
            </div>
            {profile?.isAdmin ? (
              <div className="border-t border-border">
                <TFListRow icon={<ShieldCheck size={17} />} title={t("me.adminConsole")} href="/admin" />
              </div>
            ) : (
              <div className="border-t border-border">
                <TFListRow
                  icon={<Lock size={17} />}
                  title={t("me.adminConsole")}
                  subtitle={t("me.adminConsoleHint")}
                />
              </div>
            )}
          </div>
        </section>

        {/*
          Destructive actions, last and visually separated.

          They lived nowhere before the audit: `/auth/logout` and `DELETE /users/me`
          had no caller in the whole web app, so a signed-in user could not end a
          session on a shared device and could not leave TalkFirst at all.
        */}
        <section className="mt-5 px-4">
          {accountError && !confirmOpen ? (
            <p role="alert" className="mb-2 break-words text-center text-caption text-danger-600">
              {accountError}
            </p>
          ) : null}
          <TFButton
            variant="secondary"
            fullWidth
            onClick={() => void logout()}
            loading={loggingOut}
            loadingLabel={t("me.loggingOut")}
            data-testid="logout"
          >
            {t("me.logout")}
          </TFButton>
          <TFButton
            variant="ghost"
            fullWidth
            className="mt-1.5 text-danger-600 hover:bg-danger-50"
            data-testid="delete-account"
            onClick={() => {
              setConfirmText("");
              setAccountError("");
              setConfirmOpen(true);
            }}
          >
            {t("me.deleteAccount")}
          </TFButton>
          <p className="mt-2 text-center text-caption leading-4 text-content-subtle">
            {t("me.deleteAccountWarning")}
          </p>
        </section>
      </div>

      {/*
        The irreversible confirmation. It demands a typed phrase because there is
        no undo — a plain 「确定/取消」 pair is dismissed by reflex, whereas typing
        the word forces the user to read what they are about to destroy. Logout
        deliberately does not ask for this: signing back in restores everything.
      */}
      <TFDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setAccountError("");
        }}
        title={t("me.deleteConfirmTitle")}
        description={t("me.deleteConfirmDescription", { phrase: deletePhrase })}
        footer={
          <>
            <TFButton
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setConfirmOpen(false);
                setAccountError("");
              }}
            >
              {t("common.cancel")}
            </TFButton>
            <TFButton
              variant="danger"
              className="flex-1"
              onClick={() => void deleteAccount()}
              disabled={confirmText.trim() !== deletePhrase}
              loading={deleting}
              loadingLabel={t("me.deleting")}
              data-testid="delete-account-confirm"
            >
              {t("me.confirmDelete")}
            </TFButton>
          </>
        }
      >
        <TFInput
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={deletePhrase}
          aria-label={t("me.deleteConfirmAria", { phrase: deletePhrase })}
          data-testid="delete-account-confirm-input"
          className="text-center"
          autoComplete="off"
        />
        {accountError ? (
          <p role="alert" className="mt-2 break-words text-caption text-danger-600">
            {accountError}
          </p>
        ) : null}
      </TFDialog>

      <AvatarActionSheet
        open={avatarSheetOpen}
        onClose={() => setAvatarSheetOpen(false)}
        avatarUrl={profile?.avatarUrl ?? null}
        name={profile?.nickname ?? null}
        onAvatarUpdated={(newUrl) => {
          setProfile((prev) => (prev ? { ...prev, avatarUrl: newUrl } : prev));
        }}
      />

      <TabBar active="/me" />
    </PhoneShell>
  );
}
