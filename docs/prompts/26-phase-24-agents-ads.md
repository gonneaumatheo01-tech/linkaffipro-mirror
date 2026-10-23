# Phase 24 — Agents IA : Agent Ads (analyse des pubs, recommandations justifiées, rapports)

Si `docs/STATUS.md` indique déjà « phase 24 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 23), `docs/DECISIONS-TECH.md`, **`docs/AGENTS-ARCHITECTURE.md`** (section « Agent Ads : workflow »), puis : les connecteurs Meta / TikTok (`packages/connectors`, `apps/worker/src/ads`, `AdAccountConnection`, `ConnectorSyncRun`), les modèles `Campaign`, `AdSet`, `Ad`, `AdCost`, `DailyStat` (dimension `campaigns`, commissions, retour sur dépense, coût par membre et par inscription : `packages/core/src/commissions.ts`, `campaign-attribution.ts`), les pages Statistiques (`/stats`, `/stats/ads`, `/stats/funnel`, `/stats/cohorts`, `apps/web/lib/dashboard/*`), les pages d'atterrissage (`LandingEvent`, clics pub), les rapports Telegram existants (`apps/worker/src/reports`) et les seuils d'alerte (Réglages → Alertes). Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Moteur d'analyse (chiffres par campagne, pub, audience, entonnoir, cohortes, comparaison de périodes) en logique programmée, sur les données déjà synchronisées.
2. Règles de recommandation à seuils réglables (arrêter, augmenter, tester, surveiller) avec preuves.
3. Rapports quotidien et hebdomadaire (chiffres → texte simple par l'IA), alertes, page Ads dans la rubrique Agents.
4. Tests, déploiement sur les vraies données, STATUS, bilan, phase suivante.

## But de la phase
Un agent rattaché au Grand Chef qui lit chaque jour les dépenses et résultats des pubs (Meta, TikTok, coûts importés ou saisis) et ce qu'elles ont vraiment rapporté dans la plateforme (membres, inscriptions, dépôts, commissions), puis propose des actions concrètes, classées et justifiées par les chiffres. **Il recommande, il n'agit jamais** sur les plateformes publicitaires.

## Règles non négociables (plan, section « Agent Ads »)
1. **Aucune action sur Meta ou TikTok** : pas de changement de budget, pas d'arrêt, pas de création ; les connecteurs restent en lecture (règle codée : l'agent n'a pas accès aux fonctions d'écriture, et il n'en existe pas).
2. **Les chiffres viennent de la plateforme** (`DailyStat`, attribution existante, règles de `packages/core`) : l'agent ne recalcule pas les commissions ni le retour sur dépense autrement que par les fonctions existantes ; gains = commissions − dépense pub, comme partout.
3. **Chaque recommandation porte ses preuves** (chiffres, période, comparaison) et un seuil visible ; pas de recommandation sans assez de données (seuils : au moins 3 jours et un montant minimal de dépense par pub, réglables).
4. **L'IA ne sert qu'à rédiger** le résumé en français simple à partir du JSON des chiffres et des recommandations ; jamais l'inverse ; sortie vérifiée (aucun chiffre dans le texte qui ne soit pas dans le JSON : contrôle codé).
5. Niveaux d'autonomie : sans objet (rien n'est appliqué) ; l'équipe garde seulement la possibilité d'arrêter les rapports (pause).

## Moteur d'analyse (`packages/agents/src/agents/ads/`, logique programmée)
- Par campagne, groupe de pubs et pub, sur J-1, 7 jours, 28 jours, et comparaison avec la période précédente : dépense, impressions, clics pub, visites de page d'atterrissage, entrées Telegram, membres, clics sur l'offre, inscriptions, premiers dépôts, dépôts, commissions, gains, retour sur dépense, coût par membre, coût par inscription, coût par premier dépôt ; variations (`variationBetween` / `comparableVariation`).
- Entonnoir impression → clic pub → visite → entrée Telegram → clic offre → inscription → dépôt, taux à chaque étape, goulot (l'étape dont le taux est le plus en dessous de la médiane des pubs comparables).
- Cohortes : ce que rapportent, après 7, 14 et 30 jours, les membres acquis par chaque pub (commissions datées, règles existantes).
- Meilleures et pires pubs par univers (texte, visuel, audience quand le connecteur les donne) ; pubs trop jeunes (« surveiller »).
- Alertes en temps réel (toutes les heures) : dépense anormale (plus de X % au-dessus de la moyenne des 7 jours), chute de conversions, coût par résultat au-dessus du seuil depuis N jours, budget de campagne épuisé ; interrupteurs dans Réglages → Alertes.

## Recommandations (`rules/ads.ts`, pur, testé)
- **Arrêter** : coût par résultat au-dessus du seuil depuis N jours avec assez de dépense. **Augmenter** : retour sur dépense au-dessus du seuil, budget non épuisé, tendance stable ou en hausse. **Tester** : variations suggérées à partir de ce qui marche (même audience avec un autre visuel, même visuel sur une autre audience, horaire). **Surveiller** : trop jeune ou trop peu de dépense.
- Seuils par univers dans `AgentTeamConfig` de l'équipe « ads » (ou `Setting` `agents.ads.thresholds`) : coût par inscription cible, retour sur dépense minimal, jours d'observation, dépense minimale ; valeurs de départ raisonnables à partir des données existantes (médianes), expliquées dans la page.
- Chaque recommandation = `Recommendation` (phase 21) avec `teamKey = ads`, cible (campagne, groupe, pub), action, preuves, état PROPOSED / DONE (le client dit qu'il l'a faite) / REJECTED ; jamais appliquée par le code.

## Rapports et page
- Quotidien (9 h Paris, après celui du Grand Chef, ou intégré à lui) : 5 lignes au plus (dépense d'hier, gains, meilleure et pire pub, nombre de recommandations avec un lien vers la page). Hebdomadaire (lundi) : par univers, tendances, cohortes, recommandations classées. Texte rédigé par l'IA depuis le JSON, contrôlé (règle 4), envoyé par le dialogue admin, archivé (`InsightReport`, `teamKey = ads`).
- Page `/agents/ads` : résumé du jour, recommandations (Fait / Refuser, commentaire), entonnoir par campagne, cohortes, pires et meilleures pubs, seuils (formulaire), rapports archivés, export CSV. Réutilise les composants et graphiques de Statistiques ; pas de doublon des pages `/stats/*` (liens vers elles pour le détail).
- Sans connecteur Meta / TikTok branché : l'agent travaille avec les coûts importés (CSV) ou saisis, et la page le dit en une phrase (avec le lien vers Réglages → Connecteurs).

## Données
- `Recommendation` et `InsightReport` (phase 21) étendus à l'équipe `ads` ; `Setting` ou `AgentTeamConfig` pour les seuils ; alertes `ads_spend_spike`, `ads_conversion_drop`, `ads_cost_over_threshold`, `ads_budget_exhausted`. Migration additive si besoin, `docs/DATA-MODEL.md`.

## Tests et livraison
- **Unitaires** : chiffres par pub sur un jeu de `DailyStat` connu (dépense, gains, retour, coûts par résultat, variations) ; entonnoir et goulot ; cohortes ; règles de recommandation (chaque action, seuils, données insuffisantes) ; contrôle « aucun chiffre inventé » dans le texte de l'IA (faux modèle qui invente un chiffre → rejet) ; alertes.
- **Intégration sur base réelle** : campagne, pubs et `DailyStat` de test → recommandations attendues → rapport quotidien généré et envoyé au faux Telegram → marquer une recommandation « Fait ».
- Tests de garde verts ; `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement ; santé ; captures ; puis **premier rapport réel** (`railway ssh --service web -- pnpm agents:report-now --team ads`) sur les vraies données.
- `docs/STATUS.md`, `docs/A-FAIRE-HUMAIN.md` (rien à fournir ; les seuils sont proposés par le bot ; brancher Meta / TikTok si ce n'est pas fait, lien vers le guide existant), `docs/GUIDE-UTILISATEUR.md`, `docs/DECISIONS-TECH.md`, ligne « Phase 24 » dans `CLAUDE.md`, commit, push.
- **Bilan Telegram** (5 lignes) : fait, où voir les recommandations, ce que dit le premier rapport en une phrase, rien à fournir. Puis une demande par le bot (`HumanRequest` CHOICE) : « Coût par inscription au-dessus duquel je te conseille d'arrêter une pub : 1) <médiane actuelle × 1,5> 2) <× 2> 3) un chiffre » (et la même chose pour le retour sur dépense minimal), valeurs par défaut gardées si « plus tard ».
- Puis crée `docs/PHASE-DONE` (date + « Phase 24 (agents IA : Agent Ads) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante (`docs/prompts/27-phase-25-agents-supervision.md`) toute seule. **Ne l'enchaîne pas toi-même.**

## Fini quand
- Premier rapport réel envoyé avec recommandations justifiées ; règles et contrôle « aucun chiffre inventé » testés ; page en ligne ; aucune écriture possible vers Meta / TikTok ; déploiement vérifié ; STATUS et guide à jour ; bilan envoyé.
