import { Logger } from "@nestjs/common";
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

  /**
   * 2026-10-06 事故：`.env` 写的是 `MAIL_PROVIDER=console`、`SMTP_*` 全空，
   * 而 `ENFORCE_EMAIL_VERIFICATION=false` —— 于是启动检查直接放行，
   * 注册验证码只写日志、一封信不发，注册页却说「已发送到你的邮箱」。
   * 这两条钉住修法：**同一种配置现在必须出声**，而配全了就不该再叫。
   */
  it("生产 + 不强制验证 + console 通道 -> 不拦启动，但必须告警", () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertMailConfigurationForProduction({
          NODE_ENV: "production",
          ENFORCE_EMAIL_VERIFICATION: "false",
          MAIL_PROVIDER: "console",
        }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("不会真正送达");
      expect(String(warn.mock.calls[0][0])).toContain("console");
    } finally {
      warn.mockRestore();
    }
  });

  it("生产 + 不强制验证 + SMTP 完整 -> 不告警", () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      assertMailConfigurationForProduction({
        ...COMPLETE_SMTP,
        ENFORCE_EMAIL_VERIFICATION: "false",
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
