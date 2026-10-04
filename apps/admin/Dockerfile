FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_OUTPUT_STANDALONE=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY packages ./packages
RUN npm ci
# test/fixtures/admin-roles.ts is type-checked by `next build` and imports
# PrismaClient. Without a generated client those types resolve to `any`/error,
# which is why this generate step is required here and not just in the API image.
COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema.prisma
COPY apps/admin ./apps/admin
# 交付构建前的守卫 —— 见 apps/web/Dockerfile 的同名步骤（admin 不连 Socket.IO）。
COPY scripts ./scripts
RUN node scripts/check-build-env.mjs
RUN npm run build -w @talkfirst/admin

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache wget \
  && addgroup -S app && adduser -S app -G app
# Standalone output — see apps/web/Dockerfile.
COPY --from=build --chown=app:app /app/apps/admin/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /app/apps/admin/public* ./apps/admin/
USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null http://localhost:3001/login || exit 1
CMD ["node", "apps/admin/server.js"]
