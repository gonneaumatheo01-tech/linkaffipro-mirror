# État du projet : phase 8 (corrections du client, canaux existants, campagnes, assistant IA) terminée (10 octobre 2026, 12h05)

Phases 0 à 7 en ligne. Phase 8 = les retours du client du 10 octobre (`docs/prompts/10-phase-8-corrections-et-ia-messages.md`). 993 tests unitaires et 82 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé.

## Phase 8 : ce qui a changé (10 octobre)
- **Vos canaux existants** : Canaux → **Ajouter un canal existant**. Trois méthodes : transférer un message du canal au bot (canaux privés compris), coller le lien public, ou publier un message. La liste se rafraîchit seule pendant 2 minutes. Deux boutons de plus : **Importer tous mes canaux**, avec le compte Telegram connecté, et **Re-vérifier les droits des bots**. Tout canal qui envoie quelque chose à un bot est créé automatiquement. Un bot n'est plus jamais marqué « retiré » à tort : Telegram doit confirmer son départ.
- **Statistiques justes** : seuls vos joueurs comptent partout (tableau de bord, campagnes, entonnoir, cohortes, canaux, fiches, rapports Telegram, alertes). Vos joueurs sont ceux venus d'un de vos clics ou d'une offre Link Affi liée à une de vos campagnes. Les dates sont celles de Link Affi, et le NGR est daté variation par variation. Résultat : 7, 30 et 90 jours donnent des chiffres différents. Le tableau de bord se lit en deux lignes, Telegram puis Argent. Sans campagne, il affiche « Pas encore de chiffres : créez votre première campagne ». La tuile « Événements (24 h) » est passée dans Réglages → État du système et dans Journal → Événements.
- **Campagnes** (2e menu) : assistant en 4 étapes (nom, offres, canaux, pubs) et fiche à onglets (Vue d'ensemble, Pubs, Liens, Canaux, Messages, Membres, Offres). Le bouton **Offre** se règle par campagne. Le filtre Campagne existe sur le tableau de bord, Membres, Messages (liste, calendrier, export) et Envois. La ligne Total compte chaque joueur une seule fois. Les campagnes pub TikTok / Meta sont rattachées à vos campagnes, et les statistiques se recalculent seules après chaque modification.
- **Catégories** : plus aucune n'est créée d'office. Vous créez les vôtres, avec **+ Nouvelle catégorie** directement dans le formulaire de message. Vous pouvez les renommer, changer leur couleur et leur ordre, les fusionner ou les supprimer en choisissant un remplacement. Les 63 modèles fournis ont des thèmes, pas des catégories.
- **Assistant IA** : bouton **✨ Améliorer avec l'IA** sur les messages de canal, les modèles, les envois (versions A et B), les textes du bot et les automatisations. Il propose 3 versions, puis « Plus court », « Plus percutant », « Autre angle », traductions et version B. Il peut aussi écrire à partir d'une idée et s'inspire de vos messages qui ont marché. Réglages → IA : clé chiffrée, Vérifier, plafond mensuel (20 € par défaut), limite par personne, historique. Les règles de conformité sont imposées : pas de promesse de gains, mention des risques, 18+.

## À faire par vous (15 minutes, détail dans `docs/A-FAIRE-HUMAIN.md`)
1. **Créer la clé API Anthropic et la coller dans Réglages → IA (5 minutes)**.
2. **Ajouter vos canaux existants** : Mon compte → Lier mon Telegram, puis transférer un message de chaque canal au bot. Ensuite, enregistrer une règle d'adhésion par canal. Mediatheque et Test n'en ont pas : leurs demandes attendent désormais le bouton « Accepter ».
3. **Créer votre première campagne** (Campagnes → Nouvelle campagne).
4. **Créer vos catégories** (dans le formulaire de message).

## Test de 5 minutes
1. https://app.linkaffipro.com : le tableau de bord affiche « Pas encore de chiffres : créez votre première campagne », ou deux lignes Telegram / Argent s'il y a une campagne.
2. Canaux → **Ajouter un canal existant** : la fenêtre montre les 3 méthodes. Transférez un message d'un canal au bot : il répond « Canal « … » ajouté ✅ ».
3. Campagnes → **Nouvelle campagne** : les 4 étapes s'enchaînent ; à la fin, l'onglet Liens donne l'adresse à coller dans la pub.
4. Messages → Nouveau message → Catégorie → **+ Nouvelle catégorie** : la catégorie est créée et choisie.
5. Réglages → IA : collez la clé, **Vérifier** ; puis dans un message, **✨ Améliorer avec l'IA** propose 3 versions.

## Problèmes connus et limites
- Testé par Claude avec des mises à jour Telegram simulées, sur une vraie base, puis contrôlé en production avec le compte de vérification (32 pages, textes attendus). Pas encore testé par une vraie personne : le transfert d'un message au bot (méthode 1), à faire avec le message Telegram envoyé ce matin.
- L'assistant IA a été testé avec une API simulée ; il fonctionnera dès que la clé sera collée dans Réglages → IA.
- Reprise des données faite en production : 89 écarts de NGR datés, les 7 catégories d'office retirées des 63 modèles, puis recalcul complet des statistiques. Sauvegarde faite juste avant (Réglages → État du système → Dernière sauvegarde).
- Un ancien bouton Offre (créé avant les campagnes) se duplique en choisissant sa campagne ; sinon le message n'est pas enregistré et un message explique quoi faire.
- Deux cas rares où la vue d'ensemble et l'onglet Entonnoir peuvent différer d'une unité : membre arrivé par deux pubs dans deux canaux différents, ou joueur avec clic sans message ni pub d'origine sous le seul filtre univers.
- Une campagne pub déjà importée, puis renommée plus tard comme votre campagne, ne se rattache pas toute seule : utilisez « Rattacher une campagne pub importée » (onglet Pubs).
- Le worker est toujours aux États-Unis (clic à faire, `docs/A-FAIRE-HUMAIN.md`).

## Adresses et accès
- Site : https://app.linkaffipro.com — liens traqués : https://go.goolink.eu
- Votre compte : gonneaumatheo.business@gmail.com (mot de passe choisi le 9 octobre). Compte interne de vérification : verification@linkaffipro.internal (ADMIN, utilisé par Claude pour ses contrôles).
- Dialogue par Telegram via @casinogamblingoobot.

## Ce qui est en ligne (phases 1 à 3)
- **Rapports automatiques par Telegram** : brief quotidien à 9h et rapport hebdomadaire le lundi (chiffres de la veille / de la semaine, comparaison, alertes, synchro, messages à venir) ; Réglages → Rapports pour activer, changer l'heure ou envoyer maintenant.
- **Médias dans les messages privés** : photo, vidéo, gif ou document joint aux messages d'accueil, rappels, réponses d'offre et envois groupés (choix dans l'onglet « Messages du bot »).
- **Intégration continue** : chaque envoi sur GitHub est vérifié automatiquement (lint, typage, tests, build).
- **Adhésions** avec délai et canaux à rejoindre, accueil par le bot, demandes à valider, textes d'accueil par univers (onglet « Messages du bot » de chaque canal).
- **Liens** par pub (URL à coller dans TikTok / Meta), redirections go.goolink.eu, boutons traqués, offres avec sub-ID.
- **Messages** programmés (calendrier, éditeur, médias, boutons, modèles), réactions, catégories et comparaison par catégorie.
- **Synchro Link Affi** toutes les 2 minutes (Réglages → Connecteurs : état, santé du sub-ID, seuils du niveau de dépense).
- **Membres** (liste, filtres, export CSV, fiche avec chronologie, suppression) et **Envois** groupés ciblés (segments par canal, niveau de dépense, source, langue, inactivité ; test à soi-même ; programmation ; progression).
- **Pubs** : campagnes, groupes, pubs reliées aux liens d'entrée, coûts par jour (import CSV TikTok Ads Manager / Meta Ads Manager ou saisie manuelle), CPL / CPA / coût par FTD / ROAS / bénéfice.
- **Tableau de bord** : vue d'ensemble, onglet Pubs (avec comparaison de périodes et export), Entonnoir (pertes à chaque étape), Cohortes (semaine d'arrivée, J+7 / J+30, LTV), Canaux (croissance, meilleurs horaires et catégories). Statistiques journalières recalculées chaque heure.
- **Postbacks directs** (Réglages → Postbacks) pour les programmes hors Link Affi : URL à donner au programme, mapping des paramètres, postback de test, import CSV de joueurs.
- **Solidité** : purge automatique des membres inactifs après 24 mois (réglable dans Réglages → Alertes), alertes envoyées sur votre Telegram (bot en erreur, synchro en échec, file engorgée, blocages en masse, santé du sub-ID), sauvegarde manuelle `pnpm db:dump`, 285 tests unitaires + 7 tests d'intégration.

## Tests de bout en bout réalisés par Claude (production, 9 octobre)
- Demande d'adhésion via lien d'entrée → acceptée ; messages privés via la file ✅.
- Message programmé avec bouton Offre → parti à l'heure ; clic → lien personnalisé `sub_id=9jjjff9u4U9F` ✅.
- **Link Affi a bien reçu ce sub-ID** : 2 clics enregistrés chez Link Affi avec `sub_id = 9jjjff9u4U9F` (le lien a été ouvert depuis votre téléphone à 15h04) ✅. Le dernier maillon (postback du casino avec le sub-ID) se vérifiera avec le premier vrai joueur : Réglages → Connecteurs → Santé du sub-ID.
- Postback direct simulé (inscription puis FTD 20 €, doublon ignoré, jeton inconnu refusé) → joueur rattaché au membre, au message et au canal ✅.
- Envoi groupé « tous les membres joignables » → 1 destinataire, envoyé ✅ (vous l'avez reçu).
- Statistiques journalières recalculées ✅ ; toutes les pages répondent ✅.

## Actions humaines (quand vous avez un moment, rien d'urgent) — liste complète dans `docs/A-FAIRE-HUMAIN.md`
1. **Worker en Europe** : railway.com → projet linkaffipro → worker → Settings → Regions → EU West (Amsterdam) → Deploy. Il est encore aux États-Unis (0,15 s par requête).
2. **Sauvegardes Railway** : projet linkaffipro → Postgres → Settings → Backups → activer Daily, Weekly et Monthly (voir `docs/SAUVEGARDES.md`).
3. **Comptes publicitaires** : dès qu'un compte TikTok Ads ou Meta Ads existe, dites-le : les connecteurs API remplaceront l'import CSV.
4. **Vues par message** (nombre de vues Telegram) : nécessite une connexion avec votre numéro de téléphone (code SMS), à faire ensemble en 5 minutes quand vous voudrez.

- **Automatisations « si… alors… »** (page Automatisations) : déclencheurs (a rejoint, a cliqué une offre, s'est inscrit, a déposé, inactif depuis N jours, a quitté, niveau de dépense atteint), conditions (canal, pub, langue, niveau), actions enchaînées (message, séquence du canal, attendre, étiqueter, proposer un canal, prévenir l'équipe), modèles proposés, journal par règle, « Tester sur moi ». Les règles sont créées inactives : activez-les quand le texte vous convient.

- **Tests A/B des envois groupés** : dans « Nouvel envoi », cochez « Test A/B », écrivez la version B (texte, média, boutons) et choisissez la part (10 à 90 %). Les destinataires sont répartis au hasard mais de façon stable ; la page du test compare envoyés, clics, cliqueurs uniques, inscriptions, FTD et désigne la gagnante (au moins 30 envois par version). Bouton « Envoyer la version gagnante au reste du segment » pour les membres pas encore servis.
- **Sécurité du site** (`docs/SECURITE.md`) : 10 échecs de connexion en 15 minutes (par e-mail ou par adresse) bloquent la connexion 15 minutes ; en-têtes de sécurité (HSTS, anti-cadre, CSP) ; webhooks et postbacks limités à 1 Mo ; suppressions réservées aux ADMIN.

## Phase 7 — connecteurs directs (10 octobre, 7h00)
- **Comptes publicitaires Meta et TikTok** branchés depuis le site (Réglages → Connecteurs → Meta / TikTok) : enregistrement des identifiants d'application (chiffrés, bouton Vérifier), guide clic par clic avec les valeurs exactes à copier, bouton « Connecter un compte », connexion chez Meta ou TikTok, liste des comptes à cocher, plusieurs comptes et plusieurs utilisateurs, déconnexion en un clic, reconnexion guidée (statut « À reconnecter » + alerte Telegram).
- **Dépenses automatiques** : toutes les heures (3 derniers jours), 28 jours chaque nuit, 90 jours à la connexion ; campagnes, groupes et pubs créés dans Pubs et reliés aux liens d'entrée de même nom ; dépenses converties en euros (taux Link Affi toutes les 6 h, ou saisis dans Connecteurs) ; journal par connexion (dernière synchro, lignes, erreur lisible) ; priorité à l'API sur le CSV ; badge de source (API / Fichier / Saisie) dans Pubs.
- **Vues Telegram par message** : Réglages → Connecteurs → Telegram : api_id / api_hash (my.telegram.org), numéro, code reçu dans Telegram, mot de passe 2FA ; relevés toutes les 15 min pendant 48 h puis quotidiens jusqu'à 30 jours ; tuiles Vues / Transferts et courbe dans la fiche message ; meilleurs horaires et A/B utilisent les vues dès qu'elles existent.
- Pages publiques `/privacy` et `/terms` (exigées par Meta). 571 tests unitaires + 22 d'intégration, CI verte.
- **Reste à faire par vous** (10 + 10 + 5 minutes, guidé dans chaque page) : créer l'app Meta, l'app TikTok (puis attendre sa validation, 1 à 2 semaines ; bac à sable en attendant) et l'app Telegram sur my.telegram.org. Voir `docs/A-FAIRE-HUMAIN.md`.
- Non testable sans ces apps : le vrai dialogue de connexion Meta / TikTok, les en-têtes de quota en production, la lecture réelle des vues ; tout est couvert par des réponses simulées et un bouton « Vérifier » signalera tout écart de la doc TikTok (portail non lisible par script).

## Phase 6 — compléments (9 octobre, 21h20)
- **Meilleurs horaires** : fiche canal → onglet « Meilleurs horaires » (carte jour × heure, recommandation, recalcul) ; encart « Meilleur créneau » dans le formulaire de message avec « Utiliser ».
- **Tests A/B des messages de canal** : case « Test A/B » dans Nouveau message (B 30 min après A dans le même canal, ou autre canal), page de comparaison avec gagnante provisoire.
- **63 modèles de messages** prêts à l'emploi (casino, paris, dating × 7 catégories), vue Messages → Modèles avec filtres, mention des risques sur casino et paris.
- **5 alertes métier** de plus (chute des inscriptions, dépense sans inscription, canal qui fuit, message en échec, lien désactivé cliqué) avec seuils réglables dans Réglages → Alertes.
- **Import des coûts** : détection automatique TikTok / Meta, aperçu colonne → champ modifiable, formats de nombres et de dates, mapping mémorisé, rapport d'import.
- **Périodes** : sélecteur commun (aujourd'hui, hier, 7/30/90 jours, mois, personnalisé) + « Comparer à la période précédente » sur le tableau de bord et les pubs, exports avec variation.
- **Réglages → Équipe** (invitations par lien à copier, rôles, désactivation, réinitialisation de mot de passe par lien), **Étiquettes de membres** (registre, fiche, filtre, ciblage des envois), notes modifiables, convention de nommage des pubs + liaison suggérée avec Link Affi, **bot en 6 langues** (fr, en, es, pt, de, it).

## Phase 5 — finitions (9 octobre, 20h50)
- **Interface** : chaque écran a une ligne d'aide, un état vide avec le bouton de la première action, un écran de chargement, une page d'erreur lisible avec « Réessayer », une confirmation avant toute action irréversible, des infobulles « ? » sur chaque indicateur (CPL, CPA, ROAS, NGR, cohortes…), des statuts aux mêmes libellés et couleurs partout, des textes relus en français simple (termes techniques expliqués : identifiant de suivi (sub-ID), premier dépôt (FTD), connexion Telegram).
- **Téléphone et accessibilité** : menu en tiroir, tableaux qui défilent, colonnes secondaires masquées, champs et boutons libellés ; contrôle automatique à chaque exécution des tests.
- **Confort** : recherche globale (loupe en haut ou `⌘K` / `Ctrl+K` : membres, messages, canaux, pubs, règles), raccourcis (`?` pour la liste), filtres mémorisés par page avec « Réinitialiser », export CSV sur chaque liste (membres, joueurs, messages, envois, pubs et coûts, journal) lisible dans Excel.
- **Guide d'utilisation** : menu **Aide** dans le site (et `docs/GUIDE-UTILISATEUR.md`) : les 10 premières minutes, comment ça marche, une section par menu (à quoi ça sert, comment faire, pièges), que faire si…, règles à respecter, lexique.

## Phase 4 — solidité (9 octobre, 20h15)
- **Tests automatiques** : 359 tests unitaires + 22 tests d'intégration sur base réelle (adhésion, offre avec sub-ID, message programmé, synchro Link Affi simulée, postback, redirection), exécutés aussi par GitHub Actions à chaque envoi.
- **Surveillance** : Réglages → **État du système** (santé du site et du worker, files d'attente, tâches échouées à relancer en un clic, bots, synchro, alertes, dernière sauvegarde). Nouvelles alertes Telegram : worker arrêté, erreurs répétées, sauvegarde en échec.
- **Sauvegardes automatiques** : chaque nuit à 4 h, copie complète de la base dans un espace de stockage Railway dédié (14 jours conservés), visible dans l'État du système et dans le brief quotidien. Restauration testée (`docs/SAUVEGARDES.md`).
- **Reprise sur erreur** : les envois Telegram, la synchro et les statistiques réessaient 3 fois ; les tâches bloquées sont reprises ; les échecs anciens sont purgés.
- **Performance** : 28 index de base, pagination de toutes les longues listes, tableaux de bord mis en cache 60 s.
- **Sécurité** : changer son mot de passe ou perdre ses droits déconnecte les autres appareils ; journal filtrable (utilisateur, action, période) ; toutes les actions journalisées.

## Tests réalisés par Claude en production (9 octobre, 19h35 à 19h45)
- Déploiement web + worker vérifié (health check ok, base et Redis ok, migrations à jour).
- En-têtes de sécurité présents sur les pages, absents (CSP) sur l'API et les redirections go.goolink.eu ✅.
- Test A/B créé par le formulaire réel (50/50, envoi immédiat à tous les membres joignables) : version A envoyée à 1 membre (vous : message « Version A : test A/B de la plateforme »), version B 0 ; page de comparaison correcte ✅.
- Limitation des connexions : 10 mauvais mots de passe puis le bon → refusé, aucune session ouverte, journal `auth.login_throttled` ✅.
- 333 tests unitaires verts, lint, typage et build verts, CI GitHub.

## Test de 5 minutes (quand vous voulez)
1. Ouvrez https://app.linkaffipro.com/automations : choisissez un modèle (ex. « Relance après clic sans inscription »), relisez le texte, cliquez « Tester sur moi » : vous recevez le message sur Telegram. Activez la règle si le texte vous convient.
2. Ouvrez https://app.linkaffipro.com/broadcasts : cliquez sur « Test A/B (vérification Claude) » pour voir la page de comparaison. Dans « Nouvel envoi », cochez « Test A/B » pour voir le formulaire à deux versions.
3. Demain à 9h : vous recevez le brief quotidien sur Telegram (Réglages → Rapports pour changer l'heure ou l'envoyer maintenant).

## Plus tard (quand les comptes existeront)
Connecteurs API Meta / TikTok, vues par message (MTProto, connexion téléphone).
