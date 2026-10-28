import { applyUpdate, checkForUpdate, type UpdateCheckDeps } from "./update-check";

/**
 * 「检查更新」的顺序与失败面。
 *
 * 这一条会真的把用户手上的 App 换掉，所以每个分支都要是可预期的：
 * 不支持 / 最新 / 已下载待重启 / 失败。原生调用全部注入，不碰 expo-updates。
 *
 * 2026-10-28 补了两种情况，都是线上真实碰到的：
 *
 *   1. **有 URL 但没渠道**（安装包没烧 `expo-channel-name`）—— 服务端 400，
 *      以前归到 failed，用户看到「请检查网络」，本质却是配置问题；
 *   2. **真失败时要把原始报错带出来**，否则弹窗只能说「失败」。
 */

jest.mock("expo-updates", () => ({
  isEnabled: true,
  channel: "preview",
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

function deps(overrides: Partial<UpdateCheckDeps> = {}): UpdateCheckDeps {
  return {
    isEnabled: () => true,
    channel: () => "preview",
    checkForUpdate: async () => ({ isAvailable: false }),
    fetchUpdate: async () => undefined,
    reload: async () => undefined,
    ...overrides,
  };
}

describe("checkForUpdate", () => {
  it("没有更新：只查、不下载、不重启", async () => {
    const calls: string[] = [];
    const result = await checkForUpdate({
      ...deps(),
      checkForUpdate: async () => {
        calls.push("check");
        return { isAvailable: false };
      },
      fetchUpdate: async () => {
        calls.push("fetch");
      },
      reload: async () => {
        calls.push("reload");
      },
    });

    expect(result.status).toBe("latest");
    expect(result.channel).toBe("preview");
    expect(calls).toEqual(["check"]);
  });

  it("有更新：下载但**不**替用户重启（重启时机由用户决定）", async () => {
    const calls: string[] = [];
    const result = await checkForUpdate({
      ...deps(),
      checkForUpdate: async () => {
        calls.push("check");
        return { isAvailable: true };
      },
      fetchUpdate: async () => {
        calls.push("fetch");
      },
      reload: async () => {
        calls.push("reload");
      },
    });

    expect(result.status).toBe("ready");
    expect(calls).toEqual(["check", "fetch"]);
  });

  it("安装包不支持热更新：直接返回 unsupported，不去打服务端", async () => {
    let called = false;
    const result = await checkForUpdate(
      deps({
        isEnabled: () => false,
        checkForUpdate: async () => {
          called = true;
          return { isAvailable: true };
        },
      }),
    );

    expect(result.status).toBe("unsupported");
    expect(called).toBe(false);
  });

  it("有 URL 但没有渠道：unsupported（服务端会 400，不是网络问题）", async () => {
    let called = false;
    const result = await checkForUpdate(
      deps({
        channel: () => null,
        checkForUpdate: async () => {
          called = true;
          return { isAvailable: false };
        },
      }),
    );

    expect(result.status).toBe("unsupported");
    expect(result.channel).toBeNull();
    expect(called).toBe(false);
  });

  it("渠道读取本身抛错也按 unsupported 处理，不冒泡", async () => {
    const result = await checkForUpdate(
      deps({
        channel: () => {
          throw new Error("native module missing");
        },
      }),
    );

    expect(result.status).toBe("unsupported");
  });

  it("检查抛错（断网等）→ failed，并把原始报错带出来", async () => {
    const result = await checkForUpdate(
      deps({
        checkForUpdate: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toBe("network down");
  });

  it("下载失败 → failed（不能返回 ready：那样会让用户点重启却什么都没变）", async () => {
    const result = await checkForUpdate(
      deps({
        checkForUpdate: async () => ({ isAvailable: true }),
        fetchUpdate: async () => {
          throw new Error("download failed");
        },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toBe("download failed");
  });
});

describe("applyUpdate", () => {
  it("重启成功", async () => {
    await expect(applyUpdate(deps())).resolves.toBe(true);
  });

  it("重启抛错时返回 false，不冒泡", async () => {
    await expect(
      applyUpdate(
        deps({
          reload: async () => {
            throw new Error("reload failed");
          },
        }),
      ),
    ).resolves.toBe(false);
  });
});
