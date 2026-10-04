import {
  checkUsername,
  generateUsername,
  isReservedUsername,
  isUsernameConflict,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "./username";

/**
 * P0-02 — the account-name rules.
 *
 * These are asserted here rather than through `AuthService` because they are the
 * part a change is most likely to break silently: a loosened alphabet or a
 * dropped reserved word still produces a working sign-up, so nothing else in the
 * suite would notice.
 */

describe("normalizeUsername", () => {
  it("trim 并转小写", () => {
    expect(normalizeUsername("  Alice123  ")).toBe("alice123");
  });

  it("去掉开头的 @（用户会那样写）", () => {
    expect(normalizeUsername("@Alice123")).toBe("alice123");
    expect(normalizeUsername("@@alice123")).toBe("alice123");
  });

  it("只去掉开头的 @，不碰别的位置", () => {
    // 用户名本身不允许含 @，所以这里只是证明函数不会顺手删掉中间的内容。
    expect(normalizeUsername("a@b")).toBe("a@b");
  });
});

describe("checkUsername — 格式", () => {
  it("纯字母、纯数字、字母数字混合都接受", () => {
    expect(checkUsername("abcdefgh")).toEqual({ ok: true, value: "abcdefgh" });
    expect(checkUsername("12345678")).toEqual({ ok: true, value: "12345678" });
    expect(checkUsername("a1b2c3d4")).toEqual({ ok: true, value: "a1b2c3d4" });
  });

  it("大小写归一为小写后再存", () => {
    const result = checkUsername("AbCdEfGh");
    expect(result).toEqual({ ok: true, value: "abcdefgh" });
  });

  it("下限 8 位：7 位拒绝、8 位接受", () => {
    expect(checkUsername("abcdefg")).toMatchObject({ ok: false, code: "USERNAME_INVALID" });
    expect(checkUsername("abcdefgh")).toMatchObject({ ok: true });
  });

  it("上限 30 位：30 位接受、31 位拒绝", () => {
    expect(checkUsername("a".repeat(USERNAME_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(checkUsername("a".repeat(USERNAME_MAX_LENGTH + 1))).toMatchObject({
      ok: false,
      code: "USERNAME_INVALID",
    });
  });

  it("含符号、空格、连字符、下划线都拒绝", () => {
    for (const bad of ["abc defg", "abcd-efg", "abcd_efg", "abcd.efg", "abcd+efg", "abcdefg!"]) {
      expect(checkUsername(bad)).toMatchObject({ ok: false, code: "USERNAME_INVALID" });
    }
  });

  it("含 @ 的邮箱形状被拒绝（它不是账户名）", () => {
    expect(checkUsername("alice@example.com")).toMatchObject({
      ok: false,
      code: "USERNAME_INVALID",
    });
  });

  it("空串与纯空白被拒绝", () => {
    expect(checkUsername("")).toMatchObject({ ok: false, code: "USERNAME_INVALID" });
    expect(checkUsername("        ")).toMatchObject({ ok: false, code: "USERNAME_INVALID" });
  });

  it("归一化后再判断长度：带 @ 前缀的 8 位仍是合法的", () => {
    expect(checkUsername("@abcdefg")).toMatchObject({ ok: false }); // 归一化后只有 7 位
    expect(checkUsername("@abcdefgh")).toEqual({ ok: true, value: "abcdefgh" });
  });

  it("拒绝时不要回显输入（否则成了保留字过滤器的一次探测）", () => {
    const result = checkUsername("admin123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("admin123");
  });
});

describe("保留字", () => {
  it("包含 admin / root 等敏感词的都拒绝（按子串，不是相等）", () => {
    for (const bad of [
      "admin1234",
      "myadmin12",
      "iamadmin1",
      "rootuser1",
      "myroots11",
      "superuser",
      "sysadmin12",
      "official01",
      "support001",
      "talkfirst1",
      "security01",
    ]) {
      expect(checkUsername(bad)).toMatchObject({ ok: false, code: "USERNAME_RESERVED" });
      expect(isReservedUsername(bad)).toBe(true);
    }
  });

  it("短词只在「整个名字就是它」时拒绝", () => {
    expect(checkUsername("api")).toMatchObject({ ok: false, code: "USERNAME_RESERVED" });
    expect(checkUsername("help")).toMatchObject({ ok: false, code: "USERNAME_RESERVED" });
    expect(checkUsername("www")).toMatchObject({ ok: false, code: "USERNAME_RESERVED" });
  });

  it("不会因为子串规则误伤普通名字（这是两段式列表存在的理由）", () => {
    // `api` 若按子串匹配，这三个都会被杀掉。
    for (const good of ["capital1", "rapid2024", "therapist1"]) {
      expect(checkUsername(good)).toMatchObject({ ok: true });
    }
  });

  it("格式与保留字是两种不同的失败（UI 要分开提示）", () => {
    expect(checkUsername("admin1234")).toMatchObject({ code: "USERNAME_RESERVED" });
    expect(checkUsername("abcd!")).toMatchObject({ code: "USERNAME_INVALID" });
    expect(checkUsername("abcde123")).toMatchObject({ ok: true });
  });

  it("同时既走格式又含保留词时，报保留字（保留字检查必须先跑）", () => {
    // 这条锁住的是一个真实的实现缺陷：若格式检查先跑，8 位以下的确切保留字
    // （api / www / help / me …）永远走不到保留字分支，只能报「格式不对」——
    // 那会让用户去试 api12345，而它同样被拒，只是换了个理由。
    expect(checkUsername("admin!")).toMatchObject({ code: "USERNAME_RESERVED" });
    expect(checkUsername("api")).toMatchObject({ code: "USERNAME_RESERVED" });
    expect(checkUsername("me")).toMatchObject({ code: "USERNAME_RESERVED" });
    expect(checkUsername("undefined")).toMatchObject({ code: "USERNAME_RESERVED" });
  });
});

describe("USERNAME_PATTERN", () => {
  it("与实际接受集合一致", () => {
    expect(USERNAME_PATTERN.test("a".repeat(USERNAME_MIN_LENGTH))).toBe(true);
    expect(USERNAME_PATTERN.test("a".repeat(USERNAME_MIN_LENGTH - 1))).toBe(false);
    expect(USERNAME_PATTERN.test("abc-DEFG")).toBe(false);
  });
});

describe("generateUsername — 老账号与新注册的兜底", () => {
  it("长度 10，且只含字母数字", () => {
    for (let i = 0; i < 200; i += 1) {
      const value = generateUsername();
      expect(value).toHaveLength(10);
      expect(USERNAME_PATTERN.test(value)).toBe(true);
    }
  });

  it("刻意不使用易混字符 0 / 1 / l / i / o（要能被念出来、手打出来）", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateUsername()).not.toMatch(/[01lio]/);
    }
  });

  it("生成的永远不是保留字", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isReservedUsername(generateUsername())).toBe(false);
    }
  });

  it("不会重复（500 次抽样）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateUsername());
    expect(seen.size).toBe(500);
  });
});

describe("isUsernameConflict", () => {
  it("识别 meta.target 为列名数组的情况", () => {
    expect(isUsernameConflict({ code: "P2002", meta: { target: ["username"] } })).toBe(true);
  });

  it("识别 meta.target 为索引名（字符串）的情况", () => {
    expect(isUsernameConflict({ code: "P2002", meta: { target: "User_username_key" } })).toBe(true);
  });

  it("邮箱或其他列的冲突不算", () => {
    expect(isUsernameConflict({ code: "P2002", meta: { target: ["email"] } })).toBe(false);
    expect(isUsernameConflict({ code: "P2002", meta: { target: "User_email_key" } })).toBe(false);
  });

  it("其他 Prisma 错误码与畸形输入都不算", () => {
    expect(isUsernameConflict({ code: "P2025" })).toBe(false);
    expect(isUsernameConflict({ code: "P2002" })).toBe(false); // 没有 meta
    expect(isUsernameConflict(null)).toBe(false);
    expect(isUsernameConflict(undefined)).toBe(false);
    expect(isUsernameConflict("P2002")).toBe(false);
    expect(isUsernameConflict(new Error("boom"))).toBe(false);
  });
});
