import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdminGuard } from "./admin.guard";

/**
 * 允许后台调用的起名站动作。
 *
 * 与起名站 `serviceAdmin` 的白名单**必须一致**：这里是唯一入口，多一条意味着
 * 后台能碰到没审过的动作；少一条只是功能不可用 —— 后者联调时立刻暴露，前者不会。
 */
const ALLOWED_ACTIONS = new Set([
  "adminOverview",
  "adminGetSettings",
  "adminSaveSettings",
  "adminListUsers",
  "adminGetUserDetail",
  "adminSetUserStatus",
  "adminSetUserRole",
  "adminResetUserPassword",
  "adminDeleteUser",
  "adminListAllCandidates",
  "adminUpdateCandidate",
  "adminDeleteCandidate",
  "adminDeleteProfile",
  "adminListAllBindings",
  "adminDeleteBinding",
  "adminListAllConversations",
  "adminListMessages",
  "adminDeleteConversation",
  "adminDeleteMessage",
  "adminListDmConversations",
  "adminListDmMessages",
  "adminDeleteDmMessage",
  "adminDeleteDmConversation",
]);

/**
 * 起名站（Destiny Atlas）的后台接口 —— 挂在 TalkFirst 后台的 `/admin/bazi` 下。
 *
 * ## 为什么是一层很薄的转发
 *
 * 起名站跑在**另一个进程**里（容器 :3100，SQLite 单文件），它有自己的一套
 * 管理员动作（概览、用户列表、站点设置）。在 TalkFirst 库里再建一份用户表去
 * 「顺便管理」，两份数据必然会对不上 —— 而且登录是 SSO，账号本来就不在同一个库里。
 *
 * 所以这里只做三件事：校验调用者是 TalkFirst 管理员、带上共享密钥发起服务间调用、
 * 把结果原样返回。统计口径、权限判断都留在起名站自己那侧。
 *
 * ## 密钥
 *
 * `BAZI_SERVICE_SECRET` 只存在于两台服务器的环境变量里，不进任何客户端；它放在
 * 请求体而不是 URL 上，避免被访问日志记下来。
 *
 * 这个控制器只挂 `JwtAuthGuard + AdminGuard`（不接权限表）：它管理的是一套独立的
 * 运营数据，没有需要与 TalkFirst 角色矩阵对齐的写操作 —— 白名单里也只有
 * 「看数据 / 改站点文案与注册开关」。
 */
@Controller("admin/bazi")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminBaziController {
  /** 调起名站的白名单动作，把 `serviceAdmin` 的包封拆开。 */
  private async call(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const base = (process.env.BAZI_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
    const secret = process.env.BAZI_SERVICE_SECRET ?? "";

    let response: Response;
    try {
      response = await fetch(`${base}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "serviceAdmin", args: { secret, action, args } }),
      });
    } catch {
      throw new ServiceUnavailableException({
        success: false,
        error: { code: "BAZI_UNREACHABLE", message: "起名站当前不可用" },
      });
    }

    if (!response.ok) {
      throw new BadGatewayException({
        success: false,
        error: { code: "BAZI_BAD_RESPONSE", message: `起名站返回 ${response.status}` },
      });
    }

    const body = (await response.json()) as {
      data?: { ok?: boolean; message?: string; data?: unknown };
    };
    const envelope = body.data;
    if (!envelope?.ok) {
      throw new BadGatewayException({
        success: false,
        error: {
          code: "BAZI_ACTION_FAILED",
          message: envelope?.message ?? "起名站拒绝了这次调用",
        },
      });
    }
    return envelope.data;
  }

  @Get("overview")
  async overview() {
    return { success: true as const, data: await this.call("adminOverview") };
  }

  /**
   * 通用动作入口 —— 账号管理、内容管理都走这里。
   *
   * 用一条路由而不是十几个具名端点：动作集合与参数由起名站自己的 zod schema
   * 定义，在这边再镜像一份只会让两边逐渐不一致。安全边界是上面的白名单。
   */
  @Post("action")
  async action(@Body() dto: { action?: string; args?: Record<string, unknown> }) {
    const action = dto?.action ?? "";
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new BadRequestException({
        success: false,
        error: { code: "BAZI_ACTION_NOT_ALLOWED", message: `不允许的动作：${action}` },
      });
    }
    return { success: true as const, data: await this.call(action, dto.args ?? {}) };
  }

  @Get("users")
  async users() {
    return { success: true as const, data: await this.call("adminListUsers") };
  }

  @Get("settings")
  async settings() {
    return { success: true as const, data: await this.call("adminGetSettings") };
  }

  /**
   * 保存站点设置（标题、公告、绑定上限、注册开关…）。
   *
   * 不在这里做字段校验：起名站的动作本身有 zod schema，缺字段/超长会直接拒绝，
   * 在这一侧再抄一份必然与它漂移。
   */
  @Patch("settings")
  async saveSettings(@Body() dto: Record<string, unknown>) {
    return { success: true as const, data: await this.call("adminSaveSettings", dto) };
  }
}
