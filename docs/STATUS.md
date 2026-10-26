# État du projet : phase 30 (QA Global) terminée (26 octobre 2026)

Phases 0 à 30, 33, 34 et 35 en ligne. Phase 30 (`docs/prompts/32-phase-30-qa-global.md`) : un **dernier contrôle qualité**, sur le modèle d'IA le plus capable (Claude Fable 5.1), vérifie tout ce que les agents et l'IA produisent avant que ça sorte. Il passe après les contrôles de chaque équipe, voit tout, et peut tout bloquer. **Il ne modifie jamais rien : il accepte ou refuse avec ses raisons, et l'équipe corrige.**

## Fait
- **Ce qui est vérifié** : les posts des équipes (Rencontres, Casino, Paris), les shorts du Montage, les rapports et alertes des Analystes, les règles publicitaires à risque, les recommandations (Algorithme, Inspiration, Analystes, Pubs), les rapports rédigés par l'IA et les réponses de Kevin rédigées par l'IA.
- **Ce qu'il cherche** : règles du canal et mots interdits, règles publicitaires des Analystes, copie d'un autre canal (8 mots à la suite), données sensibles (clés, identifiants, données personnelles), inventions (chiffres, sources, fonctions), promesses de gain, avis juridique, contradictions entre équipes, fausses alertes. Une partie est bloquée directement par le code, même si l'IA dit oui.
- **Rien ne sort sans son accord**, pour le contenu exact : un post modifié après l'accord est revérifié avant l'envoi. S'il est indisponible (panne, délai, plafond), **tout est retenu, jamais accepté par défaut**, et Kevin vous le dit (« Le contrôle qualité est en pause, je reprends dès que possible »).
- **Refusé** : le contenu retourne à l'équipe avec les corrections demandées ; après 3 refus du même contenu, Kevin vous demande de trancher (« Publier quand même » / « Non »).
- **Ce qui n'est pas vérifié** (volontairement) : vos propres posts et textes, les messages fixes de Kevin (confirmations, boutons), les alertes techniques.
- **Kevin** : « comment va le contrôle qualité ? », « combien de refus cette semaine ? », « pourquoi le post 42 a été refusé ? ».
- **Site** : Agents → **Qualité** (taux d'acceptation, historique filtrable avec raisons et corrections, raisons les plus fréquentes).

## Test de 5 minutes
1. Écrivez à Kevin : « comment va le contrôle qualité ? ».
2. Ouvrez Agents → Qualité sur le site.
3. Écrivez : « montre-moi les refus de cette semaine ».

## Vérifications faites
- RESULTATS
- Test de bout en bout sur base réelle (faux modèle de contrôle, fausse IA des équipes, faux Telegram) : post accepté puis publié ; post avec mot interdit refusé, corrigé, accepté, publié ; post modifié après accord revérifié ; short avec sous-titre faux refusé, refait, accepté ; rapport avec chiffre inventé refusé, réécrit, accepté ; réponse de Kevin inventée refusée, réécrite, acceptée ; recommandation contraire à une règle publicitaire jamais montrée ; fausse alerte annulée ; 3 refus → vous tranchez ; contrôle en panne ou trop lent → rien ne sort ; vos posts et les messages fixes de Kevin jamais retenus.
- Relecture adverse : 5 défauts corrigés avec un test, dont : l'accord « Publier quand même » n'était pas réservé à l'administrateur ; un texte réécrit par l'IA après votre correction pouvait passer pour le vôtre ; des rapports rédigés par l'IA étaient archivés sans contrôle ; un très gros contenu lançait trop d'appels ; l'alerte « en pause » se répétait toutes les 5 minutes.
- DEPLOIEMENT

## Reste / limites
- Coût : environ 1 à 5 centimes par vérification ; plafond 150 € par mois (réglable) — plafond atteint = tout est retenu et Kevin prévient.
- Rien n'a encore été vérifié par le vrai modèle sur de vrais contenus : les premiers jours diront si le contrôle est trop sévère (vous verrez les raisons dans Agents → Qualité).
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
Aucune obligatoire.

---

# État du projet : phase 29 (équipe Analystes) terminée (26 octobre 2026)

Phases 0 à 29, 33, 34 et 35 en ligne. Phase 29 (`docs/prompts/31-phase-29-analystes-marche.md`) : une équipe d'analystes surveille le marché (casino, paris sportifs, rencontres) dans toute l'Europe, dans la langue de chaque pays, tient à jour les règles publicitaires de Meta et TikTok par pays, et vous conseille. **Tout est sourcé, rien n'est un avis juridique, et l'équipe ne touche à rien : elle recommande, vous décidez.**

## Fait
- **Veille** : forums (BlackHatWorld, AffLift, STM, GPWA), Reddit, canaux Telegram publics, X, sites d'actualité (iGaming Business, Casino.org, EGR, SBC News, GamblingCompliance…) : 39 sources de départ, lues chaque jour, lentement et poliment (règles des sites respectées, aucune connexion à un compte). Chaque trouvaille est classée, notée sur 10, résumée en français avec son lien et sa date ; le texte d'origine est effacé après 7 jours ; aucun profil de membre de forum n'est gardé.
- **Nouvelles sources** : chaque semaine, l'équipe cherche de nouveaux forums et sites ; Kevin vous les propose, rien n'est ajouté sans votre OUI.
- **Règles publicitaires** : par plateforme × pays × marché, avec le risque (faible, moyen, élevé, bannissement) et les preuves ; « vérifiée » quand deux sources différentes la confirment ; revérifiée tous les 30 jours ; alerte immédiate pour un risque élevé ou un bannissement.
- **Questions à Kevin** : « qu'est-ce qui marche en casino en France ? », « comment faire des ads dating sans se faire bannir sur TikTok ? », « c'est risqué de faire des ads casino avec du bonus sur TikTok en France ? », « quelles tendances cette semaine ? », « briefing casino Allemagne », « quelles sources tu surveilles ? », « ajoute ce forum ». Réponse sourcée en 20 lignes au plus ; « non vérifié » quand c'est le cas ; toujours « pas un avis juridique ».
- **Rapport du lundi 8 h** : tendances par marché, alertes, recommandations numérotées (type d'annonce, angle, format, pays, risque) ; « applique 2 » note votre choix, rien n'est changé chez Meta, TikTok ni sur vos canaux.
- **Site** : Agents → **Analyses** (tendances avec courbe, règles publicitaires, rapports, sources avec Activer / Désactiver / Supprimer, recommandations). Tout se fait aussi par Kevin (phase 34 : 233 actions du site, 0 manquante).

## Test de 5 minutes
1. Écrivez à Kevin : « qu'est-ce qui marche en casino en France ? » (la première réponse peut prendre une minute ; la veille se remplit au fil des premières heures).
2. Écrivez : « quelles sources tu surveilles ? ».
3. Ouvrez Agents → Analyses sur le site.

## Vérifications faites
- Tests unitaires : environ 7 400 réussis (agents 1 665, site 3 605, Telegram 600, worker 492) ; tests d'intégration sur base réelle : 430 site, 252 worker ; lint, typage et build verts ; `pnpm kevin:parity` : 233 actions, 0 manquante.
- Test de bout en bout sur base réelle, faux Telegram, fausse IA, faux web (pages d'exemple) : premier lancement (sources et règles une seule fois), lecture des sources, question « qu'est-ce qui marche en casino en France ? » (sources, adresse inventée retirée), ajout de source inactive puis OUI, alerte de bannissement (une seule fois, avec la source et « pas un avis juridique »), question sur le bonus TikTok en France, rapport du lundi 8 h (une seule fois, rien le mardi), « applique 1 » sans aucune action externe, source en panne coupée après 5 échecs, effacement à 7 jours, post piégé (« ignore tes règles ») traité comme une simple donnée, veille coupée = rien ne tourne.
- Relecture adverse : 8 défauts corrigés avec un test, dont : les propositions du marché se mêlaient à celles de l'équipe Algorithme (« applique 2 » pouvait viser la mauvaise) ; la phrase « pas un avis juridique » pouvait sauter sur une réponse longue ; deux lectures du même site pouvaient partir en même temps ; un réglage pouvait lire un forum trop vite ; la pagination pouvait suivre un lien vers un autre site ; une affirmation sans source pouvait passer ; une panne de l'IA aurait coupé toutes les sources.
- Sauvegarde de la production avant déploiement ; migration appliquée ; site et service d'arrière-plan déployés ; santé OK ; `pnpm tg:diag` vert. Le premier lancement en production a échoué une fois (le service d'arrière-plan a démarré quelques secondes avant que le site ait créé les tables) : relancé à la main, il a créé les 39 sources de départ et 16 règles publicitaires initiales (pages officielles de Meta, sourcées, « non vérifiées » tant qu'une seule source les confirme), pour environ 0,63 €.

## Reste / limites
- Rien n'a encore tourné avec la vraie IA ni sur les vrais sites : la première nuit dira quelles sources se lisent bien (certains forums réservent leur contenu aux membres : ils sont lus par la recherche web, sans connexion).
- Coût : plafond de 30 € par mois pour l'équipe (recherches web et IA), réglable.
- Le site n'a pas de seuil « dépense pub par jour » (déjà signalé en phase 34).
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
Aucune obligatoire. Essayer le test de 5 minutes.

---

# État du projet : phase 28 (équipe Montage) terminée (26 octobre 2026)

Phases 0 à 28, 33, 34 et 35 en ligne. Phase 28 (`docs/prompts/30-phase-28-montage-video.md`) : vous envoyez une vidéo longue à Kevin avec vos consignes en français courant ; l'équipe Montage propose un plan de coupe, fabrique les shorts (1080p, sous-titres vérifiés, caméra incrustée, texte), et chaque short vous est montré avant toute publication. **Rien ne part sans votre ✅.**

## Fait
- **Envoyer une vidéo** : en privé à Kevin, depuis votre compte Telegram (jusqu'à 2 Go, 3 heures), avec une phrase : « découpe ça en shorts de 15 secondes, cam en haut à droite, thème roulette », « fais des shorts pour TikTok avec sous-titres », « fais-moi 10 clips ». Kevin répond « J'ai reçu ta vidéo (47 min, 1080p) ». La vidéo n'entre jamais dans la base : elle reste dans votre conversation avec Kevin.
- **Plan de coupe** : l'IA regarde une image toutes les 5 secondes et propose les meilleurs moments (début, fin, ce qui se passe, note sur 10). Vous répondez « ok », « enlève le 3 », « le 2, commence 2 secondes plus tôt », « garde que les 5 meilleurs ».
- **Fabrication** : un seul passage par short, depuis la vidéo d'origine (qualité haute, 1080p, images par seconde gardées) : coupe, caméra en incrustation, format vertical / carré / horizontal, vitesse, sous-titres, texte. Un short de plus de 50 Mo est compressé une fois, et Kevin le dit.
- **Sous-titres sans erreur** : deux écoutes indépendantes, comparées mot à mot, puis relues par l'IA ; au moindre doute, Kevin vous demande (« "martingale" ou "martindale" ? ») avant de les incruster.
- **Contrôle qualité** : durée, taille d'image, image noire, son muet ou saturé, lisibilité des sous-titres.
- **Aperçus** : chaque short arrive chez vous avec ✅ Valider / ✏️ Modifier / ❌ Refuser ; « le 5, raccourcis de 2 secondes », « cam en bas à gauche », « ajoute le texte "Gros gain" » ; à la fin : « envoie les validés dans le canal Roulette » (OUI pour un vrai canal).
- **Reprise** : un montage interrompu (redémarrage, panne) reprend là où il en était ; un short déjà fait n'est pas refait. Fichiers temporaires effacés au fur et à mesure.
- **Site** : Agents → **Montage** (travaux, plan en frise, shorts avec lecture, Valider / Modifier / Refuser, Annuler ; médiathèque des shorts et vidéos longues). Tout se fait aussi par Kevin (phase 34 : 229 actions du site, 0 manquante).

## Test de 5 minutes
1. Envoyez à Kevin, en privé, une vidéo courte (1 à 2 minutes) avec la légende « découpe ça en shorts de 15 secondes avec sous-titres ».
2. Répondez « ok » au plan de coupe.
3. Validez ou refusez les aperçus qui arrivent. Tout est visible dans Agents → Montage.

## Vérifications faites
- Tests unitaires : environ 7 300 réussis (agents 1 561, site 3 558, Telegram 600, worker 489) ; tests d'intégration sur base réelle : 430 site, 250 worker (dont 13 avec le vrai ffmpeg par Docker) ; lint, typage et build verts ; `pnpm kevin:parity` : 229 actions, 0 manquante.
- Test de bout en bout sur base réelle, faux Telegram et fausse IA, avec le VRAI ffmpeg (image Docker identique au serveur) : vidéo + consignes → plan → « ok lance » → shorts fabriqués en un passage (1080x1920, H.264, AAC) → sous-titres (doute posé puis tranché) → contrôle → rangement → aperçu → ✅ ; modification, refus, annulation, reprise après plantage, aucun fichier temporaire restant, aucun octet de vidéo en base, seuls les shorts validés partent sur le canal Test.
- Relecture adverse : 9 défauts corrigés avec un test, dont : un short refait pendant son rendu pouvait recevoir l'ancienne version ; un passage sans parole faisait tourner la file en boucle ; un message privé partait sans son short non validé ; le compte connecté pouvait télécharger le fichier d'un autre message ; un bouton d'un ancien aperçu décidait pour la nouvelle version ; la deuxième écoute des sous-titres était identique à la première (elle ne prouvait rien).
- Sauvegarde de la production avant déploiement ; migration appliquée ; site puis service d'arrière-plan déployés ; santé OK ; `pnpm montage:diag` en production : tout est prêt (ffmpeg 8.1.3, codecs, filtres, 1 To libre) ; un vrai short rendu dans le serveur sur la vidéo d'essai : 1080x1920, H.264, AAC, 30 images/s, contrôle qualité passé.

## Reste / limites
- Rien n'a encore été essayé sur une vraie vidéo du client ni avec la vraie IA : le premier envoi dira si le plan de coupe choisit les bons moments.
- Le compte Telegram connecté n'est pas Premium : une vidéo envoyée fait au plus 2 Go (limite de Telegram).
- Coût de l'IA : environ 2 à 5 € par vidéo d'une heure (analyse des images et vérification des sous-titres) ; plafond mensuel de l'équipe 30 € (réglable).
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
Aucune obligatoire. Essayer le test de 5 minutes.

---

# État du projet : phase 34 (tout par Kevin) terminée (25 octobre 2026)

Phases 0 à 27, 33, 34 et 35 en ligne. Phase 34 (`docs/prompts/36-phase-34-tout-par-kevin.md`) : tout ce qui se règle ou se lance sur le site se fait aussi en parlant à Kevin sur Telegram, avec **les mêmes fonctions, les mêmes droits et le même journal** que le site. Le site reste là pour regarder en grand. Les équipes d'agents restent en simulation.

## Fait
- **225 actions du site** : 215 faisables par Kevin (219 opérations), 10 laissées au site avec un remplacement (Kevin envoie le lien direct, 15 minutes, une seule fois) : connexion, mot de passe, acceptation d'invitation, liaison du Telegram au compte, code de connexion d'un compte Telegram réel, visite guidée. Liste page par page : `docs/KEVIN-PARITE.md`.
- **Une seule fonction par action** : le bouton du site et Kevin appellent la même (mêmes vérifications, mêmes messages, même journal avec « via Telegram »). Kevin passe par une entrée interne signée du site ; le rôle est toujours relu en base.
- **Confirmations** : OUI pour un vrai canal, un passage en vrai, une dépense, une hausse de plafond ou de niveau ; le mot exact **SUPPRIMER** pour supprimer, effacer, anonymiser, purger, déconnecter ou révoquer (« oui » ne suffit pas) ; **l'aperçu exact** du message et le nombre de destinataires avant tout envoi à des membres.
- **Secrets** : clés, jetons, mots de passe et identifiants de bookmaker seulement en privé, effacés aussitôt, rangés chiffrés, jamais envoyés à l'IA ; dans le groupe, Kevin répond « envoie-le-moi en privé ». Une clé ou un lien montré une seule fois (clé d'affiliés, invitation) part à l'admin en privé, à part.
- **Entrées Telegram** : un message transféré devient le contenu d'un post ou d'un envoi (mise en forme et emojis animés gardés, photos et vidéos rangées dans la médiathèque) ; un fichier CSV s'importe avec le même aperçu que le site ; les choix se font par boutons ; Meta et TikTok se connectent par un lien d'autorisation, puis Kevin propose les comptes par boutons.
- **Aide** : « aide », « aide campagnes », « comment je fais pour … ? » donnent la phrase à dire.
- **Garde-fou permanent** : un test fait échouer la vérification si une nouvelle fonction du site n'est pas faisable par Kevin (règle ajoutée à `CLAUDE.md`).

## Test de 5 minutes
1. Écrivez à Kevin : « crée l'étiquette VIP en vert », puis « supprime l'étiquette VIP » : il demande SUPPRIMER ; répondez « oui » (refusé), puis « SUPPRIMER ».
2. Transférez-lui un message, puis : « programme ça sur le canal Test demain 20 h » : il montre l'aperçu, répondez OUI.
3. Écrivez « aide » pour voir tout ce qu'il sait faire.

## Vérifications faites
- Tests sur base réelle, faux Telegram et fausse IA : les 12 exemples du client de bout en bout, au moins 2 phrases par sujet (14 sujets), même état et même journal par le site et par Kevin sur 6 actions, un responsable du groupe refusé sur une action d'administrateur, « oui » refusé et SUPPRIMER accepté, secret dans le groupe refusé, requête interne trafiquée, rejouée ou trop vieille refusée.
- Relecture adverse (droits, signature, confirmations, secrets, injection, comportement du site inchangé, Link Affi en lecture seule) : défauts corrigés avec un test, dont : Kevin aurait pu répondre « oui » à la place de l'admin à une demande de passage en vrai ; une clé d'affiliés régénérée par Kevin aurait été perdue ; un vrai canal passé en « canal de test » sans OUI ; un essai à blanc qui écrivait ; une date avec fuseau lue comme heure de Paris ; les bots proposés pour un envoi incluaient Kevin.
- Tests unitaires : environ 6 800 réussis (site 3 499, agents 1 346, Telegram 588, worker 482) ; tests d'intégration sur base réelle : 654 réussis (430 site, 224 worker) ; `pnpm kevin:parity` : 225 actions, 0 manquante ; lint, typage et build verts.
- Sauvegarde de la production avant déploiement ; site puis service d'arrière-plan déployés ; santé OK ; `pnpm tg:diag` vert.

## Reste / limites
- Rien n'a encore été essayé avec la vraie IA : le premier vrai usage dira si Kevin choisit toujours la bonne opération (sinon il pose une question ; rien ne part sans les confirmations ci-dessus).
- « Préviens-moi si les dépenses pub dépassent 200 € par jour » : ce réglage n'existe pas sur le site ; Kevin le dit et note le besoin.
- Les fichiers envoyés dans le groupe ne sont pas lus (seulement en privé).
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
Aucune obligatoire. Essayer le test de 5 minutes.

---

# État du projet : phase 35 (suite) — lecture des « widgets » de paris (25 octobre 2026, soir)

Suite de la phase 35. En regardant les trois vrais sites depuis le navigateur du Mac, le constat était net : **aucun des trois n'est une page classique**, et l'ancien lecteur ne pouvait rien y lire même avec l'accès. Sportaza et Bet Portal affichent leurs matchs dans un « widget » fermé (sans aucun lien à suivre), Celsius met son site de paris dans un cadre d'un autre domaine, et les trois changent d'adresse en cours de route. Tout cela est maintenant lu. **Toujours aucune mise, aucun dépôt, aucun retrait, et aucun contournement de blocage par pays.**

## Fait
- **Les widgets se lisent** : le navigateur « aplatit » la page avant de la lire (contenu caché dans le widget, cadres, identifiant de chaque match), comme si c'était une page normale.
- **Changement d'adresse suivi** : `sportaza.com` → `sportaza-5178.com`, `celsius.games` → `celsiuscasino.com` sont reconnus comme la même marque ; tout autre domaine reste refusé, et les pages d'argent restent interdites, même sur la nouvelle adresse.
- **Navigation sans lien** : le lecteur sait aller au football, au programme du jour et de demain et à la fiche d'un match sur chaque moteur (adresses connues, puis clics sur « Football », « Par Heure », « À venir »…), chaque clic passant par la garde « jamais de mise » : un bouton qui affiche une cote n'est jamais cliqué.
- **Trois « fiches » prêtes, sans IA** : pour le moteur de Sportaza (Altenar), celui de Bet Portal (Betby) et le site de paris de Celsius, le système connaît déjà la façon de lire ; il la vérifie sur l'enregistrement puis en vrai, comme toute méthode apprise ; si ça ne passe pas, l'IA prend le relais comme avant.
- **Lectures plus riches** : flux de données de Bet Portal (par morceaux), matchs de Celsius par son API (cotes en millièmes), marchés en grille (« plus de 2.5 / moins de 2.5 »), dates « Après-demain », « 28 oct., 18:30 »…

## Test de 5 minutes
1. Sur le Mac, dans le Terminal, collez la commande donnée dans le message de Claude (mise à jour, puis déploiement du site et du service d'arrière-plan).
2. Écrivez à Kevin « teste les bookmakers » : il dit pour chaque site s'il s'ouvre et se lit (l'accès aux sites reste celui de votre Mac ou du serveur, voir « Reste »).
3. Puis « quels matchs sur Bet Portal ce soir ? ».

## Vérifications faites
- Trois faux sites reproduisant exactement ce qui a été vu sur les vrais (widget fermé avec routeur mémoire et données React ; widget fermé avec flux par manifeste et grille ; cadre vers un second serveur avec API en millièmes) : appris par leur fiche **sans aucun appel à l'IA**, 14 matchs d'aujourd'hui et de demain lus, cotes lues (résultat, buts avec la ligne, corners, cartons, double chance), aucune mise ni page d'argent demandée.
- Tous les tests des bookmakers repassent (environ 250, dont ceux avec un vrai navigateur : apprentissage des trois anciens faux sites, garde « jamais de mise », capture).
- Les structures réelles (noms des équipes dans les cartes de Bet Portal, adresse des fiches, flux de données, pages de Sportaza et de Celsius) ont été relevées à la main dans le navigateur du Mac le 25 octobre ; aucun test automatique ne touche un vrai site.

## Reste / limites
- **Accès aux sites** : rien ne change sur le blocage par pays. Le serveur en Europe est refusé par les trois sites ; le Mac lit avec sa propre connexion. Une méthode apprise sur un site est faite pour ce site : si un site change son widget, la fiche est revalidée et, au besoin, l'IA réapprend (une fois par jour au plus).
- Bet Portal : les cotes complètes d'une fiche viennent de la page (le flux public ne donne que les marchés principaux) ; la liste des matchs vient du flux.
- Le lecteur du Mac doit être autorisé par macOS (action humaine déjà notée) ; d'ici là, seul le serveur lit.
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
- Coller la commande de mise à jour et de déploiement (donnée par Claude), une seule fois.
- Supprimer le dossier `_to_delete/` à la racine du projet (restes d'un essai, sans valeur).
- Toujours valable : autoriser « node » pour le dossier Bureau sur le Mac (`docs/A-FAIRE-HUMAIN.md`, section 3 bis).

---

# État du projet : phase 35 (cotes lues chez nos bookmakers) terminée (25 octobre 2026)

Phases 0 à 27, 33 et 35 en ligne. Phase 35 (`docs/prompts/37-phase-35-cotes-bookmakers.md`) : le système lit lui-même les matchs et les cotes sur **Celsius**, **Sportaza** et **Bet Portal** avec votre compte. Il apprend chaque site une fois, lit par le chemin le plus stable, ne garde une cote que si elle a été lue **deux fois à l'identique**, se répare seul quand un site change, et Kevin gère tout. **Il ne mise jamais, ne dépose jamais, ne retire jamais d'argent.** Les équipes restent en simulation.

## Fait
- **Apprendre un site** : un parcours guidé du site (football, aujourd'hui, un match, quelques onglets de marchés) est enregistré, vos identifiants, cookies, solde et pseudo en sont retirés AVANT toute chose, puis l'IA (Opus) en déduit la façon de lire ce site. Le code revérifie tout et rejoue la méthode sur l'enregistrement : il faut retrouver au moins 95 % des matchs et 100 % des cotes, sinon deuxième essai, puis lecture de la page seule, sinon le site est marqué bloqué avec la raison. Un site qui utilise le même moteur de paris qu'un site déjà appris est appris sans IA.
- **Lire** : d'abord la lecture directe (ce que le site charge lui-même), sinon la page, et l'image seulement pour vérifier une cote précise. Matchs gardés 20 minutes, cotes 3 minutes. Rythme humain (2 à 5 secondes par page, 60 requêtes par minute au plus), un seul lecteur à la fois par site, rien la nuit (1 h - 7 h) sauf ordre.
- **Double lecture** : avant toute publication, la cote est relue par deux chemins différents à moins de 3 minutes ; identiques → le pari peut partir ; sinon le pari attend, Kevin vous prévient avec la capture et propose de relire ; après deux attentes le pari est abandonné. Une cote lue il y a plus de 5 minutes au moment de l'envoi annule le post.
- **Jamais de mise** : une seule garde, la même sur le serveur et sur le Mac, vérifie chaque page, redirection, clic et appel AVANT qu'il parte : aucune page de dépôt, retrait, caisse, coupon ou profil ; aucun clic sur une cote ; aucun envoi qui ressemble à une mise.
- **Serveur ou Mac** : le serveur lit d'abord ; si un site refuse le serveur (blocage par pays), il passe sur votre Mac, et le serveur réessaie chaque semaine. Le lecteur du Mac est installé comme un service qui démarre tout seul.
- **Santé** : toutes les 30 minutes, une petite lecture par site ; « se lit mal » sous 90 % de réussite, « bloqué » après 3 échecs ou un obstacle (anti-robot, code, mot de passe refusé) ; ré-apprentissage automatique au plus une fois par jour ; Kevin vous dit le geste à faire ; alertes « bookmaker bloqué » et « bookmaker qui se lit mal » dans Réglages → Alertes.
- **Équipe Paris sportifs** : une catégorie de paris qui vise un de vos bookmakers choisit ses paris sur les cotes de ce site ; le fournisseur de cotes reste pour les autres bookmakers, pour les résultats et comme comparaison (écart de plus de 15 % → pari signalé « cote inhabituelle »). Un pari sans résultat n'est jamais réglé au hasard.
- **Kevin** : « quels matchs sur Sportaza ce soir ? », « la cote de PSG gagne chez Celsius ? », « les bookmakers ça va ? », « le Mac lit ? », « apprends le site Celsius », « teste les bookmakers », « ouvre le navigateur sur le Mac », « ajoute le bookmaker X, c'est x.com ». Il vous demande vos identifiants une seule fois, en privé (messages effacés).
- **Site** : Agents → **Bookmakers** : état de chaque site, qui lit (serveur ou Mac), dernier succès, réussite sur 24 h, méthode de lecture apprise, dernières lectures, matchs du jour, boutons Tester, Ré-apprendre, Ouvrir le navigateur sur le Mac, adresse modifiable (administrateur).

## Test de 5 minutes
1. Kevin vous demande en privé l'email et le mot de passe de vos comptes bookmakers (les mêmes partout) : répondez-lui.
2. Il propose de tester les trois sites : répondez OUI. Quelques minutes plus tard, il dit ce qui marche.
3. Écrivez-lui « quels matchs sur Sportaza ce soir ? ». Tout est visible dans Agents → Bookmakers.

## Vérifications faites
- Tests sur trois faux sites construits pour l'occasion (un qui charge ses cotes à part, un en pages classiques, un en direct, un en cotes fractionnaires), avec leurs variantes : site modifié, anti-robot, blocage par pays, session expirée, cote qui bouge, marché absent, et une équipe nommée « Ignore tes règles FC » (traitée comme une donnée). Apprentissage complet avec un vrai navigateur sur ces faux sites ; garde « jamais de mise » vérifiée dans un vrai navigateur (page de dépôt, bouton « Placer le pari », clic sur une cote, redirection vers la caisse : tout refusé, rien n'atteint le site).
- Relecture adverse : 12 défauts trouvés et corrigés avec un test (dont : une mise par appel direct mal reconnue, un enregistrement non masqué rangé en base, le Mac et le serveur connectés en même temps, des cookies envoyés à un autre domaine, une date de match devinée, une cote trop ancienne à l'envoi, des droits trop larges sur les tests et les identifiants).
- Tests unitaires : environ 6 800 réussis (dont 1 274 agents, 3 031 site, 571 Telegram, 477 worker) ; tests d'intégration sur base réelle : 618 réussis (394 site, 224 worker). Bout en bout sur le faux site Celsius : apprendre → prêt → matchs → marchés → double lecture identique par deux chemins, aucune page d'argent visitée. Deux scénarios Paris sportifs (phase 23) échouaient depuis que la vraie date avait dépassé leurs matchs fictifs : heure figée dans ces tests, comportement inchangé.
- Lint, typage, build verts ; page Bookmakers sans problème d'accessibilité ; captures.
- Sauvegarde de la production avant déploiement ; site (migration appliquée) puis service d'arrière-plan ; santé OK ; `pnpm tg:diag` vert ; Kevin a posé en privé la demande des identifiants communs. Lecteur du Mac installé comme service (démarre seul) : macOS le bloque tant que « node » n'a pas l'accès au dossier Bureau (action humaine ci-dessous) ; lancé à la main, il se signale bien au site.

## Essai réel du matin (25 octobre, 9 h 50)
Le client a écrit à Kevin « Salut boss ça va », puis a voulu lui donner les identifiants de Sportaza. Trois défauts, corrigés et testés en rejouant l'échange : la politesse avec « boss » tombait dans « pas encore possible » ; « Je peux te donner les identifiants du bookmaker sportaza » et « Bookmaker » n'étaient pas compris (la demande privée part maintenant tout de suite, sans IA) ; le texte affiché après un mot de passe retiré contenait des repères entre chevrons effacés par Telegram (« écris « clé   » »), réécrit. Les identifiants propres à Sportaza donnés le 24 octobre sont bien rangés (chiffrés) et restent prioritaires sur les identifiants communs.

## Premier essai sur les vrais sites (25 octobre, 14 h 04)
Le client a donné ses identifiants communs à Kevin (rangés chiffrés) puis a lancé le test des trois sites. Aucun ne s'ouvre depuis la France ni depuis notre serveur en Europe :
- **Celsius** : `celsius.games` renvoie vers `celsiuscasino.com`, qui affiche « Celsius is not available in your jurisdiction » ;
- **Bet Portal** : page vide refusée (403), y compris depuis le Mac ;
- **Sportaza** : refuse le serveur (le Mac, bloqué par macOS, n'a pas pu prendre le relais).
Corrigé : une page coupée par notre garde dit maintenant pourquoi (redirection vers un autre domaine → Kevin demande la bonne adresse) au lieu d'un « injoignable » muet. **Aucun contournement de blocage par pays** (règle de la phase) : Kevin demande au client comment il ouvre ces sites. En attendant, l'équipe Paris garde les cotes du fournisseur habituel (comportement de la phase 23).

## Reste / limites
- Les trois sites refusent la France et notre serveur ; le client y accède par un VPN en Norvège. La plateforme ne contourne pas un blocage par pays : lecture directe en pause, paris sur le fournisseur habituel, jusqu’à une décision écrite du client (Kevin le lui a dit).
- Un match que le système n'a pas pu rattacher au fournisseur de résultats avant le coup d'envoi n'est plus rattaché ensuite : le pari est remboursé au bout de 3 jours, jamais réglé au hasard.
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
Voir `docs/A-FAIRE-HUMAIN.md`, section « Bookmakers » : sur le Mac, autoriser « node » pour le dossier Bureau (Réglages Système → Confidentialité et sécurité → Fichiers et dossiers) ; donner à Kevin, en privé, l'email et le mot de passe de vos comptes bookmakers (un compte dédié est conseillé) ; la lecture automatique avec votre compte est sous votre responsabilité (conditions d'utilisation de chaque site) ; garder le Mac allumé avec votre session ouverte pour que son lecteur tourne.

---

# État du projet : phase 33 (Kevin donne des ordres aux équipes) terminée (25 octobre 2026)

Phases 0 à 27 et 33 en ligne (la phase 33 passe avant les phases 28 à 32, qui s'y brancheront). Phase 33 (`docs/prompts/35-phase-33-kevin-ordres-equipes.md`) : toute demande libre faite à Kevin devient un **ordre** donné à une équipe ; Kevin le récapitule, demande OUI quand il le faut, le transmet au Grand Chef, qui le fait exécuter par l'équipe, puis Kevin rend compte chaque jour et à la fin. Plus de « je ne sais pas encore faire ça » quand une équipe sait le faire. **Les équipes restent en simulation.**

## Fait
- **Ce que chaque équipe sait faire** (registre des capacités, 32 au total) : Paris sportifs (programmer des paris sur N jours par thème, pari unique, catégories, bilan, questions), Rencontres et Casino (programmer des posts, post unique, réglages du canal, questions ; Casino seulement avec vos médias), Algorithme, Ads, Inspiration, et « faire comme si » (le canal Test traité comme un canal d'une autre équipe). Thèmes de paris (corners, cartons, hors-jeux, buteurs…) reliés aux marchés du fournisseur de cotes.
- **Kevin comprend l'ordre** : il le planifie (IA Opus), le code revérifie tout (bornes : quotas, fenêtres, mélange, 30 jours au plus), il le récapitule en 3 lignes. Il lance tout de suite sur le canal Test pour de faux ; il demande OUI pour un vrai canal, un passage en vrai, une dépense ou plus de 7 jours. « annule » dans la minute arrête un ordre lancé.
- **Jamais un refus sec** : ce qui bloque est dit précisément (« le fournisseur n'a pas de marché hors-jeux »), avec des solutions de repli par numéros ; ce qui n'existe pas encore (« programme des shorts ») est noté pour plus tard.
- **Exécution** : le Grand Chef pose un **réglage temporaire** sur le canal (le plan habituel du canal ne bouge jamais et reprend à la fin), crée les productions chaque jour, l'équipe les fait passer par ses agents ; reprise sans doublon après un redémarrage.
- **Suivi** : « mes ordres », « où en est l'ordre sur Test ? », « passe à 3 par jour », « prolonge de 2 jours », « arrête », « demande à l'équipe Paris pourquoi il n'y a pas eu de pari hier » ; un message par jour et par ordre, bilan à la fin, bilan des demandes impossibles le lundi.
- **Voir et parler aux agents** : « qu'est-ce que l'agent des paris va poster aujourd'hui sur … ? », « montre-moi les matchs qu'il regarde » (sans rien publier), « quels matchs sont sur … ce soir ? », « pourquoi rien n'est sorti ce matin ? », « qu'est-ce qui attend ma validation ? », « dis à l'agent Rédaction d'écrire plus court sur Roulette ».
- **La voix de Kevin** : il parle comme un collègue (tutoiement, phrases courtes, pas de jargon, plusieurs façons de dire la même chose) ; près de 300 textes réécrits ; contrôle automatique de chaque texte (`docs/KEVIN-VOIX.md`) ; il répond franchement s'il est un bot.
- **Site** : Agents → **Ordres** (liste, fiche d'un ordre, Arrêter, Prolonger), encart « Réglage temporaire » sur la fiche d'un canal, page Kevin « Pas encore possible ».

## Test de 5 minutes
1. Écrivez à Kevin : « Sur le canal de test faisons comme si c'était un canal Paris sportifs, programme les paris pour 3 jours, avec comme thème les hors-jeux. »
2. Il récapitule et lance (canal Test, pour de faux). Écrivez « mes ordres », puis « passe à 3 par jour ».
3. Écrivez « arrête » quand vous voulez. Tout est visible dans Agents → Ordres.

## Vérifications faites
- Tests unitaires : environ 6 500 réussis (dont 1 025 agents, 571 Telegram, 469 worker, 3 017 site) ; tests d'intégration sur base réelle : 618 réussis (394 site, 224 worker), dont le scénario des ordres en 16 étapes avec le vrai registre : la phrase du client telle quelle → récapitulatif → lancement immédiat → 3 jours simulés, 2 paris hors-jeux par jour sur le canal Test → messages quotidiens → bilan → réglage temporaire éteint, plan du canal intact ; variante sans marché hors-jeux → replis → corners ; « passe à 3 par jour », « arrête », chevauchement, Casino sur un vrai canal (OUI, stock insuffisant → repli), persona Léa, question à l'équipe, « programme des shorts » noté, plan de l'agent des paris, consigne à l'agent Rédaction, texte transféré ignoré, aucune production créée par Kevin directement, réglage sans canal précisé → OUI, « pour de faux » jamais publié en vrai.
- Lint, typage, build verts ; contrôle d'accessibilité des pages Ordres, Kevin et Agents sans violation ; captures.
- Sauvegarde de la production avant déploiement ; site (migration appliquée) puis service d'arrière-plan ; santé OK ; `pnpm tg:diag` vert sur Kevin.

## Premier essai réel (nuit du 24 au 25 octobre)
Le client a demandé à Kevin de s'inspirer d'un canal privé (lien d'invitation) pour 🚩𝑪𝑶𝑹𝑵𝑬𝑹 puis pour le canal Test : six messages sans résultat. Corrigé et testé en rejouant cette conversation : une réponse « 3 » ou « Test » à une liste de Kevin est comprise (par numéro ou par nom, 30 minutes) ; les noms de canaux en lettres stylisées sont reconnus ; le canal Test prend l'univers de la demande (« tir cadré » → paris) ou Kevin le demande une fois ; sans compte réel libre, Kevin explique pourquoi (le seul compte relié est celui de Léa, qui discute avec des membres : jamais utilisé pour lire un canal) et propose les deux solutions ; un lien sans canal cible reçoit directement la liste des canaux.

## Relecture adverse (compte-rendu)
Deux relecteurs (bornes, confirmations, « comme si », catégories ; injection, secrets, coût, reprise, non-régression) : une trentaine de défauts confirmés, tous corrigés avec un test. Les plus importants touchaient tous la même chose : un OUI (ou son absence) qui ne correspondait pas à ce qui serait exécuté — un réglage de vrai canal parti sans OUI quand l'IA oubliait la portée, un « pour de faux » annoncé alors qu'une équipe passée en vrai aurait publié, un OUI qui confirmait une ancienne question, une durée de 30 jours contournable en modifiant l'ordre, des paris d'ordre ajoutés au quota d'un canal, un membre qui pouvait faire tourner l'IA coûteuse sans limite, des erreurs techniques brutes envoyées à l'admin.

## Reste / limites
- Rien n'a été essayé avec la vraie IA ni le vrai fournisseur de cotes (fausse IA et faux fournisseur en test) : le premier vrai ordre dira si le planificateur comprend bien.
- Quelques marchés (les deux équipes marquent, score exact, double chance, cartons jaunes / rouges) restent à confirmer chez le fournisseur réel ; s'ils manquent, Kevin le dit précisément.
- Matchs d'un bookmaker non couvert par le fournisseur (Sportaza, Celsius) : pas encore lus sur leur site (phase 35).
- Pas de liste de mots interdits par canal : un mot interdit vaut pour toute l'équipe du canal (Kevin le dit).
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
Aucune obligatoire. Essayer la phrase du test de 5 minutes.

---

# État du projet : phase 27 (canal d'inspiration) terminée (25 octobre 2026)

Phases 0 à 27 en ligne. Phase 27 (`docs/prompts/29-phase-27-canal-inspiration.md`) : vous donnez à Kevin un canal Telegram qui marche ; il le lit, mesure sa méthode, vous la résume, répond à vos questions et propose des réglages numérotés. Vous dites oui : il applique dans les bornes de l'équipe Algorithme, avec annulation, et mesure l'effet. **Il s'inspire de la méthode, il ne copie jamais le contenu.** Les équipes restent en simulation.

## Fait
- **Trois façons de donner un canal** : un lien public (`t.me/…`, lecture de l'aperçu public, lente : 1 requête toutes les 3 secondes, 200 posts au plus) ; un canal privé lu par un de vos comptes réels **déjà membre** et sans persona (lecture faite par le service des comptes réels, une seule connexion, lentement ; entrée par un lien d'invitation seulement si vous confirmez) ; ou 20 à 30 posts transférés à Kevin.
- **Mesures par le code** : rythme (posts par jour, heures de pointe, jours), forme (longueur, emojis, mélange photo / vidéo / texte, liens, boutons), fond (appels au VIP, cotes, séries pari → résultat, bonus, promesses de gain signalées), résultats (vues, meilleurs posts, liens heure / longueur / média ↔ vues, toujours avec le nombre de posts derrière). Au moins 20 posts.
- **Profil de style** écrit par l'IA à partir des chiffres et vérifié (aucun chiffre inventé, aucune copie, règles du client), lu par la Rédaction ; exemples écrits à neuf.
- **Jamais de copie** : un post ne peut pas reprendre 8 mots à la suite d'un post de référence (contrôle qui résiste à la mise en forme, aux lettres stylisées et aux caractères invisibles) ; aucune image ni vidéo reprise ; liens jamais suivis ; citations de 10 mots au plus.
- **Vie privée** : aucun membre du canal lu ; texte des posts effacé après 30 jours ; texte des messages transférés retiré du journal.
- **Kevin** : « inspire-toi de t.me/xxx pour Roulette », « c'est quoi leurs heures ? », « montre-moi un exemple », « applique 1 et 3 », « annule ». Résumé en 6 lignes, propositions numérotées (fenêtre horaire, posts par jour, mélange au plus 20 points par semaine, longueur, appels à l'offre, profil de style), application seulement avec votre accord, test de 14 jours, bilan « je garde ? ».
- **Site** : Agents → **Inspiration** (références, profil de style, eux / nous, propositions avec Annuler, historique, Retirer) ; encart « Inspiré de @… » sur la fiche d'un canal.

## Test de 5 minutes
1. Écrivez à Kevin : « inspire-toi de t.me/<un canal public casino> pour <votre canal casino> ».
2. Quelques minutes plus tard, il vous envoie le résumé : répondez « tes propositions ».
3. Répondez par exemple « 1 », puis « annule » pour revenir en arrière. Tout est visible dans Agents → Inspiration.

## Vérifications faites
- Tests unitaires : 6 135 réussis (dont 831 agents, 549 Telegram, 469 worker, 24 comptes réels, 2 976 site) ; tests d'intégration sur base réelle : 602 réussis (378 site, 224 worker), dont le scénario complet : lien public → lecture sur page enregistrée → résumé → « c'est quoi leurs heures ? » → réponse chiffrée → propositions → « applique 1 et 2 » → réglages dans les bornes et test créé → la Rédaction reçoit le profil → un post qui copie 8 mots est refusé → « annule » → réglages d'origine ; canal privé sans compte → demande de transfert → 25 posts transférés → même chaîne ; relecture hebdomadaire sans changement → silence.
- Lint, typage, build verts ; contrôle d'accessibilité de la nouvelle page sans violation ; capture de référence.
- Sauvegarde de la production avant déploiement ; site (migration appliquée), service d'arrière-plan, puis service des comptes réels (redémarré avec son compte connecté, boîte aux lettres de lecture active) ; santé OK ; `pnpm tg:diag` vert sur Kevin.

## Relecture adverse (compte-rendu)
Deux relecteurs (copie, vie privée, injection et débit ; bornes, droits, règles du client et non-régression) : environ 25 défauts confirmés, corrigés avec un test. Principaux : l'équipe Algorithme aurait pu appliquer seule des propositions d'inspiration ; un membre aurait pu faire entrer un compte réel dans un canal privé sans votre confirmation ; « 1, 3 » répondu à une autre question aurait appliqué des propositions ; un responsable aurait pu appliquer ou annuler à votre place ; le contrôle de copie se contournait avec du gras ou des lettres stylisées ; le texte des messages transférés restait dans le journal ; deux lectures pouvaient se chevaucher.

## Reste / limites
- Rien n'a été essayé sur un vrai canal ni avec la vraie IA (pages enregistrées et fausse IA en test). La lecture par compte réel demande un compte connecté, sans persona, déjà membre du canal privé.
- Série « pari → résultat » : pas proposée (l'équipe Paris sportifs ne publie pas encore de post de résultat) ; Kevin le note comme besoin.
- Le journal propre à l'inspiration n'indique pas quel membre a agi (le journal de Kevin, lui, le note).
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour toujours à faire.

## Actions humaines
`docs/A-FAIRE-HUMAIN.md`, section 7 (canal d'inspiration privé : ajouter un compte réel, ou transférer 20 à 30 posts).

---

# État du projet : phase 26 (Kevin, le Boss) terminée (24 octobre 2026)

Phases 0 à 26 en ligne. Phase 26 (`docs/prompts/28-phase-26-boss-telegram.md`) : un seul bot, **Kevin**, à qui l'on parle en français ordinaire (texte ou vocal). Il répond toujours, donne les vrais chiffres, exécute les ordres en demandant confirmation quand il faut, guide le démarrage, et travaille dans le groupe Telegram de l'équipe. Il ne fait rien de nouveau par lui-même : il pilote ce qui existe (phases 19 à 25). **Les équipes restent en simulation.**

## La panne du dialogue (cause et réparation)
- Depuis le 21 octobre, Telegram recevait « 403 » de notre site pour @casinogamblingoobot : le secret d'accès posé chez Telegram ne correspondait plus à celui de la base (cause la plus probable : un script local relancé contre la production). Les messages de l'admin n'arrivaient plus (« Oui », « Comment ça ? Ça marche pas ? »).
- Réparé le 24 octobre ; le script dangereux est supprimé ; la pose d'un webhook depuis une base locale vers la production est refusée ; le worker contrôle les webhooks toutes les 10 minutes et les répare seul (alerte si cela se répète).
- Second défaut corrigé : un message que le bot ne comprenait pas ne recevait aucune réponse. Désormais, chaque message de l'admin reçoit une réponse.
- `pnpm tg:diag` (local, et `railway ssh --service web -- pnpm tg:diag`) affiche tout le circuit ligne par ligne.

## Fait
- **Kevin** (`Bot.role = ADMIN`) : créé en envoyant son jeton au bot actuel (`jeton boss …`) ou dans Réglages → Bots (rôle « Boss »). Tant qu'il n'existe pas, le bot casino fait office de Kevin. Une fois créé, les bots de canal renvoient l'admin vers lui une seule fois et n'obéissent plus.
- **Comprendre et agir** : catalogue fermé de 51 actions (état, rapport, dépenses et projection, résultats, demandes, validations, pause, niveau, simulation / vrai, plafonds, quotas, plan des canaux, personas, stocks, thèmes, catégories de paris, bookmaker, réglages de l'Algorithme, recommandations Ads, posts et paris de test, équipe…). L'IA ne fait que choisir une action ; le code vérifie et exécute par les fonctions existantes ; tout est journalisé.
- **Confirmations** : ce qui publie, dépense, passe en vrai ou monte un plafond / niveau / quota → résumé en 2 lignes + OUI / NON (10 minutes, une seule à la fois). Les commandes d'avant (`agents`, `pause casino`, `ok 12`, `clé fal …`, `demandes`, `rapport`…) marchent toujours, sans IA.
- **Chiffres vrais** : tirés des fonctions existantes ; un chiffre absent des données est refusé (le code envoie alors les chiffres lui-même).
- **Secrets** : une clé, un jeton ou un mot de passe n'atteint jamais l'IA ni les journaux ; il est enregistré chiffré puis effacé de la conversation ; jamais demandé dans le groupe.
- **Guide** : `commencer` (état, avancement « 3/14 », une question à la fois), `aide`, besoins non couverts notés (`pnpm boss:unmet`), une relance par jour au plus quand quelque chose bloque.
- **Groupe de l'équipe** : Kevin ajouté par l'admin enregistre le groupe ; on lui présente chacun (« Kevin, voici @lea, vidéos casino ») ; il pose les questions à la bonne personne avec @ ; droits admin / responsable / membre ; un inconnu n'obtient rien ; rapport du matin résumé dans le groupe.
- **Site** : Agents → **Kevin** (bot, prénom, dépense IA et plafond, équipe, besoins non couverts, derniers échanges) ; Réglages → Bots (rôle) ; État du système (Kevin qui ne répond plus, contrôle des webhooks).

## Test de 5 minutes
1. Dans @BotFather : `/newbot` → nom « Kevin » → identifiant finissant par « bot » → copiez le jeton.
2. Écrivez au bot actuel (@casinogamblingoobot) : `jeton boss ` suivi du jeton. Il répond « Envoie /start à @… ».
3. Envoyez `/start` à Kevin, puis `commencer`. Essayez « combien j'ai dépensé ce mois ? » et « mets le casino en pause » puis « reprends le casino ».

## Vérifications faites
- Tests unitaires : 6 014 réussis (dont 666 agents, 545 Telegram, 463 worker, 2 933 site) ; tests d'intégration sur base réelle : 592 réussis (368 site, 224 worker), dont le scénario privé de Kevin (enregistrement par jeton → `/start` → `commencer` → réponse sans « Répondre » → pause → passage en vrai confirmé puis retour → dépenses égales à la vue d'ensemble → message transféré piégé ignoré → inconnu ignoré → renvoi de l'ancien bot → vocal → tâche rejouée sans double exécution → service d'arrière-plan arrêté) et le scénario du groupe (ajout par l'admin, présentation confirmée, demande à Léa par @, vidéo rangée, absence, clé jamais dans le groupe, Léa ne peut pas confirmer, inconnus ignorés, rapport du matin, mode confidentialité dans les deux sens).
- Lint, typage, build verts (le build du site demande plus de mémoire : réglé dans l'image Railway).
- Sauvegarde de la production avant déploiement ; site (2 migrations appliquées) puis service d'arrière-plan ; santé OK (base 17 ms, worker à l'heure) ; webhooks reposés ; `pnpm tg:diag` en production : identifiant admin, dialogue branché, connexion Telegram correcte pour tous les bots (0 message en attente), files et service d'arrière-plan en vie. Captures de la page Kevin et de Réglages → Bots ; contrôle d'accessibilité sans violation (base de démonstration locale).
- Next.js signale toujours une faille de sécurité connue dans la version 16.4.0 : la mise à jour reste à faire (pas lancée sans votre accord).

## Premier essai réel (24 octobre, 19 h)
Le client a créé Kevin (@kevcanauxbot) en envoyant `jeton boss …` : jeton effacé et masqué dans le journal, Kevin enregistré, `pnpm tg:diag` vert sur Kevin. À « ca va », Kevin a donné l'état des agents ; à « ça va », il a répondu « Je ne sais pas encore faire ça » : les phrases de politesse (« salut », « ça va », « merci ») ont maintenant une réponse simple, fixe et gratuite (redéployé à 19 h 17).

## Relecture adverse (compte-rendu)
Trois relecteurs indépendants (autorisation ; secrets, injection et coût ; non-régression des phases 0 à 25) : une trentaine de défauts confirmés, tous corrigés avec un test. Les plus importants : un mot de passe court pouvait partir à l'IA ; la demande d'un membre pouvait remplacer la confirmation de l'admin ; un membre pouvait, dans un cas précis, agir avec les droits de l'admin ; un responsable pouvait répondre aux questions réservées à l'admin ; Kevin aurait déclenché une fausse alerte « bot silencieux » ; les emojis animés de l'admin n'étaient plus rangés ; le build du worker était cassé. Détail dans `docs/DECISIONS-TECH.md` (« Phase 26 — relecture adverse »).

## Reste / limites
- Rien n'a été essayé avec un vrai Telegram ni la vraie IA (faux Telegram et fausse IA en test) : il faut créer Kevin. Sans clé IA (Réglages → IA), Kevin ne comprend que les commandes simples et le dit.
- Vocaux dans le groupe : Kevin demande d'écrire (il n'écoute les vocaux qu'en privé).
- La file du service d'arrière-plan traite une tâche à la fois : une réponse de Kevin peut attendre quelques secondes derrière un passage du Grand Chef (durée d'attente journalisée).
- Avertissement de sécurité de Next.js 16.4.0 : toujours à traiter.

## Actions humaines
Section 0 de `docs/A-FAIRE-HUMAIN.md` (« Créer Kevin ») : 5 clics, puis l'ajouter au groupe de l'équipe et présenter chacun en une phrase.

---

> **Note du 24/10 à 13 h 50 (phase 26)** : docs/prompts/28-phase-26-boss-telegram.md a été complété après ton départ (Kevin en groupe Telegram : section 4, règles 1, 4, 7 et 8). Relis ce fichier en entier avant de continuer, puis retire cette note.

# État du projet : phases 19 à 25 (agents IA) terminées (24 octobre 2026)

Phases 0 à 25 en ligne. La phase 25 clôt la chaîne des agents IA (`docs/prompts/27-phase-25-agents-supervision.md`) : supervision en un écran, conversation Casino et Paris sportifs, scénario complet sur 3 jours simulés, relecture adverse de tout ce qui a été construit depuis la phase 19, documentation et bilan. **Toutes les équipes restent en simulation** (tout part sur le canal Test) tant que vous ne les passez pas « en vrai ».

## Ce qui existe maintenant (phases 19 à 25)
- **Grand Chef et Chefs** (phase 19) : plan du jour, missions reprenables, budgets mensuels, niveaux d'autonomie 0 / 1 / 2, pause par équipe et pause générale, validation et questions par le bot (une question à la fois), simulation par défaut.
- **Rencontres** (phase 20) : vidéos et photos fabriquées pour chaque persona (fal.ai, Magic Hour en secours), médiathèque, contrôle des images, premières productions toujours soumises à vous.
- **Algorithme** (phase 21) : lit les résultats, propose ou applique des réglages (horaires, mélange, relances), tests A/B, rapports ; ne publie rien.
- **Casino** (phase 22) : publie seulement vos médias, classés par thème, rotation sur 30 jours, demande groupée quand le stock baisse.
- **Paris sportifs** (phase 23) : choisit les paris par une méthode chiffrée, capture la cote chez le bookmaker (jamais de mise), publie, note les résultats et tient le bilan.
- **Agent Ads** (phase 24) : conseille (Arrêter, Augmenter, Tester, Surveiller) avec preuves ; n'agit jamais chez Meta ou TikTok.
- **Supervision** (phase 25) : page Agents (état de chaque équipe, missions du jour, dépense et projection de fin de mois, résultats des posts sur 7 et 28 jours, réglages de la semaine avec Annuler, tests A/B, alertes, rapports, Pause générale) ; carte Agents dans l'État du système (files, Grand Chef, missions bloquées à relancer, fournisseurs) ; commandes du bot `agents`, `rapport`, `demandes`, `vrai <équipe>` et `niveau <équipe> <n>` (résumé puis OUI) ; `pnpm agents:status`.
- **Conversation Casino / Paris** (phase 25) : même assistante que Rencontres, univers par persona, identité « assistante » imposée (jamais « fille » ni illusion), fiche d'informations (40 questions au plus, import CSV) seule source des chiffres, lien VIP jamais au premier message, passage à l'équipe (question hors fiche, réclamation, argent, mineur, insulte) avec « À traiter » dans la boîte de réception et alerte groupée. Désactivée par défaut ; il faut un bot dédié par univers.

## Test de 5 minutes
1. Site → **Agents** : les 4 équipes et l'Agent Ads apparaissent, « simulation » partout.
2. Sur Telegram, écrivez **agents** au bot : le même résumé arrive en quelques lignes.
3. Agents → Rencontres (ou Casino) → « Produire un post de test » → validez par ✅ : le post arrive sur le canal **Test** avec « [SIMULATION …] » en tête.

## Vérifications faites
- 5 807 tests unitaires et 570 tests d'intégration (base réelle) réussis. Scénario complet sur 3 jours simulés (Rencontres, Casino, Paris, Algorithme avec réglage appliqué puis annulé, Ads, validations par Telegram et par le site, pause en cours de mission, redémarrage au milieu d'une chaîne sans double publication, plafond atteint, rapports) : aucun post hors canal Test en simulation (vérifié sur tous les posts créés).
- Lint, typage, build verts ; contrôle d'accessibilité de toutes les pages : aucune violation ; captures de référence refaites.
- Sauvegarde de la production avant déploiement ; site (3 migrations appliquées) puis service d'arrière-plan ; santé OK (base 18 ms, worker à l'heure) ; `pnpm agents:status` en production : 4 équipes actives en simulation, aucune mission bloquée, aucune erreur fournisseur.

## Relecture adverse (compte-rendu)
Six dimensions relues (règles du client, robustesse, données personnelles, chiffres, interface, non-régression des phases 0 à 18). Environ 45 défauts confirmés, tous corrigés avec un test. Principaux :
- **Dialogue admin** : actions sensibles (clés, passage en vrai, niveau 2, plafonds, seuils) réservées aux ADMIN ; une réponse à un autre message ne touche plus la question en cours ; seul un « oui » exact confirme ; une clé n'est prise qu'en réponse ou si elle ressemble à une clé, message supprimé seulement une fois enregistrée ; jamais deux exécutions d'une même réponse ; une seule question en cours garantie par la base.
- **Coûts des médias** : une vidéo n'est jamais payée deux fois (reprise après plantage, dépassement de délai, annulation chez le fournisseur) ; coût d'une photo compté une seule fois.
- **Paris sportifs** : cote du texte = cote réellement lue ; un pari trop proche du coup d'envoi est annulé à l'envoi ; garde « jamais de mise » renforcée ; clé absente ou plafond atteint = pari écarté sans mettre l'équipe en pause.
- **Pause** : un post d'agent déjà programmé est retenu tant que l'équipe est en pause, et annulé s'il visait un vrai canal alors que l'équipe est en simulation.
- **Chiffres et rapports** : contrôle « aucun chiffre inventé » durci ; libellés de l'Agent Ads alignés sur Statistiques seulement quand la valeur est la même.
- **Données personnelles** : anonymisation renforcée des extraits relus par l'IA ; suppression d'un membre et purge nocturne effacent aussi les messages des comptes réels.
- **Interface** : libellés « À traiter », « Rencontres » partout, accessibilité (lien souligné, cases nommées, zones de texte lisibles au clavier).

## Reste / limites connues
- Rien n'a été essayé avec les vraies clés (fal.ai, Magic Hour, cotes, Anthropic des agents) ni le vrai site Sportaza : il faut vos clés et votre compte. Les identifiants des marchés de football et les repères du site Sportaza seront à confirmer au premier essai (réglables sans redéploiement).
- Mémoire du navigateur de captures en production à surveiller (sinon : service séparé).
- L'index « une seule question en cours » est posé par une migration écrite à la main (hors schéma Prisma) : à garder si une future migration le propose à la suppression.
- Avertissement de sécurité de Next.js 16.4.0 : mise à jour à faire dans une phase de solidité.
- 14 demandes du bot attendent vos réponses (questions de mise en route des équipes).

## Suites possibles (non lancées, à décider par vous)
- Passer une première équipe en vrai (Casino est la plus simple : vos médias suffisent).
- Phase de solidité : mise à jour de Next.js, service séparé pour les captures.
- Brancher Meta / TikTok pour que l'Agent Ads ait des dépenses à analyser.

## Actions humaines
Liste complète et ordonnée en tête de `docs/A-FAIRE-HUMAIN.md` (« Mettre les agents en route »). Les 3 premières : (1) répondre aux questions du bot sur Telegram (`demandes`) ; (2) envoyer au bot la clé fal.ai pour Rencontres et quelques médias #casino ; (3) quand une équipe vous plaît en simulation, écrire `vrai <équipe>` puis OUI.

---

# État du projet : phase 24 (agents IA : Agent Ads) terminée (24 octobre 2026)

Phases 0 à 23 en ligne. Phase 24 = un agent rattaché au Grand Chef qui lit chaque jour ce que coûtent les pubs (Meta, TikTok, coûts importés ou saisis) et ce qu'elles rapportent vraiment dans la plateforme (membres, inscriptions, dépôts, commissions), puis conseille quoi faire, chiffres à l'appui (`docs/prompts/26-phase-24-agents-ads.md`). **Il recommande, il n'agit jamais** chez Meta ou TikTok.

## Fait
- **Analyse** par campagne, groupe de pubs et pub, sur hier, 7 jours et 28 jours, comparée à la période d'avant : dépense, clics, visites, entrées Telegram, membres, clics sur l'offre, inscriptions, premiers dépôts, commissions, gains, retour sur dépense, coûts par membre / inscription / premier dépôt (toujours avec les règles existantes : gains = commissions − dépense) ; parcours de la pub jusqu'au dépôt et étape la plus faible ; ce que rapportent les membres de chaque pub après 7, 14 et 30 jours.
- **Conseils** : Arrêter, Augmenter, Tester, Surveiller, chacun avec ses preuves et le seuil visible ; jamais de conseil sous 3 jours et 20 € de dépense ; seuils par univers réglables (automatiques au départ). Vous marquez « Fait » ou « Refuser » ; rien n'est appliqué par le code (vérifié par un test : aucune fonction d'écriture vers Meta / TikTok).
- **Rapports** : chaque matin (5 lignes) et chaque lundi (par univers), texte écrit par l'IA à partir des chiffres et refusé s'il contient un chiffre absent des données (remplacé par le texte du code) ; archivés dans la page.
- **Alertes** (interrupteurs dans Réglages → Alertes) : dépense anormale, chute des inscriptions d'une pub, pub trop chère par inscription, budget du jour d'une campagne atteint.
- **Site** : Agents → **Agent Ads** (résumé d'hier, conseils, parcours, pubs en détail, seuils, rapports, exports) et carte sur le tableau de bord des agents.
- **Correctif** : les 4 nouvelles alertes manquaient sur la page Réglages → Alertes (un enregistrement les aurait coupées) ; ajoutées.

## Premier rapport (vraies données, 24 octobre)
Envoyé sur Telegram : aucune dépense pub enregistrée (aucun compte Meta ou TikTok branché, aucun coût importé), donc aucune recommandation pour l'instant. L'agent conseillera dès que des dépenses existeront.

## Test de 5 minutes
1. Site → Agents → **Agent Ads** : lisez le résumé et les seuils.
2. Importez un fichier de coûts (Campagnes → la campagne → Pubs → importer) ou branchez Meta / TikTok : le lendemain, les chiffres et les premiers conseils apparaissent.

## Vérifications faites
- 5 530 tests unitaires et 560 tests d'intégration (base réelle) réussis, dont une campagne de test avec ses pubs et leurs chiffres → conseils attendus → rapport du jour envoyé → un conseil marqué « Fait ». Lint, typage, build verts.
- Sauvegarde avant déploiement ; site (migration appliquée) puis service d'arrière-plan ; santé OK ; premier rapport réel envoyé ; capture de la page et contrôle d'accessibilité sans violation (base de démonstration locale).

## Reste / limites
- Sans dépense pub enregistrée, l'agent n'a rien à conseiller : il faut brancher Meta / TikTok ou importer les coûts.
- Pas de commande Telegram « pause ads » (l'Agent Ads n'est pas une équipe de production) : la pause se fait sur le site.
- Avertissement de sécurité de Next.js 16.4.0 en développement : à traiter dans une phase de solidité.

## Actions humaines
Rien d'obligatoire. Répondre aux deux questions du bot sur les seuils ; brancher Meta / TikTok quand vous voulez (`docs/A-FAIRE-HUMAIN.md`).

---

# État du projet : phase 23 (agents IA : équipe Paris sportifs) terminée (24 octobre 2026)

Phases 0 à 22 en ligne. Phase 23 = troisième équipe de production : chaque jour, elle cherche chez les bookmakers les paris des catégories demandées (« tirs cadrés »…), retient les plus intéressants selon une méthode chiffrée et réglable, retrouve le pari sur le site du bookmaker, vérifie la cote, fait la capture d'écran et publie tout de suite un post court ; après le match, elle note le résultat et tient le bilan (`docs/prompts/25-phase-23-agents-paris.md`). **Tout reste en simulation** sur le canal Test.

## Fait
- **Cotes** : SportsGameOdds (documentation officielle relue), cache, comptage des appels et plafond mensuel (2 000 par défaut, alerte à 80 % et 100 %) ; faux fournisseur pour les essais.
- **Sélection** : comparaison de la cote du bookmaker à celle des autres (écart de valeur), fourchette de cote par catégorie, un pari par match, pas deux fois le même pari en 48 h, jamais à moins de 30 min du coup d'envoi ; le raisonnement chiffré est gardé et affiché.
- **Capture d'écran** : navigateur dans le serveur, connexion à votre compte, recherche du match, lecture de la cote, cadre de couleur, capture ; **jamais de mise, de dépôt ni de changement de compte** (règle codée, testée) ; session chiffrée. Si le site bloque : adresse internet de secours, ou capture depuis votre Mac, ou en dernier recours une image fabriquée, toujours soumise à vous.
- **Publication** : texte écrit par le code (match, marché, cote, 1-2 phrases chiffrées, ligne de prudence ; « sûr », « garanti », « 100 % » interdits), cote re-vérifiée juste avant l'envoi (écartée si elle a bougé de plus de 5 %), publication immédiate avec le bouton Offre.
- **Toujours soumis à vous** : nouvelle ligue, nouveau marché, cote hors fourchette, image de repli.
- **Résultats** : réglés toutes les 2 h (gagné, perdu, annulé) ; bilan par catégorie, ligue, bookmaker et semaine (taux de réussite, cote moyenne, rendement).
- **Site** : Agents → Paris sportifs (paris du jour avec capture et raisonnement, catégories, bilan, bookmakers avec « Tester la connexion », réglages, « Produire un pari de test »).
- **Correctif** : une question du bot en attente faisait répondre « Réponds oui ou non » à des messages qui n'y répondaient pas (« fait », des emojis animés à ranger) ; corrigé.

## Test de 5 minutes
1. Site → Agents → **Paris sportifs** → « Produire un pari de test » → valider (✅ sur Telegram si demandé).
2. Le pari arrive sur le canal **Test** avec sa capture (page d'essai) et « [SIMULATION …] » en tête.

## Vérifications faites
- 5 460 tests unitaires et 555 tests d'intégration (base réelle) réussis, dont la chaîne complète : 4 paris retenus, 2 publiés sur le canal Test avec capture, 1 écarté car la cote avait bougé, 1 image de repli envoyée en validation (et la question « adresse de secours ou Mac » posée), puis résultats réglés et bilan calculé. Tests du navigateur sur une page qui imite un bookmaker (connexion, recherche, cote, capture, bouton « Parier » refusé). Lint, typage, build verts.
- Image du serveur construite en local : Chromium démarre et fait une capture.
- Sauvegarde avant déploiement ; site puis service d'arrière-plan ; santé vérifiée ; capture de la fiche et contrôle d'accessibilité sans violation (base de démonstration locale).

## Reste / limites
- Rien n'a été essayé avec la vraie clé de cotes ni le vrai site Sportaza : il faut votre clé et votre compte. Les identifiants exacts des marchés de football (tirs cadrés, corners, cartons) et les repères du site Sportaza seront à confirmer au premier essai réel (réglables sans redéploiement).
- Mémoire prise par le navigateur en production à surveiller ; si elle sature, il faudra un service séparé pour les captures.
- Avertissement de sécurité de Next.js 16.4.0 en développement : à traiter dans une phase de solidité.

## Actions humaines
Répondre aux questions du bot (clé de cotes, identifiant et mot de passe du bookmaker, catégories), puis `vrai paris` + `OUI` quand ça plaît (`docs/A-FAIRE-HUMAIN.md`).

---

# État du projet : phase 22 (agents IA : équipe Casino) terminée (23 octobre 2026)

Phases 0 à 21 en ligne. Phase 22 = deuxième équipe de production : les canaux casino publient chaque jour des vidéos **fournies par vous**, des images et des textes, selon le thème de chaque canal et l'offre du moment, aux bons créneaux (`docs/prompts/24-phase-22-agents-casino.md`). **Tout reste en simulation** sur le canal Test.

## Fait
- **Médiathèque Casino** : thèmes (machines à sous, roulette, blackjack, bonus, jackpot, live, tournoi, cashback, ambiance, modifiables) ; stock par canal et par thème ; une vidéo ne revient pas sur le même canal avant 30 jours, ni le même jour sur deux canaux casino.
- **Dépôt par le bot** : `#casino #roulette` (plusieurs thèmes, variantes comme « slots » acceptées), doublons fusionnés, réponse en une ligne avec le stock ; thème inconnu → bouton « Créer le thème » ; sans thème → « à classer » sur le site.
- **Demandes de vidéos** : sous 3 vidéos non utilisées pour un thème, un seul message groupé par jour au plus, jamais de relance du même thème avant 3 jours ; alerte « Médiathèque Casino » avec interrupteur.
- **Chaîne** : Médiathèque → Rédaction (ton du canal, offre de la campagne, aucun chiffre que la fiche de l'offre ne donne) → Planification (créneaux de l'équipe Algorithme, jamais deux vidéos à moins de 4 h) → Contrôle (refuse tout média fabriqué par l'IA) → Publication avec le bouton Offre. Replis : autre thème → image → texte, comptés dans le rapport du matin.
- **Toujours soumis à vous** : nouveau canal, nouveau thème, offre jamais utilisée.
- **Site** : Agents → Casino (stock en vert / orange / rouge, médias à classer, demandes, dépôt, « Produire un post de test », thèmes, plan par canal) ; encart « Équipe Casino » sur la fiche des canaux casino ; guide à jour.

## Test de 5 minutes
1. Envoyez au bot une vidéo avec la légende `#casino #roulette` : il répond « rangée : roulette, … ».
2. Site → Agents → **Casino** → « Produire un post de test » (Vidéo) → ✅ sur Telegram.
3. Le post arrive sur le canal **Test** avec « [SIMULATION …] » en tête.

## Vérifications faites
- 5 366 tests unitaires et 552 tests d'intégration (base réelle) réussis, dont **une semaine simulée** jour par jour sur le canal Test : 4 vidéos déposées sur deux thèmes, mélange et rotation respectés, replis quand le stock s'épuise, demande groupée envoyée une seule fois, posts programmés puis envoyés, rapport du matin. Lint, typage, build verts.
- Sauvegarde avant déploiement ; site (un premier envoi resté bloqué chez Railway, relancé avec succès) puis service d'arrière-plan ; santé vérifiée ; capture de la fiche Casino et contrôle d'accessibilité sans violation (base de démonstration locale).

## Reste / limites
- La « fiche de l'offre » d'une campagne est celle de la persona qui y est rattachée (les campagnes n'ont pas de fiche à elles) : sans fiche, les textes ne citent que le nom de l'offre, jamais un montant.
- Le premier média d'un album envoyé sans légende n'est pas rangé (comme avant).
- Avertissement de sécurité de Next.js 16.4.0 en développement : à traiter dans une phase de solidité.

## Actions humaines
Répondre aux questions du bot (offre de chaque canal casino, vidéos par thème), puis `vrai casino` + `OUI` quand ça plaît (`docs/A-FAIRE-HUMAIN.md`).

---

# État du projet : phase 21 (agents IA : équipe Algorithme) terminée (23 octobre 2026)

Phases 0 à 20 en ligne. Phase 21 = une équipe qui **ne publie rien** : elle mesure ce qui marche (types de posts, horaires, conversations de chaque profil), monte des tests de deux versions, et en tire des réglages concrets pour les équipes Rencontres, Casino et Paris sportifs, appliqués dans des bornes et annulables en un clic (`docs/prompts/23-phase-21-agents-algorithme.md`).

## Fait
- **Fiches de résultats des posts** (chaque nuit) : vues à 1 h, 2 h et 24 h, clics sur l'offre, inscriptions, dépôts, et les caractéristiques de chaque post (vidéo / photo / texte, thème, persona, heure, longueur, emojis…) ; classements de ce qui marche et de ce qui ne marche pas, jamais de conclusion sous 20 posts ou 1 000 vues par cas.
- **Horaires** : fenêtres par canal, jour et heure ; c'est désormais la seule source des meilleurs horaires (le calendrier des Messages affiche « calculés par l'équipe Algorithme »).
- **Conversations** : chiffres par profil (bot ou compte réel, persona, source) ; relecture chaque semaine par l'IA d'un échantillon anonymisé (sans mineurs ni personnes qui ont demandé l'arrêt) ; propositions de réglages de persona (exemples de style, échanges avant le lien, relances) ; heures de relance conseillées.
- **Tests de deux versions** (légende, horaire, mélange) : un seul à la fois par canal et par type, clôture au seuil de 5 %, le gagnant devient une proposition.
- **Réglages** : mélange (au plus 20 points par semaine), fenêtres (dans les heures autorisées), consignes de style ; identité des personas, règles « adultes », /stop, règles de contenu et de rythme jamais touchées ; chaque réglage journalisé et annulable. Niveau 0 par défaut : tout est proposé, rien n'est appliqué sans vous.
- **Rapport « Ce qui marche »** chaque lundi par Telegram (5 lignes par équipe), écrit par l'IA à partir des chiffres calculés (refusé et remplacé par le texte du code s'il invente un chiffre) ; alertes « canal en baisse » et « profil de conversation en baisse » (−30 % sur 7 jours), avec interrupteur.
- **Site** : Agents → « Ce qui marche » (classements, graphiques par heure et par jour, tests, propositions avec Appliquer / Annuler / Refuser, conversations par profil, rapports archivés, réglages de l'équipe) ; propositions dans la fiche persona.

## Premier rapport (vraies données, 23 octobre)
Envoyé sur Telegram et rangé dans la page, calculé sur 40 posts : côté Rencontres, la photo est le type le plus fort mais avec 0 % de clic sur l'offre (encore très peu de données), meilleure fenêtre le mercredi 22 h-23 h ; Casino et Paris sportifs n'ont rien publié cette semaine ; 1 réglage proposé (consignes de style de l'équipe Rencontres), rien d'appliqué.

## Test de 5 minutes
1. Site → **Agents** → **Ce qui marche** : lisez le rapport de la semaine et les classements.
2. Section « Propositions de réglages » : ouvrez la proposition, lisez ses preuves, puis **Appliquer**… puis **Annuler** : la valeur d'avant revient.
3. Répondez aux deux questions du bot (niveau, quota maximum) quand elles arrivent.

## Vérifications faites
- 5 305 tests unitaires et 545 tests d'intégration (base réelle) réussis, dont la chaîne complète : 48 posts de test → fiches → fenêtres écrites → test de deux versions clos « A gagne » → réglage appliqué puis annulé (valeurs vérifiées) → rapport envoyé. Lint, typage, build verts.
- Sauvegarde avant déploiement ; site d'abord (migration appliquée), puis service d'arrière-plan ; santé OK ; premier rapport réel produit et envoyé ; capture de « Ce qui marche » et contrôle d'accessibilité sans violation (base de démonstration locale).

## Reste / limites
- Très peu de données pour l'instant (40 posts, aucun clic sur l'offre) : les conclusions viendront avec les publications des équipes.
- Les questions du bot partent une à la fois : d'abord le rapport du matin (toujours sans réponse), puis la mise en route de Rencontres, puis les deux questions de l'équipe Algorithme.
- Avertissement de sécurité de Next.js 16.4.0 en développement : à traiter dans une phase de solidité.

## Actions humaines
Rien à fournir. Lire le rapport et répondre aux questions du bot (`docs/A-FAIRE-HUMAIN.md`).

---

# État du projet : phase 20 (agents IA : équipe Rencontres) terminée (23 octobre 2026)

Phases 0 à 19 en ligne. Phase 20 = la première équipe de production complète (`docs/prompts/22-phase-20-agents-dating.md`) : pour chaque persona, des posts **vidéo** (la personne d'une vidéo source remplacée par le personnage), **photo** (photos neuves du personnage) et **texte**, aux bons créneaux, avec contrôle qualité, validation et budget plafonné. **Tout reste en simulation** sur le canal Test, et tant qu'aucune clé fal.ai n'est donnée, les vidéos et photos sont simulées (la vidéo source revient telle quelle, la photo est celle de la persona).

## Fait
- **Fournisseurs** : fal.ai (remplacement de la personne entière, 480p / 580p / 720p, 580p par défaut ; photos avec le fichier du personnage) et Magic Hour en secours (visage seulement), d'après leur documentation officielle relue le 23 octobre ; coût estimé avant chaque appel ; clés chiffrées, vérifiées gratuitement, jamais réaffichées.
- **Agent Média IA** : vidéo en arrière-plan (suivi toutes les 30 à 60 s, 15 min au plus), photo, médias rangés dans la médiathèque avec la persona et la source ; secours automatiques : fal deux fois en échec → Magic Hour si sa clé existe → post photo → post texte, pour tenir le quota sans dépasser les plafonds (100 € vidéo, 15 € photo par mois par défaut).
- **Chaîne Rencontres** : Médiathèque → Média IA → Rédaction (légende très courte dans le style de la persona) → Planification (jamais deux vidéos à moins de 6 h) → Contrôle qualité (3 images de la vidéo regardées par l'IA ; défaut ou doute → vous validez ; vidéo illisible → jamais publiée) → Publication.
- **Toujours soumis à vous**, quel que soit le niveau : les 3 premières vidéos et les 3 premières photos d'une persona, un nouveau canal, tout doute du contrôle.
- **Médiathèque par persona** : une vidéo source ne repasse pas sur le même canal avant 30 jours ; sous 3 vidéos sources non utilisées, le bot vous en demande (une fois par jour au plus).
- **Site** : fiche persona → « Médias du personnage » (1 à 3 images de référence, fichier du personnage, mot déclencheur, tenue et ambiance) ; Agents → Rencontres : stock, productions du mois avec aperçu, dépenses, « Produire un post de test », « Banc d'essai », dépôt de vidéos sources, fournisseur et résolution.
- **Messages vocaux** : vous pouvez parler au bot ; il répète ce qu'il a compris, puis agit comme pour un message écrit (une clé doit toujours être écrite).
- **Questions de mise en route** posées par le bot, une à la fois : clé fal.ai, fichier du personnage et mot déclencheur, photos de référence, vidéos sources, plafond vidéo, puis le banc d'essai (3 vidéos comparées, vous choisissez la meilleure).

## Test de 5 minutes
1. Site → **Agents** → **Équipe Rencontres** → « Produire un post de test » → type **Texte** (ou Photo) → valider.
2. L'aperçu arrive sur Telegram : appuyez sur ✅.
3. Le post arrive sur le canal **Test** avec « [SIMULATION …] » en tête.
4. Envoyez au bot un vocal « agents » : il répond « J'ai compris : "agents". » puis l'état des équipes.

## Vérifications faites
- 5 196 tests unitaires et 540 tests d'intégration (base réelle) réussis, dont trois missions Rencontres (vidéo, photo, texte) en simulation avec le faux fournisseur : médias rangés, posts programmés puis envoyés, coûts à 0, validation des premières vidéos demandée puis acceptée. Clients fal et Magic Hour testés sur des réponses enregistrées (aucun appel réel). Lint, typage, build verts.
- Sauvegarde avant déploiement ; site d'abord (migration appliquée), puis service d'arrière-plan (ffmpeg présent) ; santé OK. Captures de la fiche Rencontres, d'une fiche persona et des réglages (`docs/captures`), accessibilité sans violation (base de démonstration locale).

## Reste / limites
- Rien n'a été essayé avec les vrais fal.ai et Magic Hour : il faut votre clé. Le banc d'essai le fera (environ 4 € pour 3 vidéos en 580p et 720p).
- Les vidéos en cours de fabrication ne sont pas réservées sur le budget : deux vidéos lancées au même moment peuvent dépasser très légèrement le plafond.
- Avertissement de sécurité de Next.js 16.4.0 toujours affiché en développement : à traiter dans une phase de solidité.

## Actions humaines
Répondre aux questions du bot une par une (`docs/A-FAIRE-HUMAIN.md`), puis, quand les essais plaisent, `vrai dating` + `OUI`.

---

# État du projet : phase 19 (agents IA : fondations) terminée (23 octobre 2026)

Phases 0 à 18 en ligne. Phase 19 = le squelette complet de l'équipe d'agents IA du plan validé le 23 octobre (`docs/AGENTS-ARCHITECTURE.md`, consignes `docs/prompts/21-phase-19-agents-fondations.md`) : un Grand Chef, quatre Chefs d'équipe (Rencontres, Casino, Paris sportifs, Algorithme), les agents communs (Médiathèque, Rédaction, Planification, Contrôle qualité, Publication), la rubrique « Agents », la validation et les demandes par Telegram. **Tout est en simulation** : rien ne part ailleurs que sur le canal Test.

## Fait
- **Grand Chef** (logique programmée, sans IA ; toutes les 30 minutes) : plan du jour par canal, plafonds mensuels (mission refusée proprement au-delà, alerte à 80 % et 100 %), collisions, niveaux d'autonomie, reprise des missions arrêtées, rapport du matin à 9 h, validations sans réponse (rappel à 24 h, annulation à 72 h), pause automatique d'une équipe après 3 échecs de suite avec alerte.
- **Chefs d'équipe** : chaîne d'étapes par équipe ; missions reprenables (un redémarrage reprend à l'étape suivante, jamais deux publications) ; Rencontres et Casino actifs, Paris sportifs et Algorithme déclarés pour les phases 21 à 23.
- **Agents** : Médiathèque (choix du prochain média jamais réutilisé en 30 jours sur un canal ; dépôt en envoyant une photo ou une vidéo au bot avec des mots-clés comme « #casino #roulette »), Rédaction (Claude, légende très courte, sans répéter les 30 derniers posts du canal, jamais de mention d'IA), Planification (quota, fenêtre, espacement de 90 min, heures calmes, meilleurs horaires), Contrôle qualité (règles du code : mention d'IA en 6 langues, liens, longueur 900, mots interdits, mise en forme ; doublons ; avis de l'IA qui ne peut jamais forcer une publication refusée ; « refaire » une fois, sinon validation), Publication (message programmé, envoyé par le système existant).
- **Validation par Telegram** : aperçu avec ✅ Publier / ✏️ Corriger / ❌ Refuser, numéro court (`ok 2`, `non 2`), seulement depuis votre compte ; aussi depuis le site.
- **Demandes au client par Telegram** (votre demande du 23 octobre) : une question à la fois, réponse au message, rappel à 24 h, expiration à 7 jours ; clés rangées chiffrées, message supprimé aussitôt, confirmation avec les 4 derniers caractères, jamais dans le journal. Commandes : `agents`, `pause <équipe>`, `reprends <équipe>`, `pause tout`, `demandes`, `plus tard`, `niveau <équipe> <0|1|2>`, `vrai <équipe>` + `OUI`, `clé fal …`, `clé cotes …`, `budget vidéo …`.
- **Rubrique Agents** : tableau de bord, fiche par équipe (réglages, plan par canal, agents, missions étape par étape), Validations (posts et demandes), Journal (export), Réglages (administrateurs : clés, modèles d'IA, canal Médiathèque, plafonds, pause générale). Carte « Agents » dans État du système, famille « Agents » du Journal, aide et guide à jour.
- **Correctif trouvé au déploiement** : depuis la phase 18, les « bots fantômes » des comptes réels pouvaient être choisis pour vous écrire (Telegram répondait « introuvable ») : alertes et messages admin pouvaient se perdre. Corrigé.

## Test de 5 minutes
1. Ouvrez **Agents** → carte « Équipe Rencontres » → **Créer une mission de test**.
2. Une à deux minutes plus tard, l'aperçu arrive sur Telegram (« À valider n° … »).
3. Appuyez sur **✅ Publier**.
4. Le post arrive sur votre canal **Test** dans la minute, avec « [SIMULATION équipe Dating → Test] » en tête.
5. Agents → Validations : la décision est listée ; Agents → Journal : la mission est « terminée ».

## Vérifications faites
- 5 150 tests unitaires et 537 tests d'intégration (base réelle) réussis, dont la mission « post texte » de bout en bout : Grand Chef → Chef Rencontres → Rédaction → Planification → Contrôle → validation → Publication → message programmé → envoi par le système existant (bot de test) → mission terminée, journal et rapport du matin. Lint, typage et build verts.
- Sauvegarde de la base avant déploiement ; site d'abord (migration appliquée), puis service d'arrière-plan ; santé OK, 6 nouvelles files démarrées ; 4 équipes en simulation au niveau 0, aucune mission ni aucun plan en production ; la question « rapport du matin » est partie sur Telegram.
- Pages Agents : captures (`docs/captures/agents-*.webp`) et contrôle d'accessibilité sans aucune violation, sur la base de démonstration locale avec une vraie mission passée de bout en bout. En production, les 5 adresses répondent (connexion demandée) ; elles n'ont pas été ouvertes connecté (mot de passe du compte de vérification non disponible sur le Mac).

## Reste / limites
- La mission de test n'a pas été lancée en production (elle vous enverrait un aperçu) : c'est votre test de 5 minutes.
- Aucun canal n'a de plan : les équipes ne produisent rien seules tant qu'un canal n'est pas activé (fiche d'équipe → Plan par canal).
- Vidéos et photos IA (phase 20), équipe Algorithme (21), Casino (22), Paris sportifs (23), Ads (24), supervision (25) : lancées par la file d'attente.
- Next.js a affiché, sur le serveur de développement, un avertissement de faille de sécurité connue dans la version 16.4.0 utilisée : à traiter dans une phase de solidité (mise à jour de Next.js), rien n'a été changé.

## Actions humaines
Rien d'obligatoire (`docs/A-FAIRE-HUMAIN.md`) : répondre `oui` ou `non` à la question du rapport du matin, et faire le test de 5 minutes.

---

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
