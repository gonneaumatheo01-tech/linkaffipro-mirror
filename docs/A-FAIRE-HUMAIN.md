# À faire par un humain (rien d'urgent, regroupé)

## Phase 13 : brancher les affiliés Link Affi (10 minutes, quand Link Affi est prêt)
1. **Générer les deux valeurs** : https://app.linkaffipro.com/settings/connectors → partie « Campagnes Telegram des affiliés » → **Générer la clé** (copiez-la tout de suite, elle ne s'affiche qu'une fois), puis **Générer le secret** (idem).
2. **Les coller dans Link Affi** : dans Lovable, projet Link Affi → Cloud → Secrets → ajoutez `LINKAFFIPRO_API_KEY` (la clé) et `LINKAFFIPRO_WEBHOOK_SECRET` (le secret).
3. **Tester** : revenez dans la même partie et cliquez **Envoyer un événement de test** : « Reçu » = c'est branché.
4. **Transmettre au développeur de Link Affi** l'annexe de `docs/LINKAFFI-PARTENAIRES.md` (« Annexe — précisions de la plateforme ») : réponses exactes de notre API, événement de test, et surtout `attributionDays` à envoyer pour qu'une campagne à durée limitée le soit aussi chez nous.

## Phase 12 : vos emojis animés (5 minutes)
1. **Ajouter vos emojis** : dans Telegram, transférez à @casinogamblingoobot un message qui contient vos emojis animés préférés (votre compte Telegram doit être lié : site → Mon compte). Le bot répond « … emojis animés ajoutés ✅ ». Ou collez le lien d'un pack (t.me/addemoji/…) dans Messages → Emojis animés → **Ajouter des emojis animés**. Votre compte n'a aucun pack d'emojis installé : « Importer mes packs » n'ajoute donc rien pour l'instant.
2. **Message privé de test** : vous avez reçu cette nuit de @casinogamblingoobot « Essai des emojis animés (phase 12) » avec un pouce animé : s'il bougeait, les messages privés du bot avec emojis animés fonctionnent.
3. **Canal « Test »** : un message « Test automatique (Claude) » a été publié par votre compte avec un emoji animé, puis supprimé tout seul 15 minutes après (c'est normal).

## Phase 11 : régler « venu de Tir Cadré → 1 jour » et faire un vrai essai (10 minutes)
1. **Régler l'exemple** (3 clics) : https://app.linkaffipro.com/channels → **Zone Interdite** → onglet **Qui peut entrer et quand** → **+ Ajouter une exception** → « Si la personne vient » de « Tir Cadré » → **Après un délai** : 1 jour → **Enregistrer l'exception**. Pour les 5 minutes des autres : en haut, **Par défaut**, « Puis accepter » : 5 minutes → **Enregistrer la règle**.
2. **Vérifier avec le simulateur** (même onglet, « Et si quelqu'un demande à entrer ? ») : choisissez « bouton de Tir Cadré » puis « une pub » : il dit ce qui se passera, sans rien envoyer.
3. **Vrai essai sur Telegram** (avec un compte qui n'est pas encore membre) : demandez à rejoindre Zone Interdite par un lien d'entrée → l'accueil propose LA ZONE ROULETTE et TIR CADRÉ → touchez les deux boutons (une demande part dans chacun) → « ✅ J'ai rejoint » est accepté tout de suite (une demande en attente compte) → acceptation dans Zone Interdite 5 minutes après le clic. Dans **Demandes** de LA ZONE ROULETTE, la carte dit « Venu de « Zone Interdite » (canal obligatoire) ».
4. **Canaux à rejoindre** : LA ZONE ROULETTE et TIR CADRÉ ont reçu l'exception « Venu du bouton « canal à rejoindre » → tout de suite, sans message » : les personnes envoyées par Zone Interdite y entrent comme avant. Changez-la (par exemple « après 1 jour ») si vous voulez leur propre délai.

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
