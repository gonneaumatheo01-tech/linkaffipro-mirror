# Image du service web (Next.js) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl && npm install -g pnpm@12.9.1
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/home/node/.pnpm
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node . .
USER node
# Toutes les dépendances (dev comprises) sont nécessaires pour construire. Phase 26 : la vérification des types du
# site dépasse la mémoire par défaut de Node (manque de mémoire constaté en local) : 6 Go pour le build seulement (4 Go ne suffisent plus depuis le 29 octobre 2026).
RUN export NODE_OPTIONS=--max-old-space-size=6144 \
  && pnpm install --frozen-lockfile --prod=false \
  && pnpm db:generate \
  && pnpm exec turbo run build --filter=web \
  && pnpm store prune
EXPOSE 3000
# Au démarrage : migrations Prisma, premier compte, reprise de la phase 11 (une seule fois, marque Setting
# phase11.gateExceptions ; un échec ne bloque jamais le site), puis Next.
CMD ["sh", "-c", "pnpm --filter @linkaffipro/db db:migrate && pnpm --filter @linkaffipro/db db:seed && (pnpm --filter @linkaffipro/db db:phase11 || echo '[phase11] reprise en échec, à relancer : pnpm db:phase11') && pnpm --filter web exec next start -p ${PORT:-3000}"]
