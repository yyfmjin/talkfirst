/**
 * 访问日志的「渠道」分类（2026-10-06）。
 *
 * ## 为什么需要分类
 *
 * 运营方要看的是**成员**的访问。但 `AccessLog` 记录的是每一个请求，于是默认视图里混进了两类噪音：
 *
 * - **后台自己**：管理员的每一次点击都会产生一行（命中后台路由）；
 * - **服务器自己**：健康检查、部署自检、运维命令 —— 这些都来自环回地址或服务器本机。
 *
 * 要求是「单独记录，但不要出现在访问日志里」。所以这里只做**分类**，不丢数据：
 * 行照记，`channel` 标记它属于哪一类，后台的默认视图过滤成 `USER`，另两类单独可查。
 *
 * ## 优先级：OPS > ADMIN > USER
 *
 * 一台服务器上用 curl 打后台接口，是「运维操作」而不是「管理员访问」——
 * 记成 ADMIN 会让人以为有人登录后台了。所以 OPS 优先。
 *
 * ## 三个取值
 *
 * - `USER`：普通成员流量（默认视图）
 * - `ADMIN`：命中后台路由（与 `AccessLog.isAdmin` 同源：按**路径**判，不做每次请求的角色查询）
 * - `OPS`：来自环回地址，或在 `OPS_IPS` 里列出的来源
 *
 * ## 环回列表为什么在这里写死、公网 IP 却要配环境变量
 *
 * 环回地址是协议事实，永远就那三个写法；服务器自己的**公网** IP 则随部署环境变化，
 * 写进代码就是写死一个环境 —— 所以它由 `OPS_IPS` 提供（逗号分隔，可留空）。
 * 迁移里的历史回填只能回填环回那一半，另一半靠这个变量在运行时生效。
 */

/** 三个取值，顺序即类型顺序，前端筛选下拉也用它。 */
export const ACCESS_CHANNELS = ["USER", "ADMIN", "OPS"] as const;

export type AccessChannel = (typeof ACCESS_CHANNELS)[number];

/**
 * 环回地址的三种写法。
 *
 * 与 `prisma/migrations/20261006180000_access_log_channel/migration.sql` 里的回填
 * 列表**逐字一致** —— 两处不一致会让「新行」和「历史行」用两套标准分类。
 */
export const LOOPBACK_IPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;

/**
 * `OPS_IPS` 里的额外来源（逗号分隔）。
 *
 * 用途：服务器用**自己的公网 IP** 访问自己（不常见但会发生），或运维从某台固定跳板机做事。
 * 非法项不报错、只是不匹配 —— 一个配置手误不该让审计写入失败。
 */
export function opsIpsFromEnv(raw: string | undefined = process.env.OPS_IPS): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 该来源是否属于「服务器自身的操作」。 */
export function isServerOrigin(ip: string | null | undefined, extra: readonly string[] = opsIpsFromEnv()): boolean {
  if (!ip) return false;
  if ((LOOPBACK_IPS as readonly string[]).includes(ip)) return true;
  return extra.includes(ip);
}

/**
 * 分类一条请求。
 *
 * `isAdminPath` 由调用方传入（中间件已经算过一次），而不是在这里重新判路径：
 * 一来避免两处判断漂移，二来避免 `access-channel` 与 `access-log.middleware` 互相 import。
 */
export function accessChannel(
  input: { isAdminPath: boolean; ip?: string | null },
  extraOpsIps?: readonly string[],
): AccessChannel {
  if (isServerOrigin(input.ip, extraOpsIps)) return "OPS";
  if (input.isAdminPath) return "ADMIN";
  return "USER";
}

/**
 * 把任意输入收敛成一个合法的渠道筛选值。
 *
 * 返回 `undefined` 表示「不过滤渠道」（后台的 `channel=ALL`）。
 * 未知值当作**默认视图**处理，而不是报错：查询串是人手拼的，
 * 一个拼错的值不该让整个页面变成 400。
 */
export function normalizeChannelFilter(raw: string | undefined): AccessChannel | undefined {
  if (!raw) return "USER";
  const upper = raw.trim().toUpperCase();
  if (upper === "ALL" || upper === "*") return undefined;
  return (ACCESS_CHANNELS as readonly string[]).includes(upper) ? (upper as AccessChannel) : "USER";
}
