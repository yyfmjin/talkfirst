/**
 * 跨 tab 的「打开某样东西」信号。
 *
 * ## 为什么需要它
 *
 * 这个 app 没有路由库：四个 tab 是 `App.tsx` 里的一个 state，子页是各屏自己的
 * state。于是「从通知点进一条动态」这种**跨屏跳转**没有地方可以表达 ——
 * 通知屏在「消息」tab 里，动态详情在「动态」tab 里，前者够不着后者。
 *
 * 这里放一条最小的信号通道：通知屏 `navigateTo({tab:"moments", momentId})`，
 * `App.tsx` 收到后切 tab 并把 id 交给 `MomentsScreen`；目标屏打开完调
 * `onFocusHandled` 把 id 清掉（否则用户手动返回后会被再次弹开）。
 *
 * ## 为什么不是 EventEmitter 或 context
 *
 * 只有一条通道、一个监听者（App），用不着事件库；而 context 需要把 provider
 * 提到所有屏幕之上，还会让每个屏幕重渲染。这里就是一个回调。
 */
export type NavIntent = {
  tab: "moments" | "messages" | "discover" | "me";
  /** 切到「动态」后要打开的那条动态。 */
  momentId?: string;
};

let listener: ((intent: NavIntent) => void) | null = null;

/** `App.tsx` 在挂载时订阅；返回的函数用于卸载时解绑。 */
export function onNavigate(fn: (intent: NavIntent) => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** 任何屏幕都可以调用；没有监听者时静默忽略（例如单测里）。 */
export function navigateTo(intent: NavIntent): void {
  listener?.(intent);
}
