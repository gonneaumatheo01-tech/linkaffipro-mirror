Je veux que mes affiliés puissent travailler sur mes canaux Telegram et que tout apparaisse dans Link Affi comme leurs stats normales. Mes canaux et mes bots Telegram sont gérés par ma plateforme interne « LinkAffi Pro » (https://app.linkaffipro.com), qui est déjà branchée à Link Affi par le sub_id. Construis la partie Link Affi décrite ci-dessous, sans rien casser de l'existant (campagnes actuelles, liens, postbacks, sub_id, commissions, espaces affiliés et managers).

## 1. Campagnes : nouveau type de lien « Telegram »
- Dans la partie Campagnes où je crée déjà les liens affiliés vers les casinos et les paris sportifs, ajoute un type de destination **« Canal Telegram »**.
- Formulaire : affilié (mes affiliés existants), canal Telegram (liste chargée depuis ma plateforme, voir § 6), nom, offres autorisées (toutes par défaut, ou une liste de mes offres), durée d'attribution (à vie par défaut, ou N jours).
- À l'enregistrement, côté serveur uniquement (fonction edge, jamais dans le navigateur) : `POST /invite-links` sur ma plateforme avec `{ campaignKey, campaignName, affiliateId, affiliateName, channelId }`. `campaignKey` = la clé du lien de cet affilié, celle de `linkaffi.me/go/<clé>`. Une clé = un affilié = un lien Telegram. Garde `inviteLinkId` et `url`.
- `linkaffi.me/go/<clé>` redirige (302) vers cette `url` Telegram ; le clic est compté comme pour tous mes liens.
- Désactiver la campagne : `PATCH /invite-links/{inviteLinkId}` avec `{ "isActive": false }`, et la redirection ne marche plus.
- Si ma plateforme ne répond pas, message clair et rien n'est créé à moitié.

## 2. Créditer les inscriptions et FTD à l'affilié (paramètre `tg`)
- Quand un membre venu d'une campagne Telegram clique une offre dans mon bot, ma plateforme appellera : `https://linkaffi.me/go/<cléOffre>?sub_id=<SUB_ID>&tg=<cléCampagneTelegram>`.
- Si `tg` désigne une campagne Telegram active et que l'offre est autorisée pour elle : le clic, puis le joueur, l'inscription, le FTD, les dépôts et les commissions sont comptés **pour l'affilié de la campagne Telegram**, exactement comme s'il avait amené le joueur avec son propre lien vers ce casino (mêmes règles de commission, managers compris), **sans double comptage** chez moi.
- Sinon, `tg` est ignoré et tout se passe comme aujourd'hui.
- `tg` n'est jamais transmis au casino. Le sub_id continue de partir et de revenir exactement comme aujourd'hui (même format `<clé>.<sub_id>`), y compris le rapprochement par temps.
- Choisis la façon la plus propre de faire ça avec ton modèle actuel (par exemple un lien affilié créé automatiquement pour cette offre, ou une colonne d'attribution sur le clic et le joueur) et explique-la-moi.

## 3. Recevoir les événements des membres : fonction edge `telegram-events`
- Adresse : `https://igqzbemzzxvuehwnyotn.supabase.co/functions/v1/telegram-events`. Ma plateforme l'appelle avec les en-têtes `apikey` et `Authorization: Bearer` = ta clé anon (comme pour `stats-api`), plus `X-Event-Id` et `X-Signature: sha256=<HMAC-SHA256 du corps brut avec le secret LINKAFFIPRO_WEBHOOK_SECRET>`.
- Vérifie la signature sur le corps brut, avec une comparaison à temps constant ; sinon, réponds 401 et ne stocke rien.
- Corps : `{ eventId, type, occurredAt, campaignKey, channel: { id, title }, member: { telegramUserId, username, firstName, languageCode }, data }`.
- Types : `join_requested`, `join_approved`, `join_declined`, `join_expired`, `joined`, `left`, `offer_clicked` (`data: { subId, offerCampaignKey }`).
- Idempotent : un `eventId` déjà reçu répond 200 sans rien refaire. Réponds 2xx vite ; ma plateforme réessaie pendant 24 h en cas d'échec.
- Nouvelles tables :
  - `telegram_members` : une ligne par membre et par campagne, avec clé de campagne, affilié, `telegram_user_id`, username, prénom, statut actuel, dates de demande, d'acceptation, d'entrée et de départ, et joueur lié s'il existe.
  - `telegram_member_events` : historique, avec `event_id` unique.
- `offer_clicked` : relie le membre au joueur dont `players.sub_id` = `subId`. Le rapprochement se fait aussi si le joueur arrive après l'événement.
- Sécurité : RLS stricte. Un affilié ne lit que les membres de ses campagnes ; l'admin lit tout ; les managers suivent tes règles actuelles. Jamais de numéro de téléphone.

## 4. Stats normales
- La campagne Telegram apparaît dans les stats habituelles de l'affilié et dans les miennes, comme les autres campagnes : clics, inscriptions, FTD, dépôts, commissions.
- Ajoute aussi : demandes d'adhésion, acceptés, membres présents, partis.

## 5. Partie « Joueurs » (existante) : membres Telegram et parcours
- Dans la partie Joueurs qui existe déjà, ajoute un onglet ou filtre **« Telegram »**.
- Liste : pseudo (@username), prénom, canal, statut (demande en attente, accepté, dans le canal, parti, refusé, expiré), date de la demande, campagne, joueur lié (inscrit, FTD, montant). En plus pour l'admin : l'affilié.
- Fiche d'un membre : son **parcours** en frise : demande → accepté → dans le canal → clic sur une offre → inscription → FTD → dépôts → départ, avec les dates.
- **L'affilié ne voit que ses propres membres**, dans son espace. Filtres : canal, statut, période ; recherche par pseudo.

## 6. Branchement à ma plateforme
- API de ma plateforme : base `https://app.linkaffipro.com/api/integrations/linkaffi/v1`, en-tête `Authorization: Bearer <LINKAFFIPRO_API_KEY>`.
  - `GET /channels` → `[{ id, title, username, vertical, isActive }]`.
  - `POST /invite-links` et `PATCH /invite-links/{id}` : voir § 1.
  - `GET /members?campaignKey=…&since=<ISO>` : rattrapage, à appeler une fois par jour et par campagne active pour combler un événement manqué.
  - Erreurs en JSON `{ error, message }`.
- Deux secrets, que je collerai moi-même dans les secrets du projet : `LINKAFFIPRO_API_KEY` et `LINKAFFIPRO_WEBHOOK_SECRET`. Ils sont générés dans ma plateforme (Réglages → Connecteurs → Link Affi). Tant qu'ils ne sont pas posés, le type « Canal Telegram » affiche « Plateforme Telegram non connectée » au lieu de planter.
- Ajoute à la fonction `stats-api` existante (lecture seule, mêmes paramètres) : les tables `telegram_members` et `telegram_member_events`, les campagnes de type Telegram (clé, affilié, `inviteLinkId`, canal, actif), et l'attribution `tg` sur les clics et les joueurs. Ma plateforme compare ainsi ses chiffres avec les tiens.

## 7. À la fin
Réponds-moi avec un récapitulatif que je transmettrai à mon développeur :
- les tables et colonnes créées ;
- comment les FTD sont crédités à l'affilié avec `tg` (le modèle choisi) ;
- l'adresse exacte de `telegram-events` et la réponse attendue ;
- ce que `stats-api` expose en plus (noms exacts) ;
- ce qu'il me reste à faire (coller les deux secrets).
