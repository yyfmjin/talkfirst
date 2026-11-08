import type * as ExpoAudio from "expo-audio";

/**
 * 通知音的节流与播放器复用（2026-11-08）。
 *
 * 这两条行为在真机上很难稳定复现（要恰好连发两条消息、再掐着秒表听），
 * 但它们决定了「会不会响成噪音」和「会不会每次响都新建解码器」，所以放在这里测。
 *
 * 每个用例用 `jest.isolateModules` 拿一套全新的模块实例：模块内部缓存着播放器，
 * 共享实例会让「只创建了一个播放器」这类断言被上一个用例污染。
 * `expo-audio` 本体来自 `jest/setup.ts` 的全局桩；隔离模块时它也一起重新求值，
 * 所以这里必须从**同一个隔离作用域**里取 `createAudioPlayer`，否则拿到的是另一个
 * jest.fn()，数不到调用。
 */
type SoundModule = typeof import("./notification-sound");
type AudioModule = typeof ExpoAudio;

function freshModule(): { sound: SoundModule; audio: AudioModule } {
  let sound!: SoundModule;
  let audio!: AudioModule;
  jest.isolateModules(() => {
    audio = require("expo-audio") as AudioModule;
    sound = require("./notification-sound") as SoundModule;
  });
  return { sound, audio };
}

let now = 1_000_000;

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it("1.2 秒内重复触发只响一次，之后复用同一个播放器再响", () => {
  const { sound, audio } = freshModule();
  const createPlayer = audio.createAudioPlayer as jest.Mock;

  sound.playMessageSound();
  const player = createPlayer.mock.results[0].value as { seekTo: jest.Mock };
  expect(player.seekTo).toHaveBeenCalledTimes(1);

  now += 500;
  sound.playMessageSound();
  expect(player.seekTo).toHaveBeenCalledTimes(1);

  now += 900; // 累计 1.4 秒
  sound.playMessageSound();
  expect(player.seekTo).toHaveBeenCalledTimes(2);

  // 全程只建了一个播放器实例：提示音是常驻能力，不该每响一次多一个解码器。
  expect(createPlayer).toHaveBeenCalledTimes(1);
});

it("两种提示音各自节流，互不影响", () => {
  const { sound, audio } = freshModule();
  const createPlayer = audio.createAudioPlayer as jest.Mock;

  sound.playMessageSound();
  sound.playGreetingSound();

  expect(createPlayer).toHaveBeenCalledTimes(2);
  const greeting = createPlayer.mock.results[1].value as { seekTo: jest.Mock };
  expect(greeting.seekTo).toHaveBeenCalledTimes(1);
});

it("播放前先把播放器回卷到开头", () => {
  const { sound, audio } = freshModule();
  const createPlayer = audio.createAudioPlayer as jest.Mock;

  sound.playGreetingSound();
  const player = createPlayer.mock.results[0].value as { seekTo: jest.Mock };
  expect(player.seekTo).toHaveBeenCalledWith(0);
});
