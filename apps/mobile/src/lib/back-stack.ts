import { useEffect, useRef } from "react";

/**
 * 系统返回键的接管栈（Android）。
 *
 * ## 为什么需要它
 *
 * 这个 app 没有路由库：子页面是**全屏接管状态**（`MeScreen` 的 `open`、
 * `MessagesScreen` 的 `openId`…），返回靠页面自己的「返回」按钮。
 * 于是系统返回键完全没人管 —— 用户在「我的」里点进「安全中心」，
 * 按手机返回键（或全面屏手势）会**直接退出 app**，而不是回到「我的」。
 *
 * ## 怎么工作
 *
 * 每个打开的子页在可见时注册一个处理器；`App.tsx` 装一个 `BackHandler`
 * 监听，按返回键时交给**最近变得可见**（也就是最上面）的那一层处理。
 * 没有任何页面接管时返回 `false`，交回系统默认行为（在主界面退出 app）。
 *
 * 特意按「最近可见」而不是挂载顺序排序：像 `ProfilePreview` 这种一直挂在树上、
 * 用 `userId === null` 表示关闭的弹层，嵌套时（详情页里再点头像）挂载顺序
 * 与视觉层级不一致，只有按激活时间才总是对的。
 *
 * 处理器用 ref 包了一层：调用方的闭包每次渲染都是新的，但注册/注销只在
 * `active` 变化时发生 —— 否则每次渲染都重新注册，层级会被打乱。
 */
type BackHandler = () => void;

type Entry = { handler: BackHandler; seq: number };

const entries: Entry[] = [];
let seq = 0;

function register(handler: BackHandler): () => void {
  const entry: Entry = { handler, seq: (seq += 1) };
  entries.push(entry);
  return () => {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
  };
}

/**
 * 处理一次系统返回键。
 * @returns true = 已由某个子页接管；false = 没人接管，走系统默认（退出 app）。
 */
export function handleHardwareBack(): boolean {
  let top: Entry | null = null;
  for (const entry of entries) {
    if (!top || entry.seq > top.seq) top = entry;
  }
  if (!top) return false;
  top.handler();
  return true;
}

/**
 * 注册返回键处理器。
 *
 * @param active 该子页当前是否接管返回键（通常是「有没有打开子页」）。
 * @param onBack 被接管时的动作，通常是关掉这一层子页。
 */
export function useBackHandler(active: boolean, onBack: BackHandler): void {
  const latest = useRef(onBack);
  latest.current = onBack;

  useEffect(() => {
    if (!active) return undefined;
    return register(() => latest.current());
  }, [active]);
}

/** 仅供测试：清空注册表，避免用例之间互相污染。 */
export function resetBackHandlers(): void {
  entries.length = 0;
  seq = 0;
}
