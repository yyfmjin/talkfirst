FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY packages ./packages
RUN npm ci
COPY prisma ./prisma
COPY apps/api ./apps/api
RUN npx prisma generate --schema prisma/schema.prisma
RUN npm run build -w @talkfirst/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget \
  && addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY packages ./packages
# --chown here avoids a later `chown -R /app`, which would duplicate the whole
# node_modules tree into a second ~1GB layer.
#
# The `rm -rf` sits in the SAME RUN as `npm ci` on purpose. If it were its own
# RUN, the install layer would already be committed with all the frontend
# packages in it and the delete would only add a whiteout layer — the image
# would still weigh the same. Both must land in one layer for the prune to
# actually shrink the image.
#
# What is removed: npm workspaces installs the sibling apps' dependencies into
# this shared node_modules even though the API never imports them (no `next` /
# `react` / `lucide-react` anywhere in apps/api/src). That was ~570MB.
# NOT removable: @prisma/debug and @prisma/get-platform — the `prisma` CLI
# needs both transitively via @prisma/engines; dropping @prisma/debug fails at
# boot with MODULE_NOT_FOUND from @prisma/engines/dist/index.js.
RUN npm ci --omit=dev --chown=app:app \
  && npm cache clean --force \
  && rm -rf \
      node_modules/next \
      node_modules/@next \
      node_modules/@img \
      node_modules/lucide-react \
      node_modules/react \
      node_modules/react-dom \
      node_modules/socket.io-client \
      node_modules/@angular-devkit \
      node_modules/typescript \
      node_modules/@prisma/fetch-engine
# `prisma migrate deploy` runs on every boot, so the CLI must exist in the
# runtime image even though it is a devDependency. Copy it from the build
# stage instead of running a second `npm install`: this tree is a partial
# workspace (no test/dev packages), so a fresh resolve trips ERESOLVE on the
# ts-jest / @babel/core peer range.
COPY --from=build --chown=app:app /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build --chown=app:app /app/node_modules/@prisma/fetch-engine ./node_modules/@prisma/fetch-engine
COPY --from=build --chown=app:app /app/node_modules/@prisma/get-platform ./node_modules/@prisma/get-platform
COPY --from=build --chown=app:app /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build --chown=app:app /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app scripts/docker-entrypoint-api.sh ./scripts/docker-entrypoint-api.sh
# The repo is edited on Windows, where this script can pick up CRLF endings.
# A CRLF shebang makes the kernel look for `/bin/sh\r`, which surfaces as the
# maddening "exec ...: no such file or directory" for a file that is right
# there. Normalise in-image so a bad checkout cannot break the container.
RUN sed -i 's/\r$//' ./scripts/docker-entrypoint-api.sh \
  && chmod +x ./scripts/docker-entrypoint-api.sh
# FIX (audit P004): create the upload directory and hand it to the runtime user
# BEFORE the volume is mounted. Docker seeds a fresh named volume from the image
# path, including its ownership — without this the volume would be owned by root
# and every upload would fail with EACCES for the unprivileged `app` user.
RUN mkdir -p /app/uploads && chown -R app:app /app/uploads
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/v1/health/ready').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["./scripts/docker-entrypoint-api.sh"]
