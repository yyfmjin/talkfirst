import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, urlencoded } from "express";
import { join } from "path";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { trustProxySetting } from "./security/client-ip";
import { createRequestIdMiddleware } from "./security/request-id.middleware";

async function bootstrap() {
  if (process.env.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("change-me")) {
      missing.push("JWT_SECRET");
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.includes("change-me")) {
      missing.push("JWT_REFRESH_SECRET");
    }
    if (missing.length > 0) {
      throw new Error(`Missing required production secrets: ${missing.join(", ")}`);
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.setGlobalPrefix("api/v1");
  // Security Audit Center (P1): the reverse proxy terminates TLS, so Express must
  // be told how many hops to trust before `req.ip` means anything (see
  // `client-ip.ts`). Registered first so a requestId exists before any other
  // middleware, guard or interceptor runs.
  app.set("trust proxy", trustProxySetting());
  app.use(createRequestIdMiddleware());
  app.use(cookieParser());
  // Base64 image uploads (avatar / chat image) exceed Express' 100kb default.
  app.use(json({ limit: "8mb" }));
  app.use(urlencoded({ extended: true, limit: "8mb" }));
  app.useGlobalFilters(new ApiExceptionFilter());
  // Static uploads live outside the API prefix: /uploads/* vs /api/v1/uploads/*.
  app.useStaticAssets(join(process.cwd(), ".local-data", "uploads"), { prefix: "/uploads/" });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const adminUrl = process.env.ADMIN_URL ?? "http://localhost:3001";
  app.enableCors({
    origin: [appUrl, adminUrl],
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
