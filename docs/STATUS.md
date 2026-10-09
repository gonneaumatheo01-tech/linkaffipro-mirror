# État du projet — phase 0 (9 octobre 2026)

## Ce qui est fait
- Le code est sur GitHub (dépôt privé `linkaffipro-platform`), avec tests, lint et build verts.
- Le site et le robot de tâches (worker) sont déployés sur Railway avec leur base PostgreSQL et Redis. Les migrations se lancent toutes seules à chaque déploiement.
- Page de connexion (e-mail + mot de passe), rôles ADMIN / MANAGER, invitations par lien, page « Mon compte » (changer le mot de passe, lier son Telegram).
- Pages : Tableau de bord, Bots, Canaux, Journal, Réglages ; Membres / Messages / Liens annoncées « bientôt » (phase 1).
- Les 3 bots Telegram (casino, paris sportifs, dating) sont enregistrés, leurs jetons chiffrés, leurs webhooks posés et vérifiés. Ils répondent à /start.
- Détection automatique des canaux où un bot est administrateur.
- Redirections go.goolink.eu : /test envoie vers t.me/telegram, le reste vers le site ; chaque passage est journalisé (robots marqués).
- Client de l'API Link Affi prêt (en attente des deux clés, voir plus bas).

## Adresses
- Site : https://app.linkaffipro.com (DNS posés, certificat valide). L'adresse provisoire https://web-production-361c4c.up.railway.app reste utilisable.
- Liens traqués : https://go.goolink.eu (ex. https://go.goolink.eu/test).

## Votre compte administrateur
- E-mail : gonneaumatheo.business@gmail.com
- Mot de passe : celui que vous avez choisi le 9 octobre à 11h20 (le mot de passe temporaire n'est plus valable).

## DNS (fait)
Les 4 enregistrements IONOS (CNAME `app` et `go`, TXT `_railway-verify.app` et `_railway-verify.go`) sont en place et vérifiés par Railway. Les domaines nus linkaffipro.com et goolink.eu restent libres (IONOS refuse les CNAME sur domaine nu) ; une redirection IONOS vers app.linkaffipro.com est possible plus tard.

## Test de 5 minutes
1. Ouvrez https://app.linkaffipro.com et connectez-vous.
2. Menu en haut à droite → Mon compte → changez votre mot de passe.
3. Dans Telegram, ouvrez @casinogamblingoobot, @sportbettingoobot et @womendatingoobot : appuyez sur Démarrer (ou tapez /start). Chaque bot doit répondre « Bonjour, je suis …, le bot … ».
4. Créez un canal privé de test dans Telegram (Nouveau canal → nom « TEST » → privé). Ajoutez un bot comme administrateur : canal → Administrateurs → Ajouter un administrateur → cherchez @casinogamblingoobot → validez. Publiez un message dans le canal.
5. Sur le site, page Canaux : le canal « TEST » apparaît avec le bot en administrateur. Cochez la case TEST, choisissez l'univers Casino, cliquez Enregistrer.
6. Sur le site, page Tableau de bord : les compteurs et les derniers événements (/start, canal détecté) sont visibles.
7. Ouvrez https://go.goolink.eu/test : vous devez arriver sur t.me/telegram.

## Link Affi : accès établi, mais pas de sub-ID
L'API répond (32 tables ; 18 810 clics, 1 757 joueurs, 109 campagnes, 11 programmes). Le schéma complet est dans `docs/LINKAFFI-SCHEMA.md`.

Point bloquant pour l'attribution par membre : **Link Affi n'enregistre aucun sub-ID**. Le lien `linkaffi.me/go/<clé>` transmet bien les paramètres ajoutés, mais ils ne sont conservés nulle part (ni dans `clicks`, ni dans `players`, ni dans les postbacks). Aujourd'hui, Link Affi rattache un joueur à une **campagne** (clé de 8 caractères comme `47eb8mwc`), rien de plus fin.

Ce que cela change :
- Possible dès la phase 1 sans toucher à Link Affi : statistiques par **pub, canal et message**, à condition de créer dans Link Affi **une campagne par usage** (par exemple une campagne par message publié) et de la coller dans la plateforme. Le rapprochement « quel membre a cliqué » restera approximatif (horodatage + campagne).
- Pour les statistiques **par membre** (qui s'est inscrit, qui a déposé), il faut une petite évolution de Link Affi, à demander à la personne qui l'a construite. Texte à lui transmettre :
  > « Peux-tu ajouter un paramètre `sub_id` (texte, jusqu'à 64 caractères) à la fonction `track-click` : le stocker dans une colonne `clicks.sub_id`, le transmettre au casino dans le lien d'affiliation (paramètre libre que le casino renvoie dans son postback, souvent `click_id` ou `sub1`), le recopier dans `players.sub_id` à l'inscription et dans `postback_logs.sub_id`, et exposer ces colonnes dans `stats-api` ? »
- Décision du 9 octobre : **option 1**, on demande l'évolution à Link Affi (texte ci-dessus) et, en attendant, la phase 1 attribue par campagne.

## Actions humaines en attente
1. Demande d'évolution transmise au développeur de Link Affi le 9 octobre (confirmé par Telegram) ; me dire quand c'est en place.
2. Valider la phase 0 : faites le test de 5 minutes ci-dessus puis répondez « phase 0 OK » (par Telegram, voir ci-dessous).

Fait : DNS, bascule en Europe (confirmée par vous ; Postgres vérifié à Amsterdam), volumes orphelins supprimés par la ligne de commande (Railway les efface définitivement le 11 octobre).

## Dialogue par Telegram
Depuis le 9 octobre, les questions, demandes de test et annonces vous sont envoyées en message privé par le bot casino (@casinogamblingoobot) ; répondez-lui directement dans Telegram. Commandes : `pnpm tg:send`, `pnpm tg:inbox` (voir CLAUDE.md).

## Ce qui reste pour la phase 1
Demandes d'adhésion avec délai réglable, flux « rejoins ces canaux », liens go.goolink.eu par pub avec liens d'invitation, boutons avec sub-ID par membre et par message, calendrier de messages, synchronisation Link Affi, fiches membres, statistiques détaillées.
