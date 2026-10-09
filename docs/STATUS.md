# État du projet — phase 1 : kit minimal prêt (9 octobre 2026, 14h40)

Phase 0 validée le 9 octobre (« phase 0 OK » par Telegram). Sections 1 à 6 de la phase 1 déployées et vérifiées ; sections 7 à 9 en cours.

## Adresses et accès
- Site : https://app.linkaffipro.com — liens traqués : https://go.goolink.eu
- Votre compte : gonneaumatheo.business@gmail.com (mot de passe choisi le 9 octobre).
- Un compte interne « Vérification (Claude) » (verification@linkaffipro.internal, ADMIN) sert à mes contrôles automatiques des pages ; vous pouvez le désactiver dans Réglages si vous préférez (je le recréerai au besoin).
- Dialogue : par Telegram via @casinogamblingoobot (`pnpm tg:send` / `pnpm tg:inbox`).

## Ce qui est fait (kit minimal, sections 1 à 6)
- **Modèle de données complet** (19 tables de plus, voir `docs/DATA-MODEL.md`), migrations appliquées en production.
- **Adhésions** : demandes `chat_join_request` accueillies en privé par le bon bot, flux « rejoins ces canaux » (boutons + « ✅ J'ai rejoint »), approbation immédiate / après délai / manuelle, rappels, expiration ; réglables canal par canal (Canaux → ouvrir un canal → Règles d'adhésion) ; file « Demandes » avec Accepter / Refuser ; entrées et départs suivis.
- **Liens** : page Liens → « Nouveau lien d'entrée (pub) » crée le lien d'invitation Telegram + le lien go.goolink.eu avec l'URL à coller dans TikTok ou Meta (macros officielles) ; liens génériques ; tableaux Entrées / Offres / Boutons avec clics, demandes, acceptés, inscriptions, FTD.
- **Offres personnalisées** : un bouton « Offre » dans un message ouvre le bot, qui répond avec un lien Link Affi portant un **sub-ID unique** (12 caractères) par membre et par message.
- **Messages** : calendrier semaine + liste, éditeur HTML Telegram avec aperçu, médias, boutons (URL / traqué / Offre), options (épingler, supprimer après, silencieux, protégé), brouillons, modèles, duplication, décalage, annulation, suppression sur Telegram ; envoi à l'heure par le worker avec limites de débit Telegram et gestion des erreurs ; réactions comptées.
- **Synchro Link Affi** : toutes les 2 minutes, via l'API en lecture seule ; programmes, campagnes, joueurs, événements, NGR, dépôts ; rattachement joueur → clic → membre → message par sub-ID (`postback` sûr, `time_match` secours) ; Réglages → Connecteurs : état par table, « Synchroniser maintenant », santé du sub-ID, seuils du niveau de dépense. Première synchronisation lancée à 14h35 (109 campagnes et 11 programmes importés ; joueurs en cours).
- **Membres** : liste avec recherche, filtres, tri, export CSV ; fiche membre avec origine, chronologie complète, joueurs rattachés, notes, suppression (anonymisation).
- **Tableau de bord** : aujourd'hui / 7 jours / 30 jours, filtres univers et canal, 11 indicateurs avec tendances, tableau par canal.
- Qualité : 187 tests unitaires, lint et build verts, déploiement vérifié (santé, pages, webhooks des 3 bots).

## Test de 5 minutes (kit minimal)
Pré-requis : votre canal « Test » existe déjà avec @casinogamblingoobot administrateur. Créez un second canal privé « Médiathèque » et ajoutez-y aussi @casinogamblingoobot comme administrateur (il apparaîtra dans Canaux ; cochez « Médiathèque »).

1. Sur le site, Canaux → « Test » → Ouvrir → onglet Règles d'adhésion : mode « Après un délai », délai « 1 minute », canaux à rejoindre : « Médiathèque », mode du gate « Obligatoire », Enregistrer.
2. Liens → « Nouveau lien d'entrée (pub) » : canal « Test », nom « TEST-pub-1 », plateforme « Autre », Créer. Copiez l'URL go.goolink.eu affichée.
3. Depuis votre téléphone, ouvrez cette URL : Telegram s'ouvre sur « Test » avec un bouton « Demander à rejoindre ». Demandez.
4. Le bot vous écrit en privé : rejoignez « Médiathèque » via le bouton, puis appuyez sur « ✅ J'ai rejoint ». Le bot confirme ; vous êtes accepté dans « Test » environ une minute plus tard.
5. Messages → Nouveau message : canal « Test », dans 2 minutes, un texte, un bouton de type « Offre » avec une campagne Link Affi (par exemple celle de Celsius), Programmer. Le message part à l'heure ; appuyez sur le bouton : le bot répond avec votre lien personnalisé (il contient `sub_id=`).
6. Membres → votre fiche : la chronologie montre la demande, l'accueil, le gate, l'acceptation, l'entrée et le clic offre avec son sub-ID.
7. Réglages → Connecteurs : la synchro Link Affi est verte.

Répondez « kit OK » par Telegram quand c'est fait, ou décrivez ce qui ne va pas.

## Ce qui reste (phase 1, sections 7 à 9, en cours)
- Séquences d'accueil par défaut multilingues pour chaque canal et onglet « Messages du bot » (édition par langue, envoi d'un test).
- Réglages → Catégories (CRUD) et comparaison des messages par catégorie.
- Mise à jour finale des docs et test de 5 minutes complet de la phase 1.

## Actions humaines en attente
1. Faire le test de 5 minutes ci-dessus et répondre « kit OK ».
2. Dire quand le développeur Link Affi aura confirmé un premier joueur avec `sub_id_source = postback` (Réglages → Connecteurs l'affichera aussi).
