# Décisions techniques

Journal des choix techniques pris en autonomie, avec leur raison. Mis à jour à chaque phase.

## Phase 0 — 9 octobre 2026

### Versions
- Node 22 (images Docker `node:22-alpine`), pnpm 12.9.1, Turborepo 2.11, TypeScript 5.9 (pas la 7.x toute récente : outillage pas encore aligné), ESLint 10 (flat config), Prettier 3, Vitest 5.
- Next.js 16.4 (App Router, Turbopack, fichier `proxy.ts` à la place de `middleware.ts`), React 19.3, Tailwind 4, shadcn/ui (style `base-nova`, base Base UI, couleur neutre, mode clair).
- Auth.js = `next-auth@5.0.0-beta` (seule version compatible App Router), sessions JWT 14 jours, fournisseur « credentials » (bcrypt).
- Prisma 6.19 (pas la 7 : la 6 garde `url` dans le schéma et un outillage éprouvé ; migration vers la 7 à planifier plus tard), cibles binaires `native` + `linux-musl-openssl-3.0.x` (alpine).
- grammY 1.46, BullMQ 6.3, ioredis 6, pino 10, zod 4, bcryptjs 3.

### Structure
- Monorepo pnpm : `apps/web` (Next.js), `apps/worker` (Node + BullMQ), `packages/core` (règles pures), `packages/db` (Prisma), `packages/telegram` (grammY), `packages/linkaffi` (client API Link Affi, ajouté car Link Affi n'est accessible que par API), `packages/config` (tsconfig / eslint partagés).
- Les paquets internes sont consommés en **TypeScript source** (`main: ./src/index.ts`) : Next les transpile (`transpilePackages`), le worker est empaqueté par tsup (esbuild) en un seul fichier ESM, les scripts tournent avec `tsx`. Conséquence : résolution `Bundler` et imports sans extension `.js` (Turbopack ne résout pas `./x.js` → `x.ts`).
- `cacheComponents` désactivé dans Next : outil interne, rendu dynamique classique, toutes les pages lisent la base à chaque requête.
- Les types globaux Next (`PageProps`, `LayoutProps`, `RouteContext`) sont générés par `next typegen` avant `tsc` (script `typecheck`).

### Sécurité et secrets
- Jetons de bots chiffrés AES-256-GCM (`APP_ENCRYPTION_KEY`, 32 octets base64), format `v1.<iv>.<tag>.<données>` ; déchiffrés uniquement en mémoire pour créer l'instance grammY (cache par bot, invalidé si le jeton change).
- Un secret de webhook **par bot** (`Bot.webhookSecret`, aléatoire) vérifié en temps constant sur l'en-tête `X-Telegram-Bot-Api-Secret-Token`. La variable `TELEGRAM_WEBHOOK_SECRET` existe mais n'est pas utilisée (réserve).
- IP jamais stockée en clair : SHA-256 avec sel `IP_HASH_SALT`.
- Rôles vérifiés côté serveur dans chaque action (`requireAdmin` / `requireUser`), pas seulement dans l'interface. `requireUser` relit l'utilisateur en base à chaque page (un compte désactivé perd l'accès immédiatement malgré le JWT).
- Secrets locaux dans `.env.local` et `.claude/settings.local.json` (ignorés par git) ; en production dans les variables Railway.

### Telegram
- Un webhook par bot : `POST /api/telegram/<id interne du bot>`. `allowed_updates` complet (message, edited_message, channel_post, edited_channel_post, callback_query, chat_member, my_chat_member, chat_join_request, message_reaction, message_reaction_count).
- Le webhook répond toujours 200 après traitement (sinon Telegram renvoie la même update en boucle) ; les erreurs sont stockées dans `Bot.lastError`.
- Les handlers sont écrits contre une interface `TelegramDeps` (accès base abstrait) pour être testés avec des updates simulées sans base.
- `botInfo` est fourni à grammY à partir de l'enregistrement en base pour éviter un appel `getMe` à chaque instance.

### Redirections go.goolink.eu
- Routage par hôte dans `proxy.ts` : si l'hôte est `TRACKING_HOST`, réécriture vers `/r/<chemin>` sans authentification ; réponse 302 sans corps, `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- La journalisation (`Event` `tracking.redirect`) se fait **après** la réponse (`after()` de Next) pour ne jamais ralentir la redirection.
- Le domaine de tracking est **go.goolink.eu** (corrections de l'utilisateur : goolink.me → goolink.eu, puis sous-domaine `go.` à cause d'IONOS).

### Link Affi
- Link Affi tourne sur Lovable Cloud : aucun accès SQL ni MCP, seulement l'API GET `stats-api` (voir `docs/LINKAFFI-API.md`). Client typé dans `packages/linkaffi` : file d'attente 1 requête/s, pagination par `offset`, reprises avec attente croissante (429 / 5xx / réseau), aucune reprise sur 401/403/404.
- Les clés `LINKAFFI_API_KEY` / `LINKAFFI_ANON_KEY` ne sont posées que sur le service `worker`.
- Le lien de campagne `https://linkaffi.me/go/<clé>` est une page qui redirige côté navigateur vers `…/functions/v1/track-click?campaign_key=<clé>&<tous les paramètres de l'URL d'origine>` : les paramètres sont transmis tels quels. Le nom exact du paramètre de sub-ID sera confirmé dans la table `clicks` dès que les clés API seront fournies.

### Railway et Docker
- Projet `linkaffipro`, environnement `production`, services `web`, `worker`, `Postgres`, `Redis`.
- Une image par service, construite depuis la racine du monorepo (variable `RAILWAY_DOCKERFILE_PATH`). Choix volontaire d'une image « espace de travail complet » (sans `pnpm deploy` ni sortie standalone) : plus lourde mais sans surprise avec Prisma et pnpm ; à optimiser plus tard si le temps de build gêne.
- Le service `web` lance `prisma migrate deploy` puis `next start` à chaque démarrage. Le premier ADMIN est créé par `pnpm db:seed` (idempotent).
- Région : les bases Postgres et Redis ont été créées par Railway dans la région par défaut du compte (US West, `us-west2`). Une tentative de les recréer en Europe par l'API a échoué (le champ `region` est ignoré à la création des volumes, et la suppression des services a été bloquée). Un service dont la région diffère de celle de son volume ne démarre pas : **tous les services sont donc alignés sur `us-west2`** pour la phase 0. Le passage en Europe (Amsterdam) se fait depuis le tableau de bord Railway, service par service (voir STATUS.md) ; il faudra ensuite reposer les webhooks (`pnpm telegram:webhooks`, rien d'autre ne change). Les volumes orphelins créés pendant la tentative sont à supprimer dans le tableau de bord.
- Domaines : IONOS (registrar du client) refuse les CNAME sur domaine nu, donc le site est sur `app.linkaffipro.com` et le tracking sur `go.goolink.eu` (CNAME vers Railway + TXT de vérification). Le plan Railway actuel limite à 2 domaines personnalisés par service : ces deux-là sont posés ; les domaines nus restent libres (redirection IONOS possible plus tard).

### Interface
- Textes en français, police système (pas de police Google : évite un appel réseau au build).
- Formulaires rendus côté serveur avec actions serveur (`<form action>`), messages de retour passés par `?ok=` / `?error=` ; composants client réduits au minimum (connexion, invitation, bouton « copier », menu mobile).
- Pages de la phase 1 (Membres, Messages, Liens) présentes avec le détail de ce qui arrive, plutôt qu'absentes.
