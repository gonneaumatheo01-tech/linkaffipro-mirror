# Pages d'atterrissage (phase 15) — contrat technique partagé

Demande du client et précisions : `docs/prompts/17-phase-15-pages-atterrissage.md` (prioritaire). Ce fichier fixe les
noms communs pour que les parties avancent en parallèle sans se marcher dessus. Toute décision nouvelle va dans
`docs/DECISIONS-TECH.md` (section « Phase 15 »).

## Données (migration `20261015061843_phase15_pages_atterrissage`, déjà écrite et appliquée en local)
- `LandingPage` (slug unique, name, channelId, language, headline, subtext?, buttonText?, footnote?, showPhoto,
  cookieBanner, tiktokPixelId?, metaPixelId?, isActive, version, createdById).
- `LandingSource` (landingPageId, key — "" = source par défaut —, inviteLinkId? unique = lien actuel, linkError?,
  adId?, isActive). Unique (landingPageId, key).
- `InviteLink.kind = LANDING` + `landingPageId` + `landingSource` (clé de la source). Un lien révoqué garde sa page et
  sa source. `InviteLink.landingAdId` (correction D9, migration `20261015105038_phase15_pub_figee_liens`) : pub pour
  laquelle le lien a été créé, figée avec sa campagne (`campaignId`) ; la pub d'une source change → nouveau lien.
  `LandingSource.linkTriedAt` : dernier essai de création du lien.
- `LandingEvent` (append-only) : VIEW / CLICK / OPENED, visitId, sourceKey, rawSrc?, os, inApp, method, country,
  ipHash, isBot, ttclid, fbclid, userAgent. Jamais d'adresse IP.
- `ApprovalSourceKind` `LANDING_ANY` (toute page) et `LANDING_PAGE` (+ `ApprovalRule.landingPageId`, sans clé
  étrangère : « page supprimée » affiché).
- `Channel.photoSmall` (octets JPEG 160 px), `photoFileUniqueId`, `chatCheckedAt` (dernière relecture `getChat`).

## Adresses
- Page : `https://go.goolink.eu/j/<slug>?src=<source>` (le domaine `goolink.eu` nu ne pointe pas vers Railway).
  Aucune redirection avant la page (pas de barre oblique finale, pas de 30x).
- Sur l'hôte de tracking, `decideRoute` réécrit `/j/…` vers `/j/…` (et non `/r/j/…`) ; `/j/` est aussi un chemin
  public sur l'hôte du site (essais, aperçu).
- Chemins réservés sous `/j/` : tout segment qui commence par `_` (ex. `/j/_e` pour l'envoi des visites et clics,
  `/j/_p/<channelId>.jpg` pour la photo). Un slug ne commence jamais par `_`.
- Slug : `^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$` (3 à 48 caractères). Clé de source : `^[A-Za-z0-9_-]{1,32}$`,
  comparée sans tenir compte des majuscules (enregistrée en minuscules).

## Règles pures communes : `packages/core/src/landing.ts` (exportées par l'index de core, sans dépendance Node)
- `LANDING_SLUG_RE`, `isValidLandingSlug`, `slugifyLanding(name)`, `normalizeSourceKey(raw)` (→ clé ou null),
  `pickLandingSource(sources, src)` (source demandée active avec lien → elle ; sinon la source par défaut ""),
  `landingInviteLinkName(pageName, sourceKey)` (« <page>-<source> », 32 caractères au plus, jamais vide),
  `isValidTikTokPixelId`, `isValidMetaPixelId`, `LANDING_LANGS` + `landingDefaults(lang)` (bouton, petite ligne
  d'exemple, bandeau cookies : accepter / refuser / texte) pour les 6 langues du bot, `detectLandingOs(ua)`,
  `detectInApp(ua)`, `inviteHashOf(telegramInviteLink)` (« AbC… » de `https://t.me/+AbC…`),
  `landingRates({ visits, clicks, requests, approved, spend })` → `{ clickRate, visitToJoin, costPerJoin }`
  (null quand le dénominateur vaut 0 ; « join » = demande d'adhésion).
- Rendu : `packages/core/src/landing-render.ts` : `renderLandingHtml(input)` → chaîne HTML complète (CSS et script en
  ligne, polices système, aucun framework), PURE et identique pour tout visiteur (aucune lecture du navigateur côté
  serveur). Utilisé par la route publique et par l'aperçu en direct de la rubrique Pages.

## Provenance (phase 11) : `packages/core/src/provenance.ts`
- `ProvenanceType` gagne `"LANDING"` ; `Provenance.landing?: { pageId: string | null; sourceKey: string | null }` ;
  `ProvenanceLink.kind` gagne `"LANDING"` avec `landingPageId?`, `landingSource?`.
- `sourceKindMatches` : `LANDING_ANY` = toute provenance LANDING ; `LANDING_PAGE` = même `pageId` que
  `ApprovalRule.landingPageId`. Accueil normal (comme une pub).

## Files et Redis : `packages/queue`
- Nouvelle file `landing-events` : tâche `{ type: "event", … }` (un `LandingEvent` à écrire) ; `enqueueLandingEvent`.
- Invalidation du HTML en mémoire : canal Redis `landing:invalidate`, message JSON `{ pageId?, channelId?, all? }`,
  `publishLandingInvalidate(msg)` (ne lève jamais) et `subscribeLandingInvalidate(handler)` (connexion Redis dédiée,
  reconnexion automatique). Publié à chaque enregistrement d'une page ou d'une source, à chaque changement de titre ou
  de photo d'un canal (bot : `upsertChannel` ; worker : relecture `getChat`).

## Liens d'invitation
- Un lien `LANDING` par source, créé par le bot de l'univers du canal (bot dont `vertical` = celui du canal et
  administrateur avec le droit d'inviter), sinon par un autre de nos bots administrateurs (même ordre de repli que
  `createJoinRequestLink` de `apps/web/lib/channels/share-links.ts`, qu'on réutilise), `creates_join_request = true`,
  nom `landingInviteLinkName`. Compteurs et provenance existants servis tels quels (pas de second système).

## Comptage
- Visite = VIEW d'un vrai navigateur (envoyé par la page après l'affichage, `sendBeacon`), comptée une fois par
  `visitId`, robots connus jamais comptés. Clic = CLICK (un par `visitId` au plus dans les chiffres). % d'ouverture de
  Telegram = premiers CLICK de chaque visite suivis d'un OPENED de la même façon avant le CLICK suivant ÷ premiers
  CLICK (seul le premier appui est tiré au sort ; un nouvel appui prend l'autre façon et n'entre pas dans la
  comparaison ; même total que la colonne « Clics »), par système, puis par navigateur (`LandingEvent.inApp`) et façon
  d'ouvrir : les façons d'ouvrir ne se comparent que dans un même navigateur intégré (là où la page les tire au sort). Demandes et
  acceptés : `Membership` dont `inviteLinkId` est un lien LANDING de la page / source, demandes faites dans la période
  (acceptés = ces demandes acceptées depuis). Visites dont `?src=` n'a pas été suivi (`rawSrc` : source inconnue,
  retirée ou pas prête) : comptées dans le lien principal et signalées sous le tableau.
- Coût par join = part de la dépense de la pub (`AdCost` niveau `ad:<id>`, EUR) ÷ demandes ; « — » sans pub. La pub
  est celle figée sur chaque lien (`landingAdId`, D9). Sa dépense est partagée entre tous ses chemins d'arrivée (son
  lien direct `Ad.inviteLinkId` et les liens de toutes les pages créés pour elle), jour par jour, au prorata des
  arrivées (clics humains sur le lien direct, visites humaines par le lien de la source), sinon des demandes du jour,
  sinon de la période (`allocateAdSpend`, `apps/web/lib/landing/stats.ts`) : jamais comptée deux fois. Aucune ligne
  `ad:<id>` sur la période : dépense inconnue (« — » avec la raison : saisie pour toute la campagne ou le groupe, ou
  aucune), jamais 0 €. Dépense sans aucune demande : « X € · aucun join ».
- Statistiques journalières (`DailyStat`) : demandes d'un lien LANDING → pub et campagne figées sur le lien ; visites
  humaines (une par `visitId`) → « Clics pub » de la pub et de la campagne du lien affiché à ce moment-là.

## Qui fait quoi (périmètres)
- Socle : `packages/core/src/landing.ts`, `landing-render.ts` (squelette rendu + tests), provenance, `packages/queue`
  (file, publication), garde de migration `packages/db/prisma/migrations/phase15-pages-atterrissage.test.ts`.
- Page publique : route `apps/web/app/j/…`, cache mémoire + abonnement Redis, envoi des visites et clics, pays, CSP,
  `lib/routing.ts` + `proxy.ts`, processeur worker `landing-events`, purge, mesures de vitesse.
- Moteur : création des liens (`apps/web/lib/landing/links.ts`), relecture titre / photo (worker), provenance côté bot,
  statistiques journalières des pubs, script de page de test (canal TEST seulement).
- Interface : rubrique « Pages » (`apps/web/app/(admin)/pages/…`, `components/landing/…`, `lib/landing/{stats,…}.ts`),
  menu, exceptions de règles, guide, captures.

## Phase 16 : sortie du navigateur intégré (TikTok, Instagram…)
- Table des menus des applis : `packages/core/src/landing-escape.ts` (`LANDING_ESCAPE_TABLE`, appli × système : coin, décalages, signe, libellé par langue, confiance, sources ; seul TikTok iPhone est confirmé par une capture).
- Script en tout début de `<head>` (code d'invitation dans `<html data-k>`) : reconnaissance du navigateur (aide et flèche seulement), ouverture automatique hors navigateur intégré au `DOMContentLoaded`.
- Paramètres d'adresse posés par la page (jamais lus par le serveur) : `vid` (visite) et `tgt` (minute, base 36, valable 30 min) dès l'affichage dans un navigateur intégré, `tgo=1` à l'appui, `tgd=1` après une ouverture automatique (plus jamais de nouvelle tentative depuis cette adresse).
- Événements : HELP (`method` = appli), ESCAPED (`method` TGO / VID / TTCLID / FBCLID ; `visitId` = `vid`, ou rattaché par le worker au même `ttclid` / `fbclid` dans les 30 min), AUTO_OPEN (AUTO_TG / AUTO_INTENT). Façons d'ouvrir au clic : HTTPS (navigateur normal), TG_FRAME (cadre caché : TikTok, Snapchat, applis inconnues), TG_NAV (applis Meta sur iPhone, dans le geste de l'appui), INTENT_HELP (applis Meta sur Android) ; retirées : TG_SCHEME, INTENT, INTENT_FRAME. Rattachement par `ttclid` / `fbclid` seulement au même système.
- Chiffres : « Aide affichée », « Sortis de TikTok » (dont sans l'aide), « % sortis » (visites aidées puis sorties ÷ aide affichée), « Telegram ouvert après la sortie ».
