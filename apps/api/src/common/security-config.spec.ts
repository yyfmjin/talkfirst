import {
  InsecureConfigurationError,
  assertDeviceSaltConfigured,
  assertTrustProxyConfigured,
} from "./security-config";

/**
 * Phase O1 / O1-5 — the fail-closed boot guards.
 *
 * Both guards exist because their underlying setting fails *silently and
 * dangerously* when absent, and in both cases the dangerous behaviour was the
 * default rather than something an operator opted into:
 *
 *  - `SECURITY_DEVICE_SALT` unset → every `deviceHash` is NULL forever, so the
 *    "one device, many accounts" question becomes unanswerable with only a
 *    single log line to say so.
 *  - `TRUST_PROXY` unset → the code trusts one proxy hop, and with no proxy
 *    actually present that lets any caller forge the address recorded in
 *    `AccessLog.ip` (verified against real Express: `trust proxy: 1` makes
 *    `X-Forwarded-For: 1.2.3.4` become the client's address).
 *
 * The rule under test is therefore not "does the value look nice" but "is the
 * process allowed to start at all".
 */
function productionEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // `allowsInsecureDefaults` treats a live Jest worker as test mode, so the
  // worker id has to be absent for these to read as a real deployment.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...extra };
  delete env.JEST_WORKER_ID;
  delete env.ALLOW_INSECURE_DEFAULTS;
  return env;
}

describe("assertTrustProxyConfigured", () => {
  it("生产环境未设置 -> 拒绝启动", () => {
    expect(() => assertTrustProxyConfigured(productionEnv())).toThrow(InsecureConfigurationError);
  });

  it("空白字符串同样视为未设置", () => {
    expect(() => assertTrustProxyConfigured(productionEnv({ TRUST_PROXY: "   " }))).toThrow(
      InsecureConfigurationError,
    );
  });

  it("错误信息说明后果与可接受的取值", () => {
    try {
      assertTrustProxyConfigured(productionEnv());
      throw new Error("expected a refusal");
    } catch (error) {
      const message = (error as Error).message;
      // The operator has to be able to act on this without reading the source.
      expect(message).toContain("X-Forwarded-For");
      expect(message).toContain("AccessLog.ip");
      expect(message).toContain("NODE_ENV=development");
    }
  });

  it.each(["0", "1", "2"])("显式设置 %s -> 允许启动", (value) => {
    expect(() => assertTrustProxyConfigured(productionEnv({ TRUST_PROXY: value }))).not.toThrow();
  });

  it("开发/测试环境不强制（本地无需配置）", () => {
    expect(() => assertTrustProxyConfigured({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertTrustProxyConfigured({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertTrustProxyConfigured({ ALLOW_INSECURE_DEFAULTS: "true" })).not.toThrow();
  });
});

describe("assertDeviceSaltConfigured", () => {
  it("生产环境未设置 -> 拒绝启动", () => {
    expect(() => assertDeviceSaltConfigured(productionEnv())).toThrow(InsecureConfigurationError);
  });

  it("空白字符串同样视为未设置", () => {
    expect(() =>
      assertDeviceSaltConfigured(productionEnv({ SECURITY_DEVICE_SALT: "  " })),
    ).toThrow(InsecureConfigurationError);
  });

  it("任意非空值即可（不要求特定格式）", () => {
    expect(() =>
      assertDeviceSaltConfigured(productionEnv({ SECURITY_DEVICE_SALT: "abc123" })),
    ).not.toThrow();
  });

  it("开发/测试环境不强制", () => {
    expect(() => assertDeviceSaltConfigured({ NODE_ENV: "development" })).not.toThrow();
  });
});
