# Phase 13 — Campagnes Telegram des affiliés Link Affi (liens créés dans Link Affi, membres et FTD crédités aux affiliés)

Si `docs/STATUS.md` indique déjà « phase 13 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, **`docs/LINKAFFI-PARTENAIRES.md` (version 2 : le contrat, il prime)**, `docs/LINKAFFI-SUBID.md`, `docs/LINKAFFI-API.md`, `docs/REFONTE-UX.md`, `docs/STATUS.md`, et le code des liens d'invitation, du flux d'adhésion (règles par provenance de la phase 11), des offres (sub-ID) et de la synchro Link Affi. Mode autonome, aucune question, décisions dans `docs/DECISIONS-TECH.md`.

**Exception à la règle « Link Affi en lecture seule »** (déjà notée dans `CLAUDE.md` et `docs/02-decisions.md`) : seuls l'API d'intégration appelée par Link Affi et l'envoi des événements à la fonction `telegram-events` sont autorisés. Aucune autre écriture vers Link Affi.

En parallèle, le client fait construire la partie Link Affi (Lovable) : campagne de type Telegram, appel de notre API, réception de nos événements, paramètre `tg`, vue des membres dans « Joueurs ». **Ne dépends pas de son calendrier** : construis et teste notre côté avec un Link Affi simulé ; tout doit se brancher dès que le client colle les clés.

## 1. Modèle de données (migration additive)
- `InviteLink` : nouveau type `LINKAFFI` + `linkaffiCampaignKey`, `linkaffiCampaignName`, `linkaffiAffiliateId`, `linkaffiAffiliateName`, `attributionDays?`.
- `Member` : `linkaffiCampaignKey?`, `linkaffiAffiliateId?`, `affiliateAttributedAt?`, `affiliateInviteLinkId?` (premier affilié gagne, jamais écrasé automatiquement).
- `Click` : `linkaffiTelegramCampaignKey?` (copié au clic d'offre).
- `OutboundWebhook` (ou équivalent) : événements à envoyer à Link Affi, `eventId` unique, statut, tentatives, dernière erreur.
- `IntegrationKey` : clé d'API Link Affi → plateforme (stockée hachée, affichée une seule fois), secret de signature des événements (chiffré), adresse de la fonction `telegram-events`.

## 2. API d'intégration pour Link Affi
- Routes de `docs/LINKAFFI-PARTENAIRES.md` § 1 (`GET /channels`, `POST /invite-links`, `PATCH /invite-links/{id}`, `GET /members`), authentification par clé, limite de débit, validation stricte, réponses en français, journal d'audit de chaque appel.
- `POST /invite-links` : crée le lien avec demande d'adhésion par le bot du canal (repli sur un autre de nos bots administrateur, comme pour les liens des canaux obligatoires), idempotent par `campaignKey` + `channelId`.
- Réglages → Connecteurs → Link Affi → section « Campagnes Telegram des affiliés » : générer / régénérer la clé d'API et le secret de signature (affichés une fois, bouton « Copier »), adresse de la fonction `telegram-events` (pré-remplie), bouton « Envoyer un événement de test », état de la file d'envoi, et un guide en 3 étapes pour coller les deux valeurs dans les secrets de Link Affi (`LINKAFFIPRO_API_KEY`, `LINKAFFIPRO_WEBHOOK_SECRET`).

## 3. Attribution des membres
- Demande d'adhésion via un lien `LINKAFFI` : si le membre n'a pas encore d'affilié et n'était pas déjà dans le canal → rattaché à la campagne et à l'affilié (date, lien). Sinon, aucune attribution (journal).
- Règles d'acceptation (phase 11) : provenances « une campagne d'affilié précise », « un affilié précis », « n'importe quel affilié Link Affi ».
- Fiche membre : « Amené par <affilié> · campagne <nom> · le <date> » ; un ADMIN peut changer ou retirer l'attribution (motif, journal).

## 4. Événements envoyés à Link Affi
- Pour les membres attribués : `join_requested`, `join_approved`, `join_declined`, `join_expired`, `joined`, `left`, `offer_clicked` (`subId`, `offerCampaignKey`), au format exact du contrat, signés HMAC, via la file BullMQ avec nouvelles tentatives pendant 24 h, `eventId` unique. Une alerte Telegram si la file reste bloquée plus d'une heure.
- `GET /members` permet à Link Affi de tout rattraper.

## 5. Offres : paramètre `tg`
- Bouton d'offre en canal, réponses d'offre, relances, écrire à un groupe : si le membre est rattaché à une campagne Telegram d'affilié (et dans sa durée), ajouter `&tg=<linkaffiCampaignKey>` au lien Link Affi, en plus de `sub_id`. Enregistrer `Click.linkaffiTelegramCampaignKey`.
- Avertissement dans l'éditeur : si un canal compte des membres d'affiliés et qu'un post part sans bouton d'offre (post publié par le compte Telegram), afficher « Les dépôts venant de ce post ne pourront pas être crédités aux affiliés : utilisez un bouton d'offre. »

## 6. Vue interne dans la plateforme
- Page « Affiliés Link Affi » (dans Campagnes ou Statistiques, selon `docs/REFONTE-UX.md`) : par affilié et par campagne Telegram : clics (lus dans Link Affi), demandes, acceptés, présents, partis, clics d'offre, inscriptions, FTD (liste), dépôts, revenu net ; filtre par canal et période ; export CSV. Filtre « Affilié » sur Membres et Statistiques.
- Synchro Link Affi : lire les champs Telegram ajoutés par Link Affi quand ils existent (campagnes de type Telegram, `tg`/affilié sur les clics et joueurs) ; si nos chiffres et ceux de Link Affi divergent, afficher l'écart dans Réglages → Connecteurs.

## 7. Tutoriel et guide
- Section « Affiliés sur vos canaux » (guide + Aide + mini-tutoriel au premier passage) : 1) coller les deux clés dans Link Affi (une seule fois) ; 2) dans Link Affi, Campagnes → nouvelle campagne Telegram pour l'affilié, choisir le canal ; 3) l'affilié partage son lien ; 4) suivre ses membres ici et dans Link Affi ; 5) règle « premier affilié gagne » et limite des posts sans bouton.

## 8. Tests et livraison
- Tests unitaires : attribution, construction du lien d'offre avec `tg`, signature HMAC, idempotence de `POST /invite-links`, sérialisation des événements.
- Test d'intégration simulé de bout en bout : appel API simulé de Link Affi → lien créé → demande d'adhésion via ce lien → événements envoyés (récepteur simulé, signature vérifiée) → clic d'offre avec `tg` → joueur simulé → FTD visible dans la vue interne.
- `pnpm lint && pnpm build && pnpm test` verts, migration appliquée, déploiement vérifié, captures 1440 / 390, `docs/STATUS.md`, guide et `docs/A-FAIRE-HUMAIN.md` (« générer les clés et les coller dans Link Affi ») à jour, commit et push.
- Bilan Telegram en 5 lignes (avec où générer les deux clés), puis `docs/PHASE-DONE`.
