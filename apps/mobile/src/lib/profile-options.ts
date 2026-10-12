/**
 * 「资料选择」这一族的共享约束与载荷构造。
 *
 * 引导流程与「我的 → 语言·兴趣·交友目的」编辑的是**同一批字段、同一批端点、同一批
 * 数量限制**。这些数字与服务端校验是一份契约：写两份，早晚只改一边 —— 那时的表现是
 * 「界面上放得下、保存却被 400 拒掉」，而两边各自看起来都对。
 *
 * 这里只放常量与纯函数，不放组件：两个页面的交互本来就不同（引导是「下一步」串起来，
 * 编辑页是四个 section 各自保存），能共享的正是这些。
 */

export const INTEREST_MIN = 3;
export const INTEREST_MAX = 20;
export const PURPOSE_MAX = 7;
export const COUNTRY_MAX = 10;
/** 母语 1 门 + 学习语言合计上限（`PUT /users/me/languages` 收 1–8 项）。 */
export const LANGUAGE_MAX = 8;

/** 多选：已选则移除；未选则追加，但到 `max` 就停（并保持原引用，避免多余重渲染）。 */
export function toggleLimited(list: string[], value: string, max: number): string[] {
  if (list.includes(value)) return list.filter((item) => item !== value);
  if (list.length >= max) return list;
  return [...list, value];
}

/**
 * `PUT /users/me/languages` 的载荷。
 *
 * 学习语言里要去掉母语：服务端按 code 去重后会回 400，而在界面上把母语同时标成
 * 「正在学习」是一次很容易发生的误触（同一个语言在两个列表里都出现）。
 */
export function buildLanguageItems(
  nativeCode: string,
  learningCodes: string[],
): Array<{ code: string; type: "NATIVE" | "LEARNING"; level: string }> {
  return [
    { code: nativeCode, type: "NATIVE", level: "NATIVE" },
    ...learningCodes
      .filter((code) => code !== nativeCode)
      .map((code) => ({ code, type: "LEARNING" as const, level: "INTERMEDIATE" })),
  ];
}

/** 出生日期的输入格式：与 web 端 `<input type="date">` 提交的 `YYYY-MM-DD` 一致。 */
const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * 出生日期（`YYYY-MM-DD`）→ 周岁；格式不对或日期无效返回 null。
 *
 * 移动端没有原生的日期选择器（要新依赖），所以填的是一个文本框 —— 因此这里必须
 * 自己把格式挡在发请求之前，否则 `PATCH /users/me` 会因为一个 `NaN` 日期失败。
 */
export function ageFromBirthDateInput(value: string): number | null {
  const trimmed = value.trim();
  if (!BIRTH_DATE_PATTERN.test(trimmed)) return null;
  const birth = new Date(trimmed);
  if (Number.isNaN(birth.getTime())) return null;
  /* `2026-02-30` 这类「格式对但日子不存在」的串会被 Date 滚到下个月，
     比对回原始串即可识别（Date 的 ISO 解析是严格的，滚了就对不上）。 */
  if (birth.toISOString().slice(0, 10) !== trimmed) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/** 账号的最低年龄（与 web 引导一致）。 */
export const MIN_AGE = 18;

export const GENDER_VALUES = ["MALE", "FEMALE", "OTHER", "UNKNOWN"] as const;
export type GenderValue = (typeof GENDER_VALUES)[number];
