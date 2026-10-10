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
| `PlayerEvent` | Événement joueur brut. | `type` (CLICK, REGISTRATION, FTD, DEPOSIT, REDEPOSIT, NGR, OTHER), `amount`, `currency`, `occurredAt`, `externalId` (unique par joueur), `raw` |
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

