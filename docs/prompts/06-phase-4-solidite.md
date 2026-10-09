# Phase 4 — Solidité (rédigé par Claude le 9 octobre 2026, mode autonome ; aucune intervention humaine)

Pré-requis : phases 0 à 3 déployées (voir `docs/STATUS.md`). Objectif : que la plateforme tourne seule, se surveille, se sauvegarde, et que chaque parcours critique soit couvert par un test automatique. Tout se fait et se teste sans humain ; un court message Telegram à la fin.

## A. Tests de bout en bout simulés (CI incluse)
- Tests d'intégration sur base réelle (`apps/web/tests/integration`, `pnpm test:integration`) étendus aux parcours : **adhésion** (demande d'adhésion via lien d'invitation → membre créé → message privé en file → approbation), **offre** (`/start o<slug>_<code>` → lien personnalisé avec sub-ID → clic enregistré), **message programmé** (post SCHEDULED → envoi par le worker avec API Telegram simulée → statut SENT, boutons traqués), **synchro Link Affi** (serveur HTTP simulé → joueurs rattachés par sub-ID), **postback** (déjà fait, à garder).
- Les tests d'intégration tournent dans GitHub Actions (services `postgres:17` et `redis:7`), en plus des tests unitaires.
- Aucune dépendance à Telegram réel : l'API est interceptée (grammY `api.config.use` ou `fetch` simulé).

## B. Surveillance
- Page **Réglages → État du système** (ADMIN) : santé web (base, Redis, latence base chronométrée), santé worker (battement de cœur `worker.heartbeat` dans Redis, version, démarrage), profondeur de chaque file BullMQ (en attente, actives, échouées, retardées), dernières tâches échouées (message d'erreur, relance en un clic), état de chaque bot (webhook, dernière update, dernière erreur), dernière synchro Link Affi, alertes ouvertes, dernière sauvegarde.
- Nouvelles règles d'alerte Telegram : **worker arrêté** (pas de battement depuis 3 min), **erreurs répétées** (≥ 10 tâches échouées en 15 min sur une même file), en plus de celles existantes (bot en erreur, synchro en échec, file engorgée, blocages en masse, santé sub-ID). Même dédoublonnage (une par type et par jour) et résolution automatique.
- Route `/api/health` : ajoute la latence base et l'âge du dernier battement worker (sans secret).

## C. Sauvegardes automatiques
- Sans nouveau compte externe : volume Railway monté sur le worker (`railway volume add`, si le CLI le permet) et `pg_dump` quotidien à 4 h (Europe/Paris) par la file `maintenance`, rotation (14 jours), taille et date exposées sur la page État et dans le brief quotidien. Si le volume ou `pg_dump` est impossible depuis le conteneur : sauvegarde logique en JSON par Prisma (tables métier) dans le volume, sinon documenter précisément l'action humaine dans `docs/A-FAIRE-HUMAIN.md`.
- `docs/SAUVEGARDES.md` : procédure de restauration testée en local (`pnpm db:restore <fichier>`).

## D. Reprise sur erreur des workers
- Tentatives et attente exponentielle sur les tâches sensibles (envoi Telegram, synchro, stats), tâches bloquées (`stalled`) reprises, arrêt propre déjà en place à vérifier (SIGTERM → fin des tâches en cours ≤ 15 s).
- Relance manuelle d'une tâche échouée depuis la page État ; purge des tâches échouées de plus de 7 jours.

## E. Performance
- Index manquants sur les requêtes fréquentes (membres par canal/statut/date, événements par membre et date, clics par lien et date, journal d'audit par date, messages par canal et date programmée) : migration Prisma.
- Pagination serveur sur toutes les listes longues (membres, journal, événements d'un membre, messages, clics) ; tableaux de bord mis en cache 60 s (`unstable_cache` ou cache mémoire par clé de période) avec invalidation après recalcul des stats journalières.
- Mesure : page État affiche la latence base ; log des requêtes > 500 ms côté worker.

## F. Sécurité
- Sessions : durée 14 jours déjà en place ; déconnexion de tous les appareils au changement de mot de passe (version de session dans le JWT) ; mot de passe ≥ 10 caractères ; invitations expirant après 7 jours.
- Journal d'audit : vérifier que chaque action serveur (`actions.ts`) écrit un `AuditLog` ; compléter ce qui manque. Page Journal filtrable (utilisateur, action, période).
- Médias (`/api/media/[id]`) servis uniquement aux utilisateurs connectés ; vérification que les routes API internes exigent la session.

## G. Dette technique
- `hashBucket` / `variantFor` (A/B) déplacés dans `packages/core` (plus de duplication web/worker).
- Avertissements ESLint restants corrigés ; `docs/DATA-MODEL.md` et `CLAUDE.md` à jour (nouvelles commandes, nouvelles files, page État).

## Livraison
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build` verts ; déploiement web + worker vérifié (health checks) ; `docs/STATUS.md`, `docs/DECISIONS-TECH.md`, `docs/A-FAIRE-HUMAIN.md` à jour ; commit, push ; court message Telegram ; puis phase 5 (`07-phase-5-finitions.md`).
