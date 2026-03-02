#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required" >&2
    exit 1
fi

bunx prisma migrate deploy --config ./prisma.config.ts

exec bun .output/server/index.mjs
