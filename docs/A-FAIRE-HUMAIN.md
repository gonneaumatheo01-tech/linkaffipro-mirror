# À faire par un humain (rien d'urgent, regroupé)

## Tableau de bord Railway (2 clics chacun)
1. **Worker en Europe** : railway.com → projet linkaffipro → service worker → Settings → Regions → EU West (Amsterdam) → Deploy. Il est encore aux États-Unis (0,15 s par requête vers la base). Le volume de sauvegardes suivra le service.
2. **Sauvegardes de volume Railway** (en plus des sauvegardes automatiques de la plateforme) : projet linkaffipro → Postgres → Settings → Backups → activer Daily, Weekly et Monthly (voir `docs/SAUVEGARDES.md`).

## Phase 7 : trois applications à créer, puis tout se branche depuis le site (Réglages → Connecteurs)
3a. **Application Meta** (10 minutes) : https://app.linkaffipro.com/settings/connectors/meta explique chaque clic (developers.facebook.com → Créer une app → Facebook Login for Business → adresse de retour à coller → App ID + Clé secrète → Rôles de l'app). Puis « Connecter un compte Meta » et cocher les comptes.
3b. **Application TikTok** (10 minutes + validation TikTok sous 1 à 2 semaines) : https://app.linkaffipro.com/settings/connectors/tiktok (business-api.tiktok.com/portal → Become a Developer → Create an App → adresse de retour → permissions Lecture → Submit). En attendant la validation : « Mode bac à sable » avec un compte de test.
3c. **Application Telegram** (5 minutes) : https://app.linkaffipro.com/settings/connectors/telegram (my.telegram.org → API development tools → api_id + api_hash), puis votre numéro, le code reçu dans Telegram, et le mot de passe de validation en deux étapes si activé.

## Quand les comptes existeront
3. **Comptes publicitaires** : dès qu'un compte TikTok Ads ou Meta Ads existe, le brancher depuis le site (3a / 3b ci-dessus) ; l'import CSV reste disponible en secours.
4. **Vues par message** : se fait maintenant seul depuis le site (3c ci-dessus). Sans cela, les meilleurs horaires et les tests A/B se basent sur les clics et les réactions.

## Relecture (quand vous voulez)
5. **Automatisations** : les règles modèles sont créées inactives ; relire les textes puis les activer (page Automatisations).
6. **Modèles de messages** : 63 modèles installés (Messages → Modèles) ; relire ceux de votre univers avant de les utiliser, et ne pas retirer la mention des risques (casino, paris).
7. **Traductions du bot** : les textes en, es, pt, de, it ont été écrits par Claude ; faire relire par un locuteur si une langue devient importante.
8. **Équipe** : créer le compte de l'associé dans Réglages → Équipe (copier le lien d'invitation et le lui envoyer).
