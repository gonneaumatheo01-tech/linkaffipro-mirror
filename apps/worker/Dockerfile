# Image du service worker (BullMQ) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
# postgresql18-client : pg_dump pour les sauvegardes quotidiennes (même version majeure que le serveur Railway, 18.x).
RUN apk add --no-cache libc6-compat openssl postgresql18-client && npm install -g pnpm@12.9.1
ENV NODE_ENV=production PNPM_HOME=/home/node/.pnpm
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm db:generate \
  && pnpm exec turbo run build --filter=worker \
  && pnpm store prune
EXPOSE 8080
CMD ["node", "apps/worker/dist/index.js"]
