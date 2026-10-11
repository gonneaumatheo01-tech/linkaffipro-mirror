# À faire par un humain (rien d'urgent, regroupé)

## Phase 10 : à regarder (5 minutes, rien d'obligatoire)
1. **Accueil** : la carte « Gains du jour » = vos commissions moins la dépense pub (le détail est écrit dessous). Les dépôts ne comptent plus dans les gains.
2. **« À faire »** : deux demandes du 11 octobre au matin (Zone Interdite) y sont encore : cliquez « Renvoyer l'accueil avec les liens » ou acceptez-les.
3. **Canaux à rejoindre** : pour chaque canal réglé sur « après avoir rejoint ces canaux », ouvrez l'onglet « Qui peut entrer et quand » : le cadre « Liens des canaux à rejoindre » doit être vert. Sinon, il dit quel bot ajouter comme administrateur (avec le droit « Inviter via un lien »), puis « Vérifier les liens ».
4. **Modèles d'offre** : en utilisant un modèle, choisissez la campagne du bouton « Offre » avant de programmer.

## Phase 9 : découvrir le nouveau site (5 minutes, rien d'obligatoire)
1. Ouvrez https://app.linkaffipro.com : la **visite guidée** de 2 minutes démarre toute seule à la première connexion (sinon Réglages → « Revoir la visite »). En haut de l'accueil, la liste « À faire pour démarrer » coche toute seule ce qui est fait.
2. Sur votre téléphone, ouvrez le même site : barre du bas (Accueil, Messages, Membres, Campagnes, Plus), calendrier jour par jour, demandes à valider dans la fiche du canal.
3. Le bouton **?** en haut à droite ouvre l'aide de la page où vous êtes. Les anciennes adresses (favoris) marchent toujours.
4. Si un écran vous gêne ou qu'un mot n'est pas clair, écrivez-le simplement au bot : il sera corrigé.

## Phase 8 : à faire en premier (15 minutes en tout)
1. **Créer la clé API Anthropic et la coller dans Réglages → IA (5 minutes)** : https://app.linkaffipro.com/settings/ai. Clics exacts : https://platform.claude.com → créer un compte ou se connecter → Settings → Billing → ajouter une carte ou des crédits (5 $ suffisent) → Settings → API keys (https://platform.claude.com/settings/keys) → Create key → nom « LinkAffi Pro », expiration « Never », Linked account = vous → Create → Copy (la clé `sk-ant-…` ne s'affiche qu'une fois) → revenir sur Réglages → IA → coller dans « Clé API Anthropic » → Enregistrer → Vérifier. Le bouton « ✨ Améliorer avec l'IA » s'active alors pour toute l'équipe. Plafond par défaut : 20 € par mois (modifiable sur la même page).
2. **Ajouter vos canaux existants** (2 minutes par canal) : d'abord une fois, Mon compte → **Lier mon Telegram**. Ensuite, dans Telegram, ouvrez chaque canal où un de nos bots est déjà administrateur, appui long sur un message → **Transférer** → choisissez le bot (par exemple @casinogamblingoobot). Le bot répond « Canal « … » ajouté ✅ » et le canal apparaît dans la page Canaux. Si Telegram refuse le transfert : publiez un message dans le canal puis supprimez-le, ou collez le lien public du canal dans Canaux → **Ajouter un canal existant**. Puis, pour chaque canal, réglez la règle d'adhésion (onglet **Qui peut entrer et quand**) : tant qu'elle n'est pas réglée, les demandes restent à valider à la main et le bot n'écrit à personne de lui-même. **Mediatheque et Test n'ont pas encore de règle** : jusqu'ici leurs demandes étaient acceptées tout de suite ; désormais elles attendent votre bouton « Accepter » (fiche du canal) tant qu'une règle n'est pas enregistrée.
3. **Créer votre première campagne** : menu **Campagnes** → **Nouvelle campagne** (nom et univers, offre Link Affi, canaux, pubs). Tant qu'aucune campagne n'existe, la ligne « Argent » du tableau de bord reste vide : c'est voulu, seules vos données comptent.
4. **Créer vos catégories de messages** : les 7 catégories créées d'office ont été retirées. Créez les vôtres dans Messages → Programmer un message → Catégorie → **+ Nouvelle catégorie**, ou dans Réglages → Catégories de messages.

## Tableau de bord Railway (2 clics chacun)
6. **Sauvegardes de volume Railway** (en plus des sauvegardes automatiques de la plateforme) : projet linkaffipro → Postgres → Settings → Backups → activer Daily, Weekly et Monthly (voir `docs/SAUVEGARDES.md`).

## Phase 7 : trois applications à créer, puis tout se branche depuis le site (Réglages → Connexions)
7a. **Application Meta** (10 minutes) : https://app.linkaffipro.com/settings/connectors/meta explique chaque clic (developers.facebook.com → Créer une app → Facebook Login for Business → adresse de retour à coller → App ID + Clé secrète → Rôles de l'app). Puis « Connecter un compte Meta » et cocher les comptes.
7b. **Application TikTok** (10 minutes + validation TikTok sous 1 à 2 semaines) : https://app.linkaffipro.com/settings/connectors/tiktok (business-api.tiktok.com/portal → Become a Developer → Create an App → adresse de retour → permissions Lecture → Submit). En attendant la validation : « Mode bac à sable » avec un compte de test.
7c. **Application Telegram** (5 minutes) : https://app.linkaffipro.com/settings/connectors/telegram (my.telegram.org → API development tools → api_id + api_hash), puis votre numéro, le code reçu dans Telegram, et le mot de passe de validation en deux étapes si activé.

## Quand les comptes existeront
8. **Comptes publicitaires** : dès qu'un compte TikTok Ads ou Meta Ads existe, le brancher depuis le site (7a / 7b ci-dessus) ; l'import CSV reste disponible en secours.
9. **Vues par message** : se fait maintenant seul depuis le site (7c ci-dessus). Sans cela, les meilleurs horaires et les tests A/B se basent sur les clics et les réactions.

## Relecture (quand vous voulez)
10. **Relances automatiques** : Membres → Relances automatiques ; les relances prêtes à l'emploi sont inactives tant que vous ne les activez pas ; relire le message, puis l'interrupteur « Activé ».
11. **Modèles de messages** : 63 modèles installés (Messages → Modèles, filtre par univers et par thème) ; relire ceux de votre univers avant de les utiliser, et ne pas retirer la mention des risques (casino, paris).
12. **Traductions du bot** : les textes en, es, pt, de, it ont été écrits par Claude ; faire relire par un locuteur si une langue devient importante.
13. **Équipe** : créer le compte de l'associé dans Réglages → Équipe (copier le lien d'invitation et le lui envoyer).
