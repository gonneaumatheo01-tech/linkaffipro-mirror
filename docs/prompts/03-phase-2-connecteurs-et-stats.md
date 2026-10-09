# Phase 2 — Connecteurs, statistiques par pub, envois ciblés, solidité (rédigé par Claude le 9 octobre 2026, d'après `docs/01-cadrage-analyse.md` phases 3, 4, 5 et 7, en l'absence de prompt fourni)

Pré-requis : phase 1 validée. Lis `CLAUDE.md`, `docs/02-decisions.md`, `docs/DATA-MODEL.md`, `docs/DECISIONS-TECH.md`, `docs/LINKAFFI-SYNC.md`. Règles : autonomie totale, tests faits par Claude (webhook simulé, scripts via `railway ssh`), l'utilisateur n'est sollicité que pour l'indispensable (un seul point par Telegram à la fin). Section 1 seule d'abord, puis chantiers en parallèle, assemblage, `pnpm lint && pnpm build && pnpm test`, déploiement, test de bout en bout par Claude.

**Objectif.** Répondre à « quelle pub rapporte ? » en 10 secondes : coûts des pubs (import CSV TikTok / Meta et saisie manuelle, en attendant les API), postbacks directs des programmes, tableaux de bord par pub avec entonnoir et rentabilité, cohortes et exports ; envois groupés ciblés avec file et limites ; purge 24 mois, alertes Telegram vers l'admin, solidité.

**Hors périmètre (volontairement)** : API Meta / TikTok (aucun compte publicitaire créé : connecteurs prévus quand les comptes existeront), vues par message via MTProto (exige une connexion téléphone de l'utilisateur : à faire plus tard, en une fois), IA manager, A/B, éditeur d'automatisations visuel.

## 1. Modèle de données
- `Campaign` (existante) complétée : `platform`, `externalCampaignId`, `budgetDaily?`, `currency`, `tags` JSON ; `AdSet` (campaignId, name, externalId?) et `Ad` (adSetId, name, externalId?, inviteLinkId?, trackingLinkId?) pour relier chaque lien d'entrée à une pub précise (un lien d'entrée = une pub).
- `AdCost` (adId? | adSetId? | campaignId, date, spend Decimal, impressions, clicks, currency, source `CSV | MANUAL | API`, importBatchId?) unique par (niveau, date, source).
- `ImportBatch` (kind `TIKTOK_CSV | META_CSV | COSTS_MANUAL | PLAYERS_CSV`, filename, rows, imported, errors JSON, createdById, createdAt).
- `PostbackEndpoint` (programId, token unique, mapping JSON des paramètres (sub_id, player_id, event, amount, currency), isActive, lastReceivedAt) et `PostbackLog` (endpointId, receivedAt, ipHash, raw JSON, status `ACCEPTED | IGNORED | ERROR`, playerEventId?).
- `Broadcast` (name, botId, segment JSON (filtres : canaux, niveau de dépense, source/pub, langue, inactivité, a cliqué une catégorie), text HTML, buttons JSON, mediaAssetId?, status `DRAFT | SCHEDULED | SENDING | SENT | CANCELLED`, scheduledAt, counts : targeted, sent, failed, blocked, createdById) ; les envois individuels sont des `OutboundMessage` kind BROADCAST avec `broadcastId?` (ajouter la colonne).
- `Alert` (kind, severity, message, payload JSON, createdAt, notifiedAt?, resolvedAt?) et `Member.tags` JSON.
- `DailyStat` (date, channelId?, campaignId?, adId?, vertical?, métriques : requests, approved, joined, left, entryClicks, offerClicks, registrations, ftds, deposits, depositAmount, ngr, spend) calculée par le worker `stats` chaque nuit et à la demande, pour des tableaux de bord rapides.
- Mets à jour `docs/DATA-MODEL.md`.

## 2. Pubs et coûts (chantier A)
- Page **Pubs** (nouvelle entrée de menu) : liste des campagnes (nom, plateforme, univers, canaux, liens d'entrée rattachés, dépense, membres, inscriptions, FTD, CPL, CPA, coût par FTD, revenu, ROAS), création/édition, rattachement des liens d'entrée existants (une pub ↔ un lien), import CSV TikTok Ads Manager et Meta Ads Manager (exports standards : détecte les colonnes date / campagne / groupe / pub / dépense / impressions / clics, aperçu avant import, dédoublonnage par date+niveau), saisie manuelle d'une dépense par jour, historique des imports.
- Rattachement automatique : au CSV, les noms de campagne / groupe / pub sont mis en correspondance avec `Ad.name`, `AdSet.name`, `Campaign.name` (insensible à la casse), proposition de correspondance à confirmer pour le reste.

## 3. Postbacks directs (chantier B)
- `POST|GET /api/postback/<token>` : accepte les paramètres selon le mapping de l'endpoint, résout `sub_id` → `Click` → membre / message / canal, crée ou met à jour `Player` + `PlayerEvent` (registration, ftd, deposit, redeposit, ngr), idempotent (clé externe), journalise `PostbackLog`, répond 200 vite ; limite de débit et jeton obligatoire ; Réglages → Connecteurs → Postbacks : créer un endpoint par programme, afficher l'URL à donner au programme avec les macros usuelles, derniers postbacks reçus.
- Import CSV de joueurs pour les programmes sans API ni postback (dating) : colonnes sub_id / player_id / event / amount / date.

## 4. Tableaux de bord et entonnoir (chantier C)
- Tableau de bord → onglet **Pubs** : par pub et par période : dépense, clics entrée (humains), demandes, acceptés, entrées, clics offres, inscriptions, FTD, dépôts, NGR, CPL, CPA, coût par FTD, ROAS, bénéfice ; tri, comparaison de deux périodes, export CSV/Excel (xlsx via une petite génération maison ou CSV UTF-8 BOM).
- **Entonnoir** par pub / canal / période : pub → clic → demande → accepté → entré → clic offre → inscription → FTD → dépôt, avec les pertes à chaque étape (%).
- **Cohortes** : par semaine d'arrivée des membres : inscrits, FTD, dépôts cumulés à J+7 / J+30, LTV moyenne.
- **Canal** : croissance nette par jour, départs, meilleurs horaires et meilleures catégories (sur les messages envoyés).
- Tout s'appuie sur `DailyStat` (worker `stats` : recalcul des 3 derniers jours toutes les heures, de tout à la demande).

## 5. Envois groupés ciblés (chantier D)
- Page **Envois** : nouveau broadcast : bot, segment (filtres combinables, compte en direct des destinataires joignables `canDm`), texte HTML avec aperçu, médias, boutons (URL / traqué / Offre), envoi maintenant ou programmé, test à soi-même ; liste des envois avec compteurs et erreurs ; annulation en cours.
- Worker : découpage en `OutboundMessage` par destinataire (par lots de 500), envoi par la file `telegram-send` dans les limites (25/s, 1/s par chat), `BLOCKED` → `canDm = false`, reprise après redéploiement (jobs idempotents), progression visible.

## 6. Solidité (chantier E)
- Purge : worker nocturne qui anonymise les membres inactifs depuis 24 mois (règle produit) et supprime les `Event` de plus de 24 mois sauf `player.*` ; réglable dans Réglages (durée), journalisé.
- Alertes vers l'admin par Telegram (via `tg:send` interne = même code) : bot en erreur de webhook > 10 min, synchro Link Affi en échec 3 fois, file `telegram-send` > 500 en attente, 403 en masse, santé du sub-ID rouge ; dédoublonnées (une alerte par type et par heure) ; page Réglages → Alertes (historique, marquer résolu).
- Sauvegardes : vérifier et documenter les sauvegardes Railway (PITR / snapshots du volume Postgres) dans STATUS.md ; script `pnpm db:dump` (pg_dump via `railway ssh`) documenté.
- Tests d'intégration des routes critiques (webhook Telegram, redirection, postback) avec base de test (Docker local) dans `pnpm test:integration`.

## 7. Qualité et livraison
- `pnpm lint && pnpm build && pnpm test` verts ; déploiement vérifié ; test de bout en bout par Claude (import CSV d'exemple, postback simulé, broadcast à l'admin, tableau Pubs cohérent).
- Mets à jour `CLAUDE.md`, `docs/DATA-MODEL.md`, `docs/DECISIONS-TECH.md`, `docs/STATUS.md` ; un seul message Telegram final à l'admin (5 lignes) : ce qui est en ligne, ce qu'il peut regarder, ce qui attend un compte pub ou une connexion téléphone (MTProto).
