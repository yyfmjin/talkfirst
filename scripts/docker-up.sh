#!/bin/sh
set -eu

if [ "${SEED_ON_BOOT:-}" = "1" ]; then
  docker compose --profile admin up -d --build
else
  docker compose up -d --build
fi

echo "Waiting for API health..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:${API_PORT:-4000}/api/v1/health >/dev/null 2>&1; then
    echo "API is ready."
    break
  fi
  sleep 2
done

docker compose ps
