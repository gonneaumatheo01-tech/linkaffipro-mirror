# Image du service userbot (comptes Telegram reels, GramJS) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl su-exec && npm install -g pnpm@12.9.1
ENV NODE_ENV=production PNPM_HOME=/home/node/.pnpm
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node . .
USER node
# Pas de turbo build : le userbot tourne directement en TS via tsx (dependance de dev, donc --prod=false).
RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm db:generate \
  && pnpm store prune
EXPOSE 8080
CMD ["pnpm", "--filter", "userbot", "start"]
