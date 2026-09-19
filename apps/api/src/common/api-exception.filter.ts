import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiException");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === "object" && payload !== null && "success" in payload) {
        return response.status(exception.getStatus()).json(payload);
      }
      const message =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: unknown }).message ?? exception.message);
      // Phase A+: a 401 is an authentication failure by definition, so it gets a
      // domain code rather than the generic HTTP_ERROR. This is a safety net for
      // any handler that still throws a bare UnauthorizedException instead of
      // using JwtAuthGuard — the client contract stays "error.code tells you
      // what happened". Only the code changes; status and shape are unchanged.
      const code = exception.getStatus() === HttpStatus.UNAUTHORIZED ? "UNAUTHORIZED" : "HTTP_ERROR";
      return response.status(exception.getStatus()).json({
        success: false,
        error: { code, message: message || "Authentication required" },
      });
    }

    this.logger.error(String((exception as Error)?.stack ?? exception));
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  }
}
