import { createAudioPlayer, type AudioPlayer } from "expo-audio";

/**
 * 应用内提示音（2026-11-08）。
 *
 * 两段音效来自录音棚定稿（`音效总包`，readme 里 tang 的分工确认）：
 *
 *   - 新消息    `tf-bubble-final.mp3`    气泡音，0.44 秒
 *   - 打招呼请求 `tf-greeting-final.mp3`  C5-E5-G5 三音，1.2 秒
 *
 * 只带 mp3：同一段音频的 wav/ogg/caf 是不同封装，四份全打进包只会让 APK 变大。
 * mp3 在 Android / iOS 都是原生支持，0.4 秒的提示音也听不出编码差别。
 *
 * ## 播放器复用
 *
 * 每次响都 `createAudioPlayer` 的老实写法，在「对方连发十条」时会同时存在十个
 * 解码器实例；提示音本来就是单声道短音频，所以复用一个实例、每次 `seekTo(0)`。
 *
 * ## 节流
 *
 * 1.2 秒内同类提示音只响一次。没有这层，同时涌进来的几条消息会叠在一起变成噪音，
 * 而用户判断「有新消息」并不需要听出条数。
 */

const MESSAGE_SOUND = require("../../assets/sounds/message.mp3");
const GREETING_SOUND = require("../../assets/sounds/greeting.mp3");

const MIN_GAP_MS = 1200;

let messagePlayer: AudioPlayer | null = null;
let greetingPlayer: AudioPlayer | null = null;
let messageLastPlayedAt = 0;
let greetingLastPlayedAt = 0;

/**
 * 从头播一遍。
 *
 * `seekTo` 是异步的，这里先回卷再播：直接 `play()` 时如果上一遍刚好停在末尾，
 * 会得到「响了一下就结束」——连发两条消息时最容易撞上。
 */
function replay(player: AudioPlayer): void {
  void player
    .seekTo(0)
    .then(() => player.play())
    .catch(() => undefined);
}

/** 新消息：气泡音。 */
export function playMessageSound(): void {
  const now = Date.now();
  if (now - messageLastPlayedAt < MIN_GAP_MS) return;
  messageLastPlayedAt = now;
  messagePlayer ??= createAudioPlayer(MESSAGE_SOUND);
  replay(messagePlayer);
}

/** 有人发来打招呼请求：轻快三音。 */
export function playGreetingSound(): void {
  const now = Date.now();
  if (now - greetingLastPlayedAt < MIN_GAP_MS) return;
  greetingLastPlayedAt = now;
  greetingPlayer ??= createAudioPlayer(GREETING_SOUND);
  replay(greetingPlayer);
}

/**
 * 测试用：把上一次播放时间清掉，让紧接着的断言能听到声音。
 *
 * 不做「卸载播放器」——提示音是常驻能力，整个 App 生命周期内都该可用；
 * 真需要释放时 `AudioPlayer.remove()` 也应该由播放器自己决定（例如系统回收）。
 */
export function resetSoundThrottleForTests(): void {
  messageLastPlayedAt = 0;
  greetingLastPlayedAt = 0;
}
