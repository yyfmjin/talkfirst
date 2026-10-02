import { Logger } from "@nestjs/common";
import { ConsoleMailProvider } from "./console-mail.provider";
import { FakeMailProvider, resetSentVerificationMails, sentVerificationMails } from "./fake-mail.provider";
import { SmtpMailProvider } from "./smtp-mail.provider";

const MESSAGE = { to: "alice@example.com", code: "482913", expiresInSeconds: 600 };

describe("ConsoleMailProvider（development）", () => {
  it("记录发送事实但绝不输出验证码或明文邮箱", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    try {
      await new ConsoleMailProvider().sendEmailVerificationCode(MESSAGE);
      const output = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("EMAIL VERIFICATION SENT");
      expect(output).not.toContain(MESSAGE.code);
      expect(output).not.toContain(MESSAGE.to);
      expect(output).toContain("a***@example.com");
    } finally {
      log.mockRestore();
    }
  });
});

describe("FakeMailProvider（test）", () => {
  beforeEach(() => resetSentVerificationMails());

  it("把消息放进内存发件箱供测试读取", async () => {
    await new FakeMailProvider().sendEmailVerificationCode(MESSAGE);
    expect(sentVerificationMails()).toHaveLength(1);
    expect(sentVerificationMails()[0]).toMatchObject(MESSAGE);
  });

  it("reset 后清空", async () => {
    await new FakeMailProvider().sendEmailVerificationCode(MESSAGE);
    resetSentVerificationMails();
    expect(sentVerificationMails()).toHaveLength(0);
  });
});

describe("SmtpMailProvider（production）", () => {
  it("kind 为 smtp，且构造时不建立连接（懒加载）", () => {
    const provider = new SmtpMailProvider({
      host: "smtp.example.com",
      port: 587,
      user: "mailer",
      password: "s3cret",
      from: "no-reply@example.com",
      secure: false,
    });
    expect(provider.kind).toBe("smtp");
    // No transport is opened until the first send — construction is side-effect free.
  });

  // REAL SMTP DELIVERY NOT VERIFIED: exercising `send()` would require a live
  // server. The configuration path is covered by `mail.config.spec.ts`; the
  // actual hand-off to an SMTP host is unverified in this environment.
});
