# Phase 35 — Cotes chez nos bookmakers : le système va lui-même lire les matchs et les cotes sur Celsius, Sportaza et Bet Portal, de la façon la plus fiable possible, et l'équipe Paris sportifs choisit ses paris sur ces cotes-là

Si `docs/STATUS.md` indique déjà « phase 35 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

**Ordre d'exécution** : après la phase 33 (Kevin : ordres, voir, voix), **avant** la phase 34 et les phases 28 à 32. `docs/STATUS.md` contient donc les phases 19 à 27 et 33.

Lis `CLAUDE.md`, `docs/STATUS.md`, `docs/DECISIONS-TECH.md`, `docs/AGENTS-ARCHITECTURE.md` (Chef Paris sportifs : Cotes & sélection → Capture écran → Rédaction → Contrôle qualité → Publication ; section « Ordres de Kevin » de la phase 33), `docs/prompts/25-phase-23-*.md` (équipe Paris sportifs) et `docs/A-FAIRE-HUMAIN.md` (section compte bookmaker), **tout** `packages/agents/src/providers/` : `odds.ts` (contrat `OddsProvider` : `listEvents`, `getMarkets`, `getResult`, `listBookmakers`), `odds-registry.ts`, `odds-cache.ts`, `odds-batch.ts`, `sportsgameodds*.ts`, `fake-odds.ts`, `verifiers.ts`, et `screenshot/` (`adapter.ts` : `BookmakerAdapter`, `BookmakerConfig`, `BookmakerSelectors` ; `adapters.ts` : réglages sans redéploiement `AgentTeamConfig.settings.sports.bookmakers.<clé>` ; `sportaza.ts` ; `session.ts` : session chiffrée `providers.bookmakers.<nom>.session` ; `settings.ts` : `captureMode` `server` / `mac`, proxy ; `guard.ts` et `rules.test.ts` : URL interdites (dépôt, retrait, panier), `detectPageObstacle` (géo-blocage, captcha) ; `match.ts` : retrouver un match ; `requests.ts`, `runner-api.ts` : file de demandes et échanges avec le Mac ; `template.ts` : image de secours), `apps/worker/scripts/capture-runner.ts` (le Mac du client : Chromium, 15 s, rien sur disque), `apps/worker/src/capture/browser.ts`, `apps/web/app/api/integrations/capture-runner/route.ts`, `packages/agents/src/agents/cotes/{index,select}.ts`, `packages/agents/src/agents/capture/index.ts`, `packages/agents/src/sports/*` (`setup.ts`, `connection.ts`, `passage.ts`, `missions.ts`, `settle.ts`, `contracts.ts`), `BetCategory` (`marketTypes`, `leagues`, `bookmakers`, `maxOddsDriftPct`), `BettingPick`, `packages/agents/src/sports/themes.json` (phase 33 : thèmes → marchés), le catalogue de Kevin (`connexion_bookmaker`, `test_bookmaker`, `mode_capture`) et le registre des capacités (`orders/`). Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Schéma, runner du Mac étendu (lecture en plus de la capture) et installé comme service, comptes des trois bookmakers demandés par Kevin.
2. Apprentissage d'un site (« recette ») : enregistrement guidé, analyse par Opus, recette validée automatiquement, stockée, versionnée.
3. Lecteur à trois niveaux (API interne du site → page affichée → image), cache, pas de double session, respect du site.
4. Fournisseur de cotes `bookmaker-direct` branché sur l'équipe Paris : sélection sur les vraies cotes, double lecture avant publication, résultats, capture.
5. Surveillance : dérive, auto-réparation, alertes, questions à l'humain au bon moment ; Kevin (voir les matchs, apprendre un site, tester).
6. Page Agents → Bookmakers, tests, relecture adverse, déploiement, documentation, bilan, `docs/PHASE-DONE`.

## But de la phase
Les bookmakers du client sont **Celsius** (`celsius.games`, section paris sportifs), **Sportaza** (`sportaza.com/fr/sports`) et **Bet Portal** (adresse exacte à confirmer par le client : plusieurs sites portent ce nom). Aucun des trois n'est couvert par le fournisseur de cotes SportsGameOdds (vérifié le 25 octobre : 85 bookmakers listés, aucun des trois). Aujourd'hui l'équipe Paris choisit donc ses paris sur des cotes d'autres bookmakers, puis vérifie sur Sportaza au moment de la capture : écarts, paris introuvables, erreurs.

À la fin de cette phase, le système **va lui-même sur chaque site**, avec le compte du client, lit les matchs du jour et des jours suivants, les marchés et les cotes, et l'équipe Paris choisit ses paris **sur ces cotes-là**. La méthode est la plus fiable possible : le système **apprend** chaque site une fois (comment le site charge ses cotes), lit ensuite par le chemin le plus stable, vérifie chaque cote par deux chemins indépendants avant de publier, se répare seul quand un site change, et demande à l'humain seulement quand il ne peut vraiment pas (captcha, code de connexion, site refondu). Il ne mise **jamais**.

## Règles non négociables
1. **Jamais de mise, jamais d'argent.** Garde existante (`guard.ts`) étendue à la lecture : toute URL ou action de dépôt, retrait, panier, placement, bonus, est interdite ; test adverse : aucune fonction du lecteur ne peut cliquer sur un bouton de mise. Le compte bookmaker ne sert qu'à voir.
2. **Lecture seule, un seul lecteur à la fois par bookmaker**, une seule session (cookies chiffrés, existants), rythme humain (une page toutes les 2 à 5 secondes, jamais plus de 60 requêtes par minute vers un site), cache obligatoire (liste des matchs valable 20 minutes, cotes d'un match 3 minutes, refaites à la demande juste avant publication), aucune lecture la nuit sauf ordre. Le but est de ne jamais faire bannir le compte ni l'adresse.
3. **Zéro cote fausse.** Une cote n'est publiée que si elle a été lue par **deux chemins indépendants** (API interne + page affichée, ou page + image) à moins de 3 minutes d'intervalle, **identiques** (tolérance 0) ; sinon la mission attend (`WAITING_HUMAN` avec la capture) et Kevin le dit. Un chiffre lu par l'IA sur une image n'est jamais seul.
4. **Le site reste la vérité.** Les noms de marchés et de sélections sont ceux du site (gardés tels quels, traduits en interne par la recette) ; aucune cote n'est inventée, interpolée ou « rapprochée ». Un marché que le site ne propose pas n'existe pas pour l'équipe.
5. **Apprendre, pas deviner.** Les sélecteurs et les points d'entrée d'un site viennent d'un enregistrement réel analysé, validé par le code sur le même enregistrement, et stockés comme **recette** versionnée. Rien n'est écrit « à la main dans le code » pour un site (la recette de Sportaza remplace les sélecteurs « prudents, à confirmer » de la phase 23 dès qu'elle est validée ; d'ici là ils restent).
6. **Se réparer avant de déranger.** Une lecture qui échoue → chemin suivant (API → page → image) ; deux échecs de suite sur un site → ré-apprentissage automatique (au plus une fois par 24 h) ; toujours en échec → Kevin prévient avec la cause lisible et le geste à faire (ouvrir le navigateur visible sur le Mac, saisir un code, re-saisir le mot de passe, dire la nouvelle adresse du site).
7. **Secrets** : identifiants et sessions chiffrés (mécanique de la phase 23), jamais à l'IA, jamais dans les journaux, jamais sur le disque du Mac en clair (règle du runner). L'IA voit des pages, des réponses réseau et des images, **jamais** l'identifiant ni le mot de passe (masqués avant analyse).
8. **Respect des sites et des lois** : pas de contournement de blocage géographique par usurpation (si un site n'est pas disponible depuis l'adresse du serveur, c'est le Mac du client qui lit, c'est tout) ; `robots.txt` et conditions d'utilisation notés dans `docs/A-FAIRE-HUMAIN.md` pour que le client sache que la lecture automatisée avec son compte est sous sa responsabilité ; aucune donnée d'autres joueurs n'est lue.
9. **Aucun appel réseau dans les tests** : sites locaux imitant chaque bookmaker (comme `fixtures/bookmaker` de la phase 23, étendus : page d'accueil, liste des matchs, fiche d'un match, API JSON interne, changement de structure, captcha, géo-blocage), enregistrements réseau en fixtures, fausse IA, faux Mac.

## Modèles IA par tâche (allocation validée)
| Tâche | Modèle | API model string | Pourquoi |
|---|---|---|---|
| Lecture d'un site (API, page), cache, double lecture, rythme | _(pas d'IA)_ | — | Code pur, testé |
| **Apprentissage d'un site** : à partir de l'enregistrement (réponses réseau JSON, structure des pages), produire la recette (points d'entrée, en-têtes, forme des réponses, correspondance vers le format commun, sélecteurs de repli) | **Opus 5.5** | `claude-opus-5-5` | Raisonnement sur des données brutes nombreuses, une fois par site |
| Correspondance des marchés du site avec les thèmes internes (« Corners », « Hors-jeu », « Shots on target » → clés) | **Sonnet 5.5** | `claude-sonnet-5-5` | Classification multilingue avec contexte ; validée par le code et par un test sur l'enregistrement |
| Lecture d'une cote sur une image (niveau 3, secours seulement) | **Opus 5.5** | `claude-opus-5-5` | Vision précise ; jamais seule (règle 3) |
| Diagnostic d'un échec (page inattendue : captcha, maintenance, refonte, compte bloqué) | **Sonnet 5.5** | `claude-sonnet-5-5` | Classification d'une page en 6 cas, après les règles du code |
| Messages de Kevin | **Haiku 5.5** | `claude-haiku-5-5` | Gabarits, charte de voix (phase 33) |

## 1. Schéma, runner, comptes
### Schéma (`packages/db/prisma/`)
```
model BookmakerSite {
  key            String   @id          // "celsius", "sportaza", "betportal"
  label          String
  baseUrl        String                 // adresse de la section paris
  sportsPath     String?                // chemin vers les sports si différent
  providerHint   String?                // fournisseur de sportsbook détecté (iframe / scripts), ex. "betby", "altenar", "digitain", "inconnu"
  readTarget     String   @default("auto") // auto | server | mac — auto : serveur si joignable, sinon Mac
  isActive       Boolean  @default(true)
  status         String   @default("NEW") // NEW, LEARNING, READY, DEGRADED, BLOCKED
  statusReason   String?
  lastReadAt     DateTime?
  lastOkAt       DateTime?
  recipes        BookmakerRecipe[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model BookmakerRecipe {
  id             String   @id @default(cuid())
  siteKey        String
  site           BookmakerSite @relation(...)
  version        Int
  level          String                 // "api" | "dom"
  api            Json?                  // { endpoints: [{ purpose: "events"|"markets"|"odds", method, urlTemplate, params, headers (noms seulement), auth: "cookie"|"bearer"|"none", pagination, responseShape }], tokenSource }
  dom            Json?                  // { selectors par étape, plusieurs candidats, stratégies texte/ARIA }
  mapping        Json                   // { eventFields, leagueFields, marketMap: { "<nom site>": "<clé interne>" }, selectionMap, oddsFormat: "decimal"|"fractional"|"american", timezone }
  validation     Json                   // { recordedAt, eventsMatched, oddsMatched, mismatches[], passed: bool }
  isActive       Boolean  @default(false)
  createdBy      String                 // "learn" | "repair" | "manual"
  createdAt      DateTime @default(now())
  @@unique([siteKey, version])
}

model BookmakerReadJob {
  id             String   @id @default(cuid())
  siteKey        String
  kind           String                 // learn | events | markets | verify | capture | test
  target         String                 // server | mac
  status         String                 // PENDING, CLAIMED, DONE, FAILED, NEEDS_HUMAN
  params         Json
  result         Json?                  // compteurs, erreurs classées, niveau utilisé, durée ; jamais de secret
  attempts       Int      @default(0)
  claimedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime @default(now())
}

model BookmakerEvent {   // cache, 20 minutes
  id String @id @default(cuid()); siteKey String; siteEventId String; league String; leagueKey String?; homeTeam String; awayTeam String; startsAt DateTime; url String?; marketsCount Int?; fetchedAt DateTime; oddsEventId String? // correspondance avec SportsGameOdds pour les résultats (match.ts)
  @@unique([siteKey, siteEventId])
}
model BookmakerOdds {    // cache, 3 minutes ; chaque ligne = une lecture par un chemin
  id String @id @default(cuid()); siteKey String; siteEventId String; marketSite String; marketKey String?; selectionSite String; selectionKey String?; line Float?; odds Float; level String /* api | dom | image */; readAt DateTime; jobId String?
  @@index([siteKey, siteEventId, readAt])
}
```
`BettingPick` : ajouter `siteKey`, `siteEventId`, `oddsReadIds Json` (les deux lectures qui ont validé la cote), `oddsLevel`.

### Runner du Mac (`apps/worker/scripts/capture-runner.ts` → `bookmaker-runner.ts`, même jeton, même API)
- Prend aussi les jobs `learn`, `events`, `markets`, `verify`, `test` (pas seulement `capture`) ; même garde « jamais de mise » ; session reçue du site et rendue, rien sur disque (inchangé) ; option `--visible` pour les cas où l'humain doit intervenir (captcha, code), lancée par Kevin sur demande.
- **Installé comme service de session macOS** (`pnpm agents:runner:install` → `launchd`, démarre à l'ouverture de session, redémarre s'il tombe, journal dans `logs/bookmaker-runner.log`) : c'est Claude Code qui l'installe pendant cette phase sur le Mac où tourne `run-phase.sh` ; le client n'a rien à lancer. `pnpm agents:runner:status` et Kevin (« le Mac lit ? ») disent s'il tourne (dernier passage il y a moins de 2 minutes).
- `readTarget = auto` : le worker essaie d'abord depuis le serveur (avec le proxy s'il est réglé) ; page de blocage géographique ou refus → bascule sur le Mac pour ce site et le note (`BookmakerSite.readTarget = mac` jusqu'à nouvel essai hebdomadaire).

### Comptes
- Adresses confirmées par le client le 25 octobre : Celsius `https://celsius.games` (section paris sportifs), Sportaza `https://sportaza.com/fr/sports`, Bet Portal `https://betportal.com/`.
- **Un seul jeu d'identifiants pour tous les bookmakers** (décision du client : mêmes email et mot de passe sur les trois, et sur tout bookmaker ajouté plus tard). Stockage : un secret commun chiffré `providers.bookmakers.default.credentials` (mécanique de `session.ts` / `readBookmakerCredentials`), utilisé par défaut par chaque site ; un site peut garder un identifiant propre s'il en a un (priorité au propre). Les sessions (cookies) restent séparées par site.
- Kevin demande ces identifiants **une seule fois, en privé** (email, puis mot de passe ; messages effacés, chiffrés, jamais à l'IA ni dans un journal), sauf s'ils sont déjà enregistrés. Il propose ensuite de tester les trois sites d'un coup. Aucun identifiant n'est écrit dans le code, les prompts, les fixtures ou la documentation.
- Ajouter un bookmaker = une phrase à Kevin (« ajoute le bookmaker X, c'est x.com ») → `BookmakerSite` créé avec les identifiants communs → apprentissage automatique.

## 2. Apprendre un site (`packages/agents/src/bookmakers/learn/`)
Objectif : obtenir la **recette** la plus stable pour lire ce site, sans rien écrire à la main.
1. **Enregistrement guidé (code, Playwright)** : ouvrir la section paris avec la session (connexion si besoin), accepter les cookies, aller sur le football, « aujourd'hui », ouvrir la liste, ouvrir un match, ouvrir 3 onglets de marchés (résultat, buts, un marché spécial comme corners ou cartons), changer de jour, chercher une équipe. Pendant ce parcours : **toutes les réponses réseau** JSON / GraphQL / WebSocket (URL, méthode, paramètres, en-têtes nécessaires avec les valeurs secrètes masquées, corps tronqué à 200 Ko), les **instantanés de page** (HTML nettoyé et texte visible), les captures, et la détection du fournisseur de sportsbook (domaines des iframes et scripts : betby, altenar, digitain, betconstruct, kambi, sportradar, softswiss… ou inconnu). Durée visée : 2 à 4 minutes, rythme humain.
2. **Analyse (Opus)** : à partir de l'enregistrement (secrets masqués), produire une recette candidate : les points d'entrée qui portent les matchs, les marchés et les cotes ; comment les appeler (paramètres de date, de sport, de ligue, pagination), quelle authentification (cookie de session, jeton dans un en-tête, aucun) et d'où vient le jeton ; la **forme des réponses** et la correspondance vers le format commun (`OddsEvent`, `OddsSelection`) ; le format des cotes et le fuseau horaire ; en repli, des sélecteurs de page à plusieurs candidats (par texte, par rôle, par structure) pour la liste, la fiche, les marchés et les cotes ; la correspondance des noms de marchés du site avec `sports/themes.json` (Sonnet pour les cas ambigus). Sortie JSON stricte validée par schéma ; aucune URL hors des domaines vus dans l'enregistrement.
3. **Validation (code, sur l'enregistrement, sans réseau)** : rejouer la recette sur les réponses et pages enregistrées : elle doit retrouver ≥ 95 % des matchs visibles et **100 %** des cotes lues sur les pages de marchés ouvertes (comparaison API ↔ page) ; sinon, deuxième passe d'Opus avec les écarts ; toujours en échec → `dom` seul si la page passe à 100 %, sinon site `BLOCKED` avec raison et Kevin prévient.
4. **Validation en vrai (une lecture)** : exécuter la recette sur le site (events + un match) et comparer à une lecture de page : identique → `READY`, recette active, version +1 ; la précédente reste consultable.
5. Si le fournisseur de sportsbook est connu et déjà appris pour un autre site (`providerHint` identique), la recette existante est essayée **avant** un nouvel apprentissage (souvent le même moteur sert plusieurs marques) ; validée sur le nouveau site → réutilisée avec ses propres paramètres (domaine, jeton).

## 3. Lecteur à trois niveaux (`packages/agents/src/bookmakers/read/`)
- **Niveau 1 — API interne** : appels directs aux points d'entrée de la recette avec la session du navigateur (cookies, jeton), même agent utilisateur, depuis le serveur ou le Mac selon `readTarget` ; rapide, stable, peu coûteux. Jeton expiré ou 401/403 → ouverture du navigateur pour rafraîchir la session (une fois), puis reprise.
- **Niveau 2 — page affichée** : Playwright suit la recette `dom` (plusieurs candidats par étape, la première qui marche est mémorisée pour la prochaine fois) ; lecture du texte visible.
- **Niveau 3 — image** : capture de la zone du marché (code) puis lecture de la cote par Opus (vision), seulement pour **vérifier une cote précise**, jamais pour une liste, jamais seul (règle 3).
- Chaque lecture écrit `BookmakerOdds` avec son niveau ; `BookmakerEvent` pour les matchs ; cache et rythme (règle 2) ; un seul job par site à la fois (verrou) ; file `agents-bookmakers` (concurrence 1 par site).
- **Diagnostic d'un échec** : règles du code d'abord (`detectPageObstacle` : géo-blocage, captcha, maintenance, déconnecté, page vide), puis Sonnet si la page est inconnue (6 cas) → action : rafraîchir la session, basculer sur le Mac, ré-apprendre, demander à l'humain (captcha, code à deux facteurs, mot de passe refusé, nouvelle adresse).

## 4. Branchement sur l'équipe Paris sportifs
- Nouveau fournisseur `bookmaker-direct` (`providers/bookmaker-direct.ts`) qui remplit le contrat `OddsProvider` à partir du lecteur : `listEvents` (cache 20 min, sinon job `events`), `getMarkets` (cache 3 min, sinon job `markets`), `listBookmakers` (sites `READY`), `getResult` → délégué à SportsGameOdds via `BookmakerEvent.oddsEventId` (correspondance par `match.ts` : équipes normalisées + coup d'envoi ± 15 min), sinon `null` et le règlement attend (`settle.ts` : un pari sans résultat n'est jamais réglé au hasard).
- `odds-registry.ts` : pour une `BetCategory` dont `bookmakers` contient un site `READY`, le fournisseur est `bookmaker-direct` ; SportsGameOdds reste pour les bookmakers qu'il couvre, pour les résultats, et comme **comparaison** (écart > 15 % entre la cote du site et le consensus → le pari est signalé « cote inhabituelle », pas bloqué).
- `BetCategory.marketTypes` accepte les clés internes de `themes.json` ; la recette traduit vers les marchés du site. Catégories existantes migrées (clés SGO → clés internes) par script, avec liste de ce qui n'a pas de correspondance.
- **Avant publication (Contrôle qualité)** : double lecture (règle 3) de la cote retenue, à moins de 3 minutes ; `maxOddsDriftPct` s'applique entre la sélection et la publication ; la capture d'écran (phase 23) utilise la recette `dom` pour retrouver le marché (plus les sélecteurs figés) et vérifie que la cote affichée sur l'image est celle validée.
- `BettingPick.siteKey` : le post indique le bookmaker du client, avec le lien d'affiliation de la campagne (inchangé).

## 5. Surveillance, réparation, Kevin
- Job `bookmakers.health` toutes les 30 minutes par site actif : une lecture légère (liste du jour) ; taux de réussite sur 24 h ; `DEGRADED` sous 90 %, `BLOCKED` après 3 échecs de suite ou obstacle humain ; ré-apprentissage automatique (règle 6) ; chaque changement d'état → `ProspectEvent`-like dans `AuditLog` et message Kevin (charte de voix) avec le geste à faire.
- **Capacités (registre de la phase 33)**, équipe Paris, agent « Cotes & sélection » : `voir_matchs` (« quels matchs sont sur Sportaza ce soir ? », « demain chez Celsius en Ligue 1 », « il y a des corners sur le PSG ? » → liste par ligue, heure, nombre de marchés, cotes principales ; depuis le cache ou une lecture à la demande), `apprendre_site` (« apprends le site Celsius », « Bet Portal c'est betportal.xx, apprends-le »), `tester_site` (remplace `test_bookmaker` : connexion + une lecture), `etat_bookmakers` (« les bookmakers ça va ? », « le Mac lit ? »), `ouvrir_navigateur` (« ouvre le navigateur sur le Mac » → job `--visible` pour un captcha ou un code ; Kevin explique en une ligne quoi faire), `cote_de` (« la cote de PSG gagne chez Sportaza ? » → double lecture, réponse avec l'heure de lecture).
- Dans « Top 10 », rapports et bilans de l'équipe Paris : le bookmaker lu et le niveau de lecture ne sont pas affichés au client (jargon), sauf s'il demande le détail.

## 6. Page, tests et livraison
- **Page Agents → Bookmakers** : par site : état, cible (serveur / Mac), dernier succès, taux 24 h, recette active (version, niveau, fournisseur détecté, marchés reconnus), journal des jobs, bouton « Ré-apprendre », « Tester », « Ouvrir le navigateur sur le Mac » ; cache des matchs du jour ; écart site ↔ consensus.
- **Fixtures** : trois sites locaux (un par bookmaker, structures différentes : l'un charge ses cotes par API JSON, l'autre par page rendue, le troisième par WebSocket simulé), avec variantes : changement de structure, captcha, géo-blocage, session expirée, cote qui change entre deux lectures, marché absent ; enregistrements réseau correspondants ; réponses Opus simulées (recette correcte, recette avec URL hors domaine → rejet, recette incomplète → deuxième passe).
- **Unitaires** : masquage des secrets dans l'enregistrement ; validation d'une recette (95 % / 100 %) ; réutilisation par fournisseur ; lecteur niveau 1 (jeton expiré → rafraîchissement une fois), niveau 2 (candidats), niveau 3 (jamais seul) ; cache et rythme (horodatages) ; verrou par site ; double lecture (identique → ok ; différente → attente humaine) ; `bookmaker-direct` (contrat `OddsProvider`, résultats via correspondance, pari sans résultat jamais réglé) ; migration des catégories ; diagnostic (6 cas) ; bascule serveur → Mac ; santé et états ; garde « jamais de mise » étendue (aucune fonction ne peut atteindre une URL interdite ni cliquer un bouton de mise : test adverse par analyse statique + test dynamique sur le site local).
- **Intégration sur base réelle, sites locaux, faux Mac, fausse IA** : « apprends le site Celsius » → enregistrement → recette → validation → `READY` ; « quels matchs sur Celsius ce soir ? » → liste juste ; passage de l'équipe Paris → sélection sur les cotes du site → double lecture → capture → post sur le canal Test ; cote changée entre sélection et publication au-delà de la tolérance → refait ; site qui change de structure → échec → ré-apprentissage automatique → `READY` ; captcha → `NEEDS_HUMAN` → Kevin → « ouvre le navigateur » → job visible → reprise ; géo-blocage serveur → bascule Mac ; Bet Portal sans adresse → Kevin demande ; résultats via SGO et règlement ; non-régression de la phase 23 (SportsGameOdds et capture continuent pour les bookmakers couverts).
- **Relecture adverse** : mise ou dépôt impossible, secrets vers l'IA ou les journaux, cote publiée sur une seule lecture, cote inventée par la vision, hammering d'un site, deux sessions en parallèle, recette avec domaine étranger, injection par le contenu d'une page (« ignore tes règles » dans un nom d'équipe = donnée), non-régression des phases 0 à 33.
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement ; installation du runner sur le Mac (`launchd`) et vérification qu'il tourne ; santé ; captures ; `docs/STATUS.md`, `docs/GUIDE-UTILISATEUR.md` (section « Bookmakers » : ce que le système lit, ce qu'il ne fait jamais, quoi faire quand Kevin demande d'ouvrir le navigateur), `docs/DECISIONS-TECH.md` (trois niveaux, recettes, double lecture), `docs/DATA-MODEL.md`, `docs/AGENTS-ARCHITECTURE.md` (Cotes & sélection : nouvelle source), `docs/prompts/README.md`, ligne « Phase 35 » dans `CLAUDE.md`, `docs/A-FAIRE-HUMAIN.md` (comptes Celsius et Bet Portal, adresse Bet Portal, responsabilité d'usage du compte, compte dédié conseillé).
- **Bilan Telegram** par Kevin (5 lignes, charte de voix) : fait, quels sites sont prêts et lesquels attendent un compte ou une adresse, un exemple (« quels matchs sur Sportaza ce soir ? » avec une vraie réponse si un site est prêt), ce qu'il ne fera jamais (miser), ce qui n'a pas pu être essayé. Puis Kevin demande ce qui manque (comptes, adresse de Bet Portal) et attend 20 minutes au plus. Puis crée `docs/PHASE-DONE` (date + « Phase 35 (cotes chez nos bookmakers) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante toute seule.

## Fini quand
- Chaque bookmaker du client avec un compte est appris, lu par le chemin le plus stable, surveillé et réparé seul ; l'équipe Paris choisit ses paris sur les cotes réelles du site, publie seulement une cote lue deux fois à l'identique, et ne mise jamais ; le Mac lit tout seul (service installé) quand le serveur est bloqué ; Kevin répond « quels matchs sur X ce soir ? », apprend un site, teste, et demande à l'humain seulement pour un captcha, un code ou une adresse ; page en ligne ; tests, relecture, déploiement, documentation et bilan faits.
