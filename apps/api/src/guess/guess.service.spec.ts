import { GuessService } from "./guess.service";

/**
 * 猜猜看的规则不能靠「看着对」——这些断言钉住的是设计文档 §2 与 §7.5 里
 * 会被后人无意改坏的两条：干扰项必须同区域、资格必须够严。
 */
describe("GuessService", () => {
  const service = new GuessService({} as never);

  const countries = [
    { code: "JP", name: "日本", flag: "🇯🇵" },
    { code: "KR", name: "韩国", flag: "🇰🇷" },
    { code: "TH", name: "泰国", flag: "🇹🇭" },
    { code: "BR", name: "巴西", flag: "🇧🇷" },
    { code: "FR", name: "法国", flag: "🇫🇷" },
  ];

  describe("buildOptions", () => {
    it("三个选项不重复，且一定包含正确答案", () => {
      for (let i = 0; i < 20; i += 1) {
        const options = service.buildOptions("JP", countries);
        expect(options).toHaveLength(3);
        expect(new Set(options).size).toBe(3);
        expect(options).toContain("JP");
      }
    });

    it("优先取同区域的国家做干扰项", () => {
      // JP 的亚洲同区只有 KR / TH，两个干扰项应该正好是它们。
      for (let i = 0; i < 20; i += 1) {
        const options = service.buildOptions("JP", countries).filter((code) => code !== "JP");
        expect(options.sort()).toEqual(["KR", "TH"]);
      }
    });

    it("同区域不够时用其它国家补齐；国家表本身不足三个时降级为两个（不编造代码）", () => {
      const onlyTwo = countries.filter((row) => row.code === "JP" || row.code === "KR");
      const options = service.buildOptions("JP", onlyTwo);
      expect(options).toHaveLength(2);
      expect(options).toContain("JP");
    });
  });

  describe("isEligible（设计文档 §7.5 的资格）", () => {
    const base = {
      avatarUrl: "https://cdn/x.jpg",
      countryCode: "JP",
      avatarWidth: 800,
      avatarHeight: 800,
      nickname: "Mia",
      birthDate: new Date("1996-05-12"),
      fieldVisibilities: [] as Array<{ fieldKey: string; visibility: string }>,
    };

    it("公开头像 + 公开国家 + 资料完整 + 尺寸达标 → 合格", () => {
      expect(service["isEligible"](base)).toBe(true);
    });

    it("没有头像 / 没有国家 → 不合格", () => {
      expect(service["isEligible"]({ ...base, avatarUrl: null })).toBe(false);
      expect(service["isEligible"]({ ...base, countryCode: null })).toBe(false);
    });

    it("头像或国家不是公开档 → 不合格（否则游戏会绕过隐私设置）", () => {
      expect(
        service["isEligible"]({ ...base, fieldVisibilities: [{ fieldKey: "avatarUrl", visibility: "CONNECTIONS" }] }),
      ).toBe(false);
      expect(
        service["isEligible"]({ ...base, fieldVisibilities: [{ fieldKey: "countryCode", visibility: "PRIVATE" }] }),
      ).toBe(false);
    });

    it("头像尺寸不足或未知 → 不合格（「真人头像」的清晰度门槛）", () => {
      expect(service["isEligible"]({ ...base, avatarWidth: 200 })).toBe(false);
      expect(service["isEligible"]({ ...base, avatarWidth: null, avatarHeight: null })).toBe(false);
    });

    it("资料不完整 → 不合格", () => {
      expect(service["isEligible"]({ ...base, nickname: null })).toBe(false);
    });
  });
});
