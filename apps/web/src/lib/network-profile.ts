/**
 * 访客的链路质量 —— 用来决定「要不要预取」这类可省的性能动作。
 *
 * ## 为什么按链路质量，而不是按 IP 国家
 *
 * 这个项目的访客是全球的，而「哪里的用户慢」并不等于「哪个国家的用户慢」：
 * 同一个国家里既有光纤也有 3G。要按 IP 判断，前端得先请求一次
 * `/cdn-cgi/trace` 才知道 `loc=CN` —— 那本身就是一次往返，拿它去省一次预取，
 * 净收益为零，甚至为负。
 *
 * `navigator.connection` 是浏览器**已经知道**的事（Chrome/Edge/Android 都有），
 * 零请求、零延迟，且直接描述「这条链路上预取值不值」。
 *
 * ## 缺信号时一律当「不慢」
 *
 * Safari/Firefox 目前没有 `navigator.connection`。拿不到信号就不能假设用户慢 ——
 * 那样会让所有 Safari 用户失去预取（导航变慢）。所以缺省返回 `fast`，
 * 只把**明确报告过**的慢链路降级。
 */

type ConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
};

/**
 * 这条链路是否「预取会亏」。
 *
 * 判据都很保守，取的是「明确慢」而不是「可能慢」：
 *  - `saveData`：用户主动要求省流量（运营商计费流量），预取属于浪费；
 *  - `effectiveType` 为 2g/3g：单次预取常常和当前页抢带宽；
 *  - `rtt >= 400ms` 或 `downlink <= 1.5Mbps`：这两个阈值以下，预取的收益
 *    （点击后立即有内容）通常小于代价（当前页加载被拖慢）。
 *
 * 只在浏览器端有意义；服务端渲染时一律返回 `false`，保持默认行为。
 */
export function isConstrainedNetwork(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: ConnectionLike }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  const type = connection.effectiveType;
  if (type === "slow-2g" || type === "2g" || type === "3g") return true;
  if (typeof connection.rtt === "number" && connection.rtt >= 400) return true;
  if (typeof connection.downlink === "number" && connection.downlink <= 1.5) return true;
  return false;
}

/**
 * 导航链接的 `prefetch` 默认值。
 *
 * `undefined` = 用 Next 的默认（会预取），`false` = 不预取。
 * 返回 `undefined` 而不是 `true`，是为了不覆盖调用方显式传的值：
 * 只有调用方**没写** prefetch 时，这里才给建议。
 */
export function defaultPrefetch(): boolean | undefined {
  return isConstrainedNetwork() ? false : undefined;
}
