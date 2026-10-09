# Phase 0 — Préparation et socle (à exécuter en entier, en autonomie)

Tu es l'ingénieur principal du projet décrit dans `CLAUDE.md`. Lis `CLAUDE.md` et `docs/02-decisions.md`, survole `docs/01-cadrage-analyse.md`. Puis exécute ce qui suit, dans l'ordre, sans demander de confirmation pour les choix techniques. Crée une liste de tâches dès le début et coche au fur et à mesure.

**Objectif de la phase.** À la fin : le projet est sur GitHub, déployé sur Railway avec sa base de données ; la page de connexion fonctionne ; les 3 bots Telegram sont en ligne et répondent à `/start` ; les canaux où ils sont administrateurs sont détectés automatiquement ; la redirection goolink.me répond ; l'accès en lecture seule à Link Affi est établi et son schéma documenté. `docs/STATUS.md` dit à l'utilisateur quoi tester et quelles lignes DNS ajouter.

**Rappel sur l'utilisateur.** Non technique, veut seulement approuver. Quand tu lui demandes quelque chose, une seule demande à la fois, en français simple, avec les clics exacts.

## Avant tout : réglages de Claude Code (1 minute, sans rien demander)

Le fichier de réglages n'a pas pu être déposé directement. Copie `docs/setup/claude-settings.json` vers `.claude/settings.json` (crée le dossier `.claude/` si besoin). Il sera actif à la prochaine session. Aucun serveur MCP n'est nécessaire pour ce projet.

## 0. Ce que tu demandes à l'utilisateur (au début, une seule fois)

Demande-lui de coller, un par un, dans l'ordre :
1. le jeton GitHub (commence par `ghp_`) ;
2. le jeton Railway (jeton de compte) ;
3. les deux clés de l'API Link Affi, telles qu'il les a reçues : la valeur de `x-api-key` (commence par `lkst_`) et la valeur de `apikey` (un long JWT commençant par `eyJ`). L'API est décrite dans `docs/LINKAFFI-API.md` ;
4. les 3 jetons de bots Telegram (format `123456789:AAE...`), en précisant l'univers de chacun : casino, paris sportifs, dating ;
5. un lien de campagne Link Affi complet (pour comprendre le format du sub-ID) ;
6. son adresse e-mail (premier compte ADMIN) et le prénom à afficher.

Stockage des secrets :
- Crée `.claude/settings.local.json` avec `{"env": {"GH_TOKEN": "...", "RAILWAY_API_TOKEN": "..."}}` et `.env.local` à la racine avec ces deux variables plus `LINKAFFI_API_URL`, `LINKAFFI_API_KEY` (x-api-key) et `LINKAFFI_ANON_KEY` (apikey). `.gitignore` existe déjà et les ignore ; vérifie-le.
- Les jetons de bots vont en base, chiffrés, via le même code que l'interface (section 6). Ne les écris dans aucun fichier en clair, sauf temporairement dans `.env.local` si tu en as besoin pour le seed, puis retire-les.
- N'affiche jamais un jeton dans tes réponses, dans les logs ni dans STATUS.md.
- Si un jeton ne fonctionne pas, dis-le simplement et explique en 3 lignes comment le refaire (le guide de l'utilisateur décrit les clics : GitHub Settings → Developer settings → Tokens (classic) ; Railway Account Settings → Tokens). Si l'API Link Affi répond 401 ou 403, demande à l'utilisateur de vérifier les deux clés auprès de la personne qui a créé l'API.

Pour que les variables soient disponibles dans tes commandes shell de cette session, préfixe-les par `set -a; source .env.local; set +a;` quand c'est nécessaire.

## 1. Outils sur la machine

- Vérifie `node --version` (il faut 22 ou plus), `pnpm --version` (sinon `corepack enable && corepack prepare pnpm@latest --activate`), `git --version`, `gh --version`, `railway --version`.
- Installe ce qui manque sans `sudo` : avec Homebrew s'il est présent (`brew install gh railway`) ; sinon `npm i -g @railway/cli` et, pour `gh`, le binaire des releases GitHub placé dans `~/.local/bin` (ajoute ce dossier au PATH dans `~/.zshrc` si nécessaire).
- `gh` : utilise la variable `GH_TOKEN` (pas de `gh auth login` interactif). Lance `gh auth setup-git` pour les push HTTPS. Vérifie avec `gh auth status`.
- Railway : vérifie `railway whoami`. Si la CLI n'accepte pas le jeton par variable, demande à l'utilisateur de taper `railway login` dans un second Terminal, d'appuyer sur Entrée et de confirmer dans le navigateur, puis réessaie.
- Configure `git config user.name` et `user.email` avec les informations de l'utilisateur.

## 2. Dépôt Git et GitHub

- `git init` dans ce dossier (il contient déjà `CLAUDE.md`, `docs/`, `.claude/settings.json`, `.mcp.json`).
- `.gitignore` complet : `node_modules`, `.next`, `dist`, `build`, `.turbo`, `coverage`, `.env`, `.env.*`, `!.env.example`, `.claude/settings.local.json`, `.DS_Store`, `*.log`.
- Crée le dépôt privé `linkaffipro-platform` sur le compte GitHub de l'utilisateur : `gh repo create linkaffipro-platform --private --source=. --push` (après un premier commit). Note l'URL du dépôt dans `CLAUDE.md`, section Commandes.

## 3. Monorepo

- pnpm workspaces + Turborepo. Dossiers : `apps/web`, `apps/worker`, `packages/db`, `packages/telegram`, `packages/core`, `packages/config` (tsconfig et eslint partagés). TypeScript strict partout, ESLint, Prettier, Vitest.
- `apps/web` : Next.js dernière version stable (App Router), Tailwind, shadcn/ui initialisé (style sobre, mode clair, textes en français). Layout d'administration : barre latérale (Tableau de bord, Canaux, Bots, Membres, Messages, Liens, Réglages), en-tête avec l'utilisateur connecté et un menu « Mon compte / Déconnexion ». Pages prévues en phase 1 affichées comme « bientôt » plutôt qu'absentes.
- `apps/worker` : process Node avec BullMQ (connexion Redis), un serveur HTTP minimal avec `/health`, et des workers déclarés mais vides : `scheduler`, `telegram-send`, `approvals`, `sync-linkaffi`, `stats`. Arrêt propre sur SIGTERM.
- `packages/db` : Prisma, schéma initial (section 5), client exporté, scripts `db:generate`, `db:migrate` (deploy en prod, dev en local), `db:studio`, `db:seed` (crée l'ADMIN initial à partir de `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_INITIAL_PASSWORD` s'il n'existe pas).
- `packages/telegram` : fabrique de bots grammY multi-instances à partir des enregistrements `Bot` en base (jeton déchiffré en mémoire seulement) ; un webhook par bot sur `POST /api/telegram/:botId` dans `apps/web`, vérifié par `secret_token` ; handlers de base :
  - `/start` : répond « Bonjour, je suis {nom du bot}, le bot {univers}. » (texte dans un fichier de traductions fr/en, clé par univers) ; enregistre le membre (`Member`) et `MemberBotState.canDm = true, startedAt`.
  - `my_chat_member` : quand le bot est ajouté ou retiré comme administrateur d'un canal, upsert `Channel` (telegramChatId, title, username, type) et `ChannelBotAdmin` (droits reçus, detectedAt / revokedAt).
  - `channel_post` : si le canal est inconnu, upsert `Channel` ; tente `getChatAdministrators` pour renseigner `ChannelBotAdmin` pour chacun de nos bots.
  - tout update reçu est journalisé dans `Event` (type `telegram.<update_type>`, payload = update brut sans jeton).
- `packages/core` : utilitaires purs et testés : ids courts (base62, 8 caractères), chiffrement AES-256-GCM (clé `APP_ENCRYPTION_KEY`), hachage d'IP avec sel, constantes métier (univers, rôles), détection de robots par user agent.
- Scripts racine : `pnpm dev` (web + worker en parallèle), `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm db:migrate`, `pnpm db:studio`. Documente-les dans `CLAUDE.md`.
- `.env.example` complet, commenté en français.

## 4. Infrastructure Railway

- Crée le projet Railway `linkaffipro` (environnement `production`), région Europe (Amsterdam, ou Paris si proposée).
- Ajoute PostgreSQL et Redis (`railway add`). Crée les services `web` et `worker`.
- Un Dockerfile par app (`apps/web/Dockerfile`, `apps/worker/Dockerfile`), build pnpm en monorepo (`pnpm deploy` ou `turbo prune`), image Node 22 alpine, utilisateur non root. Variable `RAILWAY_DOCKERFILE_PATH` sur chaque service si nécessaire. Le service `web` lance `prisma migrate deploy` puis `next start` ; le `worker` lance son process.
- Variables (via `railway variables --set`) : `DATABASE_URL` et `REDIS_URL` (références aux services Railway), `APP_ENCRYPTION_KEY` (32 octets aléatoires en base64), `AUTH_SECRET`, `AUTH_URL` / `NEXTAUTH_URL`, `APP_BASE_URL`, `TRACKING_HOST=goolink.me`, `TRACKING_BASE_URL=https://goolink.me`, `TELEGRAM_WEBHOOK_SECRET` (aléatoire), `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_INITIAL_PASSWORD` (généré, 16 caractères ; à écrire une seule fois dans STATUS.md pour l'utilisateur), `TZ=Europe/Paris`.
- Déploie (`railway up --service web --detach`, puis `worker`). Attends la fin du build, vérifie `GET /api/health` sur web (retourne version, état base et Redis) et `/health` sur worker. Lis les logs en cas d'échec et corrige.
- Domaines : génère d'abord le domaine `*.up.railway.app` du service web (adresse provisoire, à noter dans STATUS.md). Ajoute ensuite `linkaffipro.com`, `www.linkaffipro.com` et `goolink.me` comme domaines personnalisés du service web (`railway domain`). Récupère les enregistrements DNS attendus (type, nom, cible) et écris-les tels quels dans STATUS.md. Si une étape exige le tableau de bord Railway, fais tout ce qui est possible en CLI et décris le reste en clics exacts dans STATUS.md.
- Les webhooks Telegram pointent sur l'adresse provisoire tant que linkaffipro.com n'est pas actif ; prévois un script `pnpm telegram:webhooks` qui (re)pose tous les webhooks à partir de `APP_BASE_URL`.

## 5. Base de données (schéma initial)

Modélise avec Prisma, en PostgreSQL (noms en anglais, commentaires en français) :
- `User` (id, email unique, passwordHash, name, role `ADMIN | MANAGER`, isActive, createdAt, lastLoginAt), `Invitation` (email, role, token, expiresAt, acceptedAt, invitedById), `AuditLog` (userId, action, entityType, entityId, metadata JSON, createdAt).
- enum `Vertical` : `CASINO | SPORTS | DATING`.
- `Bot` (id, name, username, telegramBotId bigint unique, tokenEncrypted, vertical, isActive, webhookSecret, lastWebhookAt, lastError), `Channel` (id, telegramChatId bigint unique, title, username, type `CHANNEL | GROUP`, vertical nullable, language default `fr`, primaryBotId nullable, isActive, isTest, isMediaLibrary, settings JSON), `ChannelBotAdmin` (channelId, botId, rights JSON, detectedAt, revokedAt nullable ; unique channelId+botId).
- `Member` (id, telegramUserId bigint unique, firstName, lastName, username, languageCode, isPremium, firstSeenAt, lastSeenAt), `MemberBotState` (memberId, botId, canDm, startedAt, blockedAt, lastDmAt ; unique memberId+botId).
- `Event` (id, type, occurredAt, memberId?, channelId?, botId?, payload JSON, createdAt), index sur (type, occurredAt), (memberId, occurredAt), (channelId, occurredAt). Append-only : aucune mise à jour ni suppression dans le code.
- `Setting` (key unique, value JSON).
Prévois sans les implémenter (noms réservés, documentés) les tables de la phase 1 : `Membership`, `ApprovalRule`, `InviteLink`, `TrackingLink`, `Click`, `Post`, `PostButton`, `PostStats`, `MessageCategory`, `MediaAsset`, `Sequence`, `SequenceStep`, `OutboundMessage`, `AffiliateProgram`, `AffiliateCampaign`, `Player`, `PlayerEvent`, `SyncState`, `Campaign`. Documente le modèle (phase 0 réalisée + phase 1 prévue) dans `docs/DATA-MODEL.md`.

## 6. Authentification et interface

- Auth.js (credentials) : e-mail + mot de passe (bcrypt), sessions JWT, page `/login` en français, déconnexion, page « Mon compte » (changer le mot de passe, lier mon Telegram : affiche un lien `t.me/<bot>?start=admin_<token>` qui, une fois cliqué, enregistre le telegramUserId sur le User). Pas d'inscription publique : invitations par un ADMIN (Réglages → Utilisateurs → inviter par e-mail → lien d'invitation à copier ; l'envoi d'e-mail viendra plus tard).
- Middleware : tout est protégé sauf `/login`, `/invite/*`, `/api/health`, `/api/telegram/*` et les routes de redirection goolink.
- Rôles : ADMIN tout ; MANAGER tout sauf Réglages, utilisateurs, jetons, suppressions. Vérification côté serveur, pas seulement dans l'interface.
- Pages : Tableau de bord (compteurs : bots actifs, canaux, membres vus, événements 24 h), Bots (liste ; ajouter un bot en collant son jeton : `getMe`, chiffrement, `setWebhook` avec `allowed_updates` = message, edited_message, channel_post, edited_channel_post, callback_query, chat_member, my_chat_member, chat_join_request, message_reaction, message_reaction_count, et `secret_token` ; statut ; bouton « re-synchroniser le webhook » ; `getWebhookInfo` affiché), Canaux (liste auto-détectée : titre, univers à choisir, langue, bot principal, bots administrateurs détectés, cases TEST et Médiathèque), Réglages (utilisateurs, invitations), Journal (AuditLog).
- Enregistre les 3 bots fournis par l'utilisateur via le même code que l'interface (script `pnpm bots:register` ou via la page), puis vérifie chaque webhook avec `getWebhookInfo` (aucune erreur, URL correcte).

## 7. Redirections goolink.me (squelette)

- Dans `apps/web`, un middleware route tout le trafic dont l'hôte est `TRACKING_HOST` vers `app/r/[[...slug]]`. Phase 0 : `GET /test` répond 302 vers `https://t.me/telegram` ; tout slug inconnu répond 302 vers `APP_BASE_URL` ; jamais de HTML, en-têtes `Cache-Control: no-store`. Journalise un `Event` `tracking.redirect` avec slug, user agent, IP hachée (SHA-256 avec sel `IP_HASH_SALT`), referer, et les paramètres `ttclid`, `fbclid`, `gclid`, `utm_*` s'ils existent. Les user agents de robots connus (facebookexternalhit, Facebot, TikTok, Bytespider, Twitterbot, Googlebot, bingbot, Slackbot, TelegramBot, WhatsApp, LinkedInBot, curl…) sont redirigés mais marqués `isBot = true`.
- Teste en local avec l'en-tête `Host: goolink.me`.

## 8. Link Affi : API en lecture seule et schéma

Link Affi tourne sur Lovable Cloud : pas de compte Supabase, pas de SQL, pas de MCP. Le seul accès est l'API décrite dans `docs/LINKAFFI-API.md` (lis-la en entier). Tout ce qui suit se fait avec `curl` (ou un petit script Node) et les deux clés fournies par l'utilisateur.

- Vérifie l'accès : `GET /stats-api` doit renvoyer la liste des tables. En cas de 401/403, voir section 0.
- Découvre le schéma des tables utiles (liste dans `docs/LINKAFFI-API.md`, section « Tables à utiliser ») : pour chacune, `GET /stats-api/<table>?limit=5&order=-created_at` (si `created_at` n'existe pas, sans `order`), note les colonnes, leurs types apparents, le `total`, et repère où vivent : campagnes, liens de suivi, clics, inscriptions, premiers dépôts, dépôts, redépôts, NGR, identifiant joueur, sub-ID, affilié, casino, horodatages, devise. Ne lis pas les tables marquées « à ne pas lire ». Ne copie aucune donnée personnelle dans les docs (seulement les noms de colonnes et des valeurs anonymisées).
- Déduis le format exact du sub-ID à partir du lien de campagne fourni par l'utilisateur et de la table `clicks` : nom du paramètre dans le lien, nom de la colonne à l'arrivée, longueur maximale acceptée. Vérifie aussi `date_col` par défaut et le comportement de `from` / `to` sur une table.
- Écris `docs/LINKAFFI-SCHEMA.md` : par table, signification, colonnes clés, volumes, colonne de date pour la synchro incrémentale, et la correspondance prévue vers notre modèle (`AffiliateProgram`, `AffiliateCampaign`, `Player`, `PlayerEvent`, `Click.subId`).
- Crée dans `packages/core` (ou `packages/linkaffi`) un client typé de l'API : en-têtes, pagination par `offset` jusqu'à `total`, limite d'une requête par seconde, gestion des erreurs et des reprises, tests unitaires avec réponses simulées. Un script `pnpm linkaffi:check` affiche la liste des tables et le nombre de lignes des tables utiles (sans secrets).
- Enregistre `LINKAFFI_API_URL`, `LINKAFFI_API_KEY`, `LINKAFFI_ANON_KEY` dans les variables du service `worker` sur Railway (pas sur `web`).

## 9. Qualité et livraison

- `pnpm lint && pnpm build && pnpm test` verts. Tests minimum : chiffrement, ids courts, détection de robots, routage par hôte, handler `/start` et `my_chat_member` avec updates simulées, route de redirection.
- Commits par étape, push.
- Déploiement vérifié ; webhooks vérifiés ; `/start` testé sur les 3 bots si l'utilisateur est disponible, sinon indique-lui de le faire dans le test de 5 minutes.
- Mets à jour `CLAUDE.md` (dépôt, projet Railway, commandes réelles) et écris `docs/DECISIONS-TECH.md` (versions, bibliothèques, structure, choix faits et pourquoi).
- Écris `docs/STATUS.md` en français simple : ce qui est fait ; l'adresse provisoire du site ; l'e-mail et le mot de passe temporaire de l'ADMIN ; les lignes DNS à ajouter ; le test de 5 minutes (connexion, changer le mot de passe, `/start` sur les 3 bots, publier un message dans le canal TEST et le voir dans Canaux, ouvrir goolink.me/test) ; ce qui reste pour la phase 1 ; les actions humaines en attente, s'il y en a.
- Termine par un message à l'utilisateur de 10 lignes maximum : « Phase 0 terminée. Voici votre test de 5 minutes… », avec les éléments de STATUS.md, sans jamais afficher de jeton.
