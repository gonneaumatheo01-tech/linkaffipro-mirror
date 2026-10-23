# Image du service worker (BullMQ) — monorepo pnpm, Node 22 alpine, utilisateur non root.
FROM node:22-alpine
# postgresql18-client : pg_dump pour les sauvegardes quotidiennes (même version majeure que le serveur Railway, 18.x).
# ffmpeg (phase 20) : images des vidéos produites (Contrôle qualité des agents) et vocaux de l'admin.
# chromium + polices (phase 23) : captures chez les bookmakers et images de repli, pilotées par playwright-core
# (Chromium d'Alpine, pas de téléchargement de navigateur par Playwright).
RUN apk add --no-cache libc6-compat openssl postgresql18-client su-exec ffmpeg chromium nss freetype harfbuzz ttf-freefont font-noto font-noto-emoji && npm install -g pnpm@12.9.1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
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
# Le volume Railway /data appartient à root : on crée /data/backups pour l'utilisateur node, puis on bascule sur node.
USER root
CMD ["sh", "-c", "mkdir -p /data/backups && chown node:node /data/backups; exec su-exec node node apps/worker/dist/index.js"]
