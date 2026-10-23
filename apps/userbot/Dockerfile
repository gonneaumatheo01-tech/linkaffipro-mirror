# Image du service userbot (comptes Telegram reels, GramJS) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
# ffmpeg : nettoyage et amplification des vocaux avant transcription (src/audio.ts).
RUN apk add --no-cache libc6-compat openssl ffmpeg && npm install -g pnpm@12.9.1
ENV NODE_ENV=production PNPM_HOME=/home/node/.pnpm
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node . .
USER node
# Pas de turbo build : le userbot tourne directement en TS via tsx (dependance de dev, donc --prod=false).
RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm db:generate \
  && pnpm store prune
# Aucun port HTTP. node en PID 1 (pas pnpm) : SIGTERM arrive au programme, qui deconnecte
# proprement les comptes Telegram (src/index.ts) au redeploiement.
WORKDIR /app/apps/userbot
CMD ["node", "--import", "tsx", "src/index.ts"]
