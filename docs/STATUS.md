# État du projet — phases 4, 5 et 6 terminées (9 octobre 2026, 21h20) ; chaîne autonome achevée

Phases 0 et 1 validées (Telegram). Phases 2, 3 et 4 déployées et testées par Claude (tests automatiques et simulés). Mode autonome le 9 octobre au soir : phases 4 (solidité), 5 (finitions) et 6 (compléments) enchaînées sans intervention humaine (`docs/prompts/05-phases-suivantes-autonome.md`). 483 tests unitaires + 22 tests d'intégration, CI GitHub verte, tout déployé.

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
