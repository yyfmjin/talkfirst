import {
  MailConfigurationError,
  assertMailConfigurationForProduction,
  readSmtpConfig,
  resolveMailProviderKind,
} from "./mail.config";
import { createMailProvider } from "./mail.service";
import { ConsoleMailProvider } from "./console-mail.provider";
import { FakeMailProvider } from "./fake-mail.provider";
import { SmtpMailProvider } from "./smtp-mail.provider";

const COMPLETE_SMTP: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  ENFORCE_EMAIL_VERIFICATION: "true",
  MAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "s3cret",
  SMTP_FROM: "no-reply@example.com",
};

describe("resolveMailProviderKind", () => {
  it("显式 MAIL_PROVIDER 优先", () => {
    expect(resolveMailProviderKind({ MAIL_PROVIDER: "console", NODE_ENV: "production" })).toBe(
      "console",
    );
    expect(resolveMailProviderKind({ MAIL_PROVIDER: "FAKE" })).toBe("fake");
    expect(resolveMailProviderKind({ MAIL_PROVIDER: "smtp" })).toBe("smtp");
  });

  it("缺省时按 NODE_ENV 选择：test=fake / production=smtp / 其他=console", () => {
    expect(resolveMailProviderKind({ NODE_ENV: "test" })).toBe("fake");
    expect(resolveMailProviderKind({ NODE_ENV: "production" })).toBe("smtp");
    expect(resolveMailProviderKind({ NODE_ENV: "development" })).toBe("console");
    expect(resolveMailProviderKind({})).toBe("console");
  });
});

describe("readSmtpConfig", () => {
  it("配置不完整时返回 null", () => {
    expect(readSmtpConfig({})).toBeNull();
    expect(readSmtpConfig({ SMTP_HOST: "smtp.example.com" })).toBeNull();
    expect(readSmtpConfig({ ...COMPLETE_SMTP, SMTP_FROM: "" })).toBeNull();
  });

  it("端口缺省 587，465 隐含 TLS", () => {
    const base = { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_FROM: "f" };
    expect(readSmtpConfig(base)).toMatchObject({ port: 587, secure: false });
    expect(readSmtpConfig({ ...base, SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
    expect(readSmtpConfig({ ...base, SMTP_PORT: "587", SMTP_SECURE: "true" })).toMatchObject({
      secure: true,
    });
  });
});

describe("assertMailConfigurationForProduction（SEC-005 启动保护）", () => {
  it("非生产环境不校验", () => {
    expect(() => assertMailConfigurationForProduction({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertMailConfigurationForProduction({ NODE_ENV: "test" })).not.toThrow();
  });

  it("生产但未开启强制验证时不校验", () => {
    expect(() =>
      assertMailConfigurationForProduction({ NODE_ENV: "production" }),
    ).not.toThrow();
  });

  it("生产 + 强制验证 + SMTP 完整 -> 通过", () => {
    expect(() => assertMailConfigurationForProduction(COMPLETE_SMTP)).not.toThrow();
  });

  it("生产 + 强制验证 + SMTP 缺失 -> 启动失败", () => {
    expect(() =>
      assertMailConfigurationForProduction({
        NODE_ENV: "production",
        ENFORCE_EMAIL_VERIFICATION: "true",
      }),
    ).toThrow(MailConfigurationError);
  });

  it("生产 + 强制验证 + 显式 console provider -> 启动失败", () => {
    expect(() =>
      assertMailConfigurationForProduction({ ...COMPLETE_SMTP, MAIL_PROVIDER: "console" }),
    ).toThrow(MailConfigurationError);
  });
});

describe("createMailProvider", () => {
  it("development -> console", () => {
    expect(createMailProvider({ NODE_ENV: "development" }).kind).toBe("console");
    expect(createMailProvider({ NODE_ENV: "development" })).toBeInstanceOf(ConsoleMailProvider);
  });

  it("test -> fake", () => {
    expect(createMailProvider({ NODE_ENV: "test" })).toBeInstanceOf(FakeMailProvider);
  });

  it("smtp 配置完整 -> smtp", () => {
    const provider = createMailProvider(COMPLETE_SMTP);
    expect(provider).toBeInstanceOf(SmtpMailProvider);
    expect(provider.kind).toBe("smtp");
  });

  it("smtp 配置缺失 + 强制验证开启 -> 抛错（不降级）", () => {
    expect(() =>
      createMailProvider({ NODE_ENV: "production", ENFORCE_EMAIL_VERIFICATION: "true" }),
    ).toThrow(MailConfigurationError);
  });

  it("smtp 配置缺失 + 未开启强制验证 -> 降级 console（不阻断启动）", () => {
    expect(createMailProvider({ NODE_ENV: "production" })).toBeInstanceOf(ConsoleMailProvider);
  });
});
