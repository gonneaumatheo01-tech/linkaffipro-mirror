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

## Phase 1 (prévue, noms réservés)

| Table | Rôle prévu |
| --- | --- |
| `Membership` | Appartenance d'un membre à un canal : demande d'adhésion (`requestedAt`), approbation (`approvedAt`, `approvedBy` bot/humain), départ, lien d'invitation d'origine (`inviteLinkId`), pub d'origine. |
| `ApprovalRule` | Règle d'approbation par canal : immédiate / après délai / après « gate » (canaux à rejoindre), délai en minutes, activation. |
| `InviteLink` | Lien d'invitation Telegram créé par la plateforme (avec demande d'adhésion), rattaché à un canal et à une campagne/pub ; compteurs. |
| `TrackingLink` | Lien court go.goolink.eu (`slug` base62 8 caractères) → cible (lien d'invitation, bot, offre), campagne, pub, paramètres conservés. |
| `Click` | Clic sur un lien go.goolink.eu ou un bouton de message : `trackingLinkId`, `postButtonId`, `memberId`, `subId` (unique par membre et par message, transmis à Link Affi), `ipHash`, `userAgent`, `isBot`, `clickIds`, `utm`. |
| `Post` | Message programmé pour un canal : contenu multilingue, média, date/heure, statut, `telegramMessageId` après envoi. |
| `PostButton` | Bouton d'un message : libellé, type (URL / deep link bot / offre), cible, compteur. |
| `PostStats` | Agrégats par message : vues (MTProto, plus tard), clics, membres, inscriptions, FTD, dépôts, NGR. |
| `MessageCategory` | Catégorie de modèles de messages (accueil, offre, rappel…). |
| `MediaAsset` | Média réutilisable (photo, vidéo) stocké via un canal « médiathèque » Telegram (`file_id`). |
| `Sequence` / `SequenceStep` | Séquence automatique de messages privés (accueil, relances) : étapes, délais, conditions. |
| `OutboundMessage` | Tout message privé envoyé par un bot : destinataire, contenu, statut (envoyé, échoué, bloqué), erreur Telegram, `retry_after`. |
| `AffiliateProgram` | Programme d'affiliation (Link Affi `casinos`) : nom, univers, devise, connecteur. |
| `AffiliateCampaign` | Campagne / lien de suivi Link Affi (`campaigns`) : clé (`47eb8mwc`), URL de base, programme, affilié. |
| `Player` | Joueur rattaché par sub-ID : identifiant externe, inscription, FTD, dépôts cumulés, NGR, membre, message, canal, pub d'origine. |
| `PlayerEvent` | Événement joueur brut (inscription, FTD, dépôt, redépôt, invalidation) avec montant, devise, horodatage, `raw` JSON. |
| `SyncState` | Curseur de synchronisation par table Link Affi : dernière réussite, lignes importées, dernière erreur. |
| `Campaign` | Pub (TikTok / Meta / autre) : plateforme, identifiants externes, coûts importés ; parent de `TrackingLink` et `InviteLink`. |

Règles : conservation 24 mois (purge à prévoir en phase 2), suppression d'un membre sur demande (fonction prévue : anonymisation de `Member` et des `Event` liés).
