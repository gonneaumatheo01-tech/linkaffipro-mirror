# Image du service worker (BullMQ) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl && npm install -g pnpm@12.9.1
ENV NODE_ENV=production PNPM_HOME=/home/node/.pnpm
WORKDIR /app
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm db:generate \
  && pnpm exec turbo run build --filter=worker \
  && pnpm store prune
EXPOSE 8080
CMD ["node", "apps/worker/dist/index.js"]
