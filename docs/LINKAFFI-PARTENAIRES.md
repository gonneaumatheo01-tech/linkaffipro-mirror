# Campagnes Telegram des affiliés Link Affi — contrat entre la plateforme et Link Affi

Version 2, décidée le 14 octobre 2026 (remplace la version « partenaires » du même jour). Ce fichier est la référence commune : le prompt Claude Code (phase 13) et le prompt Lovable (Link Affi) le suivent tous les deux.

## L'idée
- Les **affiliés de Link Affi** (ceux qui existent déjà, avec leur espace) peuvent travailler sur **nos canaux Telegram**.
- **C'est l'admin, dans Link Affi**, qui crée pour un affilié une **campagne de type Telegram**, dans la partie Campagnes qui sert déjà à créer les liens vers les casinos. Il choisit le canal ; Link Affi demande à notre plateforme un lien d'invitation dédié ; le lien Link Affi (`linkaffi.me/go/<clé>`) redirige vers ce lien Telegram.
- L'affilié partage son lien comme n'importe quel lien Link Affi. Les clics sont comptés par Link Affi comme d'habitude.
- Les personnes qui entrent dans le canal par ce lien deviennent « membres de l'affilié ». Quand elles cliquent un bouton d'offre du bot puis s'inscrivent et font leur FTD, **ces inscriptions et FTD apparaissent dans les stats normales de l'affilié**, sous sa campagne Telegram.
- Dans la partie **Joueurs** de Link Affi, l'affilié voit **les demandes d'adhésion, les pseudos et le parcours** de ses membres (demande → accepté → dans le canal → clic sur une offre → inscription → FTD → dépôts → départ). L'admin voit tout, avec l'affilié de chacun.
- Seuls les canaux pour lesquels l'admin a créé une campagne Telegram ont des affiliés.

## Échanges techniques
### 1. Link Affi → plateforme (API d'intégration de la plateforme)
- Base : `https://app.linkaffipro.com/api/integrations/linkaffi/v1`
- Authentification : en-tête `Authorization: Bearer <LINKAFFIPRO_API_KEY>` (clé générée par un ADMIN dans la plateforme, Réglages → Connecteurs → Link Affi, à coller dans les secrets de Link Affi).
- `GET /channels` → `[{ id, title, username, vertical, isActive }]` : canaux proposables (canaux actifs où au moins un de nos bots peut créer des liens).
- `POST /invite-links` avec `{ campaignKey, campaignName, affiliateId, affiliateName, channelId, attributionDays }` → `{ inviteLinkId, url }` (`attributionDays` : durée d'attribution en jours, absente ou 0 = à vie ; à envoyer pour qu'une campagne à durée limitée le soit aussi chez nous). `campaignKey` = la clé du lien de **cet affilié** (celle de `linkaffi.me/go/<clé>`) : une clé = un affilié = un lien d'invitation. Idempotent : même `campaignKey` + `channelId` = même lien. Le lien est créé par notre bot **avec demande d'adhésion**, nommé d'après la campagne (32 caractères max).
- `PATCH /invite-links/{inviteLinkId}` avec `{ isActive: false }` → désactive et révoque le lien Telegram (les attributions passées restent).
- `GET /members?campaignKey=<clé>&since=<ISO>` → membres et événements de cette campagne (rattrapage si un événement s'est perdu).
- Erreurs en JSON `{ error, message }` lisible en français ; limite 60 requêtes / minute.

### 2. Plateforme → Link Affi (événements des membres)
- Adresse : `https://igqzbemzzxvuehwnyotn.supabase.co/functions/v1/telegram-events` (fonction `telegram-events` de Link Affi ; modifiable dans la plateforme).
- En-têtes : `apikey` et `Authorization: Bearer` = clé anon de Link Affi (comme pour `stats-api`), plus `X-Signature: sha256=<HMAC-SHA256 du corps brut avec LINKAFFIPRO_WEBHOOK_SECRET>` et `X-Event-Id`.
- Corps : `{ eventId, type, occurredAt, campaignKey, channel: { id, title }, member: { telegramUserId, username, firstName, languageCode }, data }`.
- Types : `join_requested`, `join_approved`, `join_declined`, `join_expired`, `joined`, `left`, `offer_clicked` (`data: { subId, offerCampaignKey }`).
- Envoi par file d'attente, nouvelles tentatives (attente croissante, 24 h), `eventId` unique : Link Affi ignore un doublon. Réponse attendue `2xx`.
- Lien membre ↔ joueur : Link Affi rapproche `offer_clicked.subId` de `players.sub_id` (mécanisme sub-ID existant).

### 3. Offres : créditer l'affilié
- Quand un membre rattaché à une campagne Telegram d'affilié clique un bouton d'offre, notre lien vers Link Affi devient : `https://linkaffi.me/go/<offerCampaignKey>?sub_id=<SUB_ID>&tg=<telegramCampaignKey>`.
- Link Affi : si `tg` désigne une campagne Telegram active (et que l'offre fait partie des offres autorisées pour elle : toutes par défaut, liste réglable par l'admin), le clic, puis le joueur, l'inscription, le FTD et les dépôts sont comptés **pour l'affilié propriétaire de la campagne Telegram**, exactement comme s'il avait amené le joueur avec son propre lien (mêmes règles de commission, managers compris), **sans double comptage** chez l'admin. Sinon, `tg` est ignoré et rien ne change.
- `tg` n'est jamais transmis au casino ; le sub-ID part comme aujourd'hui.

## Règles d'attribution (par défaut)
- Premier affilié gagne : un membre déjà rattaché ne change pas d'affilié ; correction manuelle par un ADMIN (journalisée).
- Une personne déjà membre du canal avant de cliquer le lien n'est pas attribuée.
- À vie, sauf durée fixée sur la campagne Telegram.
- Seuls les boutons d'offre du bot (sub-ID par membre) créditent l'affilié ; un lien d'offre anonyme dans un post sans boutons (post publié par le compte Telegram avec emojis animés) ne le peut pas.

## Exception à la règle « Link Affi en lecture seule » (décidée le 14 octobre)
La plateforme reste en lecture seule sur l'API `stats-api`. Deux échanges seulement s'y ajoutent, voulus par le client et construits par Link Affi lui-même : Link Affi appelle notre API d'intégration (§ 1), et la plateforme envoie les événements des membres à la fonction `telegram-events` (§ 2). Aucune autre écriture, jamais.

## Données personnelles
L'affilié ne voit que les membres entrés par ses propres liens : prénom Telegram, pseudo, statut, dates, parcours. Jamais le numéro de téléphone, jamais les membres des autres.

## Annexe — précisions de la plateforme (14 octobre, phase 13 construite)
À transmettre au développeur de Link Affi : ce que notre côté fait exactement, en plus du contrat ci-dessus.

**Réponses de l'API d'intégration**
- Toutes les réponses sont en JSON (`Cache-Control: no-store`). Erreur : `{ error, message }` (code stable en anglais, phrase en français), plus `details: [{ field, message }]` pour un corps invalide.
- Codes : `unauthorized` 401 (clé absente ou fausse ; la clé est vérifiée avant tout le reste), `method_not_allowed` 405 (en-tête `Allow`), adresse inconnue 404 `not_found`, `rate_limited` 429 (en-tête `Retry-After`), `invalid_json` / `invalid_body` / `invalid_query` 400, `payload_too_large` 413, `channel_not_found` / `invite_link_not_found` / `campaign_not_found` / `not_found` 404, `affiliate_mismatch` 409 (la même `campaignKey` envoyée avec un autre `affiliateId`), `invite_link_disabled` 409 (lien désactivé : une nouvelle campagne = une nouvelle clé), `reactivation_refused` 409, `no_bot` / `telegram_refused` 422, `telegram_unavailable` 503 (`Retry-After: 60`), `internal_error` 500.
- `POST /invite-links` répond `{ inviteLinkId, url, isActive, channelId, campaignKey }` (201 à la création, 200 si le lien existait déjà). Champs acceptés : `campaignKey`, `campaignName`, `affiliateId` (texte ou nombre), `affiliateName` (facultatif), `channelId`, `attributionDays` (facultatif, 0 à 3650 ; 0 ou absent = à vie). Un champ inconnu est ignoré. `affiliateName` et `attributionDays` absents d'un nouvel appel pour un lien existant ne changent rien ; `null` (ou 0 pour la durée) les vide (pas de nom, attribution à vie). Corps invalide : un champ absent est annoncé « obligatoire » ; un champ du mauvais type est annoncé avec le type attendu et le type reçu.
- `PATCH /invite-links/{inviteLinkId}` avec `{ isActive: false }` répond `{ inviteLinkId, isActive: false, revokedOnTelegram, … }` ; si Telegram refuse la révocation, le lien est quand même désactivé chez nous (`revokedOnTelegram: false`). Sur un lien déjà désactivé : 200 avec `revokedOnTelegram` = le résultat de la révocation d'origine (`true`, `false`, ou `null` si inconnu). Une campagne désactivée ne rattache plus personne, même si son ancien lien marche encore chez Telegram.
- `GET /members?campaignKey=…&since=<ISO>` répond `{ members, events, hasMoreEvents, nextSince, membersTruncated }`. `members` : `telegramUserId` (texte), `username`, `firstName`, `languageCode`, `channel`, `inviteLinkId`, `status` (`requested`, `approved`, `joined`, `left`, `declined`, `expired`, `unknown`) et les dates `attributedAt`, `attributionEndsAt`, `requestedAt`, `approvedAt`, `joinedAt`, `leftAt`, `declinedAt`. `events` : les corps des événements tels qu'envoyés (même forme que § 2), depuis `since` inclus, du plus ancien au plus récent, 1 000 au plus par appel ; s'il y en a plus, `hasMoreEvents: true` et rappeler avec `since = nextSince`.

**Événements**
- `telegramUserId` est envoyé en texte (entier 64 bits sans perte). `data` vaut `{}` sauf pour `offer_clicked` (`{ subId, offerCampaignKey }` ; `offerCampaignKey` peut être `null` si l'offre cliquée n'est pas une offre Link Affi).
- `left` est aussi envoyé quand un membre est exclu ; `join_expired` aussi quand la personne retire elle-même sa demande.
- **Événement de test** (bouton « Envoyer un événement de test » de la plateforme) : `type: "test"`, `campaignKey: "test"`, `channel: { id: "test", title: "Test LinkAffi Pro" }`, `member.telegramUserId: "0"`, `data: { test: true, message }`, signé et envoyé avec les mêmes en-têtes que les vrais événements. La fonction `telegram-events` doit vérifier la signature puis **répondre 2xx sans rien enregistrer** pour ce type. Notre écran affiche : 2xx = « Reçu », 401 ou 403 = « Signature refusée », 404 / 5xx / pas de réponse = « Injoignable », autre 4xx = « Reçu mais refusé ».
- Données personnelles : quand un membre est supprimé à sa demande (ou après la durée de conservation), ses événements pas encore partis ne partent jamais et son identité est effacée de ceux déjà enregistrés (`telegramUserId` « 0 », pseudo, prénom et langue vides) ; quand un administrateur retire ou change l'affilié d'un membre, ses événements en attente pour l'ancien affilié ne partent plus, et `GET /members` ne les renvoie pas non plus (seuls les événements déjà envoyés restent lisibles). `GET /members` ne renvoie pas les membres supprimés.
- Une demande que le bot n'a pas pu accepter après plusieurs essais est envoyée comme `join_expired`.
