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
- Le lien de campagne `https://linkaffi.me/go/<clé>` est une page qui redirige côté navigateur vers `…/functions/v1/track-click?campaign_key=<clé>&<tous les paramètres de l'URL d'origine>`. Vérifié avec les clés : **aucun sub-ID n'est conservé** (`clicks`, `players`, `postback_logs` n'ont pas de colonne de sub-ID ; `sub_profile_id` est un concept interne, vide). L'attribution Link Affi se fait par campagne. Décision : en phase 1, attribution par campagne (une campagne Link Affi par pub / canal / message, saisie dans la plateforme) et rapprochement approximatif des clics par horodatage ; le sub-ID par membre sera branché dès que Link Affi aura l'évolution demandée dans STATUS.md. Le modèle (`Click.subId`, `Player.subId`) reste prévu.

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

## Phase 1 — 9 octobre 2026

### Organisation
- Section 1 (modèle) faite seule, puis cinq chantiers en parallèle (sous-agents) sur des fichiers disjoints : A adhésions, B liens et offres, C messages, D synchro Link Affi, E membres et tableau de bord. Squelettes préparés à l'avance : `apps/worker/src/processors/<file>.ts` (un fichier par file BullMQ, branchés dans `processors/index.ts`), `packages/telegram/src/handlers/{core,join-flow,offers,reactions}.ts` (les handlers spécialisés passent avant le `/start` générique, qui ignore les payloads `g…` et `o…`), fichiers réservés dans `packages/core`.
- Nouveau paquet `@linkaffipro/queue` : définitions des files et des tâches, `enqueue` idempotent par `jobId`, `enqueueDm` (crée l'`OutboundMessage` puis enfile `telegram-send`). Tout message privé passe par là ; exception : les approbations/refus d'adhésion appellent l'API Telegram directement (worker `approvals` et actions de l'interface) car ce ne sont pas des envois de messages.
- Tâches périodiques : `upsertJobScheduler` BullMQ (approvals 20 s / 5 min, scheduler 30 s, sync-linkaffi 2 min, stats 10 min).

### Adhésions (A)
- Tous les bots administrateurs reçoivent `chat_join_request` ; seul le bot « agissant » (principal s'il est admin, sinon premier admin, avertissement journalisé) traite.
- `Membership.source` contient un instantané complet (lien, pub, règle, gates, URL `/start g…`, bot) pour que le worker reconstruise rappels et boutons sans relire.
- Gate SOFT = SCHEDULED dès la demande (canaux seulement proposés) ; gate sans canal = pas de gate ; MANUAL + gate : `/start g…` note `gateSatisfiedAt` sans planifier. Expiration : KEEP → EXPIRED, APPROVE → SCHEDULED immédiat, DECLINE → `declineChatJoinRequest`.
- Entrée effective sans demande connue (`chat_member`) → Membership APPROVED marqué `joinedDirectly` ; les liens GATE sont comptés via `invite_link`.
- Textes par défaut fr/en intégrés (`join-flow/texts.ts`) tant qu'aucune séquence n'est définie ; langue : membre > canal > fr.

### Liens et offres (B)
- Macros publicitaires (sources officielles TikTok Ads / Meta) dans `packages/core/src/ad-macros.ts` : TikTok `__CAMPAIGN_NAME__`, `__CID_NAME__`, `__AID_NAME__`, identifiants, `ttclid=__CLICKID__` conservé (TikTok l'ajoute aussi automatiquement) ; Meta `{{campaign.name}}`, `{{adset.name}}`, `{{ad.name}}` et identifiants, fbclid ajouté par Meta.
- Sub-ID = 12 caractères base62 sans point (contrat `docs/LINKAFFI-SUBID.md`) ; URL d'offre = `AffiliateCampaign.trackingUrlTemplate` (`https://linkaffi.me/go/<key>?sub_id={subid}`) remplie ; reclic = nouveau clic et nouveau sub-ID ; `uniqueClicks` au premier clic du membre.
- Redirection : une requête (`slug` unique), 302 sans corps, journalisation après la réponse, dédoublonnage 10 s par (ipHash, userAgent, lien), robots enregistrés `isBot` sans compter. Les paramètres d'origine ne sont pas propagés vers un lien t.me.
- Lien d'entrée : `createChatInviteLink` (`creates_join_request`) par le bot agissant ; `InviteLink` + `TrackingLink` AD_ENTRY en transaction ; règle optionnelle copiée et liée au lien ; création en lot (50 max).

### Synchronisation Link Affi (D)
- Identifiant Link Affi d'un joueur conservé dans `Player.raw.id` ; cache en mémoire par passage pour relier `player_events` / `player_financials` ; événements d'un joueur pas encore importé ignorés jusqu'au passage suivant (chevauchement 15 min).
- Campagne ou casino inconnu → enregistrements `unknown` inactifs (aucun joueur perdu).
- Sub-ID : postback > time_match > plus récent ; null n'écrase jamais. Cumuls jamais décroissants. Événements émis seulement sur changement réel. Montant d'un dépôt `any_dep` = `details.redeposit_delta`.
- `PostStats` d'affiliation recalculées depuis les joueurs rattachés à chaque passage (idempotent). Verrou `SyncState.isRunning` périmé après 30 min. Santé du sub-ID calculée depuis nos tables sur 7 jours.
- Montants en EUR via `currency_rates` ; CPA conservé brut dans `Player.raw.financials`.

### Membres et tableau de bord (E)
- Anonymisation : identité → null, `anonymizedAt`, `telegramUserId` remplacé par un entier négatif aléatoire (jamais attribué par Telegram) pour garder l'unicité, notes supprimées, `canDm = false`, événements et clics conservés ; confirmation par saisie de « SUPPRIMER ».
- Niveau de dépense : VIP si cumul ≥ seuil (défaut 500 €), RÉGULIER si dépôts ≥ 3, DÉPOSANT dès un dépôt, INSCRIT, AUCUN ; seuils dans `Setting` `spend.thresholds`.
- Indicateurs d'affiliation par canal via `Player.click → Post.channelId` ; NGR par jour = somme des NGR mis à jour ce jour (approximation, phase 2). Export CSV `;` avec BOM UTF-8.
- Worker `stats` : recalcul idempotent des compteurs (`PostStats`, `TrackingLink`, `InviteLink`) toutes les 10 min.

### Messages programmés (C)
- Réclamation du scheduler en une requête SQL atomique (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING id`) ; idempotence par `jobId = post:<id>`.
- Album : `sendMediaGroup` (légende sur le premier média si ≤ 1024) puis message texte avec les boutons si nécessaire ; média seul avec texte > 1024 : média sans légende puis texte + boutons. `file_id` Telegram mémorisé par bot après le premier envoi.
- Limiteur de débit en fenêtre fixe sur Redis : 25/s par bot, 1/s par chat privé, 20/min par canal. 429 → attente `retry_after` (5 fois max) ; réseau/5xx → 3 tentatives ; 400 → FAILED avec message en français (`describeTelegramError`) ; 403 → `BLOCKED` + `canDm = false`.
- Boutons `Post.buttons` = lignes de `{ text, type: URL | BUTTON | OFFER, url?, trackingLinkId?, slug?, affiliateCampaignId? }` ; les `TrackingLink` BUTTON/OFFER sont créés à l'enregistrement du message.
- Pas d'éditeur riche : textarea + boutons insérant les balises HTML Telegram, aperçu client depuis le HTML validé (`validateTelegramHtml`). Un message annulé reste modifiable ; « Retirer » ne supprime en base que brouillons, annulés et échecs.

### Séquences d'accueil (F)
- Textes par défaut par univers (casino, paris, dating, neutre) pour les 5 déclencheurs, créés à la détection d'un canal (`ensureDefaultSequences` dans `upsertChannel`, jamais bloquant) et à l'ouverture de l'onglet « Messages du bot » ; `pnpm sequences:backfill` pour les canaux existants.
- Une séquence désactivée fait retomber le bot sur ses textes intégrés fr/en. « Ajouter une langue » copie le français ; le français ne peut pas être retiré. « Envoyer un test » passe par `enqueueDm` (kind TEST) et exige un Telegram lié et un `/start` préalable.
- Les constantes partagées entre une action serveur et un composant vivent dans un fichier séparé (un fichier `"use server"` ne peut exporter que des fonctions async).

### Catégories (G)
- Agrégation « par catégorie » en TypeScript sur les `Post` envoyés de la période (volume faible) plutôt que par `groupBy` Prisma (pas de traversée de relation 1:1). Suppression d'une catégorie refusée si des messages l'utilisent ; slug sans accents, unique par suffixe numérique.

### File d'attente — correction du 9 octobre (après le test utilisateur)
- BullMQ 6 refuse les identifiants de tâche personnalisés contenant « : » ; les `jobId` (`dm:<id>`, `post:<id>`…) faisaient échouer silencieusement l'enfilage des messages privés. Correction centrale : `enqueue` remplace « : » par « - » (`safeJobId`). Leçon : tester un vrai enfilage de bout en bout (producteur web → Redis → worker) avant de livrer, pas seulement les processeurs avec des mocks.

## Phase 2 — 9 octobre 2026 (prompt rédigé par Claude, validé « Ok » par l'utilisateur par Telegram)

### Organisation
- Même méthode qu'en phase 1 : modèle d'abord, puis cinq chantiers parallèles (A pubs et coûts, B postbacks, C statistiques journalières et tableaux de bord, D envois groupés, E solidité). Nouvelle file `maintenance` (purge nocturne, alertes toutes les 5 min).
- Hors périmètre volontaire : API Meta/TikTok (pas de compte pub), vues MTProto (connexion téléphone), IA, A/B, automatisations visuelles.

### Pubs et coûts (A)
- Import CSV en deux étapes sans stockage temporaire (fichier renvoyé en base64 dans un champ caché, ≤ 2 Mo) ; détection souple des colonnes TikTok/Meta FR/EN ; `AdCost` dédoublonné par `levelKey + date + source` (dernier import gagnant) ; les sources CSV et MANUAL s'additionnent.
- Une pub = un lien d'entrée : rattacher un `InviteLink` à un `Ad` copie aussi son `TrackingLink`. Membres d'une pub = adhésions passées par APPROVED ; revenu = somme des `Player.ngr` rattachés.

### Postbacks (B)
- Route publique `/api/postback/<token>` (GET/POST, JSON, formulaire, URL), 404/403/429, réponse 200 immédiate puis traitement dans `after()` (évite les ré-envois en rafale) ; `PostbackLog` toujours écrit. Idempotence par `txid` sinon `type:joueur:montant:jour`. Sub-ID inconnu → campagne directe `postback:<endpointId>` sous le programme. NGR traité comme delta ; premier dépôt sans FTD = FTD. L'import CSV de joueurs réutilise exactement ce pipeline.

### Statistiques (C)
- `DailyStat` recalculée chaque heure sur 3 jours (complet à la demande), jours en Europe/Paris ; un membre est rattaché à la pub de sa dernière demande d'adhésion ; les dépenses remontent au niveau pub/campagne, jamais au canal. Cohortes et meilleurs horaires lisent les tables sources.

### Envois groupés (D)
- Segment pur dans `packages/core/src/segment.ts` (where Prisma) partagé web/worker ; expansion par lots de 500 en `OutboundMessage` + jobs `dm-<id>` idempotents ; progression dans `send-dm`. Les boutons Offre/traqués d'un envoi s'appuient sur un `Post` « conteneur » (SENT, `templateName = broadcast:<id>`) qui porte le code du lien profond et les stats. Les médias ne sont pas encore envoyés en privé (texte + boutons seulement).

### Solidité (E)
- Purge nocturne : anonymisation des membres inactifs depuis `retention.months` (défaut 24, minimum 6) avec la même règle que la suppression manuelle ; suppression des `Event` anciens sauf `player.*`. Alertes dédoublonnées (1 h), résolution automatique, une notification Telegram par alerte via `notifyAdmin` (même mécanisme que `tg:send`). `SyncState.cursor.errorStreak` compte les échecs consécutifs.
- Sauvegardes : `pnpm db:dump` exécute `pg_dump` dans le conteneur Postgres (l'image web n'a pas de client 18) ; Railway : sauvegardes de volume planifiées à activer par l'utilisateur (voir `docs/SAUVEGARDES.md`).
- Tests d'intégration (`pnpm test:integration`) sur Docker local : webhook, redirection, postback ; `after()` remplacé par une exécution immédiate, API Telegram interceptée sur l'instance grammY.

## Phase 3 — 9 octobre 2026 (prompt `docs/prompts/04-phase-3-confort-et-automatisations.md`, rédigé par Claude après « continue »)
- Alertes : au plus une alerte par type et par jour (fenêtre de dédoublonnage 24 h) ; `Bot.lastError` est effacé dès qu'une update est traitée sans erreur (sinon une erreur ancienne déclenchait des alertes à répétition).
- Rapports Telegram (chiffres, sans IA) : brief quotidien et hebdo construits depuis `DailyStat`, planification par marqueurs `Setting` (`reports.lastDaily` / `reports.lastWeekly`, clé de jour Paris) vérifiés toutes les 10 min ; ratios affichés seulement si une dépense existe.
- Médias dans les messages privés : `OutboundMessage.mediaAssetId`, envoi avec légende (≤ 1024, sinon média puis texte), `file_id` mémorisé par bot ; la réponse d'offre (webhook) n'envoie un média que si son `file_id` est déjà connu (pas d'upload depuis le webhook) ; repli texte seul si le média échoue.
- CI GitHub Actions (`.github/workflows/ci.yml`) : install, generate, lint, typage, tests, build sur `main` et les pull requests.
- Automatisations : modèle `AutomationRule` (déclencheur, conditions JSON, actions JSON ordonnées) + `AutomationRun` (journal et reprise des étapes « attendre »), file `automations` alimentée par des événements métier.
- Automatisations (détail) : `emitAutomationEvent` centralisé dans `@linkaffipro/queue`, inactif sans `REDIS_URL` (les tests n'ont rien à mocker) ; `SPEND_LEVEL_REACHED` dérivé dans le worker après inscription/dépôt ; balayage INACTIVE horaire limité aux membres joignables (200 par règle et par heure) ; « Tester sur moi » exécute via la file en kind TEST sans étiquette ni `oncePerMember` ; règles créées inactives ; suppression ADMIN ; une règle désactivée annule ses exécutions en attente.
