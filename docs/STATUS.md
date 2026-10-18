# État du projet : phase 17 (assistante de conversation Rencontres) terminée (18 octobre 2026)

Phases 0 à 16 en ligne. Phase 17 = un bot dédié de l'univers Rencontres qui discute en privé avec les personnes qui lui écrivent d'elles-mêmes, s'adapte à leur ton, présente l'app et envoie au bon moment le lien suivi (`docs/prompts/19-phase-17-assistant-dating.md`, contrat technique `docs/ASSISTANT-CONVERSATION.md`). 4 853 tests unitaires et 533 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (site d'abord, qui applique les deux migrations additives, puis le service d'arrière-plan), sauvegardes faites avant chaque déploiement. **L'assistante est désactivée** : elle ne répond à personne tant que vous ne l'avez pas mise en route (`docs/A-FAIRE-HUMAIN.md`).

## Phase 17 : ce qui a changé
- **Nouvelle rubrique « Conversations »** (menu, après Membres) :
  - **Boîte de réception** : toutes les conversations (filtres étape, qui répond, source, persona, non lues), fil en direct ; **Prendre la main** (l'assistante se tait), écrire vous-même, **Rendre à l'assistante**, **Bloquer**, **Fermer**. Écrire est impossible après un /stop ou à un mineur. « Personne ne répond » s'affiche quand l'assistante ne peut pas répondre (désactivée, essai réservé à l'équipe…).
  - **Personas** : prénom, personnalité, ton, langues, centres d'intérêt ; règles du parcours (nombre d'échanges avant le lien, intérêt exigé, envois du lien, relances) ; offre Link Affi liée et **fiche de l'offre** (seule chose que l'assistante peut dire de l'app) ; visuel de l'app ; description du bot qui dit « l'assistante du canal » ; aperçu des consignes ; bouton **Tester** (discussion simulée dans la page, rien ne part sur Telegram, coût compté).
  - **Chiffres** : par persona et par source du lien (`?start=tk01`) : conversations, réponses, liens envoyés, clics, inscriptions, premiers dépôts, coût de l'IA ; parcours par étape (Accueil → Discussion → Proposition → Lien envoyé → Relance → Inscrit) ; export.
- **Réglages → IA de conversation** (administrateurs) : clé Venice (chiffrée, jamais réaffichée), **Vérifier** (gratuit : solde et liste des modèles), modèle par défaut `venice-uncensored-role-play` et modèle de repli, plafond **30 € par mois** (votre choix du 18 octobre), limite par conversation et par jour, **Activation** : Désactivé / Seulement l'équipe (essai) / Tout le monde.
- **Réglages → Bots** : « Mode : assistant de conversation » et persona liée. Un bot qui gère des canaux ne peut pas devenir l'assistante : il faut un bot dédié créé dans @BotFather.
- **Le lien de l'offre** part par un bouton `go.goolink.eu/a/…` : un identifiant de suivi neuf à chaque envoi, le clic compte à la première ouverture, l'inscription et le premier dépôt remontent jusqu'à la conversation, la persona et la source.
- **Réglages → Alertes** (votre demande du 17 octobre) : chaque alerte a sa case « Alerte activée » ; **« Canal qui perd ses membres » est coupée**. Deux nouvelles alertes : assistante en panne (clé, solde Venice) et plafond mensuel atteint.

## Vos règles, tenues par le code (pas seulement par les consignes de l'IA)
- **Bot officiel seulement** (aucun compte utilisateur, rien sur votre session Telegram). **Aucune prise de contact à froid** : l'assistante ne répond qu'aux personnes qui ont écrit au bot.
- **Assumée comme assistante** : le premier message le dit (« moi c'est Léa, l'assistante du canal »), la description du bot aussi ; à « t'es un bot ? », la réponse dit franchement que c'est une IA. Une réponse qui le nie, qui contient un lien, du markdown, un texte trop long, un contenu explicite, un chiffre absent de la fiche de l'offre ou un morceau des consignes est refusée et refaite une fois, puis remplacée par un texte sûr. Aucun réglage ne permet de le cacher.
- **Adultes uniquement** : un âge de moins de 18 ans (6 langues) arrête tout, poliment, sans lien, conversation fermée pour toujours.
- **Pas de spam** : jamais de lien au premier message ; au plus 2 relances après un silence, à 24 h d'écart au moins, jamais la nuit (décalées à 10 h) ; `/stop` (ou « STOP » seul) arrête tout définitivement ; `/reset` efface l'historique ; 1 message par seconde par personne, pauses de Telegram respectées, blocages respectés.
- **Rythme naturel** : « écrit… », délai selon la longueur (1 à 4 s), 1 à 3 messages courts.
- **Données** : les textes des conversations ne sont jamais copiés dans le journal ; `/reset`, la suppression d'un membre et la purge (24 mois) effacent tout.

## Test de 5 minutes (après la mise en route, `docs/A-FAIRE-HUMAIN.md` : créer le bot, coller la clé Venice, créer la persona)
1. Réglages → IA de conversation → Activation « Seulement l'équipe (essai) » → Enregistrer.
2. Depuis votre Telegram, ouvrez le nouveau bot → Démarrer → écrivez comme un vrai prospect (4 ou 5 messages), demandez « t'es un bot ? ».
3. Vérifiez : elle se présente comme l'assistante, répond franchement, et le lien n'arrive qu'après quelques échanges.
4. Menu Conversations : votre fil est là ; **Prendre la main**, écrivez un message, puis **Rendre à l'assistante**.
5. Écrivez `/stop` : elle confirme et ne vous écrit plus jamais.

## Vérifications faites
- Recherche dans la documentation officielle de Venice (noms exacts des paramètres, sortie JSON stricte, modèles et prix, vérification gratuite d'une clé) : `docs/DECISIONS-TECH.md`.
- Moteur testé sans Telegram ni réseau (faux client Venice, faux envoi) ; conversation de bout en bout simulée sur base réelle : /start avec une source → présentation → 4 échanges → lien (bouton suivi) → clic → inscription de test → étape « Inscrit » ; deux tours en parallèle → une seule réponse ; /stop, /reset pendant un tour, reprise en main, plafond, mineur, relances, pannes Venice.
- Une relecture adverse de chaque lot à chaque étape (suivie de ses corrections), puis une relecture finale en 6 dimensions (règles du client, robustesse, données personnelles, chiffres, interface, non-régression) : 41 défauts signalés, 37 confirmés par une contre-vérification et corrigés, avec un test chacun (par exemple : un « stop » sans barre oblique, un âge dit pendant une relance, un lien raccourci, un /reset pendant une réponse, le risque de transformer le bot Rencontres qui gère vos canaux).
- Production (18 octobre au soir) : santé du site et du service d'arrière-plan OK, migrations appliquées, liste des modèles Venice relue (111), 15 pages ouvertes avec le compte de vérification sans erreur, assistante désactivée et sans clé, vos 3 bots inchangés (mode normal, ils reçoivent toujours leurs messages), lien `go.goolink.eu/a/…` inconnu → redirection, aucune conversation, aucun message envoyé.

## Limites et suites
- Rien n'a été essayé avec la vraie API Venice ni le vrai bot : il faut votre clé et le bot créé dans @BotFather (le site ne peut pas les créer). La première réponse réelle confirmera le modèle choisi.
- Le contrôle « jamais de déni d'être une IA » et la détection d'âge reposent sur des tournures de phrase (6 langues) : ils rattrapent les cas courants, pas toutes les formulations ; l'équipe peut toujours reprendre la main.
- Une fois l'assistante mise en route, elle répond aussi aux personnes qui lui ont écrit dans les 24 h précédentes.
- L'alerte « Bot en difficulté (silencieux) » des bots normaux reste bavarde quand un bot ne reçoit rien pendant 10 minutes (107 fois en une semaine) : vous pouvez la signaler si elle vous gêne.

## Phase 16 — (sortir du navigateur de TikTok) terminée (16 octobre 2026)

Phases 0 à 15 en ligne. Phase 16 = faire sortir les visiteurs du navigateur intégré de TikTok (et des autres applis) vers Safari ou Chrome, où Telegram s'ouvre (`docs/prompts/18-phase-16-sortir-de-tiktok.md`). 3 727 tests unitaires et 471 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (site d'abord, qui applique la migration, puis le service d'arrière-plan), sauvegarde faite juste avant. Vos 5 nouvelles pages (Zone Interdite) ont la nouvelle version.

## Constat
- Vos vraies visites des 15 et 16 octobre le confirment : dans TikTok, aucun appui n'a ouvert Telegram (`tg://` et le lien t.me y sont bloqués). La seule voie sûre est « ••• » → « Ouvrir dans le navigateur ».

## Phase 16 : ce qui a changé
- **Aucun délai** : plus aucune attente ni saut automatique vers la page t.me. Dans Safari ou Chrome, le lien part tout de suite.
- **Dans TikTok (et Instagram, Facebook, Messenger, Snapchat…)**, l'appui sur « Rejoindre » affiche aussitôt une aide plein écran : « Appuie sur ••• puis « Ouvrir dans le navigateur » », 3 étapes, une grosse flèche jaune animée pointée sur le bouton « ••• » de l'appli, « Réessayer ». Sur iPhone, la flèche est calée sur votre capture (« ••• » en haut à droite, dans la barre noire de TikTok). En même temps, la page tente discrètement d'ouvrir Telegram (au cas où l'appli le laisse faire).
- **Dans Safari ou Chrome** (après « Ouvrir dans le navigateur »), la page lance Telegram toute seule dès l'affichage : l'iPhone pose sa question « Ouvrir dans « Telegram » ? » ; Chrome Android ouvre Telegram directement. Une seule fois, jamais de boucle ; si rien ne s'ouvre, le bouton reste là.
- **Même page pour tout le monde** (règle 7) : la reconnaissance de l'appli sert seulement à afficher l'aide et placer la flèche (précision acceptée le 15 octobre).
- **Chiffres** (rubrique Pages, fiche d'une page) : nouveau bloc « Sortie de TikTok » : Aide affichée, Sortis de TikTok, % sortis, détail iPhone / Android, et « Telegram ouvert après la sortie » ; colonne « % sortis » dans les tableaux ; export.

## Mesures en production (16 octobre, page de test du canal Test)
- **Appui → aide visible** (navigateurs intégrés simulés) : TikTok iPhone 19 ms, TikTok Android 35 ms, Instagram 26 / 31 ms, Facebook 20 / 28 ms (objectif < 100 ms) ; flèche exactement à la position de la table ; adresse marquée ; aucun saut vers t.me.
- **Navigateur normal** : le lien part en 1 ms (Safari), 13 ms (Chrome Android).
- **Première réponse du serveur → ouverture automatique** : Safari 40-41 ms, Chrome Android 30 ms (objectif < 300 ms), puis marqueur neutralisé (`tgd=1`).
- **Lighthouse mobile : 100/100** (accessibilité 100, bonnes pratiques 100) ; affichage complet 1,02 s (profil standard « Slow 4G », depuis le Mac qui sort par l'Indonésie) et 0,63 s (profil 4G). Poids 12 Ko (5,6 Ko compressée) sans pixel ; mêmes octets pour tous ; premier octet 15 ms depuis l'Europe.

## Test de 5 minutes
1. Envoyez-vous https://go.goolink.eu/j/test?src=tk01 dans un message TikTok et ouvrez-le depuis TikTok (un lien en message ou en bio passe d'abord par l'écran TikTok « Tu quittes TikTok pour accéder à un site Internet externe » : touchez le lien ; pour une pub, cet écran n'existe pas).
2. Appuyez sur « Rejoindre le canal » : l'aide apparaît tout de suite avec la flèche jaune vers « ••• ».
3. Suivez-la : « ••• » → « Ouvrir dans le navigateur ».
4. Safari demande « Ouvrir dans « Telegram » ? » → Ouvrir : Telegram s'ouvre sur la demande d'adhésion au canal Test.
5. Rubrique Pages → page « test » → Chiffres : « Aide affichée » et « Sortis de TikTok » montrent votre essai.

## Vérifications faites
- Recherche web (positions et libellés des menus par appli et système, code de Chrome et de WebKit pour l'ouverture automatique), deux passes sur la page, chiffres, deux relectures adverses, corrections, relecture finale, dernières corrections. Défauts trouvés et corrigés : « % sortis » faussé par des sorties sans aide ; 2e événement pixel pour une même personne ; ouverture directe perdue pour Instagram / Facebook ; marqueur d'adresse recopiable (désormais valable 30 minutes) ; page au-dessus de 15 Ko dans le pire cas ; flèche qui défilait en paysage.
- Identifiants de navigateur réels relevés en production (`docs/tiktok-captures/agents-utilisateurs-reels.md`) : TikTok iOS 26, navigateur publicitaire de TikTok, Snapchat, NAVER, Daum… tous reconnus.
- Captures : `docs/captures/j-aide-tiktok-iphone-390.webp`, `j-aide-tiktok-android-390.webp`, `pages-*`, `pages-id-*`.

## Limites et suites
- Seule la position du « ••• » de **TikTok iPhone** est confirmée par une capture. **TikTok Android** : en haut à droite d'après le code de l'appli et les guides, mais l'aide TikTok parle du bas de l'écran ; une capture Android est demandée (`docs/A-FAIRE-HUMAIN.md`). Instagram, Facebook, Messenger : d'après des guides, à confirmer.
- Personne n'a encore prouvé que TikTok emporte l'adresse marquée vers Safari ; à défaut, la page reconnaît la sortie au paramètre `ttclid` des pubs.
- iPhone sans Telegram installé : l'ouverture automatique fait afficher par Safari « adresse non valide » (limite de l'iPhone).
- Chrome sur iPhone pose sa propre question avant d'ouvrir Telegram.

## Phase 15 — (pages d'atterrissage, rubrique « Pages ») terminée (15 octobre 2026)

Phases 0 à 14 en ligne. Phase 15 = les pages d'atterrissage Telegram ultra-rapides demandées le 15 octobre (`docs/prompts/17-phase-15-pages-atterrissage.md`, contrat `docs/PAGES-ATTERRISSAGE.md`). 3 645 tests unitaires et 461 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (le site d'abord, qui applique les deux migrations, puis le service d'arrière-plan), sauvegarde faite juste avant.

## Phase 15 : ce qui a changé
- **Rubrique « Pages »** (menu, juste après Campagnes) : un seul formulaire (canal, phrase d'accroche, sous-texte, texte du bouton, sources ; le reste dans « Avancé » : langue, pixels TikTok / Meta vérifiés à la saisie, bandeau cookies, photo du canal, petite ligne, adresse) avec l'aperçu téléphone en direct à côté. Chaque source (tk01, tk03, exo1…) a son bouton **Copier le lien** (`https://go.goolink.eu/j/<page>?src=<source>`, celui à coller dans la pub) et peut être reliée à une pub pour le coût par join.
- **La page publique** : un écran sans défilement, le vrai titre du canal (relu automatiquement chez Telegram, jamais saisi), l'accroche, le gros bouton bleu « Rejoindre le canal → » en bas, sous le pouce. Même page pour tout le monde (robots compris) ; seule la façon d'ouvrir l'appli Telegram s'adapte au téléphone au moment du clic (iPhone, Android, TikTok, Instagram…), avec repli sur le lien t.me. Servie depuis la mémoire, sans aucune requête à la base, mise à jour dès que vous modifiez la page.
- **Liens d'invitation** : un lien par source, avec demande d'adhésion, créé tout seul par le bot de l'univers du canal (sinon un autre de nos bots administrateurs) ; un refus de Telegram s'affiche sur la source en français, avec « Réessayer », et un nouvel essai automatique toutes les 10 minutes. Les demandes et acceptations remontent à la page et à la source ; la provenance « Venu de la page « X » (source « tk01 ») » s'affiche partout ; exceptions « une page d'atterrissage (toutes) » et « la page X » dans « Qui peut entrer et quand ».
- **Chiffres** (fiche d'une page, avec le choix des dates) : visites, clics, % de clic, demandes, acceptés, % visite → join, coût par join (dépense de la pub reliée, partagée sans double compte avec le lien direct de la même pub), « Telegram ouvert après le clic » par téléphone et par appli, et en dessous la comparaison avec les liens directs des pubs du même canal. Robots jamais comptés, adresse IP jamais gardée (pays par une base locale). Export CSV.
- **Pixels TikTok et Meta** facultatifs, chargés après l'affichage (PageView, puis ClickButton / Contact au clic) ; bandeau cookies facultatif (pixels seulement après « Accepter »).

## Mesures en production (15 octobre, page de test sur le canal « Test » seulement)
- **Lighthouse mobile : score 100** (médiane de 3 ; accessibilité 100, bonnes pratiques 100). Affichage complet (LCP) : **1,07 s** avec le profil standard de Lighthouse (« Slow 4G » : 150 ms de latence, bridage du processeur ×4), **0,61 s** avec un profil 4G réaliste (60 ms, 9 Mbit/s). Ces mesures partent du Mac du projet, qui sort par l'Indonésie : elles comptent ~220 ms de trajet Asie → Europe qu'un visiteur en France n'a pas. Le profil standard a un plancher d'environ 1,2 à 1,5 s même pour une page vide sur un serveur proche : « moins de 1 s » n'est tenu qu'avec le profil 4G.
- **Poids** : 8,7 Ko (4,2 Ko compressée), pixels non compris ; mêmes octets pour les 9 navigateurs et robots testés (TikTok, Instagram, Safari, aperçu Facebook, robots TikTok et Google, aucun).
- **Temps de première réponse** : depuis l'Europe (conteneur, par l'adresse publique) 18 ms en médiane avec une nouvelle connexion, 10 ms sinon ; depuis le Mac (Indonésie, entrée Railway de Singapour) 310 ms. Service web en Europe (europe-west4) : rien à changer.
- **Clic** (navigateurs intégrés TikTok et Instagram sur iPhone et Android, Safari, Chrome, simulés sur la vraie page) : tentative d'ouverture de Telegram en 1,4 ms au plus, repli vers t.me si l'appli ne s'ouvre pas, « Telegram ouvert » seulement quand la page passe en arrière-plan, aucune erreur ni blocage de sécurité. Visites bien enregistrées en base par le service d'arrière-plan (pays déduit, IP non gardée).

## Test de 5 minutes
1. https://app.linkaffipro.com/pages → la page « test » (canal Test) : formulaire, aperçu, 4 liens prêts (principal, tk01, tk03, exo1).
2. Cliquez **Copier le lien** de tk01 et ouvrez-le sur votre téléphone : la page s'affiche tout de suite ; appuyez sur le bouton bleu : Telegram s'ouvre sur la demande d'adhésion au canal Test.
3. Envoyez-vous ce lien dans un message TikTok puis Instagram et refaites le geste depuis chaque appli (le seul test que je ne peux pas faire moi-même).
4. Revenez sur la page « test » → **Chiffres** : vos visites, clics et « Telegram ouvert » y sont.
5. **Nouvelle page** : créez votre première vraie page sur un de vos canaux et copiez le lien d'une source dans votre pub.

## Vérifications faites
- Cinq agents de réalisation (socle, recherche web sur l'ouverture de Telegram depuis TikTok / Instagram, page publique, moteur, interface), trois relectures adverses, corrections, relecture finale de bout en bout et dernières corrections. Défauts importants trouvés et corrigés : la pub reliée réécrivait l'historique des chiffres (pub désormais figée sur chaque lien) ; la dépense d'une pub comptée deux fois (page et lien direct) ; un repli vers t.me perdu après une boîte de dialogue ; « Telegram ouvert » compté pour une page d'erreur ; la page pouvait défiler avec des textes longs ; envois fabriqués capables de gonfler les visites (limites ajoutées) ; pixels servis sur l'adresse du site d'administration ; liens des pages affichés comme liens de pub dans Campagnes.
- Production : sauvegarde (36 Mo) avant ; migrations appliquées au démarrage du site ; pages préchargées ; canal « Test » marqué « canal de test » (étiquette seulement) pour y créer la page de test ; pages Pages, fiche, création, export, exceptions, Journal, aide vérifiées avec le compte de vérification ; aucun message envoyé, aucune pub, aucun vrai membre touché.
- Captures 1440 / 390 : `docs/captures/pages-*`, `pages-id-*`, `pages-new-*` et la page publique `j-demo-casino-vip-src-tk01-390`.

## Limites et suites
- **TikTok iPhone** bloque peut-être toute ouverture d'appli depuis son navigateur (sources contradictoires) : la page essaie deux façons et compte ce qui marche ; les vrais chiffres « Telegram ouvert » trancheront.
- **Publicité TikTok** : son aide ne cite pas Telegram parmi les messageries de destination ; une pub vers Telegram, même par une page, peut être refusée à la modération.
- `https://goolink.eu/j/…` (sans « go. ») demande de confier les DNS à Cloudflare : pas fait (clics exacts dans `docs/A-FAIRE-HUMAIN.md`).
- Une adresse avec une barre oblique finale (`/j/page/`) reçoit une redirection de Next avant la page ; les liens copiés n'en ont jamais.
- Les 6 passages de Lighthouse et les essais du clic comptent comme visites de la page de test (source inconnue « lh » pour Lighthouse).
- Les chiffres en direct du tableau de bord filtré par campagne ne comptent pas encore les visites des pages comme clics pub (les Statistiques et les fiches campagne, si).

## Phase 14 — (demandes bloquées sur « Attend les canaux ») terminée (15 octobre 2026)

Phases 0 à 13 en ligne. Phase 14 = ce qui bloquait les demandes de Zone Interdite pendant la pub TikTok (`docs/prompts/16-phase-14-demandes-bloquees.md`). 3 303 tests unitaires et 398 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (service d'arrière-plan puis site), sauvegarde faite juste avant.

## Constat du 15 octobre vérifié dans la base (lecture seule, 15 octobre au matin)
- « Zone Interdite 🔞 » : **48 demandes** depuis le 14 octobre 16 h (pub TikTok). Aujourd'hui **44 acceptées, 4 parties, aucune encore « Attend les canaux »** : vous avez accepté **37 demandes à la main** après être passé en « Proposés » à 3 h 33 (37 « Accepter » dans le journal) ; 12 personnes avaient appuyé sur « ✅ J'ai rejoint ». Aucune demande « Attend les canaux » ailleurs (Tir Cadré et Zone Roulette : 47 demandes programmées, normales).
- **« A bloqué le bot » mélangeait deux choses** :
  - **vrai blocage** (Telegram nous dit que la personne a bloqué le bot) : **19 personnes**, dont 12 dans les 2 minutes qui suivent l'accueil (les autres entre 9 et 23 minutes) ;
  - **refus d'envoi** : **14 rappels** (1 h) et **33 messages « Accepté »** (après vos acceptations à la main) refusés par Telegram et classés à tort « bloqué ». Ces personnes n'ont jamais appuyé sur « Démarrer » (21 sur 48 l'ont fait) : passé 5 minutes après la demande, Telegram refuse que le bot leur écrive (« bot can't initiate conversation with a user »). Aucune n'avait bloqué le bot (pas de signal de blocage pour elles). Le message exact de Telegram n'était pas gardé : il l'est désormais.
- Par heure (Paris) : 14 oct. 17 h : 23 demandes, 16 blocages ou refus ; ensuite 1 à 5 demandes par heure, dont 1 à 4 blocages ou refus.

## Phase 14 : ce qui a changé
- **Acceptation toute seule quand les canaux sont rejoints** : dès que la personne a rejoint (ou demandé à rejoindre) tous les canaux obligatoires, sa demande passe en « Acceptation programmée », sans « ✅ J'ai rejoint ». Le bot le voit tout de suite quand la demande ou l'entrée arrive dans un de nos canaux, et revérifie seul toutes les 2 minutes.
- **« ✅ J'ai rejoint » marche sans « Démarrer »** : c'est maintenant un bouton qui met à jour le message du bot (« C'est bon… » ou « Il te manque encore… »). Les anciens boutons déjà envoyés marchent toujours.
- **Rappel à 4 minutes** proposé par défaut pour toute nouvelle règle avec canaux obligatoires (le seul moment où Telegram laisse encore le bot écrire à tout le monde) ; les rappels plus tardifs ne partent qu'aux personnes qui ont démarré le bot. Les règles existantes n'ont pas changé.
- **« A bloqué le bot » veut dire bloqué** : un refus de Telegram parce que la personne n'a jamais démarré le bot n'est plus compté comme un blocage, et rien ne lui est envoyé (« Accepté », rappels). Le message exact de Telegram est gardé dans le journal.
- **Onglet Demandes** : filtre (Toutes, Attend les canaux, Acceptation programmée, À valider à la main) et **Tout accepter** sur le filtre choisi ; en haut, le **parcours des demandes** par provenance (demandes, accueil envoyé, ont bloqué le bot, canaux rejoints, acceptées, parties), repris dans Statistiques → Canaux.
- **Qui peut entrer et quand** : après une modification, « N demandes déjà en attente suivent l'ancienne règle » avec **Leur appliquer la nouvelle règle** (jamais lancé par nous : c'est vous qui décidez) ; avertissement quand l'accueil parle d'une étape obligatoire alors que les canaux sont « Proposés » (le bouton « J'ai rejoint » n'y est plus) ; notes sous les rappels.
- **Alerte Telegram** si plus d'un quart des personnes d'un canal bloquent le bot dans l'heure qui suit l'accueil (au moins 10 demandes ; au plus une par canal toutes les 6 heures), avec la pub la plus touchée.

## Rattrapage en production (15 octobre, 8 h 07, fait tout seul par le service d'arrière-plan au déploiement)
- **0 demande** « Attend les canaux » à accepter (vous les aviez déjà toutes acceptées) ; 0 encore en attente.
- **15 « a bloqué le bot » effacés** (refus de Telegram qui n'étaient pas des blocages) ; 1 personne qui n'avait jamais démarré le bot n'est plus comptée « joignable ».
- **11 accueils par défaut** réécrits sans « ✅ J'ai rejoint » ; **1 accueil écrit par vous** jamais touché : celui de Zone Interdite, qui dit encore « clique sur « J'ai rejoint » pour être accepté » alors que les canaux sont « Proposés » (le site l'affiche en avertissement ; texte proposé dans `docs/A-FAIRE-HUMAIN.md`).
- `railway ssh --service web -- pnpm db:phase14` réaffiche ce résultat sans rien refaire.

## Test de 5 minutes
1. https://app.linkaffipro.com/channels → **Zone Interdite** → onglet **Demandes** : en haut, le parcours des demandes de la pub TikTok (combien ont vraiment bloqué le bot, combien ont rejoint les canaux).
2. Onglet **Qui peut entrer et quand** : un avertissement orange vous signale l'accueil qui parle encore de « J'ai rejoint ». Corrigez-le dans **Ce que dit le bot** (texte proposé dans la liste des actions).
3. Avec un compte qui n'est pas membre, demandez à rejoindre un canal réglé sur « canaux obligatoires » (par exemple Tir Cadré), rejoignez les canaux proposés **sans appuyer sur rien** : 2 minutes plus tard au plus, la carte de la demande passe « Acceptation programmée ».
4. Refaites l'essai en appuyant sur **✅ J'ai rejoint** sans avoir appuyé sur « Démarrer » : le message du bot se met à jour tout de suite.
5. Onglet **Demandes** d'un canal avec des demandes programmées : le filtre et **Tout accepter** sont là (n'appuyez que si vous voulez vraiment les accepter toutes).

## Vérifications faites
- Trois agents de réalisation (bot et service d'arrière-plan ; règles et demandes du site ; parcours des demandes), deux relectures adverses puis une relecture finale qui a rejoué le cas de Zone Interdite par les tests (canaux rejoints sans appuyer, bouton sans « Démarrer », rappel à 4 minutes, blocage ou refus, alerte, « Tout accepter », appliquer une règle). Défauts importants trouvés et corrigés : « Tout accepter » pouvait laisser des demandes « Acceptation en cours » pour toujours (heure de secours à 10 minutes ajoutée) ; un accueil envoyé dans les 5 minutes rendait la personne « joignable » à tort (cause des rappels et « Accepté » refusés) ; le rattrapage aurait rendu injoignables des personnes qui avaient écrit au bot ; une demande acceptée en même temps par deux voies pouvait être notée « expirée ».
- Production : sauvegarde (36 Mo) juste avant ; service d'arrière-plan déployé avant le site (sinon les rappels à 4 minutes de la transition seraient perdus) ; santé OK (base 12 ms, battement du service d'arrière-plan 17 s), go.goolink.eu répond 302 ; pages vérifiées avec le compte de vérification : fiche canal (Demandes, Qui peut entrer et quand, Ce que dit le bot), Statistiques → Canaux, Journal, Membres, Aide (nouvelle section du guide), État du système ; aucune erreur dans les journaux. Captures 1440 / 390 px refaites : `docs/captures/channels-id-tab-requests-*`, `channels-id-tab-rules-*`, `stats-channels-*`, `settings-journal-events-*`.
- Aucun message envoyé à de vrais membres par nous ; « Leur appliquer la nouvelle règle » et « Tout accepter » jamais utilisés en production.

## Limites et suites
- Telegram ne laisse le bot écrire en premier que 5 minutes après la demande : une personne qui n'appuie jamais sur un bouton du bot ne reçoit ni rappel tardif ni « Accepté » ; elle est quand même acceptée.
- La vérification par Telegram (filet de 2 minutes) est limitée à 30 appels par bot et par passage : avec un très gros afflux, certaines demandes sont vérifiées au passage suivant.
- « Canaux rejoints » est rangé avec les rappels dans les statistiques des messages du bot (pas de type dédié sans changer la base).

## Phase 13 — (affiliés Link Affi sur vos canaux) terminée (14 octobre 2026)

Phases 0 à 12 en ligne. Phase 13 = les campagnes Telegram des affiliés Link Affi (`docs/prompts/15-phase-13-partenaires.md`, contrat `docs/LINKAFFI-PARTENAIRES.md` v2 + annexe). 3 151 tests unitaires et 363 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (site et service d'arrière-plan). La partie Link Affi est construite en parallèle par le client (Lovable) : notre côté est prêt et se branche dès que les deux valeurs sont collées dans Link Affi.

## Phase 13 : ce qui a changé
- **Connexion avec Link Affi** (Réglages → Connexions → « Campagnes Telegram des affiliés », administrateur) : générer la clé de connexion et le secret de signature (affichés une seule fois), adresse de Link Affi, « Envoyer un événement de test », état des envois, écarts entre nos chiffres et ceux de Link Affi.
- **Liens des affiliés** : Link Affi demande à la plateforme un lien d'invitation par campagne d'affilié (avec demande d'adhésion), le désactive, et relit les membres et leur parcours.
- **Membres des affiliés** : une personne entrée par le lien d'un affilié lui est rattachée (premier affilié gagne ; pas une personne déjà dans le canal ; à vie ou pendant la durée de la campagne). Chaque étape (demande, acceptation, refus, expiration, entrée, départ, clic sur une offre) est envoyée à Link Affi, signée, avec nouvelles tentatives pendant 24 h et une alerte si un envoi attend plus d'une heure.
- **Crédit à l'affilié** : ses clics sur les boutons d'offre du bot ajoutent la campagne de l'affilié au lien Link Affi (`tg`) : inscription et premier dépôt comptés pour lui dans Link Affi.
- **Suivi ici** : page **Campagnes → Affiliés Link Affi** (par affilié et par campagne : clics, demandes, acceptés, présents, partis, clics d'offre, inscriptions, premiers dépôts, dépôts, revenu net ; export), filtre Affilié dans Membres et Statistiques, « Amené par … » sur la fiche membre (correction par un administrateur), exceptions d'entrée par affilié, avertissement pour les messages sans bouton d'offre.

## Test de 5 minutes
1. https://app.linkaffipro.com/settings/connectors → « Campagnes Telegram des affiliés » : la partie est là, pastille « À brancher ».
2. Générez la clé de connexion puis le secret de signature, et collez-les dans les secrets de Link Affi (voir `docs/A-FAIRE-HUMAIN.md`, phase 13).
3. Cliquez « Envoyer un événement de test » : « Reçu » quand Link Affi est prêt.
4. Dans Link Affi, créez une campagne de type « Canal Telegram » pour un affilié : elle apparaît dans Campagnes → Affiliés Link Affi.
5. Une personne entre par le lien de l'affilié : sa fiche membre dit « Amené par … ».

## Vérifications faites
- Quatre agents de réalisation (attribution, événements et `tg` ; synchro Link Affi ; API d'intégration et réglages ; vues internes), deux relectures adverses puis une relecture finale qui a rejoué tout le scénario du cahier des charges (clés, appels simulés de Link Affi, lien, demande, événements signés vérifiés par un récepteur, clic d'offre avec `tg`, joueur, premier dépôt visible) : 8 vérifications sur 8. Défauts importants trouvés et corrigés : données d'un membre supprimé restées dans les événements, ordre « entré » avant « accepté », événements annulés encore relus par Link Affi.
- Production (14 octobre) : sauvegarde faite avant, migration appliquée, file d'envoi des événements démarrée par le worker, clé « anon » de Link Affi copiée sur le site (sans l'afficher) ; l'API d'intégration répond 401 en JSON français sans clé ou avec une clé fausse (et pas une redirection vers la connexion) ; pages Réglages → Connexions, Campagnes → Affiliés Link Affi (et son export), Membres, Statistiques, fiche canal vérifiées avec le compte de vérification. Les deux clés ne sont pas générées : c'est vous qui le faites (elles ne s'affichent qu'une fois). La sauvegarde est passée à 36 Mo : ce sont vos 1 125 emojis animés et vos médias, c'est normal.

## Limites et suites
- Les noms exacts des tables Telegram de Link Affi ne sont pas encore connus : la synchro les détecte toute seule et compare dès qu'elles existent ; à resserrer quand Link Affi publiera son récapitulatif.
- La durée d'attribution choisie dans Link Affi doit nous être envoyée (`attributionDays`) : ajouté au contrat et au prompt Lovable ; à transmettre au développeur de Link Affi avec l'annexe du contrat.
- Une demande qu'aucun bot administrateur ne peut accepter est réessayée sans fin (défaut antérieur, à traiter plus tard).

## Phase 12 — (emojis animés) terminée (12 octobre 2026)

Phases 0 à 11 en ligne. Phase 12 = les emojis animés des packs Premium de Telegram dans les messages (`docs/prompts/14-phase-12-emojis-animes.md`). 2 863 tests unitaires et 289 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (site et service d'arrière-plan).

## Phase 12 : ce qui a changé
- **Bibliothèque « Emojis animés »** (Messages → Emojis animés) : 3 façons d'ajouter — transférer au bot un message qui contient vos emojis (le bot répond « 6 emojis animés ajoutés ✅ »), coller le lien d'un pack (t.me/addemoji/…), ou importer les packs installés sur votre compte Telegram connecté. Aperçus animés, recherche, packs ; un administrateur peut retirer un emoji.
- **Éditeur** : bouton « Emoji animé » dans la barre de tous les écrans de rédaction (messages de canal, modèles, ce que dit le bot, relances, écrire à un groupe) ; l'emoji s'insère animé, se supprime comme une lettre et compte pour un caractère. L'assistant IA et les traductions le gardent.
- **Messages privés du bot** (accueil, rappels, relances, écrire à un groupe…) : le bot envoie les emojis animés lui-même (règle Telegram depuis février 2026, propriétaire des bots Premium). Si Telegram les refuse, le message part aussitôt avec les emojis normaux et l'admin est prévenu une fois par jour au plus. Même chose pour les messages de groupe.
- **Messages de canal** : Telegram interdit ces emojis aux bots dans les canaux, donc un message de canal qui en contient est publié par votre compte Telegram connecté, sans boutons (une offre se met en lien dans le texte, clics comptés). Avec des boutons, vous choisissez : garder les emojis animés (sans boutons) ou garder les boutons (emojis normaux). Le formulaire vérifie avant de programmer que votre compte peut publier (connecté, Premium, administrateur du canal). Badge « Publié par votre compte · emojis animés » ; épingler, supprimer après N minutes, envoyer sans son passent par votre compte ; jamais de doublon, jamais de modification par le bot.

## Test de 5 minutes
1. Dans Telegram, transférez à @casinogamblingoobot un message qui contient des emojis animés : le bot répond « … emojis animés ajoutés ✅ ».
2. https://app.linkaffipro.com/messages/emojis : vos emojis sont là, animés.
3. Messages → Programmer un message → canal « Test » → bouton **Emoji animé** : insérez-en un ; le bandeau « publié par votre compte Telegram, sans boutons » apparaît, et la ligne « Votre compte Telegram … peut publier » (sinon **Vérifier**).
4. Programmez-le dans 2 minutes : il paraît dans « Test », publié par votre compte, avec l'emoji animé.
5. Membres → Relances automatiques → une relance → **Tester sur moi** avec un emoji animé : vous le recevez animé du bot.

## Vérifications faites
- Quatre agents de réalisation (bot : ajout, aperçus, repli ; compte connecté : publication ; éditeur, sélecteur, bibliothèque ; formulaire des messages), deux relectures adverses puis une relecture finale de bout en bout, chaque défaut corrigé avec un test qui échouait avant. Défauts importants trouvés et corrigés : les groupes passaient à tort par votre compte (le bot peut y publier les emojis lui-même) ; transférer le message du canal de quelqu'un d'autre pour récupérer ses emojis ajoutait ce canal.
- Conversion du texte vers le format du compte vérifiée avec des emojis composés, des drapeaux et des caractères spéciaux (positions exactes) ; aller-retour de l'éditeur sans perte dans Chrome et Firefox ; 0 violation d'accessibilité.
- Captures de référence : `docs/captures/messages-emojis-*`, `messages-new-*` et, pour l'éditeur et le sélecteur (que l'outil de captures ne sait pas ouvrir), `docs/captures/phase12-emojis/`.
- **Essai réel en production (12 octobre, 1 h 43, en sécurité)** : état du compte relevé (connecté, **Telegram Premium confirmé**, droit de publier dans « Test ») ; message privé du bot casino **à l'admin seulement** avec l'emoji animé d'exemple de la documentation Telegram : accepté tel quel, sans repli ; message dans le canal **« Test » seulement**, publié par le compte connecté : publié avec son emoji animé gardé (1 sur 1), badge « Publié par votre compte · emojis animés », puis supprimé tout seul par le compte après 15 minutes ; aperçu animé récupéré (pack « Hand Emoji »), puis cet emoji d'essai retiré de la bibliothèque. L'import des packs du compte fonctionne mais le compte n'a aucun pack installé. Pages vérifiées avec le compte de vérification.

## Limites et suites
- La forme exacte du refus de Telegram (Premium expiré) n'est documentée nulle part : la détection est prudente et le repli a été testé en simulation.
- « Contenu protégé » ne s'applique pas à un message publié par votre compte (Telegram le réserve aux bots) : protégez tout le canal dans ses réglages Telegram.
- Les emojis récents de votre clavier Telegram ne peuvent pas être importés (Telegram ne les garde que sur le téléphone) : utilisez le transfert au bot ou les packs.

## Phase 11 — (règles selon la provenance) terminée (11 octobre 2026)

Phases 0 à 10 en ligne. Phase 11 = les règles d'acceptation selon la provenance et le délai après les canaux obligatoires, demandés par le client le 11 octobre (`docs/prompts/13-phase-11-regles-par-provenance.md`). 2 537 tests unitaires et 220 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (site et service d'arrière-plan).

## Phase 11 : ce qui a changé (11 octobre)
- **Délai selon la provenance** (fiche canal → « Qui peut entrer et quand ») : en haut, **Par défaut** ; en dessous, **Exceptions selon la provenance** : « Si la personne vient de [Tir Cadré] → après 1 jour ». Provenances possibles : un de nos canaux, le bouton « canal à rejoindre » d'un de nos canaux, n'importe lequel de nos canaux, une pub TikTok, une pub Meta, n'importe quelle pub, un lien de partage (n'importe lequel ou un précis). Ordre : lien précis, puis canal, puis type de provenance ; glisser ou Monter / Descendre dans chaque groupe ; « Jamais utilisée » signale une exception masquée. Suppression réservée aux administrateurs.
- **Simulateur** « Et si quelqu'un demande à entrer ? » : il dit ce qui se passera pour chaque provenance (règle, canaux à rejoindre, heure d'entrée, message), avec exactement la même logique que le bot (vérifié sur 20 000 cas tirés au hasard : aucun écart).
- **Délai après « ✅ J'ai rejoint »** : « Puis accepter : tout de suite / 5 minutes / 1 heure / 1 jour / sur mesure » ; le délai part du clic, le bot l'annonce, aucun rappel ni expiration pendant ce temps.
- **Canaux obligatoires avec leur propre délai** : leurs boutons font maintenant une demande d'adhésion, et le canal obligatoire applique sa propre règle. Une demande en attente compte comme « rejoint » ; le canal d'où vient la personne compte toujours comme rejoint (deux canaux peuvent s'exiger l'un l'autre sans bloquer personne) ; une personne venue d'un canal obligatoire reçoit au plus un court message, jamais un deuxième accueil complet ; un même bot n'envoie pas deux accueils en 10 minutes.
- **Rien ne change pour vos canaux sans action de votre part** : LA ZONE ROULETTE et TIR CADRÉ ont reçu l'exception « Venu du bouton « canal à rejoindre » → tout de suite, sans message » (comme avant). Les anciens boutons restent valables 7 jours, puis sont retirés automatiquement.
- **Liens de partage** (sous le simulateur) : un lien nommé à poster où vous voulez, « à poster dans » un de nos canaux en option, à copier, avec ses demandes et acceptées, désactivable.
- **Suivi** : chaque demande et la fiche membre disent « Venu de « Tir Cadré » (canal obligatoire) · règle : 1 jour · acceptation prévue le … » ; onglet Membres de la fiche canal : « D'où viennent les demandes » (30 jours : demandes, acceptées, départs dans les 7 jours) ; journal des exceptions et des liens de partage.

## Test de 5 minutes
1. https://app.linkaffipro.com/channels → **Zone Interdite** → **Qui peut entrer et quand** : **+ Ajouter une exception** → « de « Tir Cadré » » → **Après un délai** : 1 jour → **Enregistrer l'exception**.
2. En haut, **Par défaut** : « Puis accepter » → 5 minutes → **Enregistrer la règle**.
3. Plus bas, **Et si quelqu'un demande à entrer ?** : choisissez le bouton de Tir Cadré, puis une pub : le simulateur annonce 1 jour, puis 5 minutes après « ✅ J'ai rejoint ».
4. Onglet **Demandes** : chaque carte dit d'où vient la personne et quand elle sera acceptée.
5. **LA ZONE ROULETTE** → **Qui peut entrer et quand** : l'exception « bouton « canal à rejoindre » → tout de suite » est là.

## Vérifications faites
- Trois agents de réalisation (bot et worker ; écran des règles ; liens de partage et suivi), puis relectures adverses indépendantes de chaque partie et une relecture finale du scénario du client de bout en bout, chaque défaut corrigé avec un test qui échouait avant. Défaut bloquant trouvé et corrigé avant la mise en ligne : Telegram masque la fin d'un lien créé par un autre bot, ce qui aurait perdu la provenance (les liens des canaux obligatoires sont maintenant créés par le bot du canal à rejoindre, avec un filet de secours).
- Scénario exact du client testé sur une vraie base avec des mises à jour Telegram simulées (Tir Cadré exige Zone Interdite ; Zone Interdite exige Zone Roulette et Tir Cadré ; venu de Tir Cadré → 1 jour ; autre lien → 5 minutes), de la demande jusqu'à l'acceptation par le worker.
- Accessibilité : 0 violation (axe) sur les onglets de la fiche canal, les volets et la fiche membre, à 1 440 et 390 px ; captures de référence dans `docs/captures`.

## Limites et suites
- Le court message « Ta demande pour … est bien reçue » a un texte intégré (6 langues) : pas encore modifiable dans « Ce que dit le bot ».
- Le glisser-déposer des exceptions marche à la souris sur ordinateur ; sur téléphone, flèches Monter / Descendre.
- Pas encore testé par une vraie personne sur Telegram : essai à faire (voir `docs/A-FAIRE-HUMAIN.md`, phase 11).

## Phase 10 — (finitions après la refonte) terminée (11 octobre 2026)

Phases 0 à 9 en ligne. Phase 10 = les retours du client après la refonte (`docs/prompts/12-phase-10-finitions-apres-refonte.md`). 2 380 tests unitaires et 182 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé (site et service d'arrière-plan).

## Phase 10 : ce qui a changé (11 octobre)
- **Accueil sans les liens des canaux à rejoindre : corrigé** (cause exacte ci-dessous). N'importe lequel de nos bots peut fournir le lien d'un canal à rejoindre ; l'accueil part toujours avec les canaux et « ✅ J'ai rejoint » ; si un lien manque, une alerte Telegram prévient, la demande apparaît dans « À faire » avec **Renvoyer l'accueil avec les liens**, et la fiche du canal dit quel bot ajouter (cadre « Liens des canaux à rejoindre », bouton **Vérifier les liens**). Testé par le client le 11 octobre : ça fonctionne.
- **Gains = nos commissions − dépense pub**, partout : accueil (« Gains du jour », avec « commissions X € − pub Y € » dessous), campagnes, statistiques, exports, rapports et alertes Telegram. Les commissions = primes des joueurs (CPA) + notre part du revenu (revshare), nos campagnes seulement, aux vraies dates : une prime annulée se retire le jour de l'annulation. Les dépôts et le revenu net restent des indicateurs, jamais ajoutés aux gains. Retour sur dépense pub = commissions ÷ dépense.
- **Variations** : « nouveau » quand la valeur d'avant était 0, rien quand tout vaut 0, ±999 % au plus seulement sur une base non nulle.
- **Modèles de messages réécrits** : plus aucun mot entre accolades dans un message de canal ; ceux qui parlent d'une offre ont un bouton « Offre (campagne) » à régler. {prenom} est bien remplacé dans les messages privés (envois à un groupe, relances, « Tester sur moi »). L'assistant IA n'ajoute plus de repère là où il ne serait pas remplacé.
- **Relances** : bouton « Offre (campagne) » avec un identifiant de suivi par membre ; résultats par relance (envoyés, clics, inscriptions, premiers dépôts, gains), « Depuis le 11 oct. » pour les relances plus anciennes. Mini-carte de l'éditeur réparée (affichée seulement quand le parcours ne tient pas à l'écran).
- **Éditeur de texte** : vérifié dans Firefox, Chrome et Safari (22 vérifications réelles à 1 440 et 390 px), sauts de ligne et collage depuis Safari corrigés.
- **Production** : barre d'état vérifiée (aucun bot en erreur, synchros à jour, aucune alerte ouverte) ; le worker est maintenant en Europe (même région que la base).

## Bug du 11 octobre : accueil sans les liens des canaux à rejoindre (cause exacte et correction)
- **Ce qui s'est passé** : canal « Zone Interdite 🔞 » (bot @womendatingoobot), règle « après avoir rejoint » avec « LA ZONE ROULETTE 🎰 » et « 🎯 TIR CADRÉ ⚡ ». Lors des demandes de 9 h 53 et 9 h 58, l'accueil est parti **sans aucun bouton** (ni les deux canaux, ni « ✅ J'ai rejoint ») ; la demande de 10 h 14 a fonctionné.
- **Cause** : les liens d'invitation des canaux à rejoindre étaient créés par le seul bot du canal demandé. Or « LA ZONE ROULETTE » n'avait que le bot casino comme administrateur et « TIR CADRÉ » que le bot paris : chaque canal avait bien son bot, mais le bot rencontres n'y était pas. Telegram refusait la création du lien, l'erreur était avalée sans trace, et l'accueil partait vide. Le client a ajouté le bot rencontres aux deux canaux à 10 h 13, d'où la réussite de 10 h 14. Second défaut trouvé au passage : la vérification « ✅ J'ai rejoint » ne passait elle aussi que par le bot du canal demandé.
- **Correction** : n'importe lequel de nos bots administrateurs (avec le droit d'inviter) crée le lien et vérifie l'adhésion ; l'accueil part toujours avec « ✅ J'ai rejoint » et les liens obtenus ; un canal sans lien déclenche une alerte Telegram (une fois par 24 h) et un point « À faire » sur l'accueil avec « Renvoyer l'accueil avec les liens » ; la fiche du canal vérifie les liens dès l'enregistrement de la règle et dit quel bot ajouter ; les rappels recalculent les liens. Les 2 demandes bloquées de ce matin apparaissent dans « À faire ».

## Test de 5 minutes
1. https://app.linkaffipro.com : la carte « Gains du jour » avec « commissions … − pub … » dessous.
2. Campagnes : chaque carte affiche « Gains » ; dans une fiche, « Tous les chiffres de la période » détaille les commissions.
3. Canaux → un canal avec « après avoir rejoint ces canaux » → onglet « Qui peut entrer et quand » : le cadre « Liens des canaux à rejoindre » est vert.
4. Messages → Modèles → « Utiliser » sur un modèle d'offre : plus de mots entre accolades, choisissez la campagne du bouton « Offre ».
5. Membres → Relances automatiques → une relance → Message : « Ajouter un bouton » → « Offre (campagne) » ; « Tester sur moi » (la relance reste désactivée).

## Vérifications faites
- Diagnostic du bug sur les données de production (lecture seule) ; tests unitaires et d'intégration sur l'adhésion avec les canaux à rejoindre, la création des liens par un autre bot, l'accueil jamais vide, l'alerte et le renvoi.
- Gains : chiffres comparés aux données réelles Link Affi du 11 octobre (exemple : 5 primes le 4 octobre = 350 € et 2 annulations le 6 octobre = −140 €, que la table de Link Affi range au 4 octobre ; total identique de 630 € par les deux sources) ; reprise faite en production (`pnpm db:phase10:gains`) après une sauvegarde : 1 767 joueurs relus, 368 avec une commission, 496 événements de commission écrits, puis synchro complète de la table des commissions par jour et recalcul complet. Votre campagne actuelle n'a pas encore de joueur sur ses deux offres : ses gains valent 0 €, c'est normal.
- Production après déploiement : santé du site et du service d'arrière-plan OK, migration appliquée, 34 pages ouvertes avec le compte de vérification sans erreur (« Gains du jour », « commissions … − pub … », colonnes Commissions et Gains des exports), liens traqués en 302, aucun message d'erreur dans les journaux.
- Relecture du code par des agents indépendants, puis corrections, avant déploiement.
- Captures automatiques de la production avec le compte de vérification : refusées par les règles de sécurité de la machine ; pas de contournement. Contrôle fait à la place par lecture du texte des pages et requêtes en lecture seule.

## Limites et suites
- **Part du revenu (revshare)** : Link Affi ne la donne que par offre et par jour : elle compte pour les campagnes et le total, jamais pour un canal, une pub, un message ou une relance (ceux-ci montrent les primes des joueurs).
- **Relances** : les envois d'avant le 11 octobre ne sont pas rattachés à leur relance (« Depuis le 11 oct. »).
- **Éditeur** : dans Safari, ⌘Z annule toute la saisie d'un coup.
- **Deux demandes du 11 octobre** (Zone Interdite) restent dans « À faire » : les accepter ou renvoyer l'accueil.
- Actions humaines toujours en attente : clé de l'assistant IA, règle d'adhésion de Mediatheque et Test, première campagne, applications Meta / TikTok / Telegram (voir `docs/A-FAIRE-HUMAIN.md`).

## Phase 9 — (refonte UX et design) terminée (11 octobre 2026, 5h00)

Phases 0 à 8 en ligne. Phase 9 = la refonte validée par le client (`docs/REFONTE-UX.md`), livrée en 8 étapes, chacune déployée dès qu'elle était prête. 2 117 tests unitaires et 139 tests d'intégration (base réelle) réussis, lint, typage et build verts, 0 violation d'accessibilité (axe) sur les 56 pages en 1 440 et 390 px ; tout est déployé (site et service d'arrière-plan).

## Phase 9 : ce qui a changé (10 et 11 octobre)
- **Allure** : couleurs du logo (menu nuit, bouton principal orange), police Inter, trois tailles de texte, une couleur par univers (casino violet, paris vert, rencontres rose), icône du site ; thème clair (le mode sombre viendra plus tard).
- **Menu à 6 entrées + Réglages** : Accueil, Campagnes, Canaux, Messages, Membres, Statistiques. Sur téléphone : barre du bas (Accueil, Messages, Membres, Campagnes, Plus). Tout ce qui a quitté le menu est rangé, et les anciennes adresses mènent au bon endroit.
- **Accueil** : barre d'état (« Tout va bien… » ou « N points à voir »), membres arrivés, premiers dépôts et bénéfice du jour comparés à hier à la même heure, « À faire », prochains messages, campagnes actives, liste « À faire pour démarrer ».
- **Aide** : bouton « ? » sur chaque page (l'aide de la page), guide complet réécrit (page Aide), **visite guidée** de 2 minutes à la première connexion (Réglages → « Revoir la visite »).
- **Campagnes** : cartes avec tendance, création en 4 étapes, fiche à 6 onglets (Vue d'ensemble, Pubs, Liens, Canaux, Messages, Membres) ; Pubs et Liens y sont rangés.
- **Messages** : calendrier de la semaine coloré par univers, glisser un message pour changer son heure (avec « Annuler »), meilleurs créneaux surlignés, création simplifiée (l'essentiel visible, le reste dans « Avancé »), éditeur de texte sans balises, modèles en galerie.
- **Canaux** : fiche en langage courant : « Qui peut entrer et quand » (tout de suite / après un délai / après avoir rejoint ces canaux), « Ce que dit le bot », « Demandes » faciles sur téléphone, « Membres ».
- **Membres** : filtres en mots simples (ont déposé, rien fait depuis 7 jours…), fiche « l'essentiel d'abord » ; **Écrire à un groupe** en 3 étapes avec le nombre exact de destinataires ; **Relances automatiques** : 6 relances prêtes à l'emploi (interrupteur, « Tester sur moi », compteur de la semaine) et un éditeur visuel à branches (conditions oui / non, attente, arrêt).
- **Statistiques** : 5 pages (Vue d'ensemble, Pubs, Parcours, Canaux, Membres dans le temps), un seul choix de période / univers / campagne, graphiques d'abord, détail au clic.
- **Réglages** : un écran en cartes (Connexions, Bots, Équipe, Alertes et rapports, IA, Catégories et étiquettes, Journal, État du système, Avancé).
- **Mots simples partout** (premier dépôt, revenu net, identifiant de suivi, retour sur dépense pub…), y compris dans les rapports et alertes Telegram ; le terme technique reste au survol.

## Où sont passées les anciennes pages ?
Tableau de bord → Accueil (le jour) et Statistiques (le détail) · Pubs et Liens → Campagnes · Envois → Membres → Écrire à un groupe · Automatisations → Membres → Relances automatiques · Bots et Journal → Réglages · Meilleurs horaires → calendrier des Messages. Les anciens liens et favoris redirigent tout seuls.

## Test de 5 minutes
1. https://app.linkaffipro.com : la visite guidée démarre ; faites-la (2 minutes) ou « Passer la visite ».
2. Accueil : la barre d'état, les 3 chiffres du jour, « À faire ».
3. Messages : le calendrier de la semaine ; cliquez un message pour voir son volet ; « Programmer un message » : écrivez un texte en gras sans balise.
4. Membres → Relances automatiques : les 6 cartes (toutes désactivées).
5. Le « ? » en haut à droite sur deux pages différentes ; sur téléphone, la barre du bas.

## Vérifications faites
- Chaque étape : relecture design sur captures (1 440 et 390 px) et relecture du code par des agents indépendants, puis corrections, avant déploiement ; environ 250 défauts trouvés et corrigés au total.
- Captures de référence des 56 pages dans `docs/captures` (index `docs/REFONTE-CAPTURES.md`), faites sur les données de démonstration locales.
- Tests de garde permanents : aucun mot technique en surface, aucune ancienne adresse dans le code, contour de focus toujours visible, titres du guide, accessibilité statique.
- Production : site et service d'arrière-plan redéployés à chaque étape, migration additive des relances appliquée (sauvegarde faite juste avant), redirections des anciennes adresses vérifiées en 308.

## Limites et suites
- **Modèles de messages** : 43 des 63 modèles fournis contiennent {offre} et 13 contiennent {prenom}, qui ne sont pas remplacés dans un message de canal. L'éditeur les surligne en jaune et le formulaire prévient « Des mots restent à compléter ». Une réécriture des modèles est prévue.
- **Relances** : le bouton « Offre (campagne) » avec identifiant de suivi n'existe pas encore dans les messages de relance (liens simples seulement).
- **Éditeur de texte** : testé dans Chrome et Safari (moteur WebKit) ; Firefox vérifié en phase 10.
- **Mode sombre** : prévu plus tard (décision du client).
- **Fiche introuvable** : une fiche supprimée affiche bien « Cette page n'existe pas », mais le code HTTP reste 200 (affichage progressif de Next) ; sans effet pour l'équipe.
- **Barre d'état de l'accueil** : résumé rapide sans appel à Telegram ; le détail exact est dans Réglages → État du système.
- Actions humaines toujours en attente (inchangées) : clé de l'assistant IA, ajout des canaux existants et règle d'adhésion de Mediatheque et Test, première campagne, applications Meta / TikTok / Telegram, worker en Europe (voir `docs/A-FAIRE-HUMAIN.md`).

## Phase 8 — (corrections du client, canaux existants, campagnes, assistant IA) terminée (10 octobre 2026, 12h05)

Phases 0 à 7 en ligne. Phase 8 = les retours du client du 10 octobre (`docs/prompts/10-phase-8-corrections-et-ia-messages.md`). 993 tests unitaires et 82 tests d'intégration (base réelle) réussis, lint, typage et build verts ; tout est déployé.

## Phase 8 : ce qui a changé (10 octobre)
- **Vos canaux existants** : Canaux → **Ajouter un canal existant**. Trois méthodes : transférer un message du canal au bot (canaux privés compris), coller le lien public, ou publier un message. La liste se rafraîchit seule pendant 2 minutes. Deux boutons de plus : **Importer tous mes canaux**, avec le compte Telegram connecté, et **Re-vérifier les droits des bots**. Tout canal qui envoie quelque chose à un bot est créé automatiquement. Un bot n'est plus jamais marqué « retiré » à tort : Telegram doit confirmer son départ.
- **Statistiques justes** : seuls vos joueurs comptent partout (tableau de bord, campagnes, entonnoir, cohortes, canaux, fiches, rapports Telegram, alertes). Vos joueurs sont ceux venus d'un de vos clics ou d'une offre Link Affi liée à une de vos campagnes. Les dates sont celles de Link Affi, et le NGR est daté variation par variation. Résultat : 7, 30 et 90 jours donnent des chiffres différents. Le tableau de bord se lit en deux lignes, Telegram puis Argent. Sans campagne, il affiche « Pas encore de chiffres : créez votre première campagne ». La tuile « Événements (24 h) » est passée dans Réglages → État du système et dans Journal → Événements.
- **Campagnes** (2e menu) : assistant en 4 étapes (nom, offres, canaux, pubs) et fiche à onglets (Vue d'ensemble, Pubs, Liens, Canaux, Messages, Membres, Offres). Le bouton **Offre** se règle par campagne. Le filtre Campagne existe sur le tableau de bord, Membres, Messages (liste, calendrier, export) et Envois. La ligne Total compte chaque joueur une seule fois. Les campagnes pub TikTok / Meta sont rattachées à vos campagnes, et les statistiques se recalculent seules après chaque modification.
- **Catégories** : plus aucune n'est créée d'office. Vous créez les vôtres, avec **+ Nouvelle catégorie** directement dans le formulaire de message. Vous pouvez les renommer, changer leur couleur et leur ordre, les fusionner ou les supprimer en choisissant un remplacement. Les 63 modèles fournis ont des thèmes, pas des catégories.
- **Assistant IA** : bouton **✨ Améliorer avec l'IA** sur les messages de canal, les modèles, les envois (versions A et B), les textes du bot et les automatisations. Il propose 3 versions, puis « Plus court », « Plus percutant », « Autre angle », traductions et version B. Il peut aussi écrire à partir d'une idée et s'inspire de vos messages qui ont marché. Réglages → IA : clé chiffrée, Vérifier, plafond mensuel (20 € par défaut), limite par personne, historique. Les règles de conformité sont imposées : pas de promesse de gains, mention des risques, 18+.

## À faire par vous (15 minutes, détail dans `docs/A-FAIRE-HUMAIN.md`)
1. **Créer la clé API Anthropic et la coller dans Réglages → IA (5 minutes)**.
2. **Ajouter vos canaux existants** : Mon compte → Lier mon Telegram, puis transférer un message de chaque canal au bot. Ensuite, enregistrer une règle d'adhésion par canal. Mediatheque et Test n'en ont pas : leurs demandes attendent désormais le bouton « Accepter ».
3. **Créer votre première campagne** (Campagnes → Nouvelle campagne).
4. **Créer vos catégories** (dans le formulaire de message).

## Test de 5 minutes
1. https://app.linkaffipro.com : le tableau de bord affiche « Pas encore de chiffres : créez votre première campagne », ou deux lignes Telegram / Argent s'il y a une campagne.
2. Canaux → **Ajouter un canal existant** : la fenêtre montre les 3 méthodes. Transférez un message d'un canal au bot : il répond « Canal « … » ajouté ✅ ».
3. Campagnes → **Nouvelle campagne** : les 4 étapes s'enchaînent ; à la fin, l'onglet Liens donne l'adresse à coller dans la pub.
4. Messages → Nouveau message → Catégorie → **+ Nouvelle catégorie** : la catégorie est créée et choisie.
5. Réglages → IA : collez la clé, **Vérifier** ; puis dans un message, **✨ Améliorer avec l'IA** propose 3 versions.

## Problèmes connus et limites
- Testé par Claude avec des mises à jour Telegram simulées, sur une vraie base, puis contrôlé en production avec le compte de vérification (32 pages, textes attendus). Pas encore testé par une vraie personne : le transfert d'un message au bot (méthode 1), à faire avec le message Telegram envoyé ce matin.
- L'assistant IA a été testé avec une API simulée ; il fonctionnera dès que la clé sera collée dans Réglages → IA.
- Reprise des données faite en production : 89 écarts de NGR datés, les 7 catégories d'office retirées des 63 modèles, puis recalcul complet des statistiques. Sauvegarde faite juste avant (Réglages → État du système → Dernière sauvegarde).
- Un ancien bouton Offre (créé avant les campagnes) se duplique en choisissant sa campagne ; sinon le message n'est pas enregistré et un message explique quoi faire.
- Deux cas rares où la vue d'ensemble et l'onglet Entonnoir peuvent différer d'une unité : membre arrivé par deux pubs dans deux canaux différents, ou joueur avec clic sans message ni pub d'origine sous le seul filtre univers.
- Une campagne pub déjà importée, puis renommée plus tard comme votre campagne, ne se rattache pas toute seule : utilisez « Rattacher une campagne pub importée » (onglet Pubs).
- Le worker est toujours aux États-Unis (clic à faire, `docs/A-FAIRE-HUMAIN.md`).

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

## Phase 7 — connecteurs directs (10 octobre, 7h00)
- **Comptes publicitaires Meta et TikTok** branchés depuis le site (Réglages → Connecteurs → Meta / TikTok) : enregistrement des identifiants d'application (chiffrés, bouton Vérifier), guide clic par clic avec les valeurs exactes à copier, bouton « Connecter un compte », connexion chez Meta ou TikTok, liste des comptes à cocher, plusieurs comptes et plusieurs utilisateurs, déconnexion en un clic, reconnexion guidée (statut « À reconnecter » + alerte Telegram).
- **Dépenses automatiques** : toutes les heures (3 derniers jours), 28 jours chaque nuit, 90 jours à la connexion ; campagnes, groupes et pubs créés dans Pubs et reliés aux liens d'entrée de même nom ; dépenses converties en euros (taux Link Affi toutes les 6 h, ou saisis dans Connecteurs) ; journal par connexion (dernière synchro, lignes, erreur lisible) ; priorité à l'API sur le CSV ; badge de source (API / Fichier / Saisie) dans Pubs.
- **Vues Telegram par message** : Réglages → Connecteurs → Telegram : api_id / api_hash (my.telegram.org), numéro, code reçu dans Telegram, mot de passe 2FA ; relevés toutes les 15 min pendant 48 h puis quotidiens jusqu'à 30 jours ; tuiles Vues / Transferts et courbe dans la fiche message ; meilleurs horaires et A/B utilisent les vues dès qu'elles existent.
- Pages publiques `/privacy` et `/terms` (exigées par Meta). 571 tests unitaires + 22 d'intégration, CI verte.
- **Reste à faire par vous** (10 + 10 + 5 minutes, guidé dans chaque page) : créer l'app Meta, l'app TikTok (puis attendre sa validation, 1 à 2 semaines ; bac à sable en attendant) et l'app Telegram sur my.telegram.org. Voir `docs/A-FAIRE-HUMAIN.md`.
- Non testable sans ces apps : le vrai dialogue de connexion Meta / TikTok, les en-têtes de quota en production, la lecture réelle des vues ; tout est couvert par des réponses simulées et un bouton « Vérifier » signalera tout écart de la doc TikTok (portail non lisible par script).

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
