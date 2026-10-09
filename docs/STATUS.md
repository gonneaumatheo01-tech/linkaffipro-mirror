# État du projet — phase 2 déployée (9 octobre 2026, 15h40)

Phases 0 et 1 validées (Telegram). Phase 2 (prompt `docs/prompts/03-phase-2-connecteurs-et-stats.md`, rédigé par Claude et validé « Ok ») déployée et testée de bout en bout par Claude.

## Adresses et accès
- Site : https://app.linkaffipro.com — liens traqués : https://go.goolink.eu
- Votre compte : gonneaumatheo.business@gmail.com (mot de passe choisi le 9 octobre). Compte interne de vérification : verification@linkaffipro.internal (ADMIN, utilisé par Claude pour ses contrôles).
- Dialogue par Telegram via @casinogamblingoobot.

## Ce qui est en ligne (phases 1 et 2)
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

## Actions humaines (quand vous avez un moment, rien d'urgent)
1. **Worker en Europe** : railway.com → projet linkaffipro → worker → Settings → Regions → EU West (Amsterdam) → Deploy. Il est encore aux États-Unis (0,15 s par requête).
2. **Sauvegardes Railway** : projet linkaffipro → Postgres → Settings → Backups → activer Daily, Weekly et Monthly (voir `docs/SAUVEGARDES.md`).
3. **Comptes publicitaires** : dès qu'un compte TikTok Ads ou Meta Ads existe, dites-le : les connecteurs API remplaceront l'import CSV.
4. **Vues par message** (nombre de vues Telegram) : nécessite une connexion avec votre numéro de téléphone (code SMS), à faire ensemble en 5 minutes quand vous voudrez.

## Prochaines étapes possibles (phase 3)
Connecteurs API Meta / TikTok, vues par message (MTProto), automatisations « si… alors… » (éditeur par blocs), tests A/B de messages, rapports hebdomadaires automatiques par Telegram.
