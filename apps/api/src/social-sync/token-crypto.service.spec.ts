import {
  TokenCryptoService,
  TokenDecryptionError,
  assertTokenEncryptionKeyConfigured,
} from "./token-crypto.service";
import { InsecureConfigurationError } from "../common/security-config";

/**
 * Token encryption at rest.
 *
 * ## Why these cases and not others
 *
 * The properties that actually matter for a stored bearer credential are: a
 * round trip preserves the value exactly, two encryptions of the SAME value differ
 * (otherwise the ciphertext is a fingerprint of the token), a modified ciphertext
 * fails loudly instead of decrypting to something else, and production cannot run
 * without a key. Each is a case below.
 *
 * ## NOT RUN
 *
 * There is no provider integration here and none is claimed. Nothing in this file
 * contacts a social platform.
 */

const KEY_A = "a".repeat(48);
const KEY_B = "b".repeat(48);

const ORIGINAL_ENV = { ...process.env };

function setSecret(value: string | undefined): void {
  if (value === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = value;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("TokenCryptoService — 往返", () => {
  const service = new TokenCryptoService();

  beforeEach(() => setSecret(KEY_A));

  it("加密后能解回原值", () => {
    const token = "ya29.a0AfH6SMB-example-access-token";
    expect(service.decrypt(service.encrypt(token))).toBe(token);
  });

  it("非 ASCII 与长 token 也能正确往返", () => {
    // Provider tokens are usually base64url, but a refresh token or a scope string
    // is not guaranteed to be, and utf8 handling is where that breaks.
    const withUnicode = "令牌-🔐-token";
    expect(service.decrypt(service.encrypt(withUnicode))).toBe(withUnicode);

    const long = "x".repeat(8000);
    expect(service.decrypt(service.encrypt(long))).toBe(long);
  });

  it("信封带 v1 版本前缀，共四段", () => {
    const envelope = service.encrypt("t");
    const parts = envelope.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("同一个值加密两次得到不同密文（随机 IV）", () => {
    /**
     * This is the property that makes the ciphertext useless as a lookup key. With
     * a fixed IV, two members with the same token — or the same member's token
     * before and after a refresh — would produce identical rows, and GCM with a
     * repeated IV is a key-recovery vulnerability, not just a privacy leak.
     */
    const token = "same-value";
    const first = service.encrypt(token);
    const second = service.encrypt(token);
    expect(first).not.toBe(second);
    // Both still decrypt to the same plaintext.
    expect(service.decrypt(first)).toBe(token);
    expect(service.decrypt(second)).toBe(token);
  });

  it("拒绝加密空字符串", () => {
    expect(() => service.encrypt("")).toThrow(TokenDecryptionError);
  });
});

describe("TokenCryptoService — 篡改与格式", () => {
  const service = new TokenCryptoService();

  beforeEach(() => setSecret(KEY_A));

  it("密文被改动后解密失败，而不是返回别的明文", () => {
    const envelope = service.encrypt("original-token");
    const parts = envelope.split(".");
    // Flip the last byte of the ciphertext.
    const data = Buffer.from(parts[3], "base64");
    data[data.length - 1] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64")].join(".");

    expect(() => service.decrypt(tampered)).toThrow(TokenDecryptionError);
  });

  it("认证标签被改动后解密失败", () => {
    const envelope = service.encrypt("original-token");
    const parts = envelope.split(".");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    const tampered = [parts[0], parts[1], tag.toString("base64"), parts[3]].join(".");

    expect(() => service.decrypt(tampered)).toThrow(TokenDecryptionError);
  });

  it("分段数不对时拒绝", () => {
    expect(() => service.decrypt("not-an-envelope")).toThrow(TokenDecryptionError);
    expect(() => service.decrypt("v1.aaa.bbb")).toThrow(TokenDecryptionError);
    expect(() => service.decrypt("")).toThrow(TokenDecryptionError);
  });

  it("未知版本号被明确拒绝，而不是猜格式", () => {
    const envelope = service.encrypt("t");
    const bumped = envelope.replace(/^v1\./, "v9.");
    expect(() => service.decrypt(bumped)).toThrow(/Unsupported token envelope version/);
  });

  it("IV 长度不对时拒绝", () => {
    const envelope = service.encrypt("t");
    const parts = envelope.split(".");
    const shortIv = Buffer.alloc(8).toString("base64");
    const malformed = [parts[0], shortIv, parts[2], parts[3]].join(".");
    expect(() => service.decrypt(malformed)).toThrow(TokenDecryptionError);
  });
});

describe("TokenCryptoService — 密钥轮换", () => {
  it("换了密钥后旧密文解不开（这正是需要重新授权的原因）", () => {
    const service = new TokenCryptoService();

    setSecret(KEY_A);
    const envelope = service.encrypt("token-under-key-a");

    setSecret(KEY_B);
    expect(() => service.decrypt(envelope)).toThrow(TokenDecryptionError);
  });

  it("密钥变短也会改变派生结果，不会静默复用旧密钥", () => {
    /**
     * The module caches the derived key, so a naive cache keyed on nothing would
     * keep serving the old key after the environment changed. This asserts the
     * cache is invalidated by a different secret.
     */
    const service = new TokenCryptoService();

    setSecret(KEY_A);
    const envelope = service.encrypt("t");

    setSecret(KEY_A.slice(0, 32));
    expect(() => service.decrypt(envelope)).toThrow(TokenDecryptionError);
  });
});

describe("TokenCryptoService — tryDecrypt 与 redact", () => {
  const service = new TokenCryptoService();

  beforeEach(() => setSecret(KEY_A));

  it("tryDecrypt 对 null/undefined/损坏值返回 null 而不抛异常", () => {
    // Used by the background sync, where one bad row must not abort the whole run.
    expect(service.tryDecrypt(null)).toBeNull();
    expect(service.tryDecrypt(undefined)).toBeNull();
    expect(service.tryDecrypt("garbage")).toBeNull();
    expect(service.tryDecrypt(service.encrypt("ok"))).toBe("ok");
  });

  it("redact 不泄露明文，且长度很短", () => {
    const token = "super-secret-access-token-value";
    const envelope = service.encrypt(token);
    const redacted = service.redact(envelope);

    expect(redacted).not.toContain(token);
    expect(redacted.startsWith("<enc:")).toBe(true);
    expect(redacted.length).toBeLessThan(24);
    expect(service.redact(null)).toBe("<none>");
  });

  it("redact 对短密文也不泄露（不能用密文前缀做标记）", () => {
    /**
     * The regression this guards: an earlier `redact` returned a prefix of the
     * ciphertext. For a 1-byte token the ciphertext fragment is 2 characters, so a
     * 6-character "prefix" was the whole thing — the marker printed exactly what it
     * existed to hide. A hash is a fixed length regardless of input, so short values
     * are covered by the same rule as long ones.
     */
    const envelope = service.encrypt("t");
    const ciphertextPart = envelope.split(".")[3];
    const redacted = service.redact(envelope);

    expect(redacted).not.toContain(ciphertextPart);
    // Fixed width regardless of how short the ciphertext is.
    expect(redacted).toMatch(/^<enc:[0-9a-f]{8}>$/);
    expect(redacted.length).toBe("<enc:".length + 8 + 1);
  });

  it("redact 对同一行稳定、对不同行不同", () => {
    // Stability is what makes it useful for correlating two log lines.
    const envelope = service.encrypt("t");
    expect(service.redact(envelope)).toBe(service.redact(envelope));
    expect(service.redact(service.encrypt("t"))).not.toBe(service.redact(envelope));
  });
});

describe("assertTokenEncryptionKeyConfigured — 生产必须显式配置", () => {
  const PRODUCTION = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  const DEVELOPMENT = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

  it("生产环境缺少密钥时抛错", () => {
    expect(() => assertTokenEncryptionKeyConfigured(PRODUCTION)).toThrow(
      InsecureConfigurationError,
    );
  });

  it("生产环境密钥为空白时抛错", () => {
    expect(() =>
      assertTokenEncryptionKeyConfigured({ ...PRODUCTION, TOKEN_ENCRYPTION_KEY: "   " }),
    ).toThrow(InsecureConfigurationError);
  });

  it("生产环境提供了密钥时通过", () => {
    expect(() =>
      assertTokenEncryptionKeyConfigured({ ...PRODUCTION, TOKEN_ENCRYPTION_KEY: KEY_A }),
    ).not.toThrow();
  });

  it("开发环境可以不配置（有 dev 回退）", () => {
    expect(() => assertTokenEncryptionKeyConfigured(DEVELOPMENT)).not.toThrow();
  });

  it("ALLOW_INSECURE_DEFAULTS=true 也算显式声明开发环境", () => {
    expect(() =>
      assertTokenEncryptionKeyConfigured({ NODE_ENV: "production", ALLOW_INSECURE_DEFAULTS: "true" }),
    ).not.toThrow();
  });

  it("错误信息里不含任何密钥值", () => {
    try {
      assertTokenEncryptionKeyConfigured({ ...PRODUCTION, TOKEN_ENCRYPTION_KEY: "" });
      throw new Error("expected a throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("TOKEN_ENCRYPTION_KEY");
      // It names the variable (actionable) but must not print a secret.
      expect(message).not.toContain(KEY_A);
    }
  });
});

describe("TokenCryptoService — 非开发环境无密钥时拒绝工作", () => {
  it("生产环境未配置密钥时 encrypt 抛错，不会用已知密钥加密", () => {
    const service = new TokenCryptoService();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" } as NodeJS.ProcessEnv;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => service.encrypt("secret")).toThrow(InsecureConfigurationError);

    process.env = { ...ORIGINAL_ENV };
  });
});
