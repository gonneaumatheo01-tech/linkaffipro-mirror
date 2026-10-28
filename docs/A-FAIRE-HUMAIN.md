# À faire par un humain (rien d'urgent, regroupé)

## Mettre les agents en route : la liste complète, dans l'ordre (mise à jour le 24 octobre, fin des phases 19 à 25)

Rien ne part sur un vrai canal tant que vous ne l'avez pas décidé : toutes les équipes sont **en simulation** (tout va sur le canal Test) et **au niveau 0** (vous validez tout). Presque tout se fait **en répondant à Kevin sur Telegram** (voir 0 ; avant sa création, au bot @casinogamblingoobot), une question à la fois ; écrivez `demandes` pour voir celles qui attendent, `plus tard` pour en passer une. Les clés s'envoient **par écrit** (jamais en vocal) : le bot efface aussitôt votre message.

### 0. Créer Kevin, votre bot à vous (3 minutes)
Kevin est le bot à qui vous parlez de tout, en français ordinaire (texte ou vocal) ; les bots des canaux ne prennent plus d'ordres.
1. Dans Telegram, ouvrez **@BotFather** → envoyez `/newbot` → nom : **Kevin** → identifiant qui finit par « bot » (par exemple `kevin_linkaffi_bot`) → copiez le jeton (la longue ligne après « Use this token »).
2. Envoyez au bot actuel (@casinogamblingoobot) : `jeton boss ` suivi du jeton (il efface votre message aussitôt). **Ou** : https://app.linkaffipro.com/settings/bots → **Ajouter un bot** → collez le jeton → Rôle **Boss (administration)** → **Ajouter le bot**.
3. Ouvrez Kevin dans Telegram → **Démarrer** (`/start`) → écrivez `commencer` : il vous dit ce qui manque et pose les questions une par une (répondez par le message suivant, ou « plus tard »).
4. Ajoutez Kevin au **groupe Telegram de l'équipe** (Infos du groupe → Ajouter des membres → Kevin), puis présentez chacun en une phrase : « Kevin, voici @lea, elle s'occupe des vidéos casino ».
5. Facultatif, pour qu'il réagisse aussi à « Kevin, … » sans @ : dans @BotFather → `/setprivacy` → choisissez Kevin → **Disable**, puis retirez Kevin du groupe et remettez-le.

### 0 bis. Tout de suite (2 minutes)
1. Répondez `oui` ou `non` à la question du bot « Veux-tu recevoir chaque matin le rapport des agents ? ».
2. Ouvrez https://app.linkaffipro.com/agents : le tableau de bord montre les 4 équipes, l'Agent Ads, les dépenses et ce qui attend votre décision.
3. Test de 5 minutes : Agents → **Équipe Rencontres** → « Produire un post de test » (Texte) → appuyez sur ✅ dans Telegram → le post arrive sur le canal **Test** avec « [SIMULATION …] » en tête.

### 1. Équipe Rencontres : vidéos et photos du personnage (15 minutes)
1. **Clé fal.ai** (le bot la demande) : https://fal.ai → créer un compte → ajouter quelques dollars de crédit → https://fal.ai/dashboard/keys → **Add key** → copiez la clé → **répondez au message du bot** avec la clé. Il vérifie et répond OK.
2. **Pour chaque persona** (le bot demande) : l'adresse du fichier du personnage (LoRA) et son mot déclencheur (réponse au message, ou « plus tard ») ; 1 à 3 photos de référence envoyées au bot avec la légende `#dating #reference #<prénom>` ; 5 à 10 vidéos sources avec `#dating #source #<prénom>`.
3. **Plafond vidéo du mois** : répondez 1, 2, 3 ou un chiffre (100 € si « plus tard »).
4. **Banc d'essai** : répondez `oui` → 3 vidéos sont fabriquées (environ 4 €), vous recevez les résultats et choisissez la meilleure (1, 2 ou 3).
5. **Plan des canaux** : Agents → Équipe Rencontres → **Plan par canal** → pour chaque canal, cochez « Activé », choisissez la persona → Enregistrer.

### 2. Équipe Casino : vos vidéos (10 minutes)
1. Le bot demande, pour chaque canal casino, **l'offre (campagne) du bouton** : répondez le numéro.
2. Envoyez au bot **3 à 5 vidéos par thème** avec la légende `#casino #<thème>` (exemple `#casino #roulette`) ; il répond « rangée » avec le stock. Un thème inconnu : il propose un bouton « Créer le thème ».
3. Agents → **Équipe Casino** → **Plan par canal** → cochez « Activé » pour chaque canal → Enregistrer.

### 3. Équipe Paris sportifs : cotes et bookmaker (15 minutes)
1. **Clé SportsGameOdds** (le bot la demande) : https://sportsgameodds.com → créer un compte (offre gratuite) → copier la clé → répondre au message du bot.
2. **Compte bookmaker** (Sportaza) : le bot demande l'identifiant, puis le mot de passe (messages effacés aussitôt) et fait un test de connexion. S'il dit « bloqué », il propose : 1) une adresse internet de secours (service à souscrire, 10 à 30 € par mois) ou 2) la capture depuis votre Mac — dans l'application **Terminal**, collez `cd ~/Desktop/"Platefome de statistiques" && pnpm agents:capture-runner` puis Entrée, et laissez le Mac allumé.
3. **Catégories** : répondez les numéros à activer (tirs cadrés, corners, buts, cartons, buteur, résultat). Réglages fins : Agents → Paris sportifs → Catégories (canaux et campagne de chaque catégorie).
4. L'équipe ne mise **jamais** : elle se connecte seulement pour retrouver le pari, lire la cote et faire la capture.

### 3 bis. Bookmakers : Celsius, Sportaza et Bet Portal (5 minutes, phase 35)
Le système va lui-même lire les matchs et les cotes sur vos trois bookmakers : **Celsius** (`https://celsius.games`, section paris sportifs), **Sportaza** (`https://sportaza.com/fr/sports`) et **Bet Portal** (`https://betportal.com/`, l'adresse que vous avez confirmée le 25 octobre). L'équipe Paris choisit ensuite ses paris sur ces cotes-là. Il ne mise **jamais**, ne dépose jamais, ne retire jamais d'argent : le compte ne sert qu'à voir.
1. **Identifiants** : Kevin vous les demande **une seule fois, en privé** : d'abord l'e-mail, puis le mot de passe (le même sur les trois sites, et sur tout bookmaker ajouté plus tard). Répondez à son message : il efface aussitôt votre réponse, les range chiffrés, et ni l'IA ni le journal ne les voient. Ne les écrivez nulle part ailleurs (ni dans un document, ni dans le groupe de l'équipe). S'ils changent un jour : écrivez à Kevin « nouveaux identifiants bookmakers ».
2. Kevin propose ensuite de **tester les trois sites d'un coup** : répondez `oui`. Il vous dit pour chacun si la connexion et la lecture des matchs passent.
3. **Compte dédié conseillé** : si possible, utilisez un compte ouvert seulement pour ça, sans argent dessus. Si un site ne connaît pas encore cet e-mail, créez-y le compte vous-même (avec le même e-mail et le même mot de passe).
4. **Responsabilité d'usage** : la lecture automatique des pages avec votre compte se fait sous votre responsabilité. Lisez les conditions d'utilisation de chaque site (et leur fichier `robots.txt`, par exemple `https://sportaza.com/robots.txt`) : certains interdisent la lecture automatique. Le système lit lentement (une page toutes les 2 à 5 secondes, jamais plus de 60 par minute, rien la nuit de 1 h à 7 h), ne lit jamais les données d'autres joueurs et ne contourne jamais un blocage par pays.
5. **Le Mac** : si un site refuse le serveur, c'est votre Mac qui lit à sa place. Laissez-le **allumé, session ouverte** (le lecteur démarre tout seul à l'ouverture de session). Si Kevin vous écrit « ouvre le navigateur sur le Mac » (contrôle « je ne suis pas un robot » ou code de connexion) : répondez-lui « ouvre le navigateur sur le Mac », allez devant le Mac, passez le contrôle ou tapez le code dans la fenêtre qui s'ouvre, puis laissez-la : il reprend tout seul.
6. **Autoriser le lecteur du Mac (une fois, 30 secondes)** : le lecteur est installé (il démarre tout seul), mais macOS le bloque tant que vous ne l'autorisez pas à ouvrir le dossier du projet sur le Bureau. Sur le Mac : si une fenêtre « node souhaite accéder aux fichiers de votre dossier Bureau » est affichée, cliquez **Autoriser**. Sinon : menu Pomme → Réglages Système → Confidentialité et sécurité → **Fichiers et dossiers** → « node » → activez **Dossier Bureau** (ou, dans **Accès complet au disque**, cliquez « + » et ajoutez `/usr/local/bin/node`). Ensuite, dans le Terminal : `pnpm agents:runner:status` doit dire « il y a moins de 2 min ✅ ». Sans cela, tout est lu par le serveur ; seul un site qui refuse le serveur attendra.
7. **Blocage par pays (constaté le 25 octobre)** : les trois sites refusent la France et notre serveur ; vous y accédez par un VPN en Norvège. La plateforme ne contourne pas un blocage par pays : la lecture directe reste en pause et les paris gardent le fournisseur de cotes habituel. Si vous décidez de lever cette règle (lecture par un accès situé en Norvège, sous votre responsabilité et selon les conditions des sites), écrivez-le à Kevin noir sur blanc : ce sera prévu dans une prochaine étape.
8. Pour suivre : https://app.linkaffipro.com/agents/bookmakers (état de chaque site, dernières lectures, matchs du jour). Pour en ajouter un : « ajoute le bookmaker X, c'est x.com ».

### 4. Équipe Algorithme et Agent Ads (5 minutes)
1. Le bot demande le **niveau de l'équipe Algorithme** (conseillé : 2, « appliquer les petits réglages seuls ») et le **quota maximum de posts par jour et par canal**.
2. Pour l'Agent Ads, il demande deux seuils (coût par inscription, retour sur dépense) : « plus tard » garde les valeurs automatiques. Il lui faut des dépenses pub : branchez Meta / TikTok (Réglages → Connexions, voir « Phase 7 » plus bas) ou importez vos coûts (Campagnes → la campagne → Pubs → importer).
3. Lisez le rapport « Ce qui marche » chaque lundi (Agents → Ce qui marche) ; chaque réglage s'annule en un clic.

### 5. Assistante de conversation Casino et Paris sportifs (15 minutes par univers, facultatif)
1. **Un bot dédié par univers** : dans Telegram, @BotFather → `/newbot` → nom (« Assistante VIP Casino ») → identifiant finissant par « bot » → copiez le jeton. Ne l'ajoutez à **aucun** canal.
2. https://app.linkaffipro.com/settings/bots → **Ajouter un bot** → collez le jeton, univers Casino (ou Paris sportifs).
3. Conversations → Personas → **Nouvelle persona** → Univers **Casino** (l'identité « assistante » est imposée) → remplissez la **fiche d'informations** (questions courantes et réponses : bonus, dépôt minimum, pays, retraits, VIP — c'est tout ce qu'elle a le droit d'affirmer) et l'offre → **Tester** → cochez Activée → Enregistrer.
4. Réglages → Bots → le nouveau bot → Mode « Assistant de conversation », persona liée → Enregistrer. L'activation générale se règle dans Réglages → IA de conversation (comme pour Rencontres, ci-dessous).
5. Les conversations à reprendre par l'équipe (question hors fiche, réclamation, argent, mineur, insulte) apparaissent « À traiter » dans Conversations, et le bot vous prévient (un message groupé toutes les 30 minutes au plus).

### 6. Passer une équipe pour de vrai (2 minutes, quand les essais vous plaisent)
1. Écrivez au bot `vrai dating` (ou `vrai casino`, `vrai paris`) : il résume ce qui va se passer (canaux, quota, niveau) → répondez `OUI`.
2. Puis montez le niveau : `niveau dating 1` (seules les nouveautés vous sont soumises) → `OUI`. Pour tout arrêter à tout moment : `pause tout` (ou le bouton Pause générale du tableau de bord).

**Coûts à prévoir** : vidéos IA 50 à 200 € par mois selon le plafond choisi, photos IA 5 à 15 €, IA d'écriture et de contrôle 10 à 30 €, cotes 0 € au départ (offre gratuite), adresse internet de secours 0 à 30 € seulement si le bookmaker bloque, assistante de conversation 30 € par mois au plus (plafond réglé).

### 7. Canal d'inspiration privé : ajouter un compte réel (3 minutes, seulement pour un canal privé)
Un canal public se lit tout seul : écrivez simplement à Kevin « inspire-toi de t.me/nomducanal pour Roulette ». Pour un canal **privé**, Kevin ne rejoint jamais rien de lui-même :
1. Prenez le téléphone d'un de vos comptes réels (Réglages → Comptes Telegram, état **Connecté**), **sans persona** (Kevin n'utilise jamais un compte qui discute avec des membres : dans Réglages → Comptes Telegram, la colonne persona doit être vide).
2. Ouvrez Telegram sur ce téléphone → touchez le lien d'invitation du canal (`t.me/+…`) → **Rejoindre** (ou **Demander à rejoindre**, puis attendez d'être accepté).
3. Écrivez à Kevin : « inspire-toi de <nom du canal> pour <votre canal> ». Il lit le canal avec ce compte, lentement, et vous répond.

**Sans compte réel** : ouvrez le canal dans votre Telegram → appui long sur un post → **Sélectionner** → cochez 20 à 30 posts → **Transférer** → choisissez Kevin → puis écrivez-lui « c'est pour le canal <votre canal> ».

---

## Avant les agents (rappel des phases 7 à 17, toujours valable)

## Phase 17 : l'assistante de conversation Rencontres (15 minutes, quand vous voulez)
L'assistante est **désactivée** : elle ne répond à personne tant que vous ne l'avez pas mise en route.
1. **Créer le bot dédié** : dans Telegram, ouvrez @BotFather → envoyez `/newbot` → nom affiché (par exemple « Léa · Assistante ») → identifiant qui finit par « bot » → copiez le jeton (la longue ligne après « Use this token »). Ce bot ne doit être ajouté à **aucun** canal : le site refuse de transformer un bot qui gère des canaux.
2. **L'ajouter au site** : https://app.linkaffipro.com/settings/bots → **Ajouter un bot** → collez le jeton, univers **Rencontres** → **Ajouter le bot**.
3. **Clé Venice** : https://app.linkaffipro.com/settings/assistant → suivez le guide en bas de la page (compte Venice, quelques dollars de crédit, **Generate New API Key**, type **Inference Only**) → collez la clé → **Vérifier**. Le plafond est réglé à 30 € par mois.
4. **Créer la persona** : menu **Conversations** → **Personas** → **Nouvelle persona** : prénom, personnalité, ton ; dans **Offre**, choisissez l'offre Link Affi de l'app et écrivez la fiche de l'offre (ce que l'assistante a le droit de dire, rien d'autre) ; essayez-la avec **Tester** (discussion simulée, rien ne part sur Telegram) ; cochez **Activée** → **Enregistrer**.
5. **Relier le bot à la persona** : Réglages → Bots → le nouveau bot → **Mode** « Assistant de conversation », **Persona liée** → **Enregistrer le mode**.
6. **Essai par vous seul** : Réglages → IA de conversation → Activation **Seulement l'équipe (essai)** → **Enregistrer**. Depuis votre Telegram, ouvrez le nouveau bot → **Démarrer** → écrivez comme un vrai prospect (demandez aussi « t'es un bot ? »). Puis menu **Conversations** : votre fil est là ; essayez **Prendre la main**, écrivez un message, puis **Rendre à l'assistante**.
7. **Mise en route** : quand l'essai vous plaît, Activation **Tout le monde**. Lien à donner (canaux, pages, pubs) : `https://t.me/<identifiant du bot>?start=tk01` — remplacez `tk01` par le nom de la source pour avoir les chiffres par source (menu Conversations → Chiffres).

## Phase 16 : sortir de TikTok (5 minutes)
1. **Test sur iPhone** : envoyez-vous le lien https://go.goolink.eu/j/test?src=tk01 dans un message TikTok, ouvrez-le depuis TikTok, appuyez sur « Rejoindre le canal » : l'aide sombre apparaît tout de suite avec une flèche jaune vers « ••• » en haut à droite. Suivez-la : « ••• » → « Ouvrir dans le navigateur » ; Safari s'ouvre et demande « Ouvrir dans « Telegram » ? » → **Ouvrir** : Telegram s'ouvre sur la demande d'adhésion au canal Test.
2. **Même essai sur un téléphone Android** (si vous en avez un sous la main), puis **faites une capture d'écran de TikTok avec le menu « ••• » ouvert** et déposez-la dans le dossier `docs/tiktok-captures/` (ou envoyez-la au bot) : elle confirmera où se trouve le bouton sur Android (en haut à droite d'après nos recherches, mais ce n'est pas certain) et le libellé exact.
3. Si possible, sur un téléphone **Android**, ouvrez la page de test depuis **Instagram** puis **Facebook** et appuyez sur le bouton : l'aide doit apparaître et Telegram s'ouvrir directement (jamais une page d'erreur à la place). Et la capture du menu « ⋮ » / « ••• » de ces applis (iPhone et Android) : leur flèche est placée d'après des guides en ligne, pas encore d'après une vraie capture.
4. Sur **iPhone**, ouvrez aussi la page de test depuis **Instagram**, **Facebook** et **Messenger** et appuyez sur le bouton : Telegram doit s'ouvrir (ou l'iPhone le proposer), l'aide restant derrière. Si une page d'erreur apparaît ou si rien ne se passe, dites-le au bot : je passerai ces applis sur la méthode discrète.
5. Dans la rubrique **Pages** → page « test » → **Chiffres** : « Aide affichée », « Sortis de TikTok » et « % sortis » montrent votre essai.

## Phase 15 : pages d'atterrissage (10 minutes)
1. **Essai dans les vraies applis** (le seul test impossible à faire sans vous) : envoyez-vous le lien https://go.goolink.eu/j/test?src=tk01 dans un message TikTok, puis dans un message Instagram ; ouvrez-le depuis chaque appli (iPhone et, si possible, Android) et appuyez sur le bouton bleu : Telegram doit s'ouvrir sur le canal « Test » avec la demande d'adhésion. Dans la rubrique **Pages** → page « test », le tableau « Telegram ouvert après le clic » montre ensuite ce qui a marché.
2. **Créer votre première vraie page** : menu **Pages** → **Nouvelle page** → choisissez le canal, écrivez votre phrase d'accroche, ajoutez une source par pub (par exemple tk01), et si vous voulez le coût par join, **Relier à une pub** → **Créer la page**. Copiez le lien de chaque source (bouton **Copier le lien**) et collez-le dans la pub correspondante.
3. **Bon à savoir avant de lancer une pub TikTok** : l'aide TikTok ne cite pas Telegram parmi les messageries autorisées comme destination. Une pub qui mène à Telegram, même par une page, peut être refusée à la modération.
4. **Facultatif : servir aussi https://goolink.eu/j/… (sans « go. »)**. IONOS refuse ce réglage sur le domaine nu ; la solution propre est de confier les DNS à Cloudflare (gratuit), le domaine restant chez IONOS. Clics exacts :
   - dash.cloudflare.com → créer un compte gratuit → **Ajouter un domaine** → goolink.eu → offre **Free**.
   - Dans Cloudflare → **DNS** → **Enregistrements** : vérifier que tout ce qui existe chez IONOS (Domaines & SSL → goolink.eu → DNS) est recopié : le CNAME **go** et le TXT **_railway-verify.go** (indispensables, sinon les liens actuels tombent), les **MX** mx00.ionos.fr / mx01.ionos.fr et le TXT **SPF** ; tout en « DNS uniquement » (nuage gris).
   - Railway → service **web** → **Settings** → **Networking** → **Custom Domain** → goolink.eu ; noter la cible CNAME et le TXT affichés.
   - Cloudflare : supprimer les enregistrements A / AAAA de « @ » (page de parking IONOS), ajouter un **CNAME @** vers la cible Railway (nuage gris) et le **TXT _railway-verify** donné par Railway.
   - IONOS : **Domaines & SSL** → engrenage à côté de goolink.eu → **Serveur de noms** → **Utiliser des serveurs de noms personnalisés** → les deux serveurs Cloudflare → **Enregistrer**. Attendre que Cloudflare dise « actif » et que Railway affiche la coche verte, puis me prévenir : j'ajouterai l'adresse aux pages.

## Phase 14 : demandes bloquées sur « Attend les canaux » (5 minutes)
1. **Corriger l'accueil de Zone Interdite** (il parle encore de « J'ai rejoint », qui n'existe plus en « Proposés ») : https://app.linkaffipro.com/channels → **Zone Interdite** → onglet **Ce que dit le bot** → message d'accueil → remplacez le texte par, par exemple : « {prenom}, tu y es presque !🔞🤫 Rejoins aussi nos deux canaux ci-dessous 👇 Ton accès à {canal} est validé {delai}. » → **Enregistrer**. L'avertissement orange disparaît.
2. **Vrai essai** (avec un compte qui n'est pas encore membre) : demandez à rejoindre Tir Cadré par un lien d'entrée, rejoignez les canaux proposés sans appuyer sur rien : la demande passe « Acceptation programmée » en 2 minutes au plus. Puis, sur un autre essai, appuyez sur **✅ J'ai rejoint** sans « Démarrer » : le message du bot se met à jour.
3. **À décider par vous** : si des demandes restent un jour en attente sous une ancienne règle, le bouton **Leur appliquer la nouvelle règle** (onglet « Qui peut entrer et quand ») ou **Tout accepter** (onglet Demandes) les débloque. Nous ne les avons jamais utilisés en production.

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

## Phase 31 — Prospection d'affiliés
- **Vos offres** (recommandé) : réponses données à Kevin le 27 octobre (Sportaza, 5gringos, Celsius, betportal ; toute l'Europe ; hybride). Reste à donner les montants (CPA en euros, % de revshare) dans Agents → Prospection → Vos offres → Modifier.
- **API payantes des annuaires** (option, pas obligatoire) : tgstat, telemetr ou telega proposent des API payantes plus complètes. L'équipe fonctionne sans, à partir des pages publiques. Si vous souhaitez en prendre une, dites-le à Kevin.

## Phase 32 — Prospection avancée (veille, réseaux, valeur, vrais résultats)
1. **Donner le revenu moyen par joueur et par mois** (pour les offres en part du revenu, 1 minute) : écrivez à Kevin « le revenu moyen par joueur est de 40 € par mois » (votre chiffre). Sans lui, la valeur estimée ne compte que la prime par joueur ; la page Agents → Prospection → Valeur estimée le rappelle.
2. **Rattacher chaque affilié signé à Link Affi** (30 secondes par affilié) : Agents → Prospection → Affiliés signés → champ « Identifiant d'affilié Link Affi » → Rattacher. Ou écrivez à Kevin « @nom = affilié 1234 ». Sans identifiant, ses vrais résultats ne sont pas lus et le calibrage ne peut pas se faire.
3. **Choisir d'activer la recherche par compte réel** (facultatif, 1 minute) : coupée par défaut. Pour l'activer, écrivez à Kevin « active la recherche par compte » puis répondez OUI. Lecture seule, 100 recherches par jour et par compte au plus, jamais avec un compte qui converse. Pour l'arrêter : Agents → Prospection → Sources → « Couper la recherche par compte ».
