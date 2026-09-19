FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_SOCKET_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SOCKET_BASE_URL=$NEXT_PUBLIC_SOCKET_BASE_URL
ENV NEXT_OUTPUT_STANDALONE=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY packages ./packages
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build -w @talkfirst/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache wget \
  && addgroup -S app && adduser -S app -G app
# Standalone output carries its own minimal node_modules and server.js, so the
# runtime stage deliberately installs nothing.
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
# public/ is optional — it does not exist in this repo yet.
COPY --from=build /app/apps/web/public* ./apps/web/
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null http://localhost:3000/ || exit 1
CMD ["node", "apps/web/server.js"]
