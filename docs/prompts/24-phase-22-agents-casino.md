# Phase 22 — Agents IA : équipe Casino (médiathèque par thème, demandes de vidéos, chaîne complète)

Si `docs/STATUS.md` indique déjà « phase 22 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 21), `docs/DECISIONS-TECH.md`, **`docs/AGENTS-ARCHITECTURE.md`** (sections « Chef Casino », « Les agents », « Niveaux d'autonomie et garde-fous »), puis `packages/agents` (Chef Dating comme modèle), la médiathèque (phases 19-20), les modèles de messages par univers (`Post.isTemplate`, `vertical`, `pnpm seed:templates`), les catégories (`MessageCategory`), les campagnes et le bouton Offre (`apps/web/lib/campaigns/offer-button.ts`, `TrackingLink.campaignId`), et les réglages de l'équipe Algorithme (phase 21). Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Médiathèque Casino : thèmes, dépôt par mots-clés, stock par thème et par canal, demandes groupées.
2. Chaîne du Chef Casino : Médiathèque → Rédaction → Planification → Contrôle → Publication, avec replis (texte ou image) et règle « jamais de média non fourni ».
3. Planification apprenante (réglages de l'équipe Algorithme) et textes liés à l'offre du moment (campagne, bouton Offre).
4. Fiche d'équipe Casino, tests, une semaine simulée sur le canal Test, déploiement, STATUS, bilan, phase suivante.

## But de la phase
Deuxième équipe de production : les canaux casino publient chaque jour des vidéos **fournies par le client**, des images et des textes, adaptés au thème de chaque canal et à l'offre du moment, aux bons créneaux. L'équipe demande elle-même les vidéos qui manquent, par un seul message Telegram groupé, et range toute seule celles qu'elle reçoit.

## Règles non négociables
1. **Aucune vidéo ni image inventée ou générée.** L'équipe Casino n'utilise que des médias déposés par le client (`origin = HUMAN`). L'agent Média IA n'est pas dans sa chaîne, et le Contrôle qualité refuse tout média `origin = AI` sur un canal Casino (règle codée, testée).
2. **Demande de vidéos** : quand un thème d'un canal passe sous 3 vidéos non utilisées, un seul message Telegram groupé par jour au plus : thème, nombre souhaité, canal, et le mot-clé exact à mettre en légende (« envoie-les au bot avec #casino #roulette »). Jamais de relance avant 3 jours.
3. **Dépôt par le bot** : une vidéo ou une image envoyée ou transférée au bot par l'admin avec `#casino #<thème>` (plusieurs thèmes possibles, thème inconnu → créé après confirmation en un bouton) est rangée, dédoublonnée (`sha256`), et confirmée en une ligne (« rangée : roulette, 4 vidéos non utilisées »). Un média sans mot-clé est mis « à classer » et la fiche d'équipe propose de le classer.
4. **Rotation** : une vidéo n'est jamais republiée sur le même canal avant 30 jours (réglable), ni le même jour sur deux canaux du même univers.
5. **Simulation par défaut**, niveaux d'autonomie et validations « toujours » : nouveau canal, nouveau thème, offre jamais utilisée (nouvelle campagne liée) ; règles de contenu de la phase 19 ; mention d'IA interdite ; légendes très courtes.
6. **Textes honnêtes** : les textes parlent de l'offre liée à la campagne du canal (bouton Offre existant) avec ce que la fiche de la campagne dit ; aucun chiffre ni promesse inventés (même règle que l'assistante de conversation : la fiche de l'offre est la seule source).

## Médiathèque Casino
- Thèmes : liste par équipe (`AgentTeamConfig.settings.casino.themes`, valeurs de départ : machines à sous, roulette, blackjack, bonus, jackpot, live, tournoi, cashback, ambiance), modifiables dans la fiche d'équipe ; un média porte un ou plusieurs thèmes ; un canal a ses thèmes (`ChannelAgentPlan.themes`) avec un poids chacun.
- Stock : par canal et par thème, nombre de médias non utilisés depuis 30 jours ; état « manque » sous 3 ; demande groupée (règle 2) via le dialogue admin ; `Alert` métier `agents_media_low` (interrupteur).
- Choix du média : thème du jour (rotation pondérée par les poids et par les résultats de l'équipe Algorithme si disponibles), média le moins récemment utilisé, jamais le même sur deux canaux le même jour.

## Chaîne du Chef Casino
- Mission POST : VIDEO (média fourni) → Rédaction → Planification → Contrôle → Publication ; IMAGE : idem avec une image fournie ; TEXT : Rédaction seule (modèles de messages par univers comme inspiration, jamais recopiés tels quels, et sans répéter les 30 derniers posts) → … Mélange par canal (`ChannelAgentPlan.mix`, défaut `{ video: 2, image: 1, text: 1 }`), réglé ensuite par l'équipe Algorithme dans les bornes.
- Replis : pas de vidéo disponible du bon thème → autre thème du canal → image → texte ; chaque repli journalisé et compté dans le rapport quotidien (« 3 posts texte faute de vidéos : roulette »).
- Rédaction : ton du canal (`ChannelAgentPlan.styleNotes`, `styleGuidelines` de l'équipe), offre du moment (campagne liée : nom de l'offre, ce que la fiche permet de dire), thème du média, type de post ; sortie courte (« rentre dedans », pas générique).
- Planification : fenêtres de l'équipe Algorithme (`suggestedWindows`) quand elles existent, sinon meilleurs horaires existants ; espacement ; heures calmes ; jamais deux vidéos à moins de 4 h sur un canal.
- Contrôle qualité : règles de contenu, doublon, média fourni par un humain (règle 1), offre présente si le canal a une campagne (bouton Offre), puis verdict.
- Publication : `Post` programmé avec le bouton Offre de la campagne du canal (même logique que le formulaire), `publisher` BOT (ACCOUNT seulement si emojis animés), simulation → canal Test.

## Site
- `/agents/casino` : stock par canal et par thème (vert / orange / rouge), médias « à classer » (classement en ligne), demandes envoyées, mélange et fenêtres par canal, dernières productions, bouton « Produire un post de test », réglages (thèmes, seuil de manque, rotation).
- Fiche canal casino : encart « Équipe Casino » (plan du canal, lien vers la fiche d'équipe).
- Guide : section « Agents → Équipe Casino » (comment envoyer des vidéos au bot, que faire d'une demande).

## Données
- `ChannelAgentPlan.themes` (JSON thèmes + poids), colonnes ou tags de médias déjà en place (`theme`, `origin`), `AgentTeamConfig.settings.casino` (thèmes, seuil, rotation), `Alert` `agents_media_low`. Migration additive, `docs/DATA-MODEL.md`.

## Tests et livraison
- **Unitaires** : dépôt par mots-clés (thèmes multiples, thème inconnu, doublon, admin seulement, « à classer ») ; stock et seuil ; demande groupée (une par jour, pas de relance avant 3 jours) ; choix du média (rotation 30 jours, jamais deux canaux le même jour, pondération) ; replis en cascade ; refus d'un média `AI` sur Casino ; Rédaction avec offre (faux modèle) ; Planification avec fenêtres de l'équipe Algorithme.
- **Intégration sur base réelle** : 4 vidéos de test déposées via le handler (faux Telegram) sur deux thèmes → **une semaine de missions simulées** (horloge injectée, jour par jour) sur le canal Test : mélange respecté, rotation respectée, replis déclenchés quand le stock s'épuise, demande groupée envoyée une fois, posts programmés et envoyés, rapport quotidien.
- Tests de garde verts ; `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement ; santé ; captures.
- `docs/STATUS.md`, `docs/A-FAIRE-HUMAIN.md` (phase 22 : le bot demande les premières vidéos, 3 à 5 par thème et par canal casino, une demande à la fois ; la campagne liée à chaque canal casino est demandée par un choix numéroté ; quand ça plaît, « vrai casino » puis OUI au bot), `docs/GUIDE-UTILISATEUR.md`, `docs/DECISIONS-TECH.md`, ligne « Phase 22 » dans `CLAUDE.md`, commit, push.
- **Bilan Telegram** (5 lignes) : fait, test de 5 minutes (envoyer une vidéo au bot avec `#casino #roulette`, voir « rangée », produire un post de test). Puis les demandes par le bot (`HumanRequest`, une à la fois) : pour chaque canal casino, CHOICE « quelle offre (campagne) pour le bouton de <canal> ? 1) … 2) … » puis MEDIA « envoie 3 à 5 vidéos <thème> avec #casino #<thème> » pour les thèmes du canal.
- Puis crée `docs/PHASE-DONE` (date + « Phase 22 (agents IA : équipe Casino) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante (`docs/prompts/25-phase-23-agents-paris.md`) toute seule. **Ne l'enchaîne pas toi-même.**

## Fini quand
- Une semaine simulée passe sur le canal Test avec médias fournis, rotation, replis, demande groupée ; règle « jamais de média non fourni » testée ; fiche d'équipe en ligne ; déploiement vérifié ; STATUS et guide à jour ; bilan envoyé.
