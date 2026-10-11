# Phase 10 — Finitions après la refonte (relecture des captures du 11 octobre)

Si `docs/STATUS.md` indique déjà « phase 10 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/REFONTE-UX.md`, `docs/STATUS.md`, `docs/LINKAFFI-SCHEMA.md`, `docs/A-FAIRE-HUMAIN.md`. Mode autonome, aucune question. Chaque correction : un test qui échoue avant, puis la correction ; captures 1440 et 390 px des pages touchées dans `docs/captures/`.

## 0. PRIORITÉ : le message d'accueil n'envoie pas les liens des canaux à rejoindre (bug signalé par le client le 11 octobre)
Le client a réglé un canal sur « après avoir rejoint ces canaux », a fait une demande d'adhésion de test : le bot envoie bien le message d'accueil, mais sans les liens des autres canaux.
Cause probable, lue dans le code : `resolveGateButtons` (`packages/telegram/src/join-flow/service.ts`) crée chaque lien avec le bot qui gère le canal source ; si ce bot n'est pas administrateur du canal à rejoindre (avec le droit d'inviter par lien), `createChatInviteLink` échoue en silence (`catch → null`), le canal privé n'a pas de nom public, le bouton est omis, `gates` est vide et le bot envoie le message simple sans rien signaler. Autre piste à vérifier : une règle enregistrée avec des canaux à rejoindre mais un `gateMode` resté à `NONE` (bug de l'interface « trois choix »).
**Le client affirme que ses bots sont bien administrateurs avec le droit d'inviter : ne t'arrête pas à la première hypothèse.** Pistes à vérifier une par une avec les vraies données : (a) le `OutboundMessage` envoyé lors du test (texte et `buttons` réellement enregistrés) et la réponse de Telegram à l'envoi ; (b) la règle réellement appliquée : la demande est-elle passée par un lien d'entrée qui a sa propre règle (sans canaux à rejoindre) au lieu de la règle par défaut du canal ? (c) le `telegramChatId` des canaux à rejoindre (canaux ajoutés par transfert ou par lien en phase 8 : identifiant faux ou non préfixé `-100`) → `createChatInviteLink` échoue « chat not found » ; (d) l'erreur exacte renvoyée par `createChatInviteLink` (la journaliser au lieu de l'avaler) ; (e) le bot qui a traité la demande (`actingBotIdFor`) et ses droits réels dans chaque canal à rejoindre (`getChatMember`, `can_invite_users`) ; (f) un texte d'accueil personnalisé sans `{liste_canaux}` combiné à un `gates` vide ; (g) un envoi avec média dont la légende dépasse 1024 caractères (boutons sur le second message). Reproduis le cas exact du client en test avant de corriger.
- Diagnostique d'abord avec les données de production : la règle réelle du canal testé (mode, `gateMode`, `gateChannelIds`), les droits de chacun de nos bots dans chaque canal à rejoindre, les `InviteLink` de type GATE, les journaux du worker et du web au moment du test, l'`Event` de la demande. Écris dans `docs/STATUS.md` la cause exacte.
- Corrections : (1) pour créer un lien GATE, essayer d'abord le bot du canal source, puis n'importe lequel de nos bots administrateur du canal à rejoindre avec le droit d'inviter ; (2) à l'enregistrement d'une règle avec canaux à rejoindre, créer et vérifier tout de suite les liens, et afficher dans l'éditeur, en français clair, le canal qui pose problème et la solution (« Ajoutez @bot comme administrateur de « X » avec le droit Inviter via un lien ») ; (3) ne plus jamais envoyer en silence un accueil sans liens quand des canaux sont exigés : journaliser l'erreur, mettre un point dans « À faire » de l'accueil et prévenir l'admin par Telegram ; (4) l'enregistrement de la règle aligne toujours `gateMode` avec les canaux choisis ; (5) le texte d'accueil par défaut et l'aperçu de l'éditeur montrent les boutons de chaque canal à rejoindre et le bouton « ✅ J'ai rejoint ».
- Tests : bot source non administrateur du canal à rejoindre mais un autre bot l'est → lien créé ; aucun bot administrateur → avertissement dans l'éditeur, point « À faire » et alerte, jamais un accueil silencieux sans liens ; test de bout en bout simulé (demande → accueil avec boutons → `/start g…` → acceptation).
- Une fois corrigé et déployé : envoie au client par Telegram, en 3 lignes, le test à refaire.

## 1. Le « bénéfice » est mal défini (erreur de la spécification, à corriger partout)
Aujourd'hui l'accueil affiche « Bénéfice du jour (dépôts compris) = dépôts + revenu net − pub », et « Campagnes actives » utilise « revenu net − pub ». Les deux sont faux : les dépôts et le revenu net (NGR) sont l'argent du casino, pas le nôtre.
- Définition unique, partout (accueil, campagnes, statistiques, rapports et alertes Telegram, exports, guide) : **Gains = nos commissions (CPA + part de revshare) − dépense pub.** Commissions d'après Link Affi (`stats.revenue`, `cpa_revenue`, `revshare_revenue`, ou `players.cpa_affiliate_amount` avec `cpa_status` / `cpa_credited_at` / `cpa_reversed_at` : choisis la source la plus juste, documente-la dans `docs/DECISIONS-TECH.md`), uniquement pour nos campagnes, aux dates réelles. Une CPA annulée se retranche le jour de l'annulation.
- Libellé : « Gains du jour » sur l'accueil, avec en petit « commissions X € − pub Y € ». Les dépôts et le revenu net restent affichés comme indicateurs de volume, jamais additionnés aux gains.

## 2. Variations illisibles
- « > +999 % » quand la veille vaut 0 : afficher « nouveau » (ou rien si les deux valent 0). Plafond d'affichage à ±999 % seulement quand la base n'est pas nulle.

## 3. Bandeau d'état de l'accueil en production
- Les captures (environnement local, données « Démo ») montrent « Envois et synchro à l'arrêt » et « Bot @casinogamblingoobot en erreur ». Vérifie l'état réel en production (worker, files, synchro Link Affi, `getWebhookInfo` des 3 bots) ; corrige toute vraie panne ; assure-toi que le bandeau de production ne remonte jamais un faux problème (ex. : environnement local, worker de test).
- Vérifie la région du worker sur Railway : le client indique l'avoir passé en Europe ; si c'est le cas, retire le point de `docs/A-FAIRE-HUMAIN.md`, sinon garde-le avec les clics exacts.

## 4. Modèles de messages avec repères non remplacés
- 43 modèles contiennent `{offre}` et 13 `{prenom}`, que rien ne remplace dans un canal. Réécris ces modèles : dans un canal, pas de `{prenom}` ; à la place de `{offre}`, une phrase d'appel à l'action et un bouton « Offre (campagne) » pré-configuré dans le modèle. Dans les messages privés (bot, relances, écrire à un groupe), `{prenom}` reste autorisé et doit être remplacé à l'envoi : vérifie-le par un test.

## 5. Relances et « écrire à un groupe » : bouton d'offre avec identifiant de suivi
- Ajoute le bouton « Offre (campagne) » avec identifiant de suivi (sub-ID par membre et par message) aux relances automatiques (cartes et éditeur à branches) et aux envois à un groupe, exactement comme dans les messages de canal, pour que chaque inscription ou dépôt venu d'une relance soit attribué à cette relance. Statistiques par relance : envoyés, clics, inscriptions, premiers dépôts, gains.

## 6. Petites finitions
- Éditeur à branches : la mini-carte affiche des rectangles orange et rouge sans rapport avec les blocs ; corrige son rendu (couleurs du thème, proportions) ou masque-la quand le parcours tient à l'écran.
- Éditeur de texte : test dans Firefox (Playwright) et correction si besoin.
- Capture de la production avec le compte de vérification : trouve une méthode autorisée (par exemple Playwright depuis le Mac sur `https://app.linkaffipro.com` avec le compte de vérification) et relis l'accueil, Campagnes, Messages et Membres en production.

## Livraison
`pnpm lint && pnpm build && pnpm test` verts, déploiement vérifié, `docs/STATUS.md`, guide et `docs/A-FAIRE-HUMAIN.md` à jour, commit et push, bilan Telegram court, puis `docs/PHASE-DONE`.
