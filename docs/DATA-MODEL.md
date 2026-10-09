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
| `AutomationRule` | Règle « si… alors… ». | `trigger` (JOINED, OFFER_CLICKED, REGISTERED, DEPOSITED, INACTIVE, LEFT, SPEND_LEVEL_REACHED), `conditions` JSON (canaux, pubs, langues, niveaux, inactivité, catégories), `actions` JSON ordonnées (send_message, send_sequence, wait, tag, suggest_channel, notify_team), `isActive`, `oncePerMember`, `runs`, `lastRunAt` |
| `AutomationRun` | Exécution d'une règle pour un membre (journal + reprise des « attendre »). | `status` (PENDING, RUNNING, DONE, FAILED, SKIPPED, CANCELLED), `step`, `resumeAt`, `context`, `log`, `error` |
| `Broadcast.abGroupId` / `abVariant` / `abSplit` | Test A/B : variantes d'un même test et part des destinataires. | — |
