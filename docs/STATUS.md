# État du projet — phase 1 terminée et validée (9 octobre 2026, 15h05)

Phase 0 validée le 9 octobre (« phase 0 OK » par Telegram). Phase 1 (sections 1 à 9) déployée ; « phase 1 OK » reçu à 14h52. Test de bout en bout réalisé par Claude à 15h00 : message privé via la file ✅, message programmé avec bouton Offre parti à l'heure ✅, clic Offre → lien personnalisé avec sub-ID et clic enregistré ✅. Un bug trouvé pendant le test de l'utilisateur (messages privés bloqués par un identifiant de tâche refusé par BullMQ) a été corrigé et redéployé.

## Adresses et accès
- Site : https://app.linkaffipro.com — liens traqués : https://go.goolink.eu
- Votre compte : gonneaumatheo.business@gmail.com (mot de passe choisi le 9 octobre).
- Un compte interne « Vérification (Claude) » (verification@linkaffipro.internal, ADMIN) sert à mes contrôles automatiques des pages ; vous pouvez le désactiver dans Réglages si vous préférez (je le recréerai au besoin).
- Dialogue : par Telegram via @casinogamblingoobot (`pnpm tg:send` / `pnpm tg:inbox`).

## Ce qui est fait (phase 1 complète)
- **Modèle de données complet** (19 tables de plus, voir `docs/DATA-MODEL.md`), migrations appliquées en production.
- **Adhésions** : demandes `chat_join_request` accueillies en privé par le bon bot, flux « rejoins ces canaux » (boutons + « ✅ J'ai rejoint »), approbation immédiate / après délai / manuelle, rappels, expiration ; réglables canal par canal (Canaux → ouvrir un canal → Règles d'adhésion) ; file « Demandes » avec Accepter / Refuser ; entrées et départs suivis.
- **Liens** : page Liens → « Nouveau lien d'entrée (pub) » crée le lien d'invitation Telegram + le lien go.goolink.eu avec l'URL à coller dans TikTok ou Meta (macros officielles) ; liens génériques ; tableaux Entrées / Offres / Boutons avec clics, demandes, acceptés, inscriptions, FTD.
- **Offres personnalisées** : un bouton « Offre » dans un message ouvre le bot, qui répond avec un lien Link Affi portant un **sub-ID unique** (12 caractères) par membre et par message.
- **Messages** : calendrier semaine + liste, éditeur HTML Telegram avec aperçu, médias, boutons (URL / traqué / Offre), options (épingler, supprimer après, silencieux, protégé), brouillons, modèles, duplication, décalage, annulation, suppression sur Telegram ; envoi à l'heure par le worker avec limites de débit Telegram et gestion des erreurs ; réactions comptées.
- **Synchro Link Affi** : toutes les 2 minutes, via l'API en lecture seule ; programmes, campagnes, joueurs, événements, NGR, dépôts ; rattachement joueur → clic → membre → message par sub-ID (`postback` sûr, `time_match` secours) ; Réglages → Connecteurs : état par table, « Synchroniser maintenant », santé du sub-ID, seuils du niveau de dépense. Première synchronisation lancée à 14h35 (109 campagnes et 11 programmes importés ; joueurs en cours).
- **Membres** : liste avec recherche, filtres, tri, export CSV ; fiche membre avec origine, chronologie complète, joueurs rattachés, notes, suppression (anonymisation).
- **Tableau de bord** : aujourd'hui / 7 jours / 30 jours, filtres univers et canal, 11 indicateurs avec tendances, tableau par canal.
- **Séquences d'accueil** : textes par défaut par univers (casino, paris, dating) pour accueil, rappel, gate satisfait, accepté, réponse d'offre ; créés automatiquement pour chaque canal détecté ; Canaux → canal → onglet « Messages du bot » pour les modifier par langue (ajout de langue en un clic, aperçu, envoi d'un test à vous-même si votre Telegram est lié dans Mon compte).
- **Catégories** : Réglages → Catégories (7 par défaut, couleurs, ordre) ; Messages → « Comparer par catégorie » (messages envoyés, clics, offres, réactions, inscriptions, FTD, dépôts, moyennes par message, sur 7 / 30 / 90 jours).
- Qualité : 199 tests unitaires, lint et build verts, déploiement vérifié (santé, pages, webhooks des 3 bots).

## Test de 5 minutes (phase 1)
Vos canaux « Test » et « Mediatheque » existent avec @casinogamblingoobot administrateur.

1. Canaux → « Test » → Ouvrir → Règles d'adhésion : mode « Après un délai », délai « 1 minute », canal à rejoindre « Mediatheque », gate « Obligatoire », Enregistrer. Onglet « Messages du bot » : les textes par défaut sont là ; modifiez-en un si vous voulez.
2. Liens → « Nouveau lien d'entrée (pub) » : canal « Test », nom « TEST-pub-1 », plateforme « Autre », Créer. Copiez l'URL go.goolink.eu affichée.
3. Depuis votre téléphone, ouvrez cette URL : Telegram s'ouvre sur « Test » ; demandez à rejoindre.
4. Le bot vous écrit : rejoignez « Mediatheque » via le bouton, puis « ✅ J'ai rejoint ». Le bot confirme ; vous êtes accepté dans « Test » une minute plus tard.
5. Messages → Nouveau message : canal « Test », dans 2 minutes, un texte, un bouton « Offre » avec une campagne Link Affi (Celsius), Programmer. Le message part à l'heure ; appuyez sur le bouton : le bot répond avec votre lien personnalisé (il contient `sub_id=`).
6. Membres → votre fiche : la chronologie montre demande, accueil, gate, acceptation, entrée et le clic offre avec son sub-ID.
7. Réglages → Connecteurs : la synchro Link Affi est verte (la première synchronisation complète prend quelques dizaines de minutes).

Validé par vous (« phase 1 OK ») et par le test automatique ci-dessus. Pour vérifier le dernier maillon (Link Affi reçoit bien le sub-ID), ouvrez une seule fois le lien d'offre que le bot vous a envoyé le 9 octobre à 15h04 : la table `clicks` de Link Affi doit contenir `sub_id = 9jjjff9u4U9F`.

## Ce qui reste (phase 2)
Vues par message (couche MTProto), connecteurs Meta et TikTok, tableaux de bord complets par pub, purge 24 mois, automatisations « si… alors… ».

## Actions humaines en attente
1. Choisir la suite (réponse 1 ou 2 par Telegram) : ajouter le prompt de phase 2 dans `docs/prompts/`, ou laisser Claude préparer la phase 2 d'après le cadrage.
2. Passer le service « worker » en Europe (railway.com → projet linkaffipro → worker → Settings → Regions → EU West (Amsterdam) → Deploy) : il est encore aux États-Unis, ce qui ralentit la synchro (0,15 s par requête). Postgres, Redis et web sont déjà en Europe.
3. Surveiller Réglages → Connecteurs → « Santé du sub-ID » après les premiers vrais joueurs : des joueurs en `postback` = chaîne complète validée ; seulement `time_match` = demander à Lovable l'encodage sans point.
