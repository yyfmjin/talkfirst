import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { CountryField, FieldHint, GenderField } from "../components/ProfileFields";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { ageFromBirthDateInput, MIN_AGE, type GenderValue } from "../lib/profile-options";
import type { CountryOption, SessionUser } from "../lib/types";
import { colors } from "../theme";

/**
 * 编辑基本资料 —— 对齐 web 的 `/me/edit`。
 *
 * ## 与引导流程共用控件，不共用文案
 *
 * 生日 / 国家 / 性别三项和注册后的引导流程是同一批字段，控件直接复用
 * （`ProfileFields` 的 `CountryField` / `GenderField`、`ageFromBirthDateInput`），
 * 校验口径也就跟着一致 —— 两处各写一份的话，迟早是「引导里 18 岁能过、这里 18 岁
 * 过不去」这类只在特定入口才出现的分歧。
 *
 * 但**文案各用各的**：这张页面属于「我的」，不是引导，词典键走 `me.*`
 * （引导用的是 `onboarding.*`）。同一个意思两处各写一句是成本，混用键才是麻烦 ——
 * 翻译看到 `onboarding.errAge` 出现在编辑页，只能靠猜。
 *
 * ## 头像为什么不跟着 PATCH 一起提交
 *
 * `POST /uploads/avatar` 自己就写库（返回 `{ avatarUrl }`），它不是一个「暂存」接口。
 * 若再叠一次 PATCH 把同一个 URL 发回去，只是把同一张图重复写一遍；更糟的是：
 * 用户换完头像又直接返回（不点保存），头像其实已经生效了 —— 界面却可能因为没保存
 * 而看起来"没变"。所以选完图立刻提交、立刻更新会话，并把这件事说明在界面上。
 *
 * ## 预填以服务端为准，不用会话缓存
 *
 * 会话里的 `user` 是 App 启动时拉的，放一晚上就可能比库里旧（在 web 上换过头像、
 * 改过昵称的话）。web 的 `/me/edit` 出于同样理由先读一遍 `/users/me` 再填表单。
 * 拉不到就退回会话里的值 —— 表单不该被一次读请求挡住。
 *
 * ## 只发该发的字段
 *
 * `PATCH /users/me` 是部分更新。生日与国家**留空时不发**：服务端对它们有格式校验
 * （`birthDate` 必须 `YYYY-MM-DD`、`countryCode` 必须两位字母），空字符串会被判成
 * 非法输入而不是「清空」。昵称 / 简介 / 城市 / 省州可以清空，所以照发。
 */

/** 与服务端 `UploadsController.uploadAvatar` 的上限一致（base64 字符串长度）。 */
const AVATAR_MAX_CHARS = 7_000_000;

/** 昵称长度：与服务端 `UpdateProfileDto` 的 `@Length(2, 24)` 一致。 */
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 24;

export function EditProfileScreen({
  user,
  onDone,
  onUserChange,
}: {
  user: SessionUser;
  onDone: () => void;
  /** 会话里的用户需要跟着更新（预填、换头像、保存三处都会调）。 */
  onUserChange: (user: SessionUser) => void;
}) {
  const { t } = useI18n();
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [nickname, setNickname] = useState(user.nickname ?? "");
  /* 服务端存的是时间戳，输入框要的是 `YYYY-MM-DD`（与 web 同一切片方式）。 */
  const [birthDate, setBirthDate] = useState(user.birthDate ? user.birthDate.slice(0, 10) : "");
  const [countryCode, setCountryCode] = useState(user.countryCode ?? "");
  const [region, setRegion] = useState(user.region ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [gender, setGender] = useState<GenderValue>((user.gender as GenderValue | null) ?? "UNKNOWN");
  const [bio, setBio] = useState(user.bio ?? "");

  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /* 把一份资料填进表单 —— 预填与保存后的回读共用，两处口径不会漂。 */
  function applyProfile(source: SessionUser) {
    setNickname(source.nickname ?? "");
    setBio(source.bio ?? "");
    setCity(source.city ?? "");
    setRegion(source.region ?? "");
    setBirthDate(source.birthDate ? source.birthDate.slice(0, 10) : "");
    setCountryCode(source.countryCode ?? "");
    setGender((source.gender as GenderValue | null) ?? "UNKNOWN");
    setAvatarUrl(source.avatarUrl ?? "");
  }

  /*
   * 国家清单单独拉、拉不到也不挡整页：清单为空时国家那一栏只显示占位符，其余字段
   * 照样能改能存。把整页卡在一个下拉数据上，是最不划算的失败方式。
   */
  useEffect(() => {
    void apiFetch<CountryOption[]>("/meta/countries")
      .then(setCountries)
      .catch(() => setCountries([]));
  }, []);

  /* 预填用服务端的值；失败就保留上面那份会话里的初始值。 */
  useEffect(() => {
    let cancelled = false;
    void apiFetch<SessionUser>("/users/me")
      .then((fresh) => {
        if (cancelled) return;
        applyProfile(fresh);
        onUserChange(fresh);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // 只在挂载时拉一次；onUserChange 是外层 setState，换引用不该重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickAvatar() {
    if (picking || saving) return;
    setPicking(true);
    setError("");
    setMessage("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) {
        setError(t("me.avatarReadFailed"));
        return;
      }
      const dataUrl = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
      if (dataUrl.length > AVATAR_MAX_CHARS) {
        setError(t("me.avatarTooLarge"));
        return;
      }
      const updated = await apiFetch<{ avatarUrl: string }>("/uploads/avatar", {
        method: "POST",
        body: { image: dataUrl },
      });
      setAvatarUrl(updated.avatarUrl);
      onUserChange({ ...user, avatarUrl: updated.avatarUrl });
      setMessage(t("me.avatarUpdated"));
    } catch {
      setError(t("me.avatarUploadFailed"));
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    if (saving) return;
    const trimmedNickname = nickname.trim();
    if (trimmedNickname.length < NICKNAME_MIN) {
      setError(t("me.errNicknameMin", { n: NICKNAME_MIN }));
      return;
    }
    if (trimmedNickname.length > NICKNAME_MAX) {
      setError(t("me.errNicknameMax", { n: NICKNAME_MAX }));
      return;
    }
    /* 生日可以留空（编辑不是注册，不能把人卡在「必须填生日」），但一旦填了就得是
       一个真的够岁数的日期。 */
    const trimmedBirthDate = birthDate.trim();
    if (trimmedBirthDate) {
      const age = ageFromBirthDateInput(trimmedBirthDate);
      if (age === null) {
        setError(t("me.errBirthDate"));
        return;
      }
      if (age < MIN_AGE) {
        setError(t("me.errAge", { n: MIN_AGE }));
        return;
      }
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiFetch<SessionUser>("/users/me", {
        method: "PATCH",
        body: {
          nickname: trimmedNickname,
          bio: bio.trim(),
          city: city.trim(),
          region: region.trim(),
          gender,
          ...(trimmedBirthDate ? { birthDate: trimmedBirthDate } : {}),
          ...(countryCode ? { countryCode } : {}),
        },
      });
      /*
       * 写完**再读一遍**，而不是拿 PATCH 的返回值当界面状态。这一步才证明改动真的
       * 落库了（web 的 `/me/edit` 出于同样理由这么做），也顺手拿到服务端归一化后的
       * 值 —— 界面上显示的从此就是"存在库里的东西"。
       */
      const fresh = await apiFetch<SessionUser>("/users/me");
      onUserChange(fresh);
      applyProfile(fresh);
      setMessage(t("me.saved"));
    } catch {
      setError(t("me.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  /* 边填边给年龄反馈：等到点保存才说「不够 18 岁」太晚了（与引导流程一致）。 */
  const age = birthDate.trim() ? ageFromBirthDateInput(birthDate) : null;

  return (
    <View style={styles.root}>
      <SubHeader title={t("me.editProfile")} onBack={onDone} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => void pickAvatar()}
          disabled={picking || saving}
          accessibilityRole="button"
          accessibilityLabel={t("me.avatarChange")}
          style={styles.avatarRow}
        >
          <Avatar uri={avatarUrl || null} nickname={nickname || null} size={72} />
          <View style={styles.avatarText}>
            <Text style={styles.avatarAction}>
              {picking ? t("me.avatarUploading") : t("me.avatarChange")}
            </Text>
            {/* 说明「选完就生效」，这样用户不会带着「还没保存」的误解返回。 */}
            <Text style={styles.avatarHint}>{t("me.avatarHint")}</Text>
          </View>
          {picking ? <ActivityIndicator color={colors.primary} /> : null}
        </Pressable>

        <Input
          label={t("me.nickname")}
          value={nickname}
          onChangeText={setNickname}
          placeholder={t("me.nicknamePlaceholder")}
          autoCapitalize="words"
          maxLength={NICKNAME_MAX}
        />

        <Input
          label={t("me.birthDate")}
          value={birthDate}
          onChangeText={setBirthDate}
          placeholder={t("me.birthDatePlaceholder")}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        {age === null ? null : (
          <FieldHint
            text={age >= MIN_AGE ? t("me.ageOk", { n: age }) : t("me.errAge", { n: MIN_AGE })}
            tone={age >= MIN_AGE ? "muted" : "danger"}
          />
        )}

        <CountryField
          label={t("me.country")}
          countries={countries}
          value={countryCode}
          onChange={setCountryCode}
        />

        <Input
          label={t("me.region")}
          value={region}
          onChangeText={setRegion}
          placeholder={t("me.regionPlaceholder")}
          autoCapitalize="words"
          maxLength={80}
        />

        <Input
          label={t("me.city")}
          value={city}
          onChangeText={setCity}
          placeholder={t("me.cityPlaceholder")}
          autoCapitalize="words"
          maxLength={80}
        />

        <GenderField label={t("me.gender")} value={gender} onChange={setGender} />

        <Input
          label={t("me.bio")}
          value={bio}
          onChangeText={setBio}
          placeholder={t("me.bioPlaceholder")}
          multiline
          maxLength={500}
        />

        {error ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {message ? <Text style={styles.okText}>{message}</Text> : null}

        <View style={styles.actions}>
          <Button label={t("me.save")} onPress={() => void save()} loading={saving} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 20,
  },
  avatarText: { flex: 1, gap: 4 },
  avatarAction: { fontSize: 15, fontWeight: "600", color: colors.primaryDark },
  avatarHint: { fontSize: 12, lineHeight: 18, color: colors.muted },
  errorText: { fontSize: 13, lineHeight: 19, color: colors.danger },
  okText: { fontSize: 13, color: colors.primary },
  actions: { marginTop: 8 },
});
