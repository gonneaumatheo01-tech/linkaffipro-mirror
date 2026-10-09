# Image du service web (Next.js) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl && npm install -g pnpm@12.9.1
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/home/node/.pnpm
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node . .
USER node
# Toutes les dépendances (dev comprises) sont nécessaires pour construire.
RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm db:generate \
  && pnpm exec turbo run build --filter=web \
  && pnpm store prune
EXPOSE 3000
# Au démarrage : migrations Prisma, puis Next.
CMD ["sh", "-c", "pnpm --filter @linkaffipro/db db:migrate && pnpm --filter @linkaffipro/db db:seed && pnpm --filter web exec next start -p ${PORT:-3000}"]
