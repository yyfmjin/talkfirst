import {
  ACCESS_CHANNELS,
  LOOPBACK_IPS,
  accessChannel,
  isServerOrigin,
  normalizeChannelFilter,
  opsIpsFromEnv,
} from "./access-channel";

/**
 * 访问日志的渠道分类（2026-10-06）。
 *
 * 这个分类的唯一用途是**把后台自己与服务器自身的操作从默认视图里分流出去**：
 * 运营方要看的是成员的访问，而后台点击与探活请求会把真实流量淹掉。
 * 分流只影响「看什么」，不影响「记不记」—— 三类都会被写入。
 */
describe("accessChannel — 渠道分类", () => {
  it("环回地址算服务器自身的操作（三种写法都要认）", () => {
    for (const ip of LOOPBACK_IPS) {
      expect(accessChannel({ isAdminPath: false, ip })).toBe("OPS");
    }
  });

  it("OPS 优先于 ADMIN：用 curl 打后台接口是运维操作，不是管理员登录", () => {
    // 反过来说：如果这里返回 ADMIN，日志会让人以为有人登录了后台。
    expect(accessChannel({ isAdminPath: true, ip: "127.0.0.1" })).toBe("OPS");
  });

  it("命中后台路由 → ADMIN（与 isAdmin 同源）", () => {
    expect(accessChannel({ isAdminPath: true, ip: "203.0.113.9" })).toBe("ADMIN");
  });

  it("普通公网来源 + 普通路径 → USER", () => {
    expect(accessChannel({ isAdminPath: false, ip: "203.0.113.9" })).toBe("USER");
  });

  it("没有 IP 时不猜成 OPS：无路径信息时归 USER", () => {
    expect(accessChannel({ isAdminPath: false, ip: undefined })).toBe("USER");
    expect(accessChannel({ isAdminPath: false, ip: null })).toBe("USER");
  });

  it("OPS_IPS 里的额外来源也算服务器操作（服务器用自己的公网 IP 访问自己）", () => {
    expect(accessChannel({ isAdminPath: false, ip: "198.51.100.7" }, ["198.51.100.7"])).toBe("OPS");
    expect(accessChannel({ isAdminPath: false, ip: "198.51.100.8" }, ["198.51.100.7"])).toBe("USER");
  });

  it("isServerOrigin 对空值、非法值与空列表都只是「不匹配」，不抛错", () => {
    expect(isServerOrigin(undefined)).toBe(false);
    expect(isServerOrigin("")).toBe(false);
    expect(isServerOrigin("203.0.113.9", [])).toBe(false);
  });
});

describe("opsIpsFromEnv — 配置解析", () => {
  it("逗号分隔、去空白、丢空项", () => {
    expect(opsIpsFromEnv(" 1.2.3.4 , 5.6.7.8 ")).toEqual(["1.2.3.4", "5.6.7.8"]);
    expect(opsIpsFromEnv("1.2.3.4,,  ")).toEqual(["1.2.3.4"]);
  });

  it("未配置就是空列表（环回仍然生效，只是没有额外来源）", () => {
    expect(opsIpsFromEnv(undefined)).toEqual([]);
    expect(opsIpsFromEnv("")).toEqual([]);
  });
});

describe("normalizeChannelFilter — 查询串 → 渠道", () => {
  it("缺省即默认视图", () => {
    expect(normalizeChannelFilter(undefined)).toBe("USER");
    expect(normalizeChannelFilter("")).toBe("USER");
  });

  it("ALL / * 表示不过滤渠道", () => {
    expect(normalizeChannelFilter("ALL")).toBeUndefined();
    expect(normalizeChannelFilter("*")).toBeUndefined();
    expect(normalizeChannelFilter("all")).toBeUndefined();
  });

  it("大小写不敏感，三个取值都认", () => {
    expect(normalizeChannelFilter("admin")).toBe("ADMIN");
    expect(normalizeChannelFilter("Ops")).toBe("OPS");
    expect(normalizeChannelFilter(" USER ")).toBe("USER");
  });

  it("未知值收敛成默认视图，而不是让页面变成 400", () => {
    // 查询串是人手拼的：拼错一个词不该让整个访问日志页打不开。
    expect(normalizeChannelFilter("nonsense")).toBe("USER");
    expect(normalizeChannelFilter("USER;DROP TABLE")).toBe("USER");
  });

  it("取值集合就三个 —— 与迁移里的回填和后台下拉一致", () => {
    expect([...ACCESS_CHANNELS]).toEqual(["USER", "ADMIN", "OPS"]);
  });
});
