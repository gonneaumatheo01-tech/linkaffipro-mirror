# LinkAffi Pro — plateforme interne de statistiques d'affiliation + bots Telegram

## Ce qu'est ce projet
Site interne (admins et managers seulement) d'une équipe d'affiliation (casino, paris sportifs, dating) :
- Bots Telegram (un par univers) pilotés depuis le site : accueil des membres, demandes d'adhésion avec délai réglable, flux « rejoins ces canaux pour être accepté », messages programmés sur des semaines, liens traqués, envois ciblés.
- Collecte des données : Telegram, Link Affi (la plateforme d'affiliation du client, hébergée sur Lovable Cloud, lue uniquement par son API en lecture seule décrite dans `docs/LINKAFFI-API.md`), pubs Meta et TikTok (plus tard), postbacks.
- Statistiques très détaillées : par pub, canal, message, membre Telegram, joueur ; attribution pub → lien d'invitation → membre → clic → sub-ID → inscription/dépôt.
Docs de référence : `docs/00-brief-original.md` (demande d'origine), `docs/01-cadrage-analyse.md` (analyse), `docs/02-decisions.md` (décisions validées, prioritaire sur l'analyse en cas de contradiction). Lis-les au début d'une phase, pas à chaque session.

## Qui est l'utilisateur
Non technique. Il ne lit pas le code et ne veut pas agir, seulement approuver. Parle-lui en français simple, sans jargon, une étape à la fois, en lui disant quoi faire exactement (clics, textes à coller). Ne lui demande jamais une chose que tu peux faire toi-même. Quand une action humaine est indispensable (coller un jeton, un clic dans un tableau de bord, une ligne DNS), donne les clics exacts, en une seule fois.

## Comment travailler ici
- Autonomie : avance sans demander de confirmation pour les choix techniques. Prends la décision raisonnable, note-la dans `docs/DECISIONS-TECH.md`, continue.
- Ne pose une question que si la réponse change le produit et ne peut pas se déduire. Groupe les questions. Si l'utilisateur répond « fais au mieux », décide.
- À chaque phase : lis le prompt dans `docs/prompts/`, fais une liste de tâches, exécute, teste, déploie, puis écris `docs/STATUS.md` (fait / reste / test de 5 minutes pour l'utilisateur / problèmes et actions humaines nécessaires).
- Après 3 essais infructueux sur un même problème : contourne (autre méthode) ou décris l'action humaine en clics exacts dans STATUS.md, puis continue le reste. Ne tourne jamais en rond.
- Commits fréquents, messages en français, push sur GitHub à chaque étape terminée.
- Déploiement par `railway up` (voir Commandes). Vérifie que le déploiement répond (health check) avant de dire « terminé ».
- Link Affi n'est accessible que par son API en lecture seule (GET). Aucune autre voie, aucune tentative d'écriture, et pas de lecture des tables marquées « à ne pas lire » dans `docs/LINKAFFI-API.md`.
- Jamais de secrets dans git ni dans tes messages ni dans STATUS.md. Les secrets vivent dans `.claude/settings.local.json` (clé `env`) et `.env.local` sur la machine (tous deux ignorés par git) et dans les variables Railway en production. Les jetons de bots Telegram sont chiffrés en base.

## Stack (décidée ; ne change pas sans raison écrite dans DECISIONS-TECH.md)
- Monorepo pnpm + Turborepo, Node 22, TypeScript strict partout, ESLint + Prettier.
- `apps/web` : Next.js (App Router), Tailwind, shadcn/ui, Auth.js (credentials + invitations), routes API (webhooks Telegram, redirections goolink.me, API interne).
- `apps/worker` : Node + BullMQ : scheduler des posts, approbations différées, envois DM, synchro Link Affi, calculs de stats, rappels.
- `packages/db` : Prisma + PostgreSQL (Railway), migrations versionnées. `packages/telegram` : logique bots (grammY), multi-bots, limites de débit. `packages/core` : règles métier pures (attribution, métriques, chiffrement, ids courts). `packages/config` : configs partagées.
- Redis (Railway) pour BullMQ. Chiffrement AES-256-GCM des jetons de bots (clé `APP_ENCRYPTION_KEY`).
- Railway : services `web`, `worker`, `postgres`, `redis`. Domaines : `linkaffipro.com` (site) et `goolink.me` (redirections, même service web, routage par hostname).
- Interface en français ; textes du bot multilingues (fr par défaut, autres langues par traduction). Affichage Europe/Paris, stockage UTC.

## Règles produit non négociables
- Accès interne : rôles ADMIN (tout) et MANAGER (tout sauf réglages, utilisateurs, jetons, suppressions). Pas de 2FA. Pas d'inscription publique.
- Tout événement est journalisé en base (`Event`, append-only). Toute action d'un utilisateur est dans `AuditLog`.
- Telegram : ≤ 25 messages/s par bot, 1 message/s par chat en privé, gestion de 429 `retry_after`, respect des blocages par les membres, jamais de spam.
- goolink.me : réponse 302 immédiate, aucune page visible, robots connus non comptés.
- Attribution : chaque pub → son lien goolink + son lien d'invitation Telegram (avec demande d'adhésion) ; chaque clic « offre » depuis le bot → un sub-ID unique par membre et par message → transmis à Link Affi ; les événements joueurs remontent par sub-ID vers le membre, le message, le canal et la pub.
- Données personnelles : conservation 24 mois ; suppression d'un membre sur demande (fonction prévue).

## Commandes et outils (à compléter en phase 0, à tenir à jour)
- Racine : `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm db:migrate`, `pnpm db:studio`.
- GitHub : `gh` authentifié par la variable `GH_TOKEN` (`gh auth setup-git` pour les push). Dépôt : À COMPLÉTER.
- Railway : CLI authentifiée par `RAILWAY_API_TOKEN`. Projet : À COMPLÉTER. Déployer : `railway up --service web --detach` puis `railway up --service worker --detach` depuis la racine. Logs : `railway logs --service web`. Variables : `railway variables --service web`.
- Link Affi : API en lecture seule (`LINKAFFI_API_URL`, `LINKAFFI_API_KEY`, `LINKAFFI_ANON_KEY`), client typé dans le code, `pnpm linkaffi:check` pour vérifier l'accès. Aucun serveur MCP n'est nécessaire.
- Réglages Claude Code : le modèle de `.claude/settings.json` est dans `docs/setup/claude-settings.json` ; s'il manque à la racine, copie-le en place.
- Si une commande interactive est inévitable (connexion par navigateur), explique à l'utilisateur quoi taper dans un second Terminal.

## Qualité
- Tests unitaires sur `packages/core` et sur les handlers Telegram (updates simulées) ; tests d'intégration sur les routes de redirection et de webhook.
- Avant de livrer une phase : `pnpm lint && pnpm build && pnpm test` verts, déploiement vérifié, `docs/STATUS.md` écrit, ce fichier mis à jour si la stack ou les commandes ont changé.

## Nouvelle machine ou nouvel équipier
Voir `docs/prompts/90-nouvelle-machine.md`.
