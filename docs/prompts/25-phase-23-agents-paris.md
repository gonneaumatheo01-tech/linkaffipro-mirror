# Phase 23 — Agents IA : équipe Paris sportifs (cotes, sélection, capture d'écran, publication immédiate, résultats)

Si `docs/STATUS.md` indique déjà « phase 23 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 22), `docs/DECISIONS-TECH.md`, **`docs/AGENTS-ARCHITECTURE.md`** (sections « Chef Paris Sportifs », « Les agents », « Outils et APIs externes » (cotes, automatisation navigateur), « Risques et parades »), puis `packages/agents` (Chefs Dating et Casino comme modèles), les captures Playwright existantes (`pnpm captures`, `apps/web/scripts/editor-check.ts`, `pnpm landing:browser-check`), l'image Docker du worker, et le bouton Offre des campagnes. Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Fournisseur de cotes (interface, faux fournisseur sur fixtures, SportsGameOdds, OddsPapi facultatif), cache et comptage des appels, clé dans Réglages → Agents.
2. Catégories de paris et moteur de sélection (règles pures, transparentes).
3. Agent Capture écran (Playwright, compte bookmaker, vérification de la cote, surlignage, repli image), parade anti-blocage.
4. Chaîne du Chef Paris : Cotes & sélection → Capture → Rédaction → Contrôle (cote re-vérifiée) → Publication immédiate ; `BettingPick` et résultats après match.
5. Fiche d'équipe, tests, déploiement, STATUS, bilan avec ce que le client doit fournir, phase suivante.

## But de la phase
Troisième équipe de production : chaque jour, elle trouve chez les bookmakers partenaires les paris qui correspondent aux catégories demandées (par exemple « tirs cadrés »), retient les plus intéressants selon une méthode réglable et transparente, va les retrouver sur le site du bookmaker, vérifie la cote, fait la capture d'écran, rédige un post court et le publie tout de suite. Après le match, elle note le résultat et tient le bilan par catégorie.

## Règles non négociables
1. **Aucune prédiction présentée comme certaine** et aucun chiffre inventé : le post donne le match, le marché, la cote constatée, une ou deux phrases de raisonnement tirées des données (écart de cote, moyennes), et le bouton d'offre. Mots interdits par défaut : « sûr », « garanti », « 100 % », « ne peut pas perdre » (liste réglable).
2. **La cote publiée est celle du bookmaker**, vérifiée au moment de la capture puis re-vérifiée par le Contrôle qualité juste avant l'envoi ; si elle a bougé au-delà de l'écart réglé (5 % par défaut) ou si le marché a disparu, le pari est écarté (journalisé), jamais publié avec une vieille cote.
3. **Toujours validés par le client** : une ligue ou un marché jamais utilisés, une cote hors de la fourchette de la catégorie, toute image de repli (capture impossible). Simulation par défaut, niveaux d'autonomie et règles de contenu de la phase 19.
4. **Un pari ne se programme pas** : publication immédiate (ou refus) ; jamais de publication à moins de N minutes du coup d'envoi (réglable, 30 par défaut) ni après.
5. **Compte bookmaker et clés** : identifiants chiffrés dans `Setting` `agents.providers.bookmakers`, demandés par le bot Telegram (mécanisme `HumanRequest` : deux questions, identifiant puis mot de passe, messages supprimés aussitôt, test de connexion immédiat ; le site ADMIN reste possible en secours), session du navigateur chiffrée elle aussi (jamais en clair sur disque) ; aucune action sur le site du bookmaker autre que se connecter, chercher, afficher, capturer (**jamais de mise, jamais de dépôt, jamais de modification de compte** : règle codée dans l'adaptateur, testée).
6. **Quotas d'API** : appels de cotes comptés (`AgentUsage.odds`), cache Redis (matchs 30 min, cotes 5 min), plafond mensuel d'appels réglable ; au plafond, l'équipe s'arrête proprement et prévient.
7. **Aucun appel réseau dans les tests** : fournisseur de cotes faux sur fixtures ; captures testées sur une page HTML locale qui imite un site de bookmaker.

## Fournisseur de cotes
- Interface `providers/odds.ts` : `listEvents({ sport, leagues, from, to })`, `getMarkets(eventId, marketTypes)` (cotes par bookmaker et par sélection), `getResult(eventId)` (score, statistiques utiles : tirs cadrés, corners, cartons), `listBookmakers()`.
- **SportsGameOdds** en principal (clé API ; **vérifie la documentation officielle** : adresses, en-têtes, identifiants de ligues et de marchés, limites de l'offre gratuite, format des résultats ; note ce qui est confirmé). **OddsPapi** en complément facultatif (Sportaza référencé, 250 requêtes par mois gratuites : à n'utiliser que pour vérifier une cote Sportaza quand c'est possible). Faux fournisseur sur fixtures JSON (`packages/agents/fixtures/odds/*.json`) pour les tests et la simulation.
- Cote de référence (consensus) = médiane des cotes des bookmakers disponibles pour la même sélection (ou le bookmaker de référence réglé) ; probabilité implicite corrigée de la marge.

## Catégories et sélection (`rules/bets.ts`, pur, testé)
- `BetCategory` (table) : nom, sport, types de marchés chez le fournisseur (identifiants), ligues, bookmakers cibles (Sportaza, 5Gringos…), cote minimale et maximale, nombre de paris par jour, canaux de destination, campagne (bouton Offre), délai minimal avant le coup d'envoi, écart de cote toléré, actif. Valeurs de départ créées par la migration : tirs cadrés, corners, buts (plus / moins), cartons, buteur, résultat, désactivées sauf la première.
- Score d'intérêt d'une sélection = (cote du bookmaker cible × probabilité de consensus) − 1 (écart de valeur), ajusté par les moyennes récentes des équipes quand le fournisseur les donne (par exemple tirs cadrés par match sur 5 matchs), borné ; critères de la catégorie appliqués ; classement ; N meilleurs ; doublons écartés (même match, marché et sélection publiés dans les 48 h) ; le raisonnement est conservé en clair dans `BettingPick.reasoning` (chiffres), affiché dans la fiche et résumé dans le post.

## Agent Capture écran (`agents/capture`, `providers/screenshot/`)
- Playwright Chromium dans le worker (ajoute les dépendances à l'image Docker ; si la mémoire du service est insuffisante, crée un service Railway `capture` dédié sur le modèle du userbot et note la décision) ; un seul navigateur à la fois (verrou Redis), profil persistant chiffré (cookies et stockage réexportés après chaque session).
- Adaptateur par bookmaker (`sportaza.ts` d'abord ; interface commune `BookmakerAdapter` : `login`, `findEvent`, `findMarket`, `readOdds`, `highlightAndCapture`) ; connexion avec les identifiants du client ; recherche du match ; repérage du marché et de la sélection ; lecture de la cote affichée (comparée à la cote retenue) ; surlignage (cadre de couleur injecté en CSS) ; capture recadrée (PNG) → `MediaAsset` (kind SCREENSHOT, origin HUMAN_SITE). Toute erreur (captcha, double authentification, page introuvable, blocage géographique) est classée (`errors.ts`) et déclenche la parade.
- **Parade anti-blocage, dans l'ordre** (plan, section « Risques ») : (1) adresse IP résidentielle réglable (`agents.providers.screenshotProxy`, chiffrée) ; (2) capture depuis le Mac du client : commande `pnpm agents:capture-runner` (même code, tourne en local, prend les demandes en attente via la base, dépose les captures) décrite en clics simples dans `A-FAIRE-HUMAIN.md` ; (3) image de repli fabriquée par nous (gabarit HTML → image : match, marché, cote, bookmaker, mention « capture indisponible »), toujours validée par le client. Documente ce qui a été constaté en production dans `docs/DECISIONS-TECH.md`.

## Chaîne du Chef Paris et résultats
- Déclenchement : `agents-orchestrator` lance le Chef Paris 3 fois par jour (10 h, 15 h, 18 h Paris, réglable) et 2 h avant chaque match retenu ; mission BET par catégorie et par jour.
- BET : Cotes & sélection → Capture → Rédaction (match, marché, sélection, cote, raisonnement court, bouton Offre de la campagne) → Contrôle qualité (règles, cote re-vérifiée via le fournisseur ou une nouvelle lecture, pas de doublon, image présente) → Publication immédiate (`scheduledAt` = maintenant, simulation → canal Test).
- `BettingPick` : mission, catégorie, match (identifiant fournisseur, équipes, ligue, coup d'envoi), marché, sélection, cote retenue, cote de consensus, score d'intérêt, cote à l'envoi, bookmaker, capture, post, état (PROPOSED, PUBLISHED, SKIPPED avec motif, WON, LOST, VOID), résultat et statistiques du match.
- Résultats : tâche `agents-sports` `settle` toutes les 2 h : pour chaque pari publié dont le match est terminé, lit le résultat, marque gagné / perdu / annulé ; bilan par catégorie, ligue, bookmaker et semaine (taux de réussite, cote moyenne, rendement à mise constante) ; les résultats alimentent les fiches de l'équipe Algorithme (`PostInsight.betResult`).

## Site
- `/agents/sports` : catégories (formulaire complet), paris du jour avec capture, raisonnement et état, bilan par catégorie et par ligue (période commune), bookmakers connectés (état de la session, bouton « Tester la connexion » qui fait une capture de la page d'accueil), réglages (horaires de passage, écart toléré, délai avant match, plafond d'appels), bouton « Produire un pari de test » (faux fournisseur, page locale, simulation).
- Guide : section « Agents → Équipe Paris sportifs » (catégories, compte bookmaker, que faire si la capture échoue).

## Données
- `BetCategory`, `BettingPick` (ci-dessus), `AgentUsage.odds`, `Setting` chiffrés (cotes, bookmakers, proxy), tags de médias `SCREENSHOT`. Migration additive, `docs/DATA-MODEL.md`.

## Tests et livraison
- **Unitaires** : probabilité implicite et consensus ; score d'intérêt et bornes ; critères de catégorie ; doublons 48 h ; délai avant match ; vérification de cote (écart toléré, marché disparu) ; classement des erreurs de capture et parade ; adaptateur Sportaza sur une page HTML locale (connexion simulée, recherche, lecture de cote, surlignage, capture) ; règle « jamais de mise » (l'adaptateur refuse toute action hors liste) ; règlement des résultats (gagné, perdu, annulé, statistiques) ; bilan ; cache et quotas ; chiffrement des identifiants.
- **Intégration sur base réelle** : faux fournisseur de cotes + page locale → 2 paris simulés d'une catégorie de test publiés sur le canal Test (captures jointes), un pari écarté pour cote bougée, un repli image soumis à validation, puis résultats réglés et bilan calculé.
- Tests de garde verts ; `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement (image du worker avec Chromium ou service `capture`) ; santé ; captures.
- `docs/STATUS.md`, `docs/A-FAIRE-HUMAIN.md` (phase 23 : le bot demande, une question à la fois, la clé SportsGameOdds (lien pour la créer, offre gratuite), l'identifiant puis le mot de passe du compte bookmaker (test de connexion immédiat), et, seulement si le test dit « bloqué », le choix entre une adresse IP résidentielle (service à souscrire, adresse à envoyer au bot) et `pnpm agents:capture-runner` sur le Mac (clics exacts) ; puis les catégories à activer par numéros ; quand ça plaît, « vrai paris » puis OUI au bot), `docs/GUIDE-UTILISATEUR.md`, `docs/DECISIONS-TECH.md`, ligne « Phase 23 » dans `CLAUDE.md`, commit, push.
- **Bilan Telegram** (5 lignes) : fait, test de 5 minutes (« Produire un pari de test »). Puis la file des demandes par le bot (`HumanRequest`) : SECRET clé de cotes (vérifiée aussitôt), SECRET identifiant bookmaker, SECRET mot de passe bookmaker (test de connexion aussitôt, résultat renvoyé), si bloqué : CHOICE adresse IP résidentielle / capture depuis le Mac (puis SECRET adresse du proxy le cas échéant), CHOICE catégories à activer (numéros, plusieurs possibles).
- Puis crée `docs/PHASE-DONE` (date + « Phase 23 (agents IA : équipe Paris sportifs) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante (`docs/prompts/26-phase-24-agents-ads.md`) toute seule. **Ne l'enchaîne pas toi-même.**

## Fini quand
- Paris simulés publiés sur le canal Test avec captures ; vérification de cote, parade anti-blocage, règle « jamais de mise », résultats et bilan testés ; fiche d'équipe en ligne ; déploiement vérifié ; STATUS et guide à jour ; bilan envoyé.
