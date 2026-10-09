# Phase 3 — Confort d'exploitation et automatisations (rédigé par Claude le 9 octobre 2026, après « continue » de l'utilisateur ; aucune sollicitation prévue)

Pré-requis : phases 0 à 2 déployées. Tout ce qui suit se fait et se teste en autonomie ; un seul message Telegram à la fin.

## A. Rapports automatiques par Telegram (chiffres, sans IA)
Brief quotidien à 9h (Europe/Paris) et rapport hebdomadaire le lundi, à partir de `DailyStat` : demandes, acceptés, entrées, départs, clics, inscriptions, FTD, dépôts, NGR, dépense, CPL / CPA / coût par FTD / ROAS, comparaison avec la période précédente, alertes ouvertes, état de la synchro, messages programmés à venir. Réglages → Rapports : activation, heure, envoi immédiat, aperçu du dernier envoi.

## B. Médias dans les messages privés
`OutboundMessage.mediaAssetId` : photo / vidéo / gif / document envoyés avec le texte en légende (accueil, rappels, accepté, réponse d'offre, envois groupés, tests), `file_id` réutilisé par bot. Choix d'un média dans l'onglet « Messages du bot ».

## C. Intégration continue
GitHub Actions sur `main` et les pull requests : install, generate, lint, typage, tests, build.

## D. Automatisations « si… alors… » (étape suivante, après A–C)
Règles simples sans éditeur visuel complexe : déclencheur (a rejoint, a cliqué une offre, s'est inscrit, a déposé, inactif depuis N jours, a quitté, niveau de dépense atteint) → conditions (canal, pub, langue, niveau) → actions (envoyer une séquence / un message, attendre N heures, étiqueter, proposer un canal, prévenir l'équipe par Telegram). Exécution par le worker, journal par règle, test à soi-même, activation / désactivation.

## E. Hors périmètre tant que l'utilisateur n'a pas agi
Connecteurs API Meta / TikTok (comptes publicitaires), vues par message (connexion téléphone MTProto), IA manager (écartée par le client).
