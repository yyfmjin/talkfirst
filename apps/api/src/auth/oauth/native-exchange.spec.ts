import {
  consumeExchangeCode,
  issueExchangeCode,
  resetExchangeCodes,
} from "./native-exchange";

/**
 * 一次性交换码的规则。
 *
 * 这个码是「浏览器里登完 → App 拿到会话」的唯一凭据，所以它的每一条限制都值得
 * 单独钉住：用过就作废、过期作废、不能跨 provider 用。写错任何一条，都等于给
 * 别人一个可以重复使用的登录后门。
 */
describe("native-exchange", () => {
  beforeEach(() => resetExchangeCodes());

  const session = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    user: { id: "u-1", email: "a@example.test" },
  };

  it("签发后能换回同一份会话", () => {
    const code = issueExchangeCode("google", session);
    expect(consumeExchangeCode("google", code)).toEqual(session);
  });

  it("只能用一次", () => {
    const code = issueExchangeCode("google", session);
    expect(consumeExchangeCode("google", code)).not.toBeNull();
    expect(consumeExchangeCode("google", code)).toBeNull();
  });

  it("不存在的码返回 null（不抛异常）", () => {
    expect(consumeExchangeCode("google", "not-a-code")).toBeNull();
  });

  it("不能跨 provider 使用（且用错也会作废）", () => {
    const code = issueExchangeCode("google", session);
    expect(consumeExchangeCode("facebook", code)).toBeNull();
    // 已经作废：正确的 provider 也换不回来了。
    expect(consumeExchangeCode("google", code)).toBeNull();
  });

  it("过期后换不出来", () => {
    const code = issueExchangeCode("google", session);
    const now = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(now + 121_000);
    try {
      expect(consumeExchangeCode("google", code)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
