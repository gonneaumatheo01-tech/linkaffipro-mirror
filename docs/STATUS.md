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

## Adresse provisoire du site
https://web-production-361c4c.up.railway.app

(app.linkaffipro.com et go.goolink.eu fonctionneront dès que les lignes DNS ci-dessous seront ajoutées.)

## Votre compte administrateur
- E-mail : gonneaumatheo.business@gmail.com
- Mot de passe temporaire : `Ua1EMiHN9o9RzTvj`
- Changez-le dès la première connexion (menu en haut à droite → Mon compte).

## Lignes DNS à ajouter chez IONOS
IONOS refuse un CNAME sur un domaine nu : le site vit donc sur **app.linkaffipro.com** et les liens traqués sur **go.goolink.eu**. Dans IONOS : Domaines & SSL → le domaine → DNS → « Ajouter un enregistrement ». Ajoutez exactement ces 4 lignes :

| Domaine | Type | Nom (hôte) | Valeur | TTL |
| --- | --- | --- | --- | --- |
| linkaffipro.com | CNAME | app | k32xlruk.up.railway.app | automatique |
| linkaffipro.com | TXT | _railway-verify.app | railway-verify=b3edd8658ac77ec3c022e78d14c1ed8ad93c13387287f361afbe6cdbc46bab9a | automatique |
| goolink.eu | CNAME | go | no84o3u4.up.railway.app | automatique |
| goolink.eu | TXT | _railway-verify.go | railway-verify=5763577039825595254fd6ae16bc0a85ec16832fb11dcad486a8519b8f834fe3 | automatique |

Remarques :
- Dans IONOS, le champ « Nom d'hôte » attend seulement la partie avant le domaine (`app`, `_railway-verify.app`, `go`, `_railway-verify.go`). Si IONOS ajoute un point final à la valeur du CNAME, c'est normal.
- Les domaines nus (linkaffipro.com et goolink.eu sans préfixe) restent libres : vous pourrez y mettre une redirection IONOS vers app.linkaffipro.com plus tard si vous le souhaitez.
- Une fois les lignes ajoutées, comptez de 5 minutes à quelques heures. Dites-moi « DNS fait » : je basculerai l'adresse du site et les webhooks des bots sur app.linkaffipro.com et je vérifierai go.goolink.eu/test.

## Test de 5 minutes
1. Ouvrez https://web-production-361c4c.up.railway.app, connectez-vous avec l'e-mail et le mot de passe ci-dessus.
2. Menu en haut à droite → Mon compte → changez votre mot de passe.
3. Dans Telegram, ouvrez @casinogamblingoobot, @sportbettingoobot et @womendatingoobot : appuyez sur Démarrer (ou tapez /start). Chaque bot doit répondre « Bonjour, je suis …, le bot … ».
4. Créez un canal privé de test dans Telegram (Nouveau canal → nom « TEST » → privé). Ajoutez un bot comme administrateur : canal → Administrateurs → Ajouter un administrateur → cherchez @casinogamblingoobot → validez. Publiez un message dans le canal.
5. Sur le site, page Canaux : le canal « TEST » apparaît avec le bot en administrateur. Cochez la case TEST, choisissez l'univers Casino, cliquez Enregistrer.
6. Sur le site, page Tableau de bord : les compteurs et les derniers événements (/start, canal détecté) sont visibles.
7. Ouvrez https://web-production-361c4c.up.railway.app/r/test : vous devez arriver sur t.me/telegram (go.goolink.eu/test fera la même chose après les DNS).

## Actions humaines en attente
1. **Clés de l'API Link Affi** : collez-moi les deux valeurs reçues (`x-api-key`, commence par `lkst_`, et `apikey`, un long texte commençant par `eyJ`). Je vérifierai l'accès, documenterai le schéma exact et le format du sub-ID.
2. **Lignes DNS** (tableau ci-dessus).
3. **Région des serveurs Railway (facultatif, recommandé, 5 minutes)** : tout tourne pour l'instant aux États-Unis (région par défaut du compte), ce qui ajoute environ 0,1 s à chaque page. Pour passer en Europe : ouvrez railway.com → projet « linkaffipro » → cliquez sur « Postgres » → onglet Settings → section « Regions » → choisissez « EU West (Amsterdam) » → cliquez Deploy. Faites pareil pour « Redis », puis « web », puis « worker ». Les bases sont quasi vides, aucun risque. Dites-moi « région faite » : je vérifierai et reposerai les webhooks. Ensuite, dans le même projet, supprimez les 4 volumes orphelins (ceux qui ne sont reliés à aucun service, nommés redis-volume, redis-volume-sUnY, postgres-volume, postgres-volume-NXsx) : clic sur le volume → Settings → Delete.
4. Rien d'autre pour l'instant.

## Ce qui reste pour la phase 1
Demandes d'adhésion avec délai réglable, flux « rejoins ces canaux », liens go.goolink.eu par pub avec liens d'invitation, boutons avec sub-ID par membre et par message, calendrier de messages, synchronisation Link Affi, fiches membres, statistiques détaillées.
