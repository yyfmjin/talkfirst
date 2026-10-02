import { randomInt } from "node:crypto";
import { newVerificationCode } from "./crypto";

/**
 * SEC-005 — the e-mail verification code is a security token.
 *
 * `Math.random()` is not a cryptographic source: its internal state is
 * recoverable from a handful of outputs, so a predictable "random" code is
 * guessable rather than brute-forceable. These tests pin the contract that the
 * value is six digits, spans the whole advertised range and is drawn from
 * `crypto.randomInt`.
 */
jest.mock("node:crypto", () => {
  const actual = jest.requireActual("node:crypto");
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

describe("newVerificationCode（SEC-005）", () => {
  beforeEach(() => {
    (randomInt as unknown as jest.Mock).mockClear();
  });

  it("始终是 6 位数字", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(newVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it("落在 100000–999999 之间（含边界）", () => {
    for (let i = 0; i < 500; i += 1) {
      const value = Number(newVerificationCode());
      expect(value).toBeGreaterThanOrEqual(100000);
      expect(value).toBeLessThanOrEqual(999999);
    }
  });

  it("由 crypto.randomInt 生成，而不是 Math.random", () => {
    const mathRandom = jest.spyOn(Math, "random");
    newVerificationCode();
    expect(randomInt).toHaveBeenCalledWith(100000, 1000000);
    expect(mathRandom).not.toHaveBeenCalled();
    mathRandom.mockRestore();
  });

  it("多次生成结果不固定", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) seen.add(newVerificationCode());
    expect(seen.size).toBeGreaterThan(1);
  });
});
