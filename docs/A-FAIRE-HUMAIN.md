# À faire par un humain (rien d'urgent, regroupé)

## Phase 8 : à faire en premier (15 minutes en tout)
1. **Créer la clé API Anthropic et la coller dans Réglages → IA (5 minutes)** : https://app.linkaffipro.com/settings/ai. Clics exacts : https://platform.claude.com → créer un compte ou se connecter → Settings → Billing → ajouter une carte ou des crédits (5 $ suffisent) → Settings → API keys (https://platform.claude.com/settings/keys) → Create key → nom « LinkAffi Pro », expiration « Never », Linked account = vous → Create → Copy (la clé `sk-ant-…` ne s'affiche qu'une fois) → revenir sur Réglages → IA → coller dans « Clé API Anthropic » → Enregistrer → Vérifier. Le bouton « ✨ Améliorer avec l'IA » s'active alors pour toute l'équipe. Plafond par défaut : 20 € par mois (modifiable sur la même page).
2. **Ajouter vos canaux existants** (2 minutes par canal) : d'abord une fois, Mon compte → **Lier mon Telegram**. Ensuite, dans Telegram, ouvrez chaque canal où un de nos bots est déjà administrateur, appui long sur un message → **Transférer** → choisissez le bot (par exemple @casinogamblingoobot). Le bot répond « Canal « … » ajouté ✅ » et le canal apparaît dans la page Canaux. Si Telegram refuse le transfert : publiez un message dans le canal puis supprimez-le, ou collez le lien public du canal dans Canaux → **Ajouter un canal existant**. Puis, pour chaque canal, réglez la règle d'adhésion (onglet **Règles d'adhésion**) : tant qu'elle n'est pas réglée, les demandes restent à valider à la main et le bot n'écrit à personne de lui-même. **Mediatheque et Test n'ont pas encore de règle** : jusqu'ici leurs demandes étaient acceptées tout de suite ; désormais elles attendent votre bouton « Accepter » (fiche du canal) tant qu'une règle n'est pas enregistrée.
3. **Créer votre première campagne** : menu **Campagnes** → **Nouvelle campagne** (nom et univers, offre Link Affi, canaux, pubs). Tant qu'aucune campagne n'existe, la ligne « Argent » du tableau de bord reste vide : c'est voulu, seules vos données comptent.
4. **Créer vos catégories de messages** : les 7 catégories créées d'office ont été retirées. Créez les vôtres dans Messages → Nouveau message → Catégorie → **+ Nouvelle catégorie**, ou dans Réglages → Catégories de messages.

## Tableau de bord Railway (2 clics chacun)
5. **Worker en Europe** : railway.com → projet linkaffipro → service worker → Settings → Regions → EU West (Amsterdam) → Deploy. Il est encore aux États-Unis (0,15 s par requête vers la base). Le volume de sauvegardes suivra le service.
6. **Sauvegardes de volume Railway** (en plus des sauvegardes automatiques de la plateforme) : projet linkaffipro → Postgres → Settings → Backups → activer Daily, Weekly et Monthly (voir `docs/SAUVEGARDES.md`).

## Phase 7 : trois applications à créer, puis tout se branche depuis le site (Réglages → Connecteurs)
7a. **Application Meta** (10 minutes) : https://app.linkaffipro.com/settings/connectors/meta explique chaque clic (developers.facebook.com → Créer une app → Facebook Login for Business → adresse de retour à coller → App ID + Clé secrète → Rôles de l'app). Puis « Connecter un compte Meta » et cocher les comptes.
7b. **Application TikTok** (10 minutes + validation TikTok sous 1 à 2 semaines) : https://app.linkaffipro.com/settings/connectors/tiktok (business-api.tiktok.com/portal → Become a Developer → Create an App → adresse de retour → permissions Lecture → Submit). En attendant la validation : « Mode bac à sable » avec un compte de test.
7c. **Application Telegram** (5 minutes) : https://app.linkaffipro.com/settings/connectors/telegram (my.telegram.org → API development tools → api_id + api_hash), puis votre numéro, le code reçu dans Telegram, et le mot de passe de validation en deux étapes si activé.

## Quand les comptes existeront
8. **Comptes publicitaires** : dès qu'un compte TikTok Ads ou Meta Ads existe, le brancher depuis le site (7a / 7b ci-dessus) ; l'import CSV reste disponible en secours.
9. **Vues par message** : se fait maintenant seul depuis le site (7c ci-dessus). Sans cela, les meilleurs horaires et les tests A/B se basent sur les clics et les réactions.

## Relecture (quand vous voulez)
10. **Automatisations** : les règles modèles sont créées inactives ; relire les textes puis les activer (page Automatisations).
11. **Modèles de messages** : 63 modèles installés (Messages → Modèles, filtre par univers et par thème) ; relire ceux de votre univers avant de les utiliser, et ne pas retirer la mention des risques (casino, paris).
12. **Traductions du bot** : les textes en, es, pt, de, it ont été écrits par Claude ; faire relire par un locuteur si une langue devient importante.
13. **Équipe** : créer le compte de l'associé dans Réglages → Équipe (copier le lien d'invitation et le lui envoyer).
