# À faire par un humain (rien d'urgent, regroupé)

## Phase 21 : l'équipe Algorithme (rien à fournir)
1. **Lire le premier rapport « Ce qui marche »** : il est arrivé sur Telegram ; le détail est sur le site, Agents → onglet de l'équipe Algorithme (« Ce qui marche »).
2. **Deux questions du bot** (une à la fois, après les précédentes) : le niveau de l'équipe (conseillé : 2, « appliquer les petits réglages seuls ») et le nombre maximum de posts par jour et par canal que les réglages ne peuvent pas dépasser.
3. Chaque réglage proposé ou appliqué se trouve dans « Ce qui marche » avec ses preuves, et s'annule en un clic.

## Phase 20 : l'équipe Rencontres fabrique des vidéos et des photos (quand vous voulez)
1. **Le bot vous pose les questions une par une sur Telegram** : clé fal.ai, fichier LoRA et mot déclencheur de chaque persona, photos de référence, vidéos sources, plafond vidéo du mois, puis le banc d'essai. Répondez à chaque message (en répondant au message du bot) ; « plus tard » pour passer. Répondez d'abord à la question du rapport du matin, elle est devant dans la file.
2. **En secours**, tout se fait aussi sur le site : Agents → Réglages (clés, bouton « Vérifier ») et Conversations → Personas → la persona → « Médias du personnage ».
3. **Vous pouvez parler au bot par messages vocaux** : il répète ce qu'il a compris avant d'agir. Une clé s'envoie toujours par écrit.
4. **Quand les essais vous plaisent** : répondez au bot `vrai dating` puis `OUI` (ou Agents → Rencontres → « Publier sur les vrais canaux »), puis montez le niveau (`niveau dating 1`). Pensez aussi à activer un plan de canal (Agents → Rencontres → Plan par canal, avec la persona).

## Phase 19 : les agents IA (rien d'obligatoire)
Rien à fournir pour cette phase. Pour vous repérer :
1. **Où** : menu **Agents** (après Conversations). Le tableau de bord montre les 4 équipes (Rencontres, Casino, Paris sportifs, Algorithme), leur dépense du mois et les rapports du matin.
2. **Simulation** : active pour toutes les équipes. Tant qu'elle l'est, tout part sur votre canal **Test**, avec « [SIMULATION …] » en tête. Pour passer une équipe sur les vrais canaux plus tard : Agents → l'équipe → « Simulation » (administrateur), ou écrivez au bot `vrai dating` puis `OUI`.
3. **Niveaux** : 0 = vous validez tout (réglage actuel), 1 = seulement les nouveautés, 2 = rien (rapport seulement). Sur la fiche de l'équipe, ou au bot : `niveau dating 1`.
4. **Sur Telegram** : les posts à valider arrivent avec ✅ Publier / ✏️ Corriger / ❌ Refuser. Écrivez `agents` pour l'état, `pause dating` / `reprends dating` (ou `pause tout`), `demandes` pour les questions en attente.
5. **Une question vous attend déjà** sur Telegram : « Veux-tu recevoir chaque matin le rapport des agents ? » → répondez `oui` ou `non` à ce message.
6. **Aucun canal n'a encore de plan** : les agents ne produisent rien seuls tant qu'un canal n'est pas activé dans la fiche d'une équipe (« Plan par canal »). Les vidéos et photos IA arrivent avec la phase 20.

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
