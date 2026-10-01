import { LoginAttemptService } from "./login-attempt.service";

/**
 * SEC-001 — the account-dimension brute-force budget.
 *
 * Clock is injected, so these are exact rather than timing-dependent.
 */
describe("LoginAttemptService", () => {
  const POLICY = { maxFailures: 5, adminMaxFailures: 3, baseLockMs: 1_000, maxLockMs: 8_000, windowMs: 60_000 };

  let now: number;
  let service: LoginAttemptService;

  beforeEach(() => {
    now = 1_000_000;
    service = new LoginAttemptService(POLICY, () => now);
  });

  it("未知邮箱初始未锁定", () => {
    expect(service.check("nobody@example.com")).toEqual({ locked: false, retryAfterMs: 0 });
  });

  it("未达阈值不锁定", () => {
    for (let i = 1; i < POLICY.maxFailures; i += 1) {
      const outcome = service.recordFailure("a@example.com", false);
      expect(outcome.locked).toBe(false);
      expect(outcome.lockedNow).toBe(false);
    }
    expect(service.check("a@example.com").locked).toBe(false);
  });

  it("达到阈值时锁定，并在该次返回 lockedNow", () => {
    let last = service.recordFailure("a@example.com", false);
    for (let i = 2; i <= POLICY.maxFailures; i += 1) {
      last = service.recordFailure("a@example.com", false);
    }
    expect(last.lockedNow).toBe(true);
    expect(last.locked).toBe(true);
    expect(last.retryAfterMs).toBe(POLICY.baseLockMs);
    expect(service.check("a@example.com")).toEqual({ locked: true, retryAfterMs: POLICY.baseLockMs });
  });

  it("锁定时长随时间自然过期，无需手动解锁", () => {
    for (let i = 0; i < POLICY.maxFailures; i += 1) service.recordFailure("a@example.com", false);
    expect(service.check("a@example.com").locked).toBe(true);

    now += POLICY.baseLockMs + 1;
    expect(service.check("a@example.com").locked).toBe(false);
  });

  it("锁定窗口内继续失败则指数退避（有上限）", () => {
    for (let i = 0; i < POLICY.maxFailures; i += 1) service.recordFailure("a@example.com", false);

    // First lock expires, attacker tries again: the budget is still in-window, so
    // the next failure escalates the lock instead of starting over.
    now += POLICY.baseLockMs + 1;
    const second = service.recordFailure("a@example.com", false);
    expect(second.retryAfterMs).toBe(POLICY.baseLockMs * 2);

    now += second.retryAfterMs + 1;
    const third = service.recordFailure("a@example.com", false);
    expect(third.retryAfterMs).toBe(POLICY.baseLockMs * 4);

    now += third.retryAfterMs + 1;
    const fourth = service.recordFailure("a@example.com", false);
    expect(fourth.retryAfterMs).toBe(POLICY.maxLockMs); // capped
  });

  it("管理员阈值更严格", () => {
    const outcome = [1, 2, 3].map(() => service.recordFailure("admin@example.com", true)).pop()!;
    expect(outcome.lockedNow).toBe(true);
    expect(outcome.failures).toBe(POLICY.adminMaxFailures);
  });

  it("reset 清空预算（成功登录后不再锁）", () => {
    for (let i = 0; i < POLICY.maxFailures - 1; i += 1) service.recordFailure("a@example.com", false);
    service.reset("a@example.com");
    expect(service.recordFailure("a@example.com", false).failures).toBe(1);
    expect(service.check("a@example.com").locked).toBe(false);
  });

  it("超出窗口的旧失败会被遗忘", () => {
    for (let i = 0; i < POLICY.maxFailures - 1; i += 1) service.recordFailure("a@example.com", false);
    now += POLICY.windowMs + 1;
    expect(service.recordFailure("a@example.com", false).failures).toBe(1);
  });

  it("默认策略下退避为 30s → 60s → 120s …，封顶 15min", () => {
    // Uses the shipped defaults for everything except the window, which is widened
    // so the exponential growth is observable without the budget resetting first.
    const defaults = new LoginAttemptService(
      { windowMs: 24 * 60 * 60 * 1000 },
      () => now,
    );

    for (let i = 0; i < 5; i += 1) defaults.recordFailure("a@example.com", false);
    expect(defaults.check("a@example.com").retryAfterMs).toBe(30_000);

    now += 30_001;
    expect(defaults.recordFailure("a@example.com", false).retryAfterMs).toBe(60_000);
    now += 60_001;
    expect(defaults.recordFailure("a@example.com", false).retryAfterMs).toBe(120_000);
    now += 120_001;
    expect(defaults.recordFailure("a@example.com", false).retryAfterMs).toBe(240_000);
    now += 240_001;
    expect(defaults.recordFailure("a@example.com", false).retryAfterMs).toBe(480_000);
    now += 480_001;
    // 30s * 2^5 = 960s would exceed the cap, so it clamps to 15 minutes.
    expect(defaults.recordFailure("a@example.com", false).retryAfterMs).toBe(15 * 60_000);
  });

  it("按邮箱计数，与来源 IP 无关", () => {
    // The API surface only takes an e-mail: there is no IP parameter for a caller
    // to vary, which is exactly why rotating IPs cannot reset the budget.
    for (let i = 0; i < POLICY.maxFailures; i += 1) service.recordFailure("a@example.com", false);
    expect(service.check("a@example.com").locked).toBe(true);
  });
});
