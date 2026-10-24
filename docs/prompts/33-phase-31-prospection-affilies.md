# Phase 31 — Équipe Prospection (cœur) : trouver, lire, noter et classer les canaux Telegram casino et paris sportifs d'Europe, et livrer chaque jour au client les meilleurs à contacter

Si `docs/STATUS.md` indique déjà « phase 31 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 30), `docs/DECISIONS-TECH.md`, `docs/AGENTS-ARCHITECTURE.md` (toutes les équipes, niveaux d'autonomie, bornes, missions reprenables), `docs/prompts/28-phase-26-boss-telegram.md` et `packages/agents/src/boss/*` (Kevin : catalogue, interprète, mémoire, groupe, `answer.ts`, `BossUnmet`, boutons inline déjà utilisés par la phase 28 pour les shorts), `packages/agents/src/inspiration/sources/web-preview.ts` (phase 27 : lecture de `t.me/s/<nom>`, pagination `before`, débit — à réutiliser, pas à réécrire), `packages/agents/src/inspiration/sources/account.ts` (lecture par compte réel, phase 18 — **non utilisé dans cette phase**, réservé à la phase 32), `packages/agents/src/analysts/*` (phase 29 : scraping web, `TrendEntry`, `ComplianceRule` par pays), `packages/agents/src/qa/*` (phase 30 : `qaCheck`, tout ce qui sort passe par le QA Global), `packages/agents/src/montage/preview.ts` (boutons inline grammY, `callback_data`), le client Link Affi en lecture seule déjà présent dans le dépôt (cherche l'intégration de l'API Link Affi dans `packages/` ; elle sert en phase 32), le worker BullMQ, `packages/ai/` (profils de modèles). Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Ordres de Kevin (phase 33, déjà en place avant cette phase)
La phase 33 (`docs/prompts/35-phase-33-kevin-ordres-equipes.md`) a construit le registre des capacités (`packages/agents/src/orders/`) : toute demande libre de l'admin devient un `TeamOrder` planifié, récapitulé, confirmé si nécessaire, exécuté et suivi. **Cette équipe s'y branche** : déclare ses capacités dans le registre (`capabilities/<equipe>.ts` : description, schéma, limites, `check` avec raisons et replis, `plan`, `run` idempotent, `report`), de sorte que « Kevin, … » en français courant lui parvienne sans entrée de catalogue dédiée. Les entrées de catalogue listées plus bas restent des raccourcis instantanés. `docs/STATUS.md` contient donc la phase 33 en plus des phases citées ci-dessus.

## Étapes
1. Schéma, queue, réglages, dictionnaire des marques et des pays, offres du client.
2. Agent Sourceur : annuaires, recherche web multilingue, réseaux sociaux, graphe Telegram (forwards, mentions, dossiers), dédoublonnage.
3. Agent Enrichisseur : page `t.me/<nom>` (abonnés, description), posts `t.me/s/`, mesures par le code, langue, pays, marques, contacts, authenticité, contrôle local.
4. Agent Évaluateur : score 0-100 transparent, niveaux A/B/C/D, dossier (Opus) pour les meilleurs.
5. Agent Pipeline : statuts, boutons Kevin, « Top 10 du jour », rappels, rapport hebdo, catalogue Kevin, QA Global.
6. Page Prospection (tableau, pipeline, fiche, offres, sources, export), tests, relecture, déploiement, documentation, bilan, `docs/PHASE-DONE`.

## But de la phase
Le client recrute des affiliés qui possèdent des canaux Telegram **casino** et **paris sportifs** partout en Europe. L'équipe Prospection trouve ces canaux toute seule (annuaires, recherche web dans toutes les langues européennes, réseaux sociaux, et surtout le graphe Telegram : forwards, mentions, dossiers de canaux), les lit, mesure leur vraie audience, élimine les faux canaux et les canaux hors Europe, repère quelles marques ils poussent déjà et comment ils gagnent de l'argent, extrait tous les contacts publics, les note de 0 à 100 avec une explication, et livre chaque matin au client les 10 meilleurs à contacter, avec un dossier pour chacun. Le client contacte lui-même ; il met à jour le pipeline en appuyant sur un bouton sous le message de Kevin. **L'équipe ne contacte personne.**

Le client propose aux affiliés du **CPA** ou du **revenue share**, au choix. Les offres du client (marque, verticale, pays acceptés, montant CPA, % revshare) sont enregistrées dans `AffiliateOffer` et servent à mesurer si un canal « colle » avec une offre.

La phase 32 (`docs/prompts/34-phase-32-prospection-avancee.md`) ajoute la veille (affilié lâché, canal en hausse), les réseaux de canaux, la valeur estimée en euros, l'apprentissage à partir des vrais résultats Link Affi, et la recherche par compte réel. Prévois le schéma pour ça (champs nullables, pas de refonte).

## Règles non négociables
1. **Aucun contact direct, jamais.** L'équipe n'envoie aucun message, aucun DM, aucun commentaire, aucune demande d'adhésion ; aucun bot n'écrit à un propriétaire de canal ; aucun compte réel n'est utilisé dans cette phase. Elle produit des listes et des dossiers ; le client fait le commercial. Test adverse obligatoire : aucune fonction de l'équipe ne peut appeler une méthode d'envoi Telegram vers un tiers.
2. **Données publiques uniquement.** Page publique `t.me/<nom>`, aperçu `t.me/s/<nom>`, pages d'annuaires, résultats de recherche, pages liées dans la description (1 niveau). Aucune lecture de liste de membres, aucun canal privé rejoint, aucun lien d'invitation suivi.
3. **Données minimales.** On garde : les chiffres, les dates, les classifications, le résumé en français (200 caractères), les marques et liens d'affiliation détectés, les contacts publics, et au plus 3 extraits de 15 mots comme preuves. Le texte brut des posts est effacé dès l'analyse terminée (jamais écrit en base). Aucun membre, aucun lecteur, aucun profil personnel d'une tierce personne autre que le contact public de prospection (username ou email affichés publiquement pour être contactés).
4. **Débit et respect des sites.** `t.me/<nom>` et `t.me/s/<nom>` : 1 requête toutes les 3 secondes, 100 posts (5 pages) par canal au plus. Annuaires (tgstat, telemetr, telega, tlgrm…) : 1 requête toutes les 10 secondes, `robots.txt` respecté, 403 / captcha → source mise en pause 24 h et signalée à Kevin, jamais de contournement. Sites liés (linktree, site perso) : 1 page, 1 requête. Plafonds journaliers dans les réglages.
5. **Europe seulement par défaut.** Un canal dont l'audience est hors Europe (Brésil, Amérique latine, CIS, Turquie, Inde, Afrique…) est gardé avec `region = NON_EU` mais n'apparaît jamais dans les listes ni dans les comptages, sauf si le client élargit `prospection.countries_scope`. Portugais ≠ Portugal, espagnol ≠ Espagne, anglais ≠ Royaume-Uni : le pays se déduit des **signaux** (marques, compétitions, monnaie, orthographe), pas de la langue.
6. **Zéro faux canal.** Un canal à faux abonnés, à vues achetées, qui ne fait que transférer, ou vide de contenu propre, ne monte jamais en niveau A ou B. Les signaux sont calculés par le code (ratios, variance, forwards) **et** jugés par l'IA (authenticité), les deux doivent concorder pour le niveau A. Les vendeurs de « matchs truqués » / « gains garantis » sont exclus (`SCAM`).
7. **Le code mesure, l'IA décrit, le score s'explique.** Tous les chiffres viennent du code ; l'IA classe, résume, détecte et juge ; le score est une somme de composantes visibles (audience, engagement, adéquation, ouverture, concurrence, joignabilité, pénalités) avec les poids dans les réglages. Un chiffre inventé par l'IA (hors de ce que le code a mesuré) → sortie rejetée (règle des phases 24-30).
8. **Rien ne sort sans le QA Global** (phase 30) : liste du jour, dossiers, rapports, alertes, réponses de Kevin passent par `qaCheck` (`KEVIN_RESPONSE`, `RECOMMENDATION`, `REPORT`).
9. **Pas de conseil juridique.** La légalité du casino en ligne varie par pays (France, Pays-Bas, Allemagne…). L'équipe signale le risque réglementaire d'un pays via les `ComplianceRule` de la phase 29 (champ `regulatoryFlag` sur le prospect) et Kevin ajoute une ligne « vérifie avec un avocat » quand un dossier touche un pays signalé. Elle ne dit jamais « c'est légal » ou « c'est illégal ».
10. **Aucun appel réseau dans les tests.** Pages `t.me`, `t.me/s`, annuaires, linktree, dossiers `t.me/addlist`, résultats de recherche : tout en fixtures ; fausse IA ; faux Telegram pour Kevin.

## Modèles IA par agent (allocation validée)
| Agent / Tâche | Modèle | API model string | Pourquoi |
|---|---|---|---|
| Sourceur — parser annuaires, pages, résultats, dossiers | _(pas d'IA)_ | — | HTML structuré, regex, dédoublonnage |
| Sourceur — générer les requêtes de recherche (24 langues × 2 verticales × intentions) | **Haiku 5.5** | `claude-haiku-5-5` | Traduction de mots-clés, volume élevé, enjeu faible |
| Enrichisseur — mesures, ratios, variance, forwards, extraction de liens et contacts par motifs | _(pas d'IA)_ | — | Calcul pur, testé unitairement |
| Enrichisseur — langue (bibliothèque) puis confirmation si ambiguë | **Haiku 5.5** | `claude-haiku-5-5` | Classification simple |
| Enrichisseur — lecture du contenu : verticale, type, monétisation, marques, contacts, authenticité, risques, résumé | **Sonnet 5.5** | `claude-sonnet-5-5` | Compréhension de 30-50 posts multilingues, jugement qualitatif |
| Évaluateur — score, niveau | _(pas d'IA)_ | — | Formule transparente, poids dans les réglages |
| Évaluateur — dossier des niveaux A (et B les mieux notés), 30 par semaine au plus | **Opus 5.5** | `claude-opus-5-5` | Synthèse à forte valeur, faible volume : audience, géo, marques et depuis quand, monétisation, contact, risques, pourquoi maintenant, questions à poser, structure de deal cohérente avec l'offre |
| Pipeline — textes de liste, rappels, rapport hebdo | **Haiku 5.5** | `claude-haiku-5-5` | Gabarits + données |
| Kevin — routage des commandes prospection | **Haiku 5.5** | `claude-haiku-5-5` | Classification d'intention |
| Kevin — questions complexes (« compare mes prospects FR et IT en casino, lesquels d'abord ? ») | **Opus 5.5** | `claude-opus-5-5` | Croisement multi-critères, comme en phase 29 |
| QA Global — tout ce qui sort | **Fable 5.1** | `claude-fable-5-1` | Phase 30, inchangé |

Profils dans `packages/ai/` ; les appels Haiku de classification avec `max_tokens` ≤ 500 ; jamais de repli d'un appel Opus ou Sonnet vers un modèle inférieur (échec signalé plutôt que résultat dégradé).

## 1. Schéma (`packages/db/prisma/`), queue, réglages, dictionnaires

### `Prospect`
```
model Prospect {
  id                 String   @id @default(cuid())
  // Identité
  username           String?  @unique      // sans @, minuscules ; null si lien d'invitation privé
  telegramId         String?  @unique      // si connu (phase 32, compte réel)
  channelUrl         String   @unique      // forme normalisée https://t.me/<username> ou https://t.me/+<hash>
  kind               ProspectKind          // CHANNEL, GROUP
  title              String
  descriptionRaw     String?               // description publique du canal (c'est un texte public court, gardé tel quel pour relecture des contacts)
  summaryFr          String?               // résumé IA en français, 200 caractères
  // Classification
  vertical           ProspectVertical      // SPORTS, CASINO, BOTH, OTHER
  verticalDetails    Json?                 // { sports: ["foot","tennis"], casino: ["slots","crash","roulette","live","bonus","streams"] }
  contentType        String?               // tips_free, vip_sales, bonus_pushing, streams_clips, news, mixed
  language           String?               // ISO 639-1
  languageConfidence Float?
  countries          Json?                 // ["FR","BE"] par ordre de probabilité
  geoSignals         Json?                 // { brands:[...], leagues:[...], currency:"EUR", spelling:"pt-PT", ... } — preuves
  geoConfidence      Float?
  region             ProspectRegion        // EU, NON_EU, UNKNOWN
  regulatoryFlag     String?               // ex. "FR: casino en ligne non autorisé (ComplianceRule #id)" — depuis la phase 29
  // Mesures (code)
  subscribers        Int?                  // exact, lu sur t.me/<nom>
  postsPerDay        Float?
  medianViews        Int?                  // 30 derniers jours
  avgViews           Int?
  viewRate           Float?                // medianViews / subscribers
  viewVarianceCv     Float?                // coefficient de variation des vues
  forwardRatio       Float?                // part de posts transférés
  reactionRate       Float?                // réactions / vues, si visibles
  commentRate        Float?                // commentaires / vues, si groupe de discussion lié
  linkDensity        Float?                // part de posts avec un lien externe
  postingHours       Json?                 // histogramme 24 cases (Europe/Paris)
  firstSeenPostAt    DateTime?
  lastPostAt         DateTime?
  // Authenticité et risques
  authenticity       ProspectAuthenticity? // REAL, SUSPECT_GENERIC, SUSPECT_BOT, REPOST
  authenticityReason String?
  fakeFlags          Json?                 // ["SUSPECT_FAKE_SUBS","SUSPECT_VIEW_BOT","SUSPECT_BOT_CONTENT","GROWTH_SPIKE"]
  riskFlags          Json?                 // ["SCAM_FIXED_MATCHES","GUARANTEED_WINS","PROMOTES_OUR_BRAND","UNDERAGE_SIGNALS"]
  // Monétisation et concurrence
  monetization       Json?                 // { sellsVip: true, vipPrice: "49€/mois", sellsAds: true, adPrice: "40€/post", pushesAffiliate: true, marketplaceListing: "https://telega.io/..." }
  brands             Json?                 // [{ brand:"1xbet", country:"GLOBAL", links:7, firstSeenAt, lastSeenAt, promoCode:"XYZ", intensity:"HEAVY"|"MEDIUM"|"LIGHT" }]
  hasCompetitor      Boolean  @default(false)
  competitiveState   String?               // FREE, ROTATING, EXCLUSIVE, OURS
  // Contacts
  contactConfidence  ContactConfidence @default(NONE)
  bestContact        String?               // valeur du meilleur contact
  // Score
  score              Int?                  // 0-100
  scoreBreakdown     Json?                 // { audience: 22, engagement: 9, fit: 17, openness: 8, competition: 10, reach: 6, penalties: -5 }
  tier               ProspectTier?         // A, B, C, D
  tierReason         String?               // 1 ligne
  dossier            String?               // texte Opus (A et meilleurs B)
  dossierAt          DateTime?
  matchedOfferId     String?
  matchedOffer       AffiliateOffer? @relation(...)
  // Pipeline
  status             ProspectStatus
  statusChangedAt    DateTime?
  presentedAt        DateTime?             // dernière fois montré dans un Top 10
  snoozedUntil       DateTime?
  contactedAt        DateTime?
  respondedAt        DateTime?
  signedAt           DateTime?
  dealType           String?               // CPA, REVSHARE, HYBRID
  dealTerms          Json?                 // { cpa: 100, revshare: 30, currency: "EUR", exclusive: false, notes: "" }
  linkAffiAffiliateId String?              // phase 32
  networkId          String?               // phase 32
  // Provenance
  sourceType         String                // DIRECTORY, WEB_SEARCH, SOCIAL, GRAPH_FORWARD, GRAPH_MENTION, FOLDER, ANALYSTS, MANUAL, ACCOUNT_SEARCH (phase 32)
  sourceDetail       String?               // url ou requête
  discoveredFromId   String?               // prospect d'origine pour le graphe
  cocitationCount    Int      @default(0)  // nombre de canaux qualifiés qui le mentionnent / transfèrent
  discoveredAt       DateTime @default(now())
  enrichedAt         DateTime?
  lastEnrichedAt     DateTime?
  enrichError        String?
  contacts           ProspectContact[]
  notes              ProspectNote[]
  events             ProspectEvent[]
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

enum ProspectKind { CHANNEL GROUP }
enum ProspectVertical { SPORTS CASINO BOTH OTHER }
enum ProspectRegion { EU NON_EU UNKNOWN }
enum ProspectAuthenticity { REAL SUSPECT_GENERIC SUSPECT_BOT REPOST }
enum ContactConfidence { NONE LOW MEDIUM HIGH }
enum ProspectTier { A B C D }
enum ProspectStatus {
  DISCOVERED      // trouvé, pas encore lu
  ENRICHING       // en cours
  UNREADABLE      // lien privé, aperçu absent, page introuvable
  ENRICH_FAILED   // erreur technique (retenté une fois)
  QUALIFIED       // score ≥ seuil, visible dans les listes
  DISQUALIFIED    // score < seuil, faux, hors Europe, mort, scam (raison dans tierReason)
  CONTACTED       // le client a dit « contacté »
  RESPONDED       // a répondu
  NEGOTIATING
  SIGNED
  ACTIVE          // produit des résultats (phase 32 : Link Affi)
  CHURNED
  SKIPPED         // « pas intéressé » (bouton), peut revenir plus tard
  BLACKLISTED     // ne plus jamais montrer
}
```

### `ProspectContact`
```
model ProspectContact {
  id          String   @id @default(cuid())
  prospectId  String
  prospect    Prospect @relation(...)
  type        ProspectContactType  // TELEGRAM_USERNAME, EMAIL, WEBSITE, BOT, SOCIAL, MARKETPLACE, LINKED_GROUP, OTHER
  value       String
  label       String?              // "contact pub", "admin", "signature des posts", "linktree", "telega.io"
  source      String               // description, pinned, signature, linked_page:<url>, directory:<url>, posts
  confidence  ContactConfidence
  evidence    String?              // extrait ≤ 15 mots
  createdAt   DateTime @default(now())
  @@unique([prospectId, type, value])
}
```

### `ProspectNote`, `ProspectEvent`
```
model ProspectNote { id, prospectId, note String, authorType String @default("client"), createdAt }
model ProspectEvent {
  id          String   @id @default(cuid())
  prospectId  String
  type        String   // DISCOVERED, ENRICHED, SCORED, PRESENTED, STATUS_CHANGED, NOTE, ALERT (phase 32), REMINDER
  payload     Json?    // { from, to, by: "client"|"system", ... }
  createdAt   DateTime @default(now())
}
```

### `AffiliateOffer` — les offres du client
```
model AffiliateOffer {
  id            String   @id @default(cuid())
  brand         String               // nom de la marque (casino / bookmaker)
  vertical      ProspectVertical     // SPORTS, CASINO, BOTH
  countries     Json                 // pays acceptés ["FR","BE","CH"]
  dealTypes     Json                 // { cpa: 100, revshare: 30, hybrid: { cpa: 50, revshare: 15 } } — montants en EUR
  trackingHint  String?              // domaine / motif de lien Link Affi pour reconnaître nos liens (phase 32)
  notes         String?
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```
Au premier démarrage, si aucune offre n'existe, Kevin demande au client en 3 questions courtes (marque ; pays acceptés ; CPA et/ou revshare) et crée l'offre. Sans offre, l'adéquation est calculée sur « Europe, verticale » seulement et Kevin le dit.

### `ProspectSourceRun` — journal des sessions de découverte
```
model ProspectSourceRun { id, sourceType, sourceDetail, languages Json, vertical, started, finished, found Int, newCount Int, duplicates Int, errors Json?, pausedUntil DateTime? }
```

### Dictionnaires (fichiers du dépôt, versionnés, testés)
- `packages/agents/src/prospection/dict/brands.json` : marques par pays avec type (bookmaker / casino / les deux) et statut (licencié local / global-offshore). Point de départ à compléter : FR Winamax, Betclic, Unibet, PMU, ParionsSport, ZEbet, Bwin, Netbet, Vbet ; UK bet365, William Hill, Ladbrokes, Coral, Paddy Power, Betfair, Sky Bet, Betfred, 888 ; DE/AT Tipico, bwin, Betano, Interwetten, bet-at-home, Admiral, win2day ; ES bet365, Codere, Sportium, Betway, 888, Luckia ; IT Sisal, Snai, Eurobet, Lottomatica, Goldbet, Planetwin365, Betflag ; PT Betano, Betclic, Placard, ESC Online, Solverde ; NL Toto, Unibet, Holland Casino, Jack's ; BE Unibet, Betfirst, Bingoal, Napoleon, Ladbrokes ; PL STS, Fortuna, Superbet, Betclic, LV BET ; SE Svenska Spel, Betsson, Unibet, LeoVegas, ATG ; NO Norsk Tipping ; DK Danske Spil, Bet365 ; FI Veikkaus ; GR OPAP, Stoiximan, Novibet ; RO Superbet, Betano, Unibet, Fortuna, MaxBet ; CZ/SK Tipsport, Fortuna, Sazka, Niké ; HU TippmixPro ; HR SuperSport, Germania, PSK ; BG efbet, Winbet, Palms Bet ; GLOBAL/offshore 1xbet, Melbet, 22bet, Stake, Roobet, BC.Game, Betwinner, Linebet, 1win, Mostbet, Pin-Up, Parimatch, 20bet (ces dernières, surtout 1win/Mostbet/Pin-Up/Linebet, signalent souvent une audience hors Europe). L'équipe Analystes (phase 29) peut proposer des ajouts ; jamais d'ajout silencieux.
- `dict/affiliate-patterns.json` : motifs de liens d'affiliation (`?ref=`, `?aff=`, `?affid=`, `?btag=`, `?a=`, `?partner=`, `?promo=`, `?tag=`, `sub_id`, `/aff/`, `/ref/`, `/promo/`, `utm_`), raccourcisseurs (bit.ly, cutt.ly, t.ly, tinyurl, is.gd, rebrand.ly, short.io), motifs « code promo » multilingues (code promo, promo code, Promocode, codice promo, código promocional, kod promocyjny…).
- `dict/geo-signals.json` : compétitions et clubs par pays, monnaies, orthographes (pt-PT « desportivas » vs pt-BR « esportivas » ; es-ES vs es-419 ; en-GB vs en-US), domaines nationaux, villes, préfixes téléphoniques.
- `dict/queries.json` : gabarits de requêtes par langue et verticale (voir Sourceur), générés une fois par Haiku puis **versionnés** (pas régénérés à chaque fois).
- `dict/contact-labels.json` : étiquettes de contact par langue (contact, pub, publicité, partenariat, collab, ads, Werbung, Kontakt, pubblicità, contatti, publicidad, contacto, reklama, kontakt, samenwerking, adverteren, annons, samarbete, διαφήμιση, επικοινωνία, publicitate, reklám, reklama, spolupráce…).
- Périmètre : `prospection.countries_scope` = UE 27 + UK, CH, NO, IS par défaut ; tout le reste `NON_EU`.

### Queue et planification
- Queue `agents-prospection`, concurrence 2, timeout 5 minutes par job, missions reprenables (chaque job note son étape).
- Jobs : `prospection.discover` (une source × un lot de langues × une verticale), `prospection.enrich` (un canal), `prospection.score` (un canal), `prospection.dossier` (un canal), `prospection.daily-top`, `prospection.reminders`, `prospection.weekly-report`, `prospection.requalify` (phase 32).
- Planification (Europe/Paris) : découverte chaque jour 02:00-06:00 par lots (toutes les langues couvertes en 7 jours, les deux verticales), enrichissement en continu dès qu'un canal est découvert (plafond journalier), score et dossier à la suite, « Top 10 du jour » à 09:00, rappels à 09:05, rapport hebdo lundi 09:00 (avant le Top 10 ce jour-là). Horaires dans les réglages.

### Réglages (Setting)
```
prospection.enabled = true
prospection.verticals = ["SPORTS","CASINO"]
prospection.countries_scope = [UE27 + "GB","CH","NO","IS"]
prospection.daily_top_count = 10
prospection.daily_top_hour = 9
prospection.discovery_daily_cap = 300        // nouveaux candidats par jour, toutes sources
prospection.enrich_daily_cap = 200
prospection.graph_max_depth = 3              // profondeur du graphe depuis une source directe
prospection.min_posts_30d = 8
prospection.min_median_views = 100
prospection.qualified_threshold = 35         // score minimal pour QUALIFIED (niveau C)
prospection.tier_a_threshold = 70
prospection.tier_b_threshold = 50
prospection.dossier_weekly_cap = 30
prospection.reminder_days = 5
prospection.negotiation_reminder_days = 10
prospection.reminders_daily_cap = 5
prospection.tme_rate_limit_ms = 3000
prospection.directory_rate_limit_ms = 10000
prospection.pitch_drafts = false             // le client a choisi « juste la liste » ; s'il l'active, le dossier ajoute 2 propositions de message (Sonnet), jamais envoyées
prospection.weights = { audience: 30, engagement: 15, fit: 20, openness: 15, competition: 10, reach: 10 }
```

## 2. Agent Sourceur (`packages/agents/src/prospection/discover/`)
Objectif : des centaines de candidats par semaine, dans toutes les langues, avec la provenance, sans doublon. Chaque source est un module avec la même interface (`findCandidates(lot) → Candidate[]`), un débit, un plafond, un état (actif / en pause / en erreur).

**A. Annuaires (`sources/directories.ts`)** — tgstat.com (catégories paris / casino, par langue et pays selon la navigation du site, listes « en croissance »), telemetr.io, tlgrm.eu, telegramchannels.me, et les **places de marché de pub** (telega.io et équivalents : un canal qui vend des posts affiche un prix et un contact = ouvert aux deals, on garde le prix et le lien de fiche). Pour chaque canal listé : username, titre, abonnés annoncés, catégorie, et l'URL de la fiche. Les sélecteurs HTML sont relevés sur des pages réelles enregistrées comme fixtures au moment de l'implémentation ; une page qui change de structure → erreur propre, source en pause, Kevin prévenu (pas de données fausses). Les API payantes des annuaires sont **une option** notée dans `docs/A-FAIRE-HUMAIN.md`, pas utilisées sans le client.

**B. Recherche web multilingue (`sources/web-search.ts`)** — gabarits par langue × verticale × intention, versionnés dans `dict/queries.json` : paris (pronostics, paris sportifs, tipster, prono, typy bukmacherskie, Sportwetten Tipps, pronostici, pronósticos, apostas desportivas, speltips, προγνωστικά, ponturi pariuri…), casino (casino en ligne, bonus sans dépôt, machines à sous, slots, crash, Aviator, roulette, live casino, Online Casino Bonus, casinò online, casino online bono, kasyno online, nettikasino…), combinés avec « telegram », `site:t.me`, et aussi `site:linktr.ee`, `site:beacons.ai`. Chaque résultat est fouillé pour des liens `t.me/<nom>` (WebFetch, 1 page). Rotation : 3-4 langues par nuit.

**C. Réseaux sociaux (`sources/social.ts`)** — les tipsters et streamers casino ont souvent TikTok / Instagram / YouTube / X → Telegram. Recherches `site:tiktok.com`, `site:instagram.com`, `site:youtube.com`, `site:x.com` + mots-clés + « telegram », puis extraction des liens `t.me` des bios et descriptions (WebFetch). Aucun compte social n'est utilisé ; pages publiques seulement ; si une page est inaccessible, on passe.

**D. Graphe Telegram (`sources/graph.ts`) — la source la plus puissante.** Chaque canal lu par l'Enrichisseur produit des candidats : origines des posts transférés (`forward_origin` dans l'aperçu), mentions `@nom`, liens `t.me/<nom>` dans les posts et la description, **dossiers de canaux** `t.me/addlist/<hash>` (la page publique liste les canaux du dossier : on la lit, on n'ajoute rien), groupe de discussion lié (public : candidat de type GROUP). Parcours en largeur, profondeur ≤ `graph_max_depth`, priorité aux candidats cités par plusieurs canaux qualifiés (`cocitationCount`). C'est ainsi qu'on couvre tout l'écosystème d'un pays à partir de quelques canaux.

**E. Pont avec les Analystes (`sources/analysts.ts`)** — les `TrendEntry` de la phase 29 (forums, Reddit) où quelqu'un présente son canal (« mon canal Telegram 20k abonnés cherche des offres », « join my telegram ») : extraction des liens `t.me` → candidats avec `sourceType = ANALYSTS`.

**F. Manuel** — « Kevin, ajoute t.me/xxx » ou un lien transféré à Kevin → candidat `MANUAL`, enrichi en priorité.

**Dédoublonnage (`dedupe.ts`)** : normalisation (minuscules, retrait de `@`, `https://`, `t.me/s/`, paramètres), un `channelUrl` unique ; lien d'invitation privé (`t.me/+…`, `joinchat`) → `UNREADABLE` immédiat (pas de lecture possible sans rejoindre, interdit) ; un candidat déjà connu incrémente `cocitationCount` au lieu d'être recréé. Journal dans `ProspectSourceRun`.

## 3. Agent Enrichisseur (`packages/agents/src/prospection/enrich/`)
Entrée : un `Prospect` en `DISCOVERED`. Sortie : toutes les colonnes de mesure, de classification, de contact, et un statut (`QUALIFIED` est posé par l'Évaluateur, pas ici).

1. **Page publique `t.me/<nom>` (`page.ts`)** : titre, description, **nombre exact d'abonnés** (« 12 345 subscribers ») ou de membres (→ `kind = GROUP`), photo ignorée. Page introuvable → `UNREADABLE`. Page présente mais aperçu `t.me/s/` absent (aperçu désactivé) → on garde abonnés + description, on continue avec ce qu'on a (score plafonné faute de posts, `tierReason` le dit).
2. **Posts `t.me/s/<nom>` (`posts.ts`)** : réutilise `inspiration/sources/web-preview.ts` ; 100 posts ou 90 jours au plus ; par post : id, date, type de média, vues, origine de transfert, nombre de commentaires, réactions (si affichées), boutons inline et leurs URL, signature d'auteur, liens, mentions. Le texte ne quitte pas la mémoire du job.
3. **Mesures (`metrics.ts`, fonctions pures)** : `postsPerDay`, `medianViews`, `avgViews` (30 jours), `viewRate`, `viewVarianceCv`, `forwardRatio`, `reactionRate`, `commentRate`, `linkDensity`, `postingHours`, `firstSeenPostAt`, `lastPostAt`.
4. **Filtres durs (code)** : `lastPostAt` > 21 jours → `DISQUALIFIED` (abandonné) ; `postsPerDay × 30` < `min_posts_30d` → `DISQUALIFIED` (quasi-mort) ; `medianViews` < `min_median_views` → `DISQUALIFIED` (audience trop faible) ; `forwardRatio` > 0,7 → `authenticity = REPOST`, `DISQUALIFIED`.
5. **Signaux de faux (code, `fake.ts`)** : `viewRate` < 0,03 → `SUSPECT_FAKE_SUBS` ; `viewVarianceCv` < 0,05 sur ≥ 20 posts → `SUSPECT_VIEW_BOT` ; tous les posts de même longueur (± 10 caractères) et même structure → `SUSPECT_BOT_CONTENT` ; vues élevées (≥ 1 000) et zéro réaction / commentaire alors que les réactions sont activées → `SUSPECT_NO_ENGAGEMENT`. Chaque signal est une pénalité (section 4), deux signaux ou plus = jamais A.
6. **Langue (`language.ts`)** : bibliothèque de détection sur l'ensemble des textes (franc ou équivalent), confirmation Haiku si confiance < 0,8 ou mélange.
7. **Pays et région (`geo.ts`, code sur `dict/geo-signals.json` + marques)** : points par signal (marque licenciée locale +3, compétition nationale +2, monnaie +2, orthographe régionale +2, domaine national +1, ville +1, marque « offshore CIS/LatAm » −2 pour l'Europe) → `countries` ordonnés, `geoConfidence`, `region` (EU si le premier pays est dans `countries_scope` et confiance ≥ 0,6 ; NON_EU si le premier pays est hors périmètre ; sinon UNKNOWN → score plafonné, Kevin peut demander au client). Cas traités explicitement et testés : pt-PT vs pt-BR, es-ES vs LatAm, en-GB vs en-US/IN/NG, de-DE vs de-AT/CH, fr-FR vs fr-BE/CH/CA, russe → NON_EU par défaut.
8. **Lecture IA (Sonnet, `analyze.ts`)** sur description + 30-50 posts représentatifs (les plus vus et un échantillon chronologique), sortie JSON stricte validée par schéma :
   ```
   Tu es analyste de canaux Telegram de paris sportifs et de casino en ligne en Europe.
   Canal : {title} ({url}), {subscribers} abonnés, {medianViews} vues médianes, langue {language}, pays probables {countries}.
   Description : {description}
   Posts ({n}, du plus récent au plus ancien, avec dates et vues) : {posts}

   Réponds UNIQUEMENT en JSON :
   {
     "vertical": "SPORTS"|"CASINO"|"BOTH"|"OTHER",
     "vertical_details": { "sports": [...], "casino": [...] },
     "content_type": "tips_free"|"vip_sales"|"bonus_pushing"|"streams_clips"|"news"|"mixed",
     "summary_fr": "... (200 caractères max)",
     "quality": 1-10,                      // soin, régularité, valeur du contenu, personnalité
     "monetization": { "sells_vip": bool, "vip_price": "...|null", "sells_ads": bool, "ad_price": "...|null", "pushes_affiliate": bool },
     "brands": [ { "brand": "...", "links": n, "promo_code": "...|null", "first_seen": "YYYY-MM-DD", "last_seen": "YYYY-MM-DD", "intensity": "HEAVY"|"MEDIUM"|"LIGHT", "evidence": "≤ 15 mots" } ],
     "authenticity": "REAL"|"SUSPECT_GENERIC"|"SUSPECT_BOT"|"REPOST",
     "authenticity_reason": "...",
     "contacts": [ { "type": "TELEGRAM_USERNAME"|"EMAIL"|"WEBSITE"|"BOT"|"SOCIAL"|"OTHER", "value": "...", "label": "...", "source": "description"|"pinned"|"signature"|"posts", "confidence": "HIGH"|"MEDIUM"|"LOW", "evidence": "≤ 15 mots" } ],
     "risk_flags": [ "SCAM_FIXED_MATCHES", "GUARANTEED_WINS", "UNDERAGE_SIGNALS", ... ],
     "geo_hints": [ "..." ]               // indices de pays que tu vois (compétitions, marques, monnaie, expressions)
   }

   Règles : un VRAI canal a une voix (« je pense », analyses, réponses à l'audience, erreurs assumées) ; un canal GÉNÉRIQUE recopie des cotes ou des bonus sans rien ajouter ; un canal BOT a des textes mécaniques ; un REPOST ne fait que transférer. « Matchs truqués », « 100 % sûr », « gains garantis » → SCAM_FIXED_MATCHES ou GUARANTEED_WINS. Pour les marques, regarde les liens trackés, les codes promo, les boutons, « lien dans la bio ». Ne donne aucun chiffre qui n'est pas dans les données fournies.
   ```
   Concordance : si le code a ≥ 2 signaux de faux et l'IA dit `REAL`, l'authenticité devient `SUSPECT_GENERIC` et la raison le note ; si l'IA dit `SUSPECT_BOT` ou `REPOST` → `DISQUALIFIED`.
9. **Contacts (`contacts.ts`, code + résultats IA)** : motifs multilingues (`dict/contact-labels.json`) sur la description et le post épinglé → `HIGH` quand une étiquette précède l'username ou l'email (« pub : @x », « contact: x@y.com ») ; username seul dans la description → `MEDIUM` ; signature d'auteur sur les posts → `MEDIUM` ; username mentionné dans les posts → `LOW` ; bots `@…_bot` → type BOT, `MEDIUM` ; pages liées (linktree, beacons, site : **1 page, 1 requête**) → emails / usernames / réseaux → `MEDIUM` ; fiche sur une place de marché → `MARKETPLACE`, `HIGH` (contact par la place de marché) ; groupe de discussion lié public → `LINKED_GROUP`, `LOW` (le client peut y voir les admins lui-même). Exclusions : l'username du canal lui-même, les usernames de marques, les bots de casino. `bestContact` et `contactConfidence` en découlent.
10. **Marques et état concurrentiel (`brands.ts`)** : fusion des marques IA et des liens détectés par motifs ; `competitiveState` : `FREE` (aucune marque), `ROTATING` (≥ 2 marques ou marque changée dans la fenêtre), `EXCLUSIVE` (1 marque, `HEAVY`, présente du premier au dernier post), `OURS` (la marque d'une `AffiliateOffer` active → `riskFlags += PROMOTES_OUR_BRAND`, à vérifier par le client : peut-être déjà affilié ailleurs).
11. **Signal réglementaire (`regulatory.ts`)** : pour le premier pays et la verticale, chercher une `ComplianceRule` (phase 29) de type REGULATION à risque HIGH/BAN → `regulatoryFlag`.
12. **Contrôle local (`qc.ts`, code)** : champs obligatoires présents, URL joignable, chiffres plausibles (vues ≤ abonnés × 5, dates cohérentes), pas de doublon, JSON IA valide ; sinon `ENRICH_FAILED` avec raison, un nouvel essai 6 heures plus tard, puis Kevin prévient si ça échoue encore. Texte brut effacé à la fin du job quel que soit le résultat.

## 4. Agent Évaluateur (`packages/agents/src/prospection/score/`)
**Score 0-100 (code, `score.ts`), composantes et poids par défaut (`prospection.weights`) :**
- **Audience (30)** : échelle logarithmique sur `medianViews` (pas sur les abonnés, qui s'achètent) : 100 → 5, 300 → 10, 1 000 → 16, 3 000 → 22, 10 000 → 27, ≥ 25 000 → 30 ; multiplié par 0,6 si `SUSPECT_GENERIC`.
- **Engagement (15)** : `viewRate` ≥ 0,20 → 10, 0,10 → 7, 0,05 → 4, 0,03 → 2, < 0,03 → 0 ; + jusqu'à 5 pour `reactionRate` / `commentRate` (si visibles) ; aperçu sans posts → 0.
- **Adéquation (20)** : `region = EU` obligatoire (NON_EU → D direct) ; premier pays dans les pays d'une offre active → +12 ; verticale compatible avec l'offre → +5 ; type de contenu propice (vip_sales, tips_free, bonus_pushing, streams_clips) → +3, news → +1 ; `regulatoryFlag` → −6 (pas d'exclusion, mais le dossier le dit).
- **Ouverture (15)** : vend de la pub → +6, pousse des liens d'affiliation → +5 (preuve qu'il monétise), vend du VIP → +3, fiche sur une place de marché → +4 ; plafond 15.
- **Concurrence (10)** : `FREE` → 10, `ROTATING` → 8, `EXCLUSIVE` → 3, `OURS` → 2.
- **Joignabilité (10)** : `HIGH` → 10, `MEDIUM` → 6, `LOW` → 3, `NONE` → 0.
- **Pénalités** : chaque signal de faux −6 (max −18), `SUSPECT_GENERIC` −8, `kind = GROUP` −5, `UNKNOWN` région → plafond 49 (jamais A/B), `GUARANTEED_WINS` −15, `SCAM_FIXED_MATCHES` → D et `riskFlags`, `authenticity` SUSPECT_BOT/REPOST → `DISQUALIFIED`.
- **Niveau** : A ≥ `tier_a_threshold`, B ≥ `tier_b_threshold`, C ≥ `qualified_threshold`, sinon D (`DISQUALIFIED`). Jamais A avec ≥ 2 signaux de faux ou sans contact. `tierReason` en une ligne lisible (« 2,1k vues/post, FR, pousse 1xbet (rotatif), contact pub : @x — A »). `scoreBreakdown` conservé.

**Dossier (Opus, `dossier.ts`)** pour les A et les B les mieux notés, `dossier_weekly_cap` par semaine, uniquement à partir des données stockées (résumé, mesures, marques avec dates, monétisation, contacts, risques, offre appariée, règle réglementaire). 8 lignes au plus, en français, format fixe : qui c'est et ce qu'il fait ; audience réelle (vues médianes, taux de vue, tendance si connue) ; pays et langue avec les preuves ; ce qu'il pousse déjà et depuis quand ; comment il gagne de l'argent (VIP, pub, prix connus) ; comment le joindre (meilleur contact, autres) ; risques (faux, réglementaire, scam, marque à nous) ; **pourquoi maintenant** et quelle structure de deal colle avec l'offre (CPA, revshare, hybride) et 2 questions à lui poser. Pas de message rédigé (sauf `pitch_drafts = true`). Vérification « aucun chiffre hors des données » puis `qaCheck("RECOMMENDATION", …)` ; refus → dossier absent, `tierReason` suffit, Kevin le dit.

## 5. Agent Pipeline (`packages/agents/src/prospection/pipeline/`) et Kevin
**Statuts et transitions (`status.ts`)** : table des transitions autorisées (ex. `QUALIFIED → CONTACTED → RESPONDED → NEGOTIATING → SIGNED → ACTIVE`, `SKIPPED → QUALIFIED` après 60 jours, `BLACKLISTED` terminal) ; toute transition écrit un `ProspectEvent` avec `by: client|system`.

**« Top 10 du jour » (`daily-top.ts`)** à `daily_top_hour` : les `QUALIFIED` jamais présentés (ou présentés il y a > 7 jours sans action, une seule fois), `snoozedUntil` passé, triés par niveau puis score puis `cocitationCount`, mélange des deux verticales et des pays selon les offres actives (pas 10 canaux du même pays si d'autres existent). Un message d'en-tête (« 10 canaux à contacter — 4 A, 6 B — 3 FR, 2 IT, 2 ES, 2 DE, 1 PT ») puis **un message par prospect** :
```
🅰️ @nom — 🇫🇷 Paris sportifs — 2,1k vues/post (12 % des 17k abonnés)
Pousse 1xbet (code XYZ) depuis 4 mois · vend ses posts 40 € · VIP 29 €/mois
Contact : @admin_pub (pub, HIGH) · site : xxx.fr
Pourquoi : audience FR réelle, concurrent rotatif, contact direct — colle à l'offre {marque} (CPA 100 €)
⚠️ (si applicable) : 1 signal de faux / pays à vérifier / règle FR
```
avec boutons inline : `✅ Contacté` `🤝 Signé` `🔎 Dossier` `⏰ Plus tard` `❌ Pas intéressé`. `callback_data = prospect:<id>:<action>` (même mécanique que la phase 28). `Signé` ouvre deux boutons `CPA` `Revshare` `Hybride` puis une question courte (montant) → `dealTerms`. Le Top 10 passe par `qaCheck("KEVIN_RESPONSE", …)` avant envoi ; `presentedAt` posé à l'envoi.

**Rappels (`reminders.ts`)** à 09:05 : `CONTACTED` depuis > `reminder_days` sans réponse → « Ça fait 6 jours pour @x, tu relances ? » avec `✅ Relancé` `⏰ 3 jours` `❌ Abandon` ; `NEGOTIATING` > `negotiation_reminder_days` → « La négo avec @x dure depuis 11 jours, on en est où ? » ; `reminders_daily_cap` par jour ; jamais le week-end sauf réglage.

**Rapport hebdo (`weekly-report.ts`, lundi 09:00)** : nouveaux qualifiés par niveau / pays / verticale, Top 5 de la semaine, pipeline par statut, conversions (contacté → répondu → signé) avec délais médians, sources qui ont produit les meilleurs canaux (attribution par `sourceType`), 3 suggestions au plus (« L'Italie donne 30 % des A, je creuse ? » → réponse oui = lot de découverte dédié), pauses de sources. `qaCheck("REPORT", …)`.

**Catalogue Kevin (`boss/catalogue/prospection.ts`)**, phrases attendues en français courant :
- `prospects_top` : « montre les prospects », « qui contacter ? », « top du jour », « encore 10 » → Top N (relance à la demande, sans doublon du matin).
- `prospects_filtre` : « prospects FR casino libres », « les A sans concurrent », « les plus gros en Italie », « ceux qui vendent de la pub en Espagne », « canaux crash/Aviator » → filtres (pays, verticale, sous-type, niveau, concurrence, ouverture, contact) → liste compacte.
- `prospect_detail` : « détail @x », « dossier @x », « pourquoi @x est A ? » → fiche + `scoreBreakdown` lisible + dossier.
- `prospect_statut` : « j'ai contacté @x », « @x a répondu », « on négocie avec @x », « @x a signé CPA 100 », « @x est actif », « @x a arrêté », « ignore @x », « blacklist @x », « plus tard @x » → transition + confirmation en 1 ligne.
- `prospect_note` : « note @x : veut des créatives mardi ».
- `prospect_ajout` : « ajoute t.me/xxx », lien transféré → `MANUAL`, enrichi en priorité, réponse quand c'est prêt.
- `prospects_relances` : « qui relancer ? », « relances ».
- `prospects_stats` : « stats prospection », « pipeline », « combien de signés ce mois ? », « taux de réponse ».
- `prospection_cherche` : « cherche des canaux casino en Pologne », « plus de paris en Grèce » → lot de découverte dédié (sources A-C) et retour quand les premiers qualifiés arrivent.
- `prospection_offres` : « ajoute une offre : {marque}, FR BE, CPA 120 », « mes offres », « désactive l'offre {marque} ».
- `prospection_pause` : « pause la prospection », « reprends ».
- `prospection_export` : « export prospects » → lien vers l'export CSV du site (pas de fichier dans Telegram au-delà de 50 lignes).
- Questions complexes (« compare FR et IT en casino, lesquels d'abord ? ») → `answer.ts` avec Opus sur les données, chiffres du code uniquement.
Toute réponse passe par le QA Global. Demande hors catalogue → `BossUnmet`.

## 6. Page Prospection (`apps/web/`, route `/agents/prospection`)
- **Tableau** : toutes les colonnes utiles (canal, niveau, score, verticale, pays, langue, abonnés, vues médianes, taux de vue, concurrence, marques, ouverture, contact, statut, source, dernière action), filtres combinables, tri, recherche, vues enregistrées, sélection multiple (« marquer contactés », « ignorer »), export CSV des lignes filtrées.
- **Pipeline** : colonnes par statut avec compteurs, glisser-déposer facultatif, délais médians.
- **Fiche** : tout le prospect, `scoreBreakdown` en barres, dossier, contacts avec preuve et confiance, marques avec dates, signaux de faux et risques, chronologie (`ProspectEvent`), notes, lien direct vers le canal, boutons de statut.
- **Offres** : création / modification des `AffiliateOffer`.
- **Sources** : état de chaque source (actif / pause / erreur, prochain passage), journal `ProspectSourceRun`, candidats trouvés / nouveaux / doublons par source, attribution (niveaux produits par source).
- **Dictionnaires** : lecture des marques et motifs, proposition d'ajout (appliquée seulement après validation).

## Tests et livraison
- **Fixtures** : pages `t.me/<nom>` (canal 17k abonnés avec description et contact « pub : @x » ; canal sans aperçu ; groupe 5k membres ; page introuvable), aperçus `t.me/s/` (canal FR pronostics réel avec 1xbet + code promo + signature ; canal IT VIP payant avec linktree ; canal DE casino slots avec bet-at-home ; canal « espagnol » mais LatAm (Caliente, pesos) ; canal pt-BR vs pt-PT ; canal « matchs truqués » ; canal à vues constantes (bot) ; canal 100 % transferts ; canal mort depuis 40 jours ; canal multilingue ambigu), pages d'annuaire (liste, fiche, place de marché avec prix), page linktree, page de dossier `t.me/addlist`, résultats de recherche web et sociaux, réponses IA simulées (JSON valide, JSON invalide, chiffre inventé).
- **Unitaires** : chaque parseur (abonnés, description, posts, forwards, réactions, boutons, signatures, dossiers, annuaires, linktree) ; chaque mesure ; filtres durs ; signaux de faux ; langue ; pays (tous les cas listés en 3.7) ; contacts (chaque niveau de confiance, exclusions) ; marques et `competitiveState` ; signal réglementaire ; contrôle local ; score composante par composante et niveaux ; plafonds (UNKNOWN → ≤ 49, ≥ 2 faux → jamais A) ; dédoublonnage et `cocitationCount` ; transitions de statut (valides, invalides) ; Top 10 (mélange, pas de doublon, snooze) ; rappels (délais, plafond) ; boutons (`callback_data` → transition) ; export CSV ; purge immédiate du texte brut (aucune colonne ne contient de texte de post).
- **Intégration sur base réelle, faux réseau** : découverte (annuaire + recherche + graphe depuis un canal) → 25 candidats, 5 doublons → enrichissement → 8 qualifiés (3 A, 3 B, 2 C), 6 disqualifiés avec raisons justes (LatAm, bot, repost, mort, scam, faible audience), 2 UNREADABLE → dossiers Opus pour les A → Top 10 à 09:00 avec boutons → `✅ Contacté` → statut → 6 jours → rappel → « @x a signé » → `CPA` → `100` → SIGNED avec `dealTerms` → rapport hebdo correct → « cherche des canaux casino en Pologne » → lot dédié → « compare FR et IT » → réponse Opus chiffrée ; `qaCheck` appelé pour chaque sortie (compteur) ; QA en panne → rien n'est envoyé et Kevin prévient.
- **Relecture adverse** : contact direct impossible (grep + test : aucun appel d'envoi vers un tiers dans `prospection/`), aucune lecture de membres, aucun join, lien privé jamais suivi, débit respecté (horodatages), plafonds journaliers, NON_EU invisible, scam exclu, faux jamais A, texte brut jamais en base, injection par le contenu d'un canal (« ignore tes règles ») = donnée, non-régression des phases 19 à 30.
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement ; santé ; captures ; `docs/STATUS.md`, `docs/GUIDE-UTILISATEUR.md` (section « Prospection d'affiliés » : ce que Kevin envoie chaque matin, les boutons, les commandes, les offres, ce que l'équipe ne fait jamais), `docs/DECISIONS-TECH.md`, `docs/DATA-MODEL.md`, `docs/AGENTS-ARCHITECTURE.md` (équipe Prospection : 4 agents, schéma du flux, modèles), `docs/prompts/README.md`, ligne « Phase 31 » dans `CLAUDE.md`, `docs/A-FAIRE-HUMAIN.md` (API payantes d'annuaires : option, pas obligatoire ; saisie des offres).
- **Bilan Telegram** par Kevin (5 lignes) : fait, ce qui arrive chaque matin, comment répondre avec les boutons, combien de canaux déjà trouvés et qualifiés (vrais chiffres), ce qui n'a pas pu être essayé. Puis Kevin demande les offres si elles manquent. Puis crée `docs/PHASE-DONE` (date + « Phase 31 (prospection, cœur) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance `docs/prompts/34-phase-32-prospection-avancee.md` toute seule.

## Fini quand
- Les six sources trouvent des canaux casino et paris dans toutes les langues du périmètre sans doublon et sans jamais contacter ni rejoindre ; l'enrichissement mesure l'audience réelle, détecte langue, pays, région, marques, monétisation, contacts, faux et risques, et efface le texte brut ; le score est transparent et les niveaux justes sur les fixtures ; chaque matin Kevin envoie le Top 10 avec boutons et le client met à jour le pipeline en un geste ; dossiers Opus pour les meilleurs ; rappels, rapport hebdo, filtres, recherche à la demande, offres ; page en ligne avec export ; tout passe par le QA Global ; tests, relecture, déploiement, documentation et bilan faits.
