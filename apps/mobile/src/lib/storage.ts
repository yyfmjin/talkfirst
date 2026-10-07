import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "talkfirst.access_token";
const REFRESH_KEY = "talkfirst.refresh_token";
/**
 * 界面语言偏好：`"system"` / `"zh"` / `"en"`。
 *
 * 存在 SecureStore 里而不是另外引一个键值库：已经是依赖了，而它要存的就是
 * 一个短字符串。**没设置过时返回 `null`**（代表跟随系统），而不是 `"system"`
 * —— 让「从没选过」与「显式选了跟随系统」在数据上可区分。
 */
const LOCALE_KEY = "talkfirst.locale";

export async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCESS_KEY);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getLocalePreference(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LOCALE_KEY);
  } catch {
    return null;
  }
}

/** 失败不抛：语言偏好存不住最多是「下次启动回到跟随系统」，不该阻断用户。 */
export async function saveLocalePreference(value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(LOCALE_KEY, value);
  } catch {
    // 忽略：调用方已经把这次选择应用在界面上了。
  }
}
