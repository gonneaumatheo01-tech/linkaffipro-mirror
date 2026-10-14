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
- `POST /invite-links` avec `{ campaignKey, campaignName, affiliateId, affiliateName, channelId }` → `{ inviteLinkId, url }`. `campaignKey` = la clé du lien de **cet affilié** (celle de `linkaffi.me/go/<clé>`) : une clé = un affilié = un lien d'invitation. Idempotent : même `campaignKey` + `channelId` = même lien. Le lien est créé par notre bot **avec demande d'adhésion**, nommé d'après la campagne (32 caractères max).
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
