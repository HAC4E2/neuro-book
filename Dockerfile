FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app

ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/neuro_book

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run nuxt:prepare
RUN bun run generate
RUN bun run nuxt:build

FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/server/generated/prisma ./server/generated/prisma
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
