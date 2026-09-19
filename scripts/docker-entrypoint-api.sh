#!/bin/sh
set -e

echo "[api] running prisma migrate deploy..."
npx prisma migrate deploy --schema prisma/schema.prisma

# The runtime image installs with --omit=dev, so `tsx` is unavailable here.
# Use the plain-JS mirror of the seed instead.
if [ -n "$SEED_ON_BOOT" ]; then
  echo "[api] seeding database..."
  node prisma/seed.runtime.cjs || echo "[api] seed skipped/failed (continuing)"
fi

echo "[api] starting NestJS..."
exec node apps/api/dist/main.js
