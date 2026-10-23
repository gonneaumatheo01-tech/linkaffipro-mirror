# Modèle de données — LinkAffi Pro

Source de vérité : `packages/db/prisma/schema.prisma`. Noms de tables et colonnes en anglais, commentaires en français. Horodatages stockés en UTC, affichés en Europe/Paris. Identifiants Telegram en `BigInt`.

## Phase 0 (réalisée)

| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `User` | Utilisateur interne (ADMIN ou MANAGER). Pas d'inscription publique. | `email` unique, `passwordHash` (bcrypt), `role`, `isActive`, `telegramUserId` (lié via « Mon compte »), `telegramLinkToken` (jeton temporaire `admin_<token>`), `lastLoginAt` |
| `Invitation` | Invitation créée par un ADMIN, valable 7 jours. | `email`, `role`, `token` unique, `expiresAt`, `acceptedAt`, `invitedById` |
| `AuditLog` | Journal des actions des utilisateurs (append-only). | `userId`, `action` (ex. `bot.created`, `user.role_changed`), `entityType`, `entityId`, `metadata` JSON |
| `Bot` | Bot Telegram piloté par la plateforme. | `telegramBotId` unique, `username`, `tokenEncrypted` (AES-256-GCM), `vertical`, `isActive`, `webhookSecret` (par bot, vérifié à chaque webhook), `lastWebhookAt`, `lastError` |
| `Channel` | Canal ou groupe Telegram détecté automatiquement. | `telegramChatId` unique, `title`, `username`, `type` (CHANNEL/GROUP), `vertical` (à choisir), `language` (défaut `fr`), `primaryBotId`, `isActive`, `isTest`, `isMediaLibrary`, `settings` JSON |
| `ChannelBotAdmin` | Droits d'administrateur d'un de nos bots sur un canal. | unique `(channelId, botId)`, `rights` JSON (`can_post_messages`, `can_invite_users`…), `detectedAt`, `revokedAt` |
| `Member` | Membre Telegram vu par au moins un bot. | `telegramUserId` unique, `firstName`, `lastName`, `username`, `languageCode`, `isPremium`, `firstSeenAt`, `lastSeenAt` |
| `MemberBotState` | Relation membre ↔ bot : peut-on lui écrire en privé ? | unique `(memberId, botId)`, `canDm`, `startedAt`, `blockedAt`, `lastDmAt` |
| `Event` | Journal d'événements (append-only, jamais modifié ni supprimé par le code). | `type`, `occurredAt`, `memberId?`, `channelId?`, `botId?`, `payload` JSON ; index `(type, occurredAt)`, `(memberId, occurredAt)`, `(channelId, occurredAt)`, `(botId, occurredAt)` |
| `Setting` | Réglage global clé → valeur JSON. | `key` (PK), `value` |

Enums : `Role = ADMIN | MANAGER`, `Vertical = CASINO | SPORTS | DATING`, `ChatType = CHANNEL | GROUP`.

### Types d'événements émis en phase 0

| Type | Quand | Références |
| --- | --- | --- |
| `telegram.<update_type>` | Toute update reçue par un webhook (`message`, `my_chat_member`, `channel_post`, `chat_join_request`…). Payload = update brute, sans jeton. | bot, membre, canal si connus |
| `member.start` | `/start` reçu en privé | membre, bot |
| `member.blocked` / `member.unblocked` | Le membre bloque / débloque le bot | membre, bot |
| `channel.bot_admin_detected` / `channel.bot_admin_revoked` | Le bot gagne / perd les droits d'administrateur | canal, bot |
| `tracking.redirect` | Redirection go.goolink.eu. Payload : `slug`, `target`, `known`, `host`, `userAgent`, `isBot`, `ipHash` (SHA-256 salé), `referer`, `clickIds` (`ttclid`, `fbclid`, `gclid`, `msclkid`), `utm` | — (lien en phase 1) |

## Phase 1 (réalisée le 9 octobre 2026)

Migrations : `20261009120919_phase1_kit_lancement`, `20261009121130_player_sub_id_source`.

### Adhésions
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `Membership` | Une demande d'adhésion = un enregistrement (un membre qui revient en crée un nouveau). | `code` unique (lien profond `/start g<code>`), `status` (REQUESTED, PENDING_GATE, SCHEDULED, APPROVED, DECLINED, LEFT, KICKED, EXPIRED, FAILED), `inviteLinkId`, `approvalRuleId`, `userChatId` (chat privé donné par Telegram), `requestedAt`, `gateSatisfiedAt`, `approveAt`, `approvedAt`, `declinedAt`, `joinedAt`, `leftAt`, `expiresAt`, `approvedByBotId`, `source` JSON (instantané lien / pub / campagne), `remindersSent`, `lastReminderAt`, `attempts`, `lastError` ; unique `(memberId, channelId, requestedAt)` |
| `ApprovalRule` | Règle d'approbation d'un canal (ou d'un lien précis via `inviteLinkId`). | `mode` (IMMEDIATE, DELAY, MANUAL), `delaySeconds`, `gateChannelIds` JSON, `gateMode` (NONE, REQUIRED, SOFT), `reminderAfterMinutes` JSON, `maxReminders`, `expireAfterHours`, `expireAction` (DECLINE, APPROVE, KEEP), `sendAcceptedMessage`, `isDefault`, `isActive` |
| `InviteLink` | Lien d'invitation Telegram créé par la plateforme. | `telegramInviteLink` unique, `kind` (AD_ENTRY, GATE, MANUAL), `createsJoinRequest`, `campaignId`, `adPlatform`, `adCampaignName`, `adSetName`, `adName`, `adExternalIds`, `sourceChannelId` (pour un GATE : canal d'origine), `language`, compteurs `requests`, `approved`, `joined`, `left` |

### Liens traqués et clics
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `TrackingLink` | Lien court go.goolink.eu. | `slug` unique (base62, 6 à 10), `kind` (AD_ENTRY, OFFER, BUTTON, GENERIC), `destinationTemplate` (placeholders `{subid}`, `{click_id}`, `{member_id}`, `{post_id}`), `inviteLinkId`, `channelId`, `campaignId`, `affiliateCampaignId`, `postId`, compteurs `clicks`, `uniqueClicks` (humains) |
| `Click` | Clic sur un lien ou un bouton. | `subId` unique (12 caractères base62, sans point, clics OFFER seulement), `memberId`, `postId`, `botId`, `ipHash`, `userAgent`, `isBot`, `referer`, `ttclid`, `fbclid`, `gclid`, `utm` JSON, `destination` |

### Messages
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `MessageCategory` | Catégorie (Bonus, Preuve de gains, Teasing, Rappel, Information, Événement, Sondage). | `slug` unique, `color`, `vertical`, `sortOrder` |
| `MediaAsset` | Média stocké en base (≤ 50 Mo). | `sha256` unique, `bytes`, `mimeType`, `width`, `height`, `duration` |
| `MediaAssetTelegramFile` | `file_id` Telegram d'un média par bot (réutilisation sans ré-upload). | unique `(assetId, botId)` |
| `Post` | Message programmé. | `code` unique (lien profond d'offre), `status` (DRAFT, SCHEDULED, SENDING, SENT, FAILED, DELETED, CANCELLED), `scheduledAt`, `sentAt`, `telegramMessageIds` JSON, `categoryId`, `language`, `text` (HTML Telegram), `mediaAssetIds` JSON, `buttons` JSON (lignes de `{ text, type: URL | BUTTON | OFFER, url?, trackingLinkId?, affiliateCampaignId? }`), options d'envoi, `isTemplate`, `templateName`, `duplicatedFromId` |
| `PostStats` | Chiffres d'un message. | `views`, `forwards` (phase 2), `reactions` JSON, `reactionsTotal`, `clicks`, `uniqueClickers`, `offerClicks`, `registrations`, `ftds`, `deposits`, `depositAmount` |

### Séquences et messages privés
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `Sequence` | Séquence de messages privés par déclencheur (JOIN_REQUEST, GATE_REMINDER, GATE_SATISFIED, APPROVED, START, OFFER_REPLY), par canal et/ou bot. | `trigger`, `isActive` |
| `SequenceStep` | Étape : textes par langue (JSON), boutons, média, délai. | `order`, `delaySeconds`, `texts` JSON, `buttons` JSON, `mediaAssetId` |
| `OutboundMessage` | Tout message privé sortant (file + historique). | `kind` (WELCOME, GATE_REMINDER, ACCEPTED, OFFER_REPLY, BROADCAST, AUTOMATION, TEST), `status` (QUEUED, SENT, FAILED, BLOCKED), `chatId`, `text`, `buttons`, `telegramMessageId`, `error` |

### Affiliation et joueurs
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `AffiliateProgram` | Programme (Link Affi `casinos`). | `source` (LINKAFFI, CSV, API), `externalId`, `vertical`, `raw` ; unique `(source, externalId)` |
| `AffiliateCampaign` | Campagne Link Affi (`campaigns`). | `externalId`, `campaignKey` (8 caractères), `trackingUrlTemplate` (`https://linkaffi.me/go/<key>?sub_id={subid}`), `raw` ; unique `(programId, externalId)` |
| `Player` | Joueur rattaché par sub-ID. | `externalPlayerId`, `subId`, `subIdSource` (`postback` sûr, `time_match` secours), `clickId`, `memberId`, `registeredAt`, `ftdAt`, `ftdAmount`, `depositCount`, `redepositCount`, `depositTotal`, `ngr`, `currency`, `status`, `raw` ; unique `(affiliateCampaignId, externalPlayerId)` |
| `PlayerEvent` | Événement joueur brut. | `type` (CLICK, REGISTRATION, FTD, DEPOSIT, REDEPOSIT, NGR, OTHER ; phase 10 : CPA, CPA_REVERSAL), `amount`, `currency`, `occurredAt`, `externalId` (unique par joueur), `raw` |
| `SyncState` | Curseur par table Link Affi. | `source` (PK), `cursor` JSON, `lastRunAt`, `lastSuccessAt`, `lastError`, `rowsImported`, `isRunning` |

### Pubs et divers
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `Campaign` | Pub TikTok / Meta / autre. | `channelIds` JSON, `affiliateCampaignIds` JSON, `adPlatform`, `adExternalIds`, `startAt`, `endAt`, `status` (DRAFT, ACTIVE, PAUSED, ENDED), `notes` |
| `MemberNote` | Note interne sur un membre. | `authorId`, `text` |
| `Member.anonymizedAt` | Suppression sur demande : identité effacée, événements conservés. | — |

Règles : conservation 24 mois (purge à prévoir en phase 2) ; les montants sont stockés en EUR (`Decimal(14,2)`).

## Phase 2 (9 octobre 2026) — migration `20261009130901_phase2_pubs_postbacks_envois`

### Pubs et coûts
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `Campaign` (complétée) | Pub TikTok / Meta / autre. | + `externalCampaignId`, `budgetDaily`, `currency`, `tags` JSON |
| `AdSet` | Groupe de pubs d'une campagne. | `campaignId`, `name`, `externalId` ; unique `(campaignId, name)` |
| `Ad` | Pub précise = un lien d'entrée. | `adSetId`, `name`, `externalId`, `inviteLinkId` unique, `trackingLinkId` unique |
| `AdCost` | Coût par jour à un niveau (pub, groupe ou campagne). | `levelKey` (`ad:<id>` / `adset:<id>` / `campaign:<id>`), `date`, `spend`, `impressions`, `clicks`, `currency`, `source` (CSV, MANUAL, API), `importBatchId` ; unique `(levelKey, date, source)` |
| `ImportBatch` | Import de fichier. | `kind` (TIKTOK_CSV, META_CSV, COSTS_MANUAL, PLAYERS_CSV), `filename`, `rows`, `imported`, `errors` JSON |

### Postbacks directs
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `PostbackEndpoint` | Point d'entrée d'un programme. | `programId`, `token` unique, `mapping` JSON (noms des paramètres + `eventMap`), `isActive`, `lastReceivedAt` |
| `PostbackLog` | Journal des postbacks reçus (append-only). | `endpointId`, `receivedAt`, `ipHash`, `raw` JSON, `status` (ACCEPTED, IGNORED, ERROR), `message`, `playerEventId` |

### Envois groupés, alertes, statistiques
| Table | Rôle | Colonnes clés |
| --- | --- | --- |
| `Broadcast` | Envoi groupé ciblé. | `botId`, `segment` JSON, `text`, `buttons`, `mediaAssetId`, `status` (DRAFT, SCHEDULED, SENDING, SENT, CANCELLED), `scheduledAt`, `startedAt`, `finishedAt`, `targeted`, `sent`, `failed`, `blocked` ; `OutboundMessage.broadcastId` |
| `Alert` | Alerte système. | `kind`, `severity` (INFO, WARNING, CRITICAL), `message`, `payload`, `notifiedAt`, `resolvedAt` |
| `DailyStat` | Statistiques journalières pré-calculées. | `date`, `dimension` (`all`, `channel:<id>`, `campaign:<id>`, `ad:<id>`, `vertical:<V>`), métriques (requests, approved, joined, left, entryClicks, offerClicks, registrations, ftds, deposits, depositAmount, ngr, spend) ; unique `(date, dimension)` |
| `Member.tags` | Étiquettes libres (JSON). | — |

## Phase 3 (9 octobre 2026) — migrations `outbound_media`, `automations`, `broadcast_ab`
| Table / colonne | Rôle | Colonnes clés |
| --- | --- | --- |
| `OutboundMessage.mediaAssetId` | Média joint à un message privé (légende = texte). | relation `MediaAsset` |
| `AutomationRule` | Règle « si… alors… ». | `trigger` (JOINED, OFFER_CLICKED, REGISTERED, DEPOSITED, INACTIVE, LEFT, SPEND_LEVEL_REACHED), `conditions` JSON (canaux, pubs, langues, niveaux, inactivité, catégories), `actions` JSON ordonnées (send_message, send_sequence, wait, tag, suggest_channel, notify_team), `isActive`, `oncePerMember`, `runs`, `lastRunAt` ; phase 9 : `graph` JSON facultatif (relance à branches : nœuds déclencheur, condition oui/non, action, attente, arrêt ; null = liste d'actions linéaire), `templateKey` (carte prête à l'emploi : welcome, offer_no_signup, signup_no_deposit, inactive_7d, first_deposit_thanks, vip) |
| `AutomationRun` | Exécution d'une règle pour un membre (journal + reprise des « attendre »). | `status` (PENDING, RUNNING, DONE, FAILED, SKIPPED, CANCELLED), `step`, `resumeAt`, `context`, `log` (entrées avec `nodeId` et `branch` pour un graphe), `error` ; phase 9 : `nodeId` (bloc courant d'une relance à branches) |
| `Broadcast.abGroupId` / `abVariant` / `abSplit` | Test A/B : variantes d'un même test et part des destinataires. | — |

## Phase 4 (9 octobre 2026) — migrations `phase4_index`, `phase4_session`

### `20261009175800_phase4_index` : index seulement (aucune donnée modifiée)
| Table | Index ajoutés | Pour quoi |
| --- | --- | --- |
| `AuditLog` | `(action, createdAt)` | Journal filtré par préfixe d'action et période |
| `Member` | `(lastSeenAt)`, `(firstSeenAt)`, `(anonymizedAt, lastSeenAt)` | Tri de la liste des membres ; purge des inactifs |
| `MemberBotState` | `(botId, canDm)` | Ciblage des envois groupés (membres joignables par un bot) |
| `Event` | `(occurredAt)` | Purge par date, compteur « 24 h » de l'accueil |
| `Membership` | `(channelId, requestedAt)`, `(inviteLinkId, requestedAt)`, `(requestedAt)`, `(approvedAt)`, `(joinedAt)`, `(leftAt)` | Tableaux de bord et statistiques journalières (demandes, acceptés, entrées, départs par période) ; rentabilité des pubs |
| `InviteLink` | `(kind, createdAt)`, `(campaignId)` | Listes des liens d'entrée ; pubs |
| `TrackingLink` | `(kind, createdAt)`, `(inviteLinkId)`, `(channelId)`, `(affiliateCampaignId)` | Page Liens paginée par type ; jointures |
| `Click` | `(isBot, createdAt)` | Clics humains par période (tableaux de bord) |
| `Post` | `(isTemplate, scheduledAt)`, `(categoryId)` | Calendrier, liste et modèles ; filtre par catégorie |
| `OutboundMessage` | `(memberId, status, sentAt)` | Dernier message envoyé à un membre (automatisations) |
| `Player` | `(clickId)`, `(registeredAt)`, `(ftdAt)`, `(lastEventAt)`, `(createdAt)` | Attribution par clic ; inscriptions / FTD par période |
| `Broadcast` | `(createdAt)` | Liste des envois paginée |

Les autres index (43 avant cette phase) sont inchangés ; les colonnes `@unique` servent déjà d'index.

### `20261009175816_phase4_session`
| Table / colonne | Rôle |
| --- | --- |
| `User.sessionVersion` (`Int`, défaut 0) | Version de session. Le jeton de connexion (JWT) porte la version émise (`sv`) ; elle est incrémentée au changement de mot de passe, de rôle et à la désactivation du compte, ce qui invalide toutes les sessions existantes (déconnexion de tous les appareils). Vérification : à chaque page via `requireUser` (comparaison immédiate) et dans le rappel `jwt` d'Auth.js (lecture en base au plus une fois par 5 minutes et par utilisateur). |

## Phase 6 (9 octobre 2026) — migration `20261009185245_phase6_post_ab`
| Table / colonne | Rôle | Colonnes clés |
| --- | --- | --- |
| `Post.abGroupId` / `abVariant` | Test A/B de message de canal : identifiant commun aux deux variantes (A et B) d'un même test, lettre de la variante. B part 30 min après A dans le même canal (délai réglable 5 min – 24 h), ou à la même heure dans un autre canal. Comparaison : `/messages/ab/<abGroupId>` (gagnante provisoire par `pickPostWinner` de `packages/core/src/ab.ts`). | index `(abGroupId)` |
| `Post.vertical` (`Vertical?`) | Univers du modèle (bibliothèque « Modèles » filtrable par univers et catégorie). Renseigné à la création d'un modèle depuis le canal, et par `pnpm seed:templates` (63 modèles : 3 univers × 7 catégories × 3 ; clé technique `Post.code` = `modele:<univers>:<categorie>:<n>`, titre lisible dans `templateName`). | index `(isTemplate, vertical)` |
| `Setting` `besthours.<channelId>` / `besthours.updatedAt` | Meilleurs horaires de publication (JSON) : par canal et par catégorie (`all` + chaque catégorie), carte jour (1 = lundi … 7) × heure (0–23, Paris) sur 8 semaines de messages envoyés : messages, vues, clics, cliqueurs uniques, réactions, taux de clic (si vues), clics et réactions par message, recommandation (≥ 3 messages). Calcul : tâche `stats` `{type:"best-hours"}` toutes les 24 h et à la demande (fiche canal → Meilleurs horaires → Recalculer). | — |

## Phase 7 (10 octobre 2026) — migration `20261010040337_phase7_connecteurs`
- Enum `ConnectionStatus` (ACTIVE, NEEDS_RECONNECT, DISABLED).
- `ConnectorApp` (clé `platform` AdPlatform) : identifiants d'application développeur par plateforme (`clientId` en clair, `secretEncrypted` AES-256-GCM, `extra` JSON : Meta `configId`, TikTok `sandbox`), `verifiedAt`, `lastError`.
- `AdAccountConnection` : compte publicitaire connecté par OAuth (`platform` + `externalId` uniques : Meta `act_<id>`, TikTok `advertiser_id`), nom, devise, fuseau, Business Manager, `status`, jetons chiffrés (`tokenEncrypted`, `refreshTokenEncrypted`, `tokenExpiresAt`), `connectedById`, `lastSyncAt`, `lastSyncRows`, `lastError`, `nextFullSyncAt` (resynchro 28 jours une fois par nuit), `backfilledAt` (historique 90 jours chargé).
- `ConnectorSyncRun` : journal d'une synchro (plage, lignes, état `running | ok | error`, erreur lisible).
- `Campaign.connectionId` : compte connecté qui alimente la campagne (les lignes CSV sont alors refusées pour elle). `AdCost.spendOriginal` : dépense dans la devise du compte ; `AdCost.spend` reste en EUR (toutes les statistiques lisent `spend`).
- `TelegramUserSession` (ligne unique `main`) : session MTProto chiffrée du compte Telegram qui lit les vues (`status` PENDING_CODE | PENDING_PASSWORD | ACTIVE | ERROR | DISCONNECTED, `phoneCodeHash` pendant la connexion). Identifiants `api_id` / `api_hash` dans `Setting` `telegram.userApi`.
- `PostViewSample` : relevé horodaté des vues et transferts d'un message (courbes) ; `Post.viewsNextAt` : prochain relevé (15 min pendant 48 h, puis quotidien jusqu'à 30 jours, puis null).
- `Setting` : `currency.rates.imported` (taux Link Affi, toutes les 6 h), `currency.rates.manual` (saisie, prioritaire), `connectors.pending.<plateforme>.<utilisateur>` (jetons chiffrés en attente du choix des comptes, 15 min).

## Phase 8 (10 octobre 2026) — migration `20261010045429_phase8_ia`
- `AiSuggestion` : une ligne par demande à l'assistant IA d'écriture. `userId` (qui), `kind` (`improve | idea | shorter | punchier | angle | translate | ab_variant`), `context` JSON (univers, catégorie, langue, objectif, ton, longueur, média, surface `post | bot_text | broadcast | template | automation`, nombre d'exemples joints, qualité supérieure ou non), `input` (brouillon ou idée), `outputs` JSON (versions `{ text, why, lang? }` : 3 versions, ou une par langue pour `translate`), `model`, `inputTokens`, `outputTokens`, `cachedTokens` (lus en cache), `costEur` Decimal(10,4) estimé (prix publics Anthropic, 1 $ = 0,92 €), `usedIndex` (version retenue, null sinon). Index `(userId, createdAt)` et `(createdAt)` pour le compteur du mois, la limite par jour et l'historique.
- `Setting` `ai.config` : `{ apiKeyEncrypted (AES-256-GCM, clé APP_ENCRYPTION_KEY), defaultModel, qualityModel, monthlyCapEur (défaut 20), perUserDailyLimit (défaut 50), riskNotice: { casino, sports }, verifiedAt, lastError }`. La clé n'est jamais renvoyée au navigateur ni journalisée.

## Phase 10 (11 octobre 2026) — migration `20261011123318_phase10_gains_relances`

Migration additive (valeurs d'énumération, colonnes facultatives ou avec défaut, une table, index, clés étrangères `ON DELETE SET NULL`) ; aucune donnée existante modifiée. Garde : `packages/db/prisma/migrations/phase10-gains-relances.test.ts` (migration présente et additive, champs attendus). Définition : **Gains = nos commissions (CPA + part de revshare) − dépense pub** ; les dépôts et le revenu net restent des indicateurs de volume (argent du casino), jamais additionnés aux gains.

### Gains : commissions Link Affi
| Table / colonne | Rôle | Colonnes clés |
| --- | --- | --- |
| `PlayerEventType` + `CPA`, `CPA_REVERSAL` | Événements datés de la commission CPA d'un joueur. `CPA` : crédit, montant **positif** (part affilié), daté `players.cpa_credited_at` (repli `qualified_at` quand il manque). `CPA_REVERSAL` : annulation, montant **négatif**, datée `players.cpa_reversed_at`. Somme des deux sur une période = CPA nette (une CPA annulée se retranche le jour de l'annulation). | `externalId` conseillé : `cpa:<players.id>` et `cpa_reversal:<players.id>` (unicité `(playerId, externalId)`, synchro rejouable) |
| `Player.cpaStatus` | Statut CPA Link Affi (`players.cpa_status`). Valeurs observées le 11 octobre : `none` 1 207, `approved` 370, `reversed` 156, `not_eligible` 32. | texte, null tant que la synchro ne l'a pas lu |
| `Player.cpaAmount` | Commission CPA côté affilié en EUR (`players.cpa_affiliate_amount`, = `player_financials.cpa_affiliate`). Reste renseignée après annulation (montant annulé). | `Decimal(14,2)`, null = aucune ou inconnue |
| `Player.cpaCreditedAt` / `cpaReversedAt` | Dates réelles du crédit et de l'annulation (`players.cpa_credited_at` / `cpa_reversed_at`). Un joueur `approved` ancien peut ne pas avoir de date de crédit. | index sur chacune |
| `AffiliateDailyStat` | Agrégat journalier Link Affi (`stats`), seule source de la part de revshare. **Une ligne par ligne Link Affi** (`externalId` = `stats.id`, upsert idempotent), pas une par (jour, offre) : le 11 octobre, 90 groupes (jour, offre, affilié, casino) sur 1 651 ont plusieurs lignes (corrections créées plus tard mais datées du jour d'origine) et 716 lignes sur 1 833 n'ont pas d'offre. Couvre tous les affiliés de Link Affi : ne compter que nos offres. Lire en additionnant par (`date`, `affiliateCampaignId`). | `date` (jour de Paris côté Link Affi), `affiliateCampaignId?` (→ `AffiliateCampaign`), `campaignExternalId?`, `programId?` (→ `AffiliateProgram`), `programExternalId?`, `affiliateExternalId?`, `clicks`, `signups`, `deposits`, `depositAmount`, `revenue` (total affilié, arrondi au centime, inclut parfois des primes manuelles), `cpaRevenue`, `revshareRevenue` (fractionnaire, parfois négatif) en `Decimal(14,4)`, `sourceCreatedAt` (`stats.created_at`), `raw` ; index `(date)`, `(affiliateCampaignId, date)`, `(programId, date)` |
| `DailyStat.commissions` | Nos commissions du jour (EUR) = `cpaCommissions` + `revshareCommissions`. Gains du jour = `commissions` − `spend`. | `Decimal(14,2)`, défaut 0 |
| `DailyStat.cpaCommissions` / `revshareCommissions` | Détail : CPA nette au jour réel (événements `CPA` / `CPA_REVERSAL`) ; part de revshare (`AffiliateDailyStat` de nos offres). | `Decimal(14,2)`, défaut 0 |

### Relances attribuables
| Table / colonne | Rôle | Colonnes clés |
| --- | --- | --- |
| `TrackingLink.automationRuleId` | Relance automatique qui a envoyé ce bouton (Offre ou lien traqué), comme `postId` pour un message de canal. Chaîne d'attribution : `Player.clickId` → `Click.trackingLinkId` → `TrackingLink.automationRuleId`. Relance supprimée : le lien reste actif, le rattachement est effacé. | `String?` → `AutomationRule` (`ON DELETE SET NULL`), index |
| `OutboundMessage.automationRuleId` | Relance à l'origine d'un message privé (kind `AUTOMATION`) : « envoyés » par relance = messages `SENT` de la relance. | `String?` → `AutomationRule` (`ON DELETE SET NULL`), index `(automationRuleId, status)` |
| `Broadcast` (inchangé) | Un bouton d'un envoi à un groupe est déjà rattaché par le message « conteneur » `Post` (`templateName = broadcast:<id>`) : `TrackingLink.postId` et `Click.postId` (code du conteneur dans `/start o<slug>_<code>`). Aucune colonne ajoutée. | — |

## Phase 11 (11 octobre 2026) — migration `20261011155518_phase11_regles_provenance`

Règles d'adhésion selon la provenance et liens de partage. Migration additive (deux énumérations, une valeur
d'énumération, colonnes facultatives ou avec défaut, un index) ; seule écriture : la portée `INVITE_LINK` des anciennes
règles d'un lien précis (même comportement qu'avant). Garde : `packages/db/prisma/migrations/phase11-regles-provenance.test.ts`.
Règles pures de résolution : `packages/core/src/provenance.ts` (partagées par le bot, le worker et le site).

| Table / colonne | Rôle | Valeurs |
| --- | --- | --- |
| `ApprovalRule.scope` (`ApprovalRuleScope`) | Portée : règle par défaut du canal ou exception. | `DEFAULT` (avec `isDefault = true`), `INVITE_LINK` (`inviteLinkId`), `SOURCE_CHANNEL` (`sourceChannelId`), `SOURCE_KIND` (`sourceKind`) |
| `ApprovalRule.sourceChannelId` | Canal d'où vient la personne (lien GATE ou SHARE de ce canal). Sans clé étrangère, comme `InviteLink.sourceChannelId`. | identifiant de `Channel` |
| `ApprovalRule.sourceKind` (`ApprovalSourceKind`) | Type de provenance. | `GATE` (bouton « canal à rejoindre » d'un de nos canaux), `ANY_CHANNEL` (lien GATE, ou lien SHARE posté dans un de nos canaux), `AD_ANY`, `AD_TIKTOK`, `AD_META` (liens d'entrée de pub), `SHARE` (liens de partage) |
| `ApprovalRule.label` | Texte lisible de l'exception, recalculé à l'enregistrement. | « Venu de « Tir Cadré » » |
| `ApprovalRule.sortOrder` | Ordre de l'équipe entre exceptions de même niveau (10, 20, 30…). | entier, défaut 0 |
| `ApprovalRule.sendWelcome` | Message privé à l'arrivée (accueil, ou court message pour une personne venue d'un canal obligatoire). Toujours envoyé quand des canaux sont à rejoindre. | défaut vrai |
| `InviteLinkKind.SHARE` | Lien de partage nommé créé depuis la fiche du canal, avec demande d'adhésion ; `sourceChannelId` facultatif (« à poster dans <canal> »). | — |

Résolution d'une demande (`pickRuleForProvenance`) : règle du lien précis → règle du canal d'origine → règle du type de
provenance → règle par défaut du canal → aucune règle (validation à la main ; entrée directe pour une personne venue
du bouton « canal à rejoindre » d'un de nos canaux, comme les anciens liens GATE). À niveau égal, `sortOrder` départage.
Une personne venue d'un canal obligatoire qui tombe sur la règle par défaut ne se voit imposer aucun canal à rejoindre
(`effectiveGateChannelIds`), et le canal d'où elle vient compte toujours comme rejoint (exigences croisées sans boucle).

`Membership.source` (JSON) gagne :
- `provenance` : `{ type: "GATE" | "SHARE" | "AD" | "MANUAL" | "UNKNOWN", inviteLinkId, sourceChannelId, adPlatform, label }` ;
- `appliedRule` : `{ id, scope, label, noGates? }` (`noGates` : canaux à rejoindre de la règle non imposés pour cette provenance ; `label` null pour la règle par défaut) ; `appliedRule = null` quand le canal n'a aucune règle, avec alors
- `noRule` : `"MANUAL"` (validation à la main) ou `"IMMEDIATE"` (entrée directe silencieuse d'une personne venue d'un bouton « canal à rejoindre » : ni accueil ni message « Accepté »).
La provenance est aussi enregistrée pour une entrée directe vue seulement par `chat_member`. Les anciennes demandes sans `provenance` se lisent par leur `InviteLink` (`provenanceOfLink`).

Liens GATE : depuis la phase 11, créés avec demande d'adhésion (`createsJoinRequest = true`) ; le canal obligatoire
applique alors sa propre règle. Les anciens liens GATE à entrée directe (`createsJoinRequest = false`) ne sont plus
proposés et sont révoqués par le worker 7 jours après la mise en ligne de la phase 11 (`Setting`
`phase11.legacyGateRevokeAfter`, date ISO écrite au premier passage, jamais repoussée ; événement
`invite_link.legacy_revoked`). Un lien GATE avec demande d'adhésion est créé par le bot qui agit pour le canal à
rejoindre (`InviteLink.botId`) : Telegram masque la fin d'un lien créé par un autre administrateur ; un lien reçu masqué
se retrouve par `InviteLink.channelId` + début de `telegramInviteLink` + `Bot.telegramBotId` du créateur (un seul
candidat, sinon provenance inconnue).

Autres `Setting` de la phase 11 : `phase11.gateExceptions` (marque de la reprise `pnpm db:phase11`, lancée au démarrage
du conteneur web juste après la migration : `{ doneAt, created, skippedExisting, rescheduled }`). La reprise replanifie
aussi les demandes arrivées entre la mise en ligne et sa propre exécution par un bouton « canal à rejoindre » et tombées
sur la règle par défaut (événement `membership.rescheduled` : `{ membershipId, reason, ruleId, previousRuleId,
previousStatus, previousApproveAt, approveAt }`).

`Membership.expiresAt` n'est rempli et utilisé que pour les demandes qui attendent encore (REQUESTED : l'équipe ;
PENDING_GATE : la personne) ; une demande SCHEDULED dont l'heure d'acceptation est fixée n'expire jamais.

## Phase 12 (11 octobre 2026) — migration `20261011191631_phase12_emojis_animes`

Emojis animés (emojis personnalisés des packs Premium Telegram). Migration additive : énumérations `PostPublisher`
(BOT, ACCOUNT) et `CustomEmojiSource` (FORWARD, PACK, ACCOUNT), colonne `Post.publisher` (défaut BOT : rien ne change pour
les messages existants), table `CustomEmoji`. Garde : `packages/db/prisma/migrations/phase12-emojis-animes.test.ts`.
Règles pures : `packages/core/src/custom-emoji.ts` (balises, emoji de remplacement, lien de pack, qui publie, état du compte).

| Table / colonne | Rôle |
| --- | --- |
| `CustomEmoji` | Bibliothèque de l'équipe : `customEmojiId` (unique, identifiant Telegram), `fallback` (emoji standard de remplacement), `setName` / `setTitle` (pack), `format` (tgs / webm / webp), aperçu `previewBytes` + `previewMime` (récupéré par le worker, `previewAt`, `previewError`), `source`, `addedById`, `useCount` / `lastUsedAt` (emojis récents), `hiddenAt` (retiré de la bibliothèque). |
| `Post.publisher` | BOT (le bot du message, Bot API) ou ACCOUNT (compte Telegram connecté, MTProto) pour un message de CANAL (Channel.type CHANNEL) qui contient des emojis animés : Telegram les interdit aux bots dans les canaux ; dans un groupe ou supergroupe, le bot les publie lui-même (BOT). `protectContent` est toujours faux pour un message ACCOUNT. Un message ACCOUNT n'a pas de boutons et n'est jamais modifié ensuite par le bot ; épingler, désépingler et supprimer passent par le compte. |

Texte : un emoji animé s'écrit `<tg-emoji emoji-id="<customEmojiId>"><fallback></tg-emoji>` dans le HTML Telegram de
tous les textes (messages de canal, messages du bot, relances, envois à un groupe, modèles). Il compte comme son emoji de
remplacement dans la longueur du texte.

File BullMQ `custom-emoji` : `fetch-previews` (aperçus par le Bot API), `import-account` (packs installés sur le compte
connecté), `account-status` (Premium et droits de publication par canal → `Setting` `mtproto.publishStatus`, forme
`MtprotoPublishStatus`), `tick` (toutes les 10 minutes).

Formes écrites par le worker : `mtproto.publishStatus` = `MtprotoPublishStatus` (canaux indexés par `Channel.id`) ;
événement `post.sent` d'un message ACCOUNT = `{ publisher: "ACCOUNT", customEmoji: { sent, kept }, protectContentApplied:
false }` (`kept < sent` : Telegram a retiré des emojis animés, compte sans Premium) ; `custom_emoji.added` (source ACCOUNT)
= `{ count, ids, already, packs, totalPacks, partial, userId }`. Après un échec, une tâche d'envoi de message porte le
jobId `post:<id>:<attempts>` (sinon BullMQ ignorerait la reprogrammation).
Événements de repli : `dm.custom_emoji_fallback` `{ outboundMessageId, botId, error, resent, kind, via? }` et
`post.custom_emoji_fallback` `{ postId, botId, error, resent }` (comptés par l'alerte `custom_emoji_refused`) ;
`post.deferred` (publication par le compte reportée : FLOOD_WAIT, session occupée, réseau).


## Phase 13 (14 octobre 2026) — migration `20261014124215_phase13_affilies_linkaffi`

Campagnes Telegram des affiliés Link Affi (contrat `docs/LINKAFFI-PARTENAIRES.md`, version 2). Migration additive
(une énumération, trois valeurs d'énumération, colonnes facultatives, deux tables, index, clé étrangère SET NULL) ;
l'index unique `(linkaffiCampaignKey, channelId)` porte sur une colonne nouvelle (vide en production). Garde :
`packages/db/prisma/migrations/phase13-affilies-linkaffi.test.ts`. Règles pures : `packages/core/src/linkaffi-partners.ts`
(événements, signature, clés, paramètre `tg`, attribution, nouvelles tentatives) et `packages/core/src/provenance.ts`
(provenance LINKAFFI, exceptions « n'importe quel affilié » et « un affilié précis »).

| Table / colonne | Rôle |
| --- | --- |
| `InviteLinkKind.LINKAFFI` + `InviteLink.linkaffiCampaignKey`, `linkaffiCampaignName`, `linkaffiAffiliateId`, `linkaffiAffiliateName`, `attributionDays` | Lien d'une campagne Telegram d'affilié créée dans Link Affi (`POST /invite-links`), avec demande d'adhésion. Même clé + même canal = même lien (`@@unique`). `attributionDays` null = à vie. |
| `Member.linkaffiCampaignKey`, `linkaffiAffiliateId`, `affiliateAttributedAt`, `affiliateAttributionEndsAt`, `affiliateInviteLinkId` | Affilié qui a amené le membre : premier affilié gagne, jamais écrasé automatiquement ; changé ou retiré seulement par un ADMIN (journal). |
| `Click.linkaffiTelegramCampaignKey` | Campagne Telegram d'affilié du membre au moment du clic d'offre (`&tg=<clé>` ajouté au lien Link Affi). |
| `ApprovalSourceKind.LINKAFFI_ANY`, `LINKAFFI_AFFILIATE` + `ApprovalRule.linkaffiAffiliateId` | Exceptions de règle d'adhésion : n'importe quel affilié Link Affi, un affilié précis (une campagne précise = exception du lien, portée INVITE_LINK). |
| `LinkaffiEvent` | Événement à envoyer à Link Affi : `eventId` unique et stable (`lap_<type>_<demande ou clic>`), `type`, `occurredAt`, `campaignKey`, corps exact du contrat (`body`), `status` PENDING / SENT / FAILED, `attempts`, `nextAttemptAt`, `lastError`, `lastStatus`, `sentAt`. Nouvelles tentatives pendant 24 h ; sert aussi au rattrapage `GET /members`. |
| `IntegrationKey` (`provider` = "linkaffi") | Clé d'API de Link Affi stockée hachée (`apiKeyHash`, `apiKeyPrefix` pour l'affichage), secret de signature chiffré (`webhookSecretEncrypted`), adresse de la fonction `telegram-events` (`eventsUrl`), dernières utilisations. |

Envoi : `emitLinkaffiEvent` (`packages/queue/src/linkaffi-events.ts`) enregistre l'événement d'un membre rattaché
(attribution en cours ; événements d'adhésion du seul canal de sa campagne ; `offer_clicked` pour tout clic d'offre) et
l'enfile dans la file BullMQ `linkaffi-events` (`deliver`, `tick` chaque minute).

Autres données de la phase 13 : `Setting` `linkaffi.telegramCampaigns` (écrit par la synchro toutes les 10 minutes :
campagnes Telegram lues chez Link Affi, leurs chiffres et les écarts avec les nôtres ; disponibilité des tables) ;
`Setting` `affiliates.tutorial.<userId>` (`{ dismissedAt }`, mini-tutoriel de la page des affiliés). Événements :
`member.affiliate_attributed` `{ membershipId, inviteLinkId, campaignKey, campaignName, affiliateId, affiliateName, stage,
attributedAt, endsAt }`, `membership.affiliate_not_attributed` (mêmes champs + `reason`, `currentCampaignKey`,
`currentAffiliateId`), `linkaffi_event.failed` (un par événement abandonné), `member.affiliate_changed` /
`member.affiliate_removed` `{ from, to?, reason, by }` ; `click.offer` porte `linkaffiTelegramCampaignKey` quand `tg` a été
ajouté. Livraison : réservation d'un événement par mise à jour conditionnelle avec un bail de 2 minutes.

## Phase 14 (15 octobre 2026) — aucune migration

Demandes bloquées sur « Attend les canaux » : aucun changement de schéma. Données nouvelles :

| Donnée | Rôle |
| --- | --- |
| `Setting` `phase14.gateBackfill` | Résultat du rattrapage unique (`runGateBackfillOnce`, fait par le premier passage du filet du worker ou `pnpm db:phase14`) : `satisfied`, `stillPending`, `errors`, `byChannel`, `botStates { canDmCleared, blockedCleared, wroteKept }`, `sequenceTexts { updated, upToDate, keptByTeam }`. Sa présence empêche un second passage (sauf `--force`). |
| `MemberBotState.canDm` | Désormais vrai seulement après « Démarrer » ou l'appui sur un bouton du bot (`startedAt` rempli) ; un message parti dans les 5 minutes d'une demande crée l'état avec `canDm` faux. `blockedAt` n'est plus rempli que par un vrai blocage. |
| `Membership.source.ruleAppliedAt` | Heure à laquelle « Leur appliquer la nouvelle règle » a recalculé la demande. |
| `Membership.source.approveAll` | `{ at, byUserId, fallbackAt }` : demande lancée par « Tout accepter » (affichée « Acceptation en cours ») ; `approveAt` vaut l'heure de secours `fallbackAt` (+10 minutes). |
| `OutboundMessage.error` | Texte exact de Telegram gardé pour tout refus (« 403 Forbidden: … »). |

Événements : `dm.blocked` (seulement « bot was blocked by the user ») et `dm.unreachable` (autre refus 403 : la personne n'a
jamais démarré le bot) portent `telegramError` ; `dm.skipped_unreachable` `{ membershipId, kind: WELCOME | GATE_REMINDER |
GATE_SATISFIED | ACCEPTED, reason: blocked | never_started | unreachable, manual? }` (aucun message mis en file) ;
`membership.gate_satisfied` `{ auto: true, trigger: join_request | joined | sweep | backfill | rule_applied,
requested }` ; `membership.rule_applied` `{ previousStatus, status, ruleId, approveAt, byUserId }`. Journal d'actions :
`approval_rule.applied_to_pending`, `membership.approve_all`.

Tâches : file `approvals` `gate-sweep` (toutes les 2 minutes, demandes « Attend les canaux » de moins de 7 jours, 30
vérifications Telegram par bot et par passage), `reminder` (rappel différé de moins de 5 minutes, identifiant
`reminder-<demande>-<rang>`) ; file `telegram-send` `approve` / `decline` (« Tout accepter »). Alerte `bot_blocked_rate`
(plus de 25 % de vrais blocages dans l'heure qui suit l'accueil, au moins 10 demandes, une alerte par canal toutes les 6 h).

## Phase 15 (15 octobre 2026) — migration `20261015061843_phase15_pages_atterrissage`

Pages d'atterrissage Telegram (rubrique « Pages », contrat `docs/PAGES-ATTERRISSAGE.md`). Migration additive (une
énumération, trois valeurs d'énumération, colonnes facultatives, trois tables, index, clés étrangères SET NULL / CASCADE
sur les nouvelles tables seulement). Garde : `packages/db/prisma/migrations/phase15-pages-atterrissage.test.ts`. Règles
pures : `packages/core/src/landing.ts`, rendu `packages/core/src/landing-render.ts`, provenance LANDING dans
`packages/core/src/provenance.ts`.

| Table / colonne | Rôle |
| --- | --- |
| `LandingPage` | Page servie sur `https://go.goolink.eu/j/<slug>` : canal (titre jamais saisi), langue, accroche, sous-texte, texte du bouton, petite ligne, photo, bandeau cookies, pixels TikTok / Meta, `isActive` (pause), `version` (clé du HTML en mémoire). |
| `LandingSource` | Source d'une page (`key` lue dans `?src=`, "" = lien principal) : lien actuel `inviteLinkId`, refus de Telegram `linkError`, dernier essai de création du lien `linkTriedAt` (reprise du worker : chaque page à son tour), pub reliée `adId` (coût par join). Jamais supprimée : désactivée (`isActive`), son lien révoqué. |
| `InviteLinkKind.LANDING` + `InviteLink.landingPageId`, `landingSource`, `landingAdId` | Lien d'invitation d'une source (avec demande d'adhésion), créé par le bot de l'univers du canal pour la pub reliée à sa source à ce moment-là : `landingAdId` et `campaignId` figés à la création (ses demandes et ses visites comptent pour cette pub et sa campagne, pour toujours ; pub de la source changée : nouveau lien). Pub supprimée : `landingAdId` à null (SET NULL), la campagne reste. Un lien révoqué garde sa page, sa source et sa pub ; un lien en trop d'un passage concurrent n'a ni source, ni pub, ni campagne. |
| `LandingEvent` | Visite (VIEW), clic (CLICK, avec la façon d'ouvrir Telegram `method`) et ouverture de Telegram (OPENED : page quittée dans les 2 s) ; `visitId`, source, os, navigateur intégré, pays, `ipHash`, `isBot`, `ttclid` / `fbclid`. Append-only, écrit par la file `landing-events`, purgé avec les données personnelles. Aucune adresse IP. |
| `ApprovalSourceKind.LANDING_ANY`, `LANDING_PAGE` + `ApprovalRule.landingPageId` | Exceptions de « Qui peut entrer et quand » : n'importe quelle page, une page précise (pas de clé étrangère : « page supprimée »). |
| `Channel.photoSmall`, `photoFileUniqueId`, `chatCheckedAt` | Petite photo du canal (JPEG 160 px) pour les pages qui l'affichent ; dernière relecture `getChat` (titre et photo). |

Correction de la même phase, migration `20261015105038_phase15_pub_figee_liens` (additive : `InviteLink.landingAdId` +
index + clé étrangère SET NULL vers `Ad`, `LandingSource.linkTriedAt` ; reprise de la pub du lien actuel des sources
reliées ; garde dans le même fichier de test). `Channel.photoSmall` est omise par défaut par le client partagé
(`omit` global) : lue seulement avec `select: { photoSmall: true }`. Tâches : file `landing-events` (`event`),
maintenance `landing-chats` (toutes les 5 min, titre et photo relus au plus toutes les 30 min par canal) et
`landing-links` (toutes les 10 min : liens manquants ou créés pour une autre pub, liens détachés révoqués, campagne des
liens actuels). Canal Redis `landing:invalidate` (`{ pageId?, channelId?, all? }`). Journal : `landing.page_created` /
`updated` / `deleted`, `landing.test_page_created` / `updated` (AuditLog) ; événements `invite_link.landing_created`,
`invite_link.landing_failed`, `invite_link.landing_revoked`.

## Phase 16 (16 octobre 2026) — migration `20261016050025_phase16_sortie_des_applis`

Sortie du navigateur intégré de TikTok (et des autres applis). Migration additive : trois valeurs ajoutées à
`LandingEventType`.

| Valeur | Rôle |
| --- | --- |
| `HELP` | Aide plein écran « Appuie sur ⋯ puis « Ouvrir dans le navigateur » » affichée dans un navigateur intégré après l'appui (`method` = appli reconnue). |
| `ESCAPED` | Page rouverte dans Safari / Chrome avec le marqueur `tgo=1&vid=<visite>` (`method` = TGO), ou à défaut avec `ttclid` / `fbclid` hors navigateur intégré (TTCLID / FBCLID). Avec le marqueur, `visitId` = `vid` : même visite que dans l'appli. |
| `AUTO_OPEN` | Ouverture automatique de Telegram tentée au chargement dans Safari / Chrome (`method` AUTO_TG ou AUTO_INTENT) ; un OPENED de même méthode suit si la page passe en arrière-plan. |

Nouvelles façons d'ouvrir (`LandingEvent.method`) : TG_FRAME / INTENT_FRAME (tentative dans un cadre caché, avec l'aide),
AUTO_TG / AUTO_INTENT ; TG_SCHEME et INTENT (phase 15) ne sont plus envoyés. Table des menus des applis :
`packages/core/src/landing-escape.ts` (`LANDING_ESCAPE_TABLE`).

## Phase 17 (18 octobre 2026) — migration `20261018125018_phase17_assistant_conversation`

Assistant de conversation (bot officiel dédié, univers Rencontres ; contrat `docs/ASSISTANT-CONVERSATION.md` § 1).
Migration additive : cinq énumérations, une valeur ajoutée à `OutboundKind`, colonnes facultatives (ou avec défaut) sur
`Bot`, `Click` et `TrackingLink`, six tables, index et clés étrangères. Supprimer un membre ou un bot supprime ses
conversations (et leurs messages et événements) ; supprimer une persona, une conversation, un clic ou un message privé ne
supprime jamais un bot, un lien traqué ni un clic (SET NULL). Garde :
`packages/db/prisma/migrations/phase17-assistant-conversation.test.ts`. Libellés français des énumérations :
`apps/web/lib/status-badges.tsx` (`botMode`, `conversationStage`, `conversationStatus`, `conversationAuthor`,
`outboundKind.ASSISTANT`).

| Table / colonne | Rôle |
| --- | --- |
| `Bot.mode` (`BotMode` STANDARD / ASSISTANT, index) + `Bot.personaId` | Bot normal ou assistant de conversation (réglé par un ADMIN), persona liée (SET NULL). Un bot ASSISTANT n'est jamais choisi automatiquement. |
| `Persona` | Assistant ASSUMÉ (jamais une vraie personne) : prénom, `gender` (F → « l'assistante », M → « l'assistant »), personnalité, ton, langues, centres d'intérêt, consigne en plus, modèle et température (null = réglages), règles du parcours (`minExchangesBeforeOffer` 4, `requireInterest`, `maxOfferSends` 2, `followUpAfterHours` 24, `followUpsMax` 2), offre Link Affi et notre campagne liées, fiche de l'offre `offerPitch`, texte du bouton, visuel de l'app `offerMediaAssetId`, descriptions du bot, `isActive` (faux par défaut). |
| `Conversation` | Une par bot et par membre (`@@unique([botId, memberId])`) : persona du premier message, source du `/start` (jamais écrasée), étape (`ConversationStage` WELCOME → CHAT → PROPOSAL → LINK_SENT → FOLLOW_UP → CONVERTED → CLOSED), statut (`ConversationStatus` BOT / HUMAN / PAUSED / CLOSED), profil de style, résumé roulant, faits dits par la personne, langue, mineur, `/stop` (`stoppedAt`, définitif), fermeture et sa raison (STOP, MINOR, TEAM, BLOCKED, UNREACHABLE), reprise en main, compteurs, relances (`followUpCount`, `nextFollowUpAt`), nouvel essai après une panne (`retryAt`), conversion. |
| `ConversationMessage` | Texte brut (jamais de HTML), sens (`ConversationDirection` IN / OUT), auteur (`ConversationAuthor` MEMBER / ASSISTANT / TEAM / SYSTEM), média, méta (sub-ID de l'offre, modèle, rejets…), message Telegram (anti-doublon `@@unique([conversationId, direction, telegramMessageId])`), message privé sortant (`outboundMessageId` unique, kind ASSISTANT, SET NULL), tour (`turnId`, `partIndex` : `@@unique([turnId, partIndex])`), heure de réclamation par un tour en cours (`claimedAt`, indexée, remise à null à la fin du tour : balayage des tours bloqués, migration `phase17_relecture_moteur`). Effacé par `/reset` et la purge. |
| `ConversationEvent` | Événements du parcours, append-only, sans aucun texte (`stage_changed`, `offer_sent`, `offer_opened`, `follow_up_sent`, `stopped`, `reset`, `minor`, `taken_over`, `released`, `blocked`, `closed`, `ai_failed`, `cap_reached`, `daily_limit`, `converted`) ; survit à `/reset`. Doublé d'un `Event` `conversation.<type>` (famille « Assistant de conversation » du Journal). |
| `AssistantOfferLink` | Un lien d'offre envoyé = un sub-ID unique (`go.goolink.eu/a/<subId>`) : conversation, persona, membre (SET NULL), bot, lien OFFER de la persona (CASCADE), copie de la source, ouvertures, `Click` de la première ouverture (unique, SET NULL). |
| `Click.conversationId` (index), `TrackingLink.personaId` (index) | Clic d'une offre ouverte depuis une conversation ; lien OFFER stable d'une persona (slug déterministe). |
| `OutboundKind.ASSISTANT` | Message privé de l'assistant (ou de l'équipe dans une conversation reprise en main). |
| `AiConversationUsage` | Coût de chaque appel à l'IA de conversation (Venice) : persona, conversation (null pour « Tester »), but (REPLY, FOLLOW_UP, SUMMARY, TEST), modèle, jetons, `costEur` (4 décimales), réussite, code d'erreur, essai, identifiant de requête (`CF-RAY`), copie de la source de la conversation (`source`, coût par source après la suppression de la conversation). Le plafond mensuel est la somme de `costEur` depuis le début du mois à Paris (`parisMonthStart` de `packages/chat`). |

Réglage `Setting` `assistant.venice` (forme et lecture tolérante : `packages/chat/src/config.ts`) : clé Venice chiffrée
(`encrypt` de core, jamais renvoyée au navigateur), activation (`off` par défaut, `team`, `all`), modèle par défaut
(`venice-uncensored-role-play`) et de repli (`venice-uncensored-1-2`), température (0,85), longueur maximale (400 jetons),
plafond mensuel (30 €, 0 = aucun appel), réponses par jour et par conversation (60), cache des modèles proposables et sa
date, dernière vérification et dernière erreur. Page Réglages → IA de conversation (`/settings/assistant`, ADMIN). Journal
d'actions : `assistant.settings_saved`, `assistant.key_verified`, `assistant.key_removed`, `assistant.activation_changed`
(jamais la clé) ; familles `persona.*` et `conversation.*` pour l'équipe.

## Phase 19 : agents IA (Grand Chef, Chefs d'équipe, agents)

Migration additive `20261023120000_phase19_agents` : nouvelles tables, colonnes nullables (ou avec défaut) sur
`MediaAsset` et `Post.agentMissionId`. Plan : `docs/AGENTS-ARCHITECTURE.md` ; spécification : `docs/prompts/21-…`.
Équipes (`teamKey`, texte) : `dating`, `casino`, `sports`, `algo` (`TEAM_KEYS` de `@linkaffipro/agents`).

| Table / colonne | Rôle |
| --- | --- |
| `AgentTeamConfig` | Une ligne par équipe (`teamKey` unique, créée par défaut au premier passage) : `enabled`, `simulation` (vrai par défaut : toute publication part sur le canal Test), `paused` + `pausedReason`, `autonomyLevel` (0 je valide tout, 1 les nouveautés, 2 rien), plafonds mensuels en centimes par poste `monthlyBudgetCents` `{ llm, video, image, odds, screenshot }`, consignes de style lues par Rédaction, mots interdits (`string[]`), longueur maximale (900), heures calmes `{ start, end }[]` (Europe/Paris), réglages libres, `consecutiveFailures` (pause automatique à 3), `updatedById`. |
| `ChannelAgentPlan` | Plan d'un canal (`channelId` unique, CASCADE) : équipe, activé (faux par défaut), posts par jour (3), fenêtre `windowStart`/`windowEnd` (« HH:MM » Paris), espacement minimal (90 min), mélange `{ video, photo, text }`, persona, campagne (bouton Offre), thèmes. |
| `AgentMission` | Une mission (`AgentMissionKind` POST / BET / REPORT / ANALYSIS) : équipe, canal (SET NULL), statut (`AgentMissionStatus` PENDING, RUNNING, WAITING_VALIDATION, WAITING_HUMAN, DONE, FAILED, CANCELLED, BLOCKED_BUDGET), étape en cours et `steps` (`{ agent, status, startedAt, endedAt, summary, costCents, error }[]` : reprise après un redémarrage), `payload` (texte, média, créneau, verdict, motifs), coût, `postId` (unique, posé AVANT l'envoi : jamais deux publications), validation en cours, `scheduledFor`, jour du plan `planDay` (AAAA-MM-JJ Paris), `isTest` (« Créer une mission de test »), `createdBy` (`AgentMissionCreator` GRAND_CHEF / HUMAN) et `createdById`, essais, dernière erreur, `lastActivityAt` (reprise des missions muettes depuis 15 min). |
| `AgentRun` | Chaque passage d'un agent : mission (CASCADE), clé de l'agent, index de l'étape, statut (RUNNING / OK / ERROR / SKIPPED), début, fin, durée, coût, résumés d'entrée et de sortie (jamais le texte complet d'un post), erreur. |
| `AgentValidation` | Élément soumis à une décision humaine : numéro court `number` (« ok 12 » sur Telegram), mission (CASCADE), équipe, aperçu, média, motif, statut (`AgentValidationStatus` PENDING, APPROVED, REJECTED, EDITED, EXPIRED), qui, par où (`AgentDecisionVia` SITE / TELEGRAM), quand, motif du refus, message Telegram de l'aperçu, `awaitingEditAt` (« ✏️ Corriger » : le prochain message texte de l'admin remplace le texte), texte corrigé, rappel envoyé. |
| `AgentUsage` | Dépense par équipe, fournisseur (`llm`, `video`, `image`, `odds`, `screenshot`) et mois (AAAA-MM Paris), unique `(teamKey, provider, month)` : centimes, appels, alertes 80 % et 100 % déjà envoyées. |
| `HumanRequest` | Demande au client par le bot du dialogue admin (`HumanRequestKind` SECRET, TEXT, CHOICE, MEDIA, CONFIRM) : ce qui est demandé (`key`), question, options, attendu (MEDIA : nombre, mots-clés), statut (`HumanRequestStatus` QUEUED → PENDING → ANSWERED / SKIPPED / EXPIRED : une seule PENDING à la fois), résumé de la réponse (jamais un secret : « …ab12 »), envoi, message Telegram, rappel, réponse, mission qui attend, suite à donner `onAnswer`. |
| `MediaUsage` | Utilisation d'un média de la médiathèque : média, canal (CASCADE), post, mission, date (jamais deux fois en 30 jours sur un même canal). |
| `MediaAsset.teamKey`, `theme`, `personaId`, `kind` (`MediaAssetKind` SOURCE / GENERATED / PHOTO / REFERENCE), `origin` (`MediaAssetOrigin` HUMAN / AI), `tags`, `libraryMessageId` | Classement de la médiathèque (dépôt par le bot avec mots-clés) ; copie facultative dans le canal Telegram « Médiathèque ». Les octets restent dans `MediaAsset.bytes`. |
| `Post.agentMissionId` (index, SET NULL) | Mission qui a produit ce message. |

Réglages `Setting` : `agents.pausedAll` (pause générale), `agents.models` (modèles rapide et fort), `agents.libraryChannelId`
(canal Médiathèque), `agents.dailyReport` (rapport du matin oui / non), `agents.dailyReportAsked`, clés des fournisseurs
chiffrées (`packages/agents/src/human/secrets.ts`, jamais renvoyées au navigateur ni journalisées). Événements `Event` de
la famille « Agents » : types `agents.*` (identifiants et résumés, jamais le texte complet d'un post) ; rapport du jour
`agents.report.daily` (`{ day, lines }`). Conservation : missions et passages de plus de 24 mois purgés la nuit.

## Phase 20 : équipe Dating des agents

Migration additive `20261023180000_phase20_agents_dating`.

| Table / colonne | Rôle |
| --- | --- |
| `Persona.referenceImageIds` (JSON `string[]`), `loraUrl`, `loraTrigger`, `loraScale` (0,8), `mediaNotes` | Médias du personnage : 1 à 3 images de référence (`MediaAsset` REFERENCE ; la première sert au remplacement vidéo), fichier LoRA (adresse) et mot déclencheur pour les photos, consignes de tenue et d'ambiance. |
| `MediaAsset.sourceAssetId`, `providerJobId`, `providerName`, `resolution` (index `(personaId, kind)`) | Média produit par un fournisseur (vidéo GENERATED ou photo PHOTO, origine AI) : vidéo source d'origine, travail chez le fournisseur, résolution. |

Réglages de l'équipe Dating dans `AgentTeamConfig` : `monthlyBudgetCents.video` (10 000 par défaut), `.image` (1 500),
`settings.videoProvider` (`fal` / `magichour`), `settings.videoResolution` (580p par défaut). `ChannelAgentPlan.mix`
Dating par défaut `{ video: 1, photo: 2, text: 1 }`, `personaId` obligatoire.

## Phase 21 : équipe Algorithme

Migration additive `20261023200000_phase21_agents_algorithme`.

| Table / colonne | Rôle |
| --- | --- |
| `PostInsight` (`postId` unique, CASCADE) | Fiche de résultats d'un post envoyé, recalculée chaque nuit : vues à 1 h / 2 h / 24 h (interpolées depuis `PostViewSample`, null sans relevé), vues finales, transferts, réactions, clics, clics sur l'offre, inscriptions, premiers dépôts, dépôts ; caractéristiques : format (VIDEO, PHOTO, ALBUM, TEXT), thème, catégorie, persona, univers, longueur, emojis, boutons, heure et jour de Paris, variante A/B, mission d'agent, modèle, test. |
| `Experiment` (`ExperimentKind` STYLE_LEGENDE / HORAIRE / MELANGE / REGLAGE_PERSONA, `ExperimentStatus` PROPOSED / RUNNING / CLOSED / CANCELLED) | Test de deux versions : équipe, canal ou persona, hypothèse, variantes, mesure, taille minimale, dates, résultat (effectifs, taux, seuil de 5 %), gagnant (A, B ou NONE), recommandation née du test. Un seul actif par canal et par type. |
| `Recommendation` (`RecommendationStatus` PROPOSED / APPLIED / UNDONE / REJECTED, `RecommendationAppliedBy` GRAND_CHEF / HUMAN) | Réglage proposé : cible (CHANNEL_PLAN, TEAM_CONFIG, PERSONA) et son identifiant, champ, valeur avant (pour l'annulation en un clic) et après, preuves, gain attendu, taille (SMALL : horaires, mélange ; BIG : persona, quota), qui l'a appliqué / annulé / refusé et quand. |
| `InsightReport` (unique `(teamKey, weekStart)`) | Rapport « Ce qui marche » d'une équipe pour une semaine (lundi, Paris) : texte envoyé, chiffres (dont `stats.conversations`, chiffres par profil de conversation). |
| `ChannelAgentPlan.suggestedWindows`, `.styleNotes` | Fenêtres suggérées par l'agent Horaires ; consigne « ce qui marche ici » lue par la Rédaction. |
| `Persona.suggestedFollowUpHours` | Heures de relance conseillées ; lues par le moteur de relances seulement si une recommandation les a appliquées. |
