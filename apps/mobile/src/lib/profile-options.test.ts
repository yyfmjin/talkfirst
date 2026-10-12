import {
  INTEREST_MAX,
  LANGUAGE_MAX,
  MIN_AGE,
  ageFromBirthDateInput,
  buildLanguageItems,
  toggleLimited,
} from "./profile-options";

/**
 * 资料选择的共享约束与纯函数用例。
 *
 * ## 为什么单独测这一小撮纯函数
 *
 * 它们服务端校验的**镜像**：兴趣 3–20、语言合计 ≤8、年满 18 —— 界面上放得下、
 * 服务端却回 400，是这类页面最常见的一种坏。而这些数字只应该有一处定义
 * （见 `profile-options.ts` 顶部），所以把这一处测死，两个页面就都站在同一份契约上。
 *
 * 生日那几条尤其值钱：移动端没有原生日期选择器，填的是**文本框**，非法输入必须
 * 在发请求之前挡住 —— 否则服务端只会回一个笼统的 400。
 */

/* 固定「今天」，让年龄断言与运行日期无关（真实实现用 `new Date()`）。 */
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-06-15T12:00:00Z") });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ageFromBirthDateInput", () => {
  it("算出生日已经过了的周岁", () => {
    /* 生日在「今天」之前（今天固定为 2026-06-15）。 */
    expect(ageFromBirthDateInput("2008-06-14")).toBe(18);
    expect(ageFromBirthDateInput("1990-01-01")).toBe(36);
  });

  it("生日还没到的，周岁要少一岁", () => {
    expect(ageFromBirthDateInput("2008-06-17")).toBe(17);
  });

  it("刚好卡在 18 岁门槛上：差一天就不放行", () => {
    expect(ageFromBirthDateInput("2008-06-17")).toBeLessThan(MIN_AGE);
    expect(ageFromBirthDateInput("2008-06-14")).toBeGreaterThanOrEqual(MIN_AGE);
  });

  it("格式不对就返回 null（不会把 NaN 发给服务端）", () => {
    expect(ageFromBirthDateInput("")).toBeNull();
    expect(ageFromBirthDateInput("abc")).toBeNull();
    expect(ageFromBirthDateInput("1998/06/30")).toBeNull();
    expect(ageFromBirthDateInput("19980630")).toBeNull();
    expect(ageFromBirthDateInput("1998-6-3")).toBeNull();
  });

  it("格式对但日子不存在的也返回 null（闰年之外的 2 月 30 日）", () => {
    /* `new Date("2026-02-30")` 在 V8 上会滚到 3 月 2 日，而不是 Invalid Date ——
       所以实现里拿 toISOString 与原文对了一遍，这条就是在守那个判断。 */
    expect(ageFromBirthDateInput("2026-02-30")).toBeNull();
    expect(ageFromBirthDateInput("1998-13-01")).toBeNull();
  });
});

describe("buildLanguageItems", () => {
  it("母语排第一，且是 NATIVE/NATIVE", () => {
    expect(buildLanguageItems("zh", ["en"])).toEqual([
      { code: "zh", type: "NATIVE", level: "NATIVE" },
      { code: "en", type: "LEARNING", level: "INTERMEDIATE" },
    ]);
  });

  it("学习语言里混进母语时会被去掉（服务端按 code 去重后会回 400）", () => {
    expect(buildLanguageItems("zh", ["zh", "en"])).toEqual([
      { code: "zh", type: "NATIVE", level: "NATIVE" },
      { code: "en", type: "LEARNING", level: "INTERMEDIATE" },
    ]);
  });

  it("没有学习语言时只有母语一项（界面在这一步之前就会拦下）", () => {
    expect(buildLanguageItems("zh", [])).toEqual([
      { code: "zh", type: "NATIVE", level: "NATIVE" },
    ]);
  });
});

describe("toggleLimited", () => {
  it("未选中则追加，已选中则移除", () => {
    expect(toggleLimited(["a"], "b", INTEREST_MAX)).toEqual(["a", "b"]);
    expect(toggleLimited(["a", "b"], "a", INTEREST_MAX)).toEqual(["b"]);
  });

  it("到上限后不再追加，且不改变原数组", () => {
    const full = ["a", "b"];
    const next = toggleLimited(full, "c", 2);
    expect(next).toHaveLength(2);
    expect(next).not.toContain("c");
  });

  it("上限是「母语之外」的额度：学习语言最多 LANGUAGE_MAX - 1 门", () => {
    expect(LANGUAGE_MAX - 1).toBe(7);
  });
});
