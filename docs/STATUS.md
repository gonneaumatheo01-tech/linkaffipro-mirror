# Statut — 29 octobre 2026 : Kevin répond comme Claude

## Fait
- ✅ Kevin répond maintenant à tout, comme Claude : questions générales, conseils (pubs, TikTok, canaux), idées, « écris-moi un post », traductions, explications, calculs. Il ne dit plus « je ne sais pas encore faire » à une simple question.
- ✅ Réponses longues et mises en forme quand il faut (listes, gras), et il suit mieux la conversation (20 derniers échanges).
- ✅ Garde-fous inchangés pour les actions : il n'agit que par ses commandes habituelles, avec OUI quand il faut ; il n'invente jamais nos chiffres (membres, dépôts, gains…) et le contrôle qualité vérifie chaque réponse.
- ✅ Tests du paquet agents : 2 256 verts.

## Test de 5 minutes
1. Écrire à Kevin : « c'est quoi un bon taux de clic sur une pub TikTok ? »
2. Puis : « écris-moi un post pour annoncer un bonus casino ce soir ».
3. Puis : « fais-le plus court » (il doit reprendre le post d'avant).

## Problèmes et actions humaines
- Aucun. Une réponse longue coûte un peu plus d'IA, toujours dans le plafond mensuel de Kevin.

---

# Statut — 29 octobre 2026 : retrait du Montage et des vidéos IA

## Fait
- ✅ Agents → **Montage** retiré : plus de découpe de vidéos longues en shorts, de commandes de Kevin, de file `agents-montage` ni de verrou QA des shorts. Les 4 montages et le short déjà en base dorment ; un ancien short est refusé s'il est choisi pour un message (jamais envoyé vide).
- ✅ **Vidéos IA** retirées (« swap IA ») : Kevin ne remplace plus la personne d'une vidéo, l'équipe Rencontres ne fabrique plus de vidéos (plus de fal.ai Wan Animate, de Magic Hour, de banc d'essai, de demandes de vidéos sources). Elle garde les photos IA et les textes ; mélange par défaut 3 photos / 1 texte, repli photo → texte.
- ✅ Données gardées en base (aucune migration) ; `/agents/montage` → `/agents` ; au démarrage, le worker efface les planifications du montage, vide sa file et clôt les questions au client devenues sans objet.
- ✅ Image du worker allégée (polices des sous-titres retirées ; ffmpeg gardé pour les vocaux).
- ✅ Vérifié en local : typage et lint verts partout ; tests unitaires verts (agents 1 547, site 3 537, Telegram 592, worker 494, cœur 420, chat 595, files 42, userbot 27) ; parité de Kevin : 237 actions, 0 manquante.

- ✅ En ligne le 29 octobre vers 9 h 35 (site puis worker, version `main` avec le bot VIP paris déjà en ligne) : santé OK, `/agents/montage` → `/agents` (308), au démarrage le worker a effacé 2 planifications du montage et vidé 2 files retirées.

## Reste
- Rien.

## Test de 5 minutes (après la mise en ligne)
1. Ouvrir Agents : l'onglet « Montage » a disparu.
2. Ouvrir Agents → Rencontres → « Produire un post de test » : seuls « photo » et « texte » sont proposés ; le post arrive sur le canal Test après validation.
3. Écrire à Kevin « aide » : plus aucune commande de montage ni de remplacement de personne.

## Problèmes et actions humaines
- Aucune. La clé Magic Hour reste chiffrée en base, sans usage (effaçable sur demande).
- Mise en ligne : depuis un dossier de travail séparé, `railway up` envoyait le dossier principal (travail en cours d'une autre session) : il faut `railway up "$PWD" --path-as-root --service …`. Le build du site demande maintenant 6 Go de mémoire (`apps/web/Dockerfile`).

---

# Statut — 28 octobre 2026 (nuit) : retrait des parties « Bookmakers » et « Inspiration » des agents

## Fait
- ✅ Agents → **Bookmakers** retiré : plus aucune lecture des sites (Celsius, Sportaza, Bet Portal), plus de captures automatiques, de navigateur, de proxy, d'identifiants bookmaker ni de programme du Mac. Les paris passent par « capture et cote envoyées par l'équipe » (ou cotes SportsGameOdds + image de repli validée).
- ✅ Agents → **Inspiration** retiré : plus de lecture de canaux exemples, de profils de style ni de commandes de Kevin. Le lecteur des canaux publics reste pour la Prospection et les Analystes.
- ✅ Données gardées en base (rien n'est effacé) ; anciennes adresses redirigées ; le worker efface au démarrage les tâches planifiées retirées et clôt les alertes bookmakers ouvertes.
- ✅ Corrigé au passage : la recherche de prospects par compte réel n'utilise plus un compte avec persona ; le contrôle de code `aggregate-players.test.ts` passe.
- ✅ Vérifié : typage et lint verts partout ; tests unitaires verts (agents 1 792, site 3 602, Telegram 605, worker 503, cœur 420, files 42, userbot 27) ; parité de Kevin : 0 manquante.

- ✅ En ligne le 28 octobre vers 20 h 40 : site, worker, userbot (santé vérifiée). Au démarrage, le worker a effacé 3 planifications retirées, vidé la file `agents-bookmakers` et clos 3 alertes bookmakers ouvertes. Service du Mac `com.linkaffipro.bookmaker-runner` retiré.
- ✅ CI de la demande de fusion verte (tests d'intégration compris) ; build du site en CI avec plus de mémoire.

## Reste
- Rien pour ce retrait.

## Test de 5 minutes (après la mise en ligne)
1. Ouvrir Agents : les onglets « Inspiration » et « Bookmakers » ont disparu.
2. Ouvrir Agents → Paris sportifs → « Produire un pari de test » : le pari apparaît dans « Paris du jour » puis sur le canal Test.
3. Écrire à Kevin « aide » : plus aucune commande de bookmaker ni d'inspiration.

## Problèmes et actions humaines
- Aucune.

---

# Statut — 28 octobre 2026 (soir) : Kevin met une persona à la place de la personne d'une vidéo

## Fait
- ✅ Kevin sait maintenant faire « mets Léa à la place de la personne dans cette vidéo » (phrase sous la vidéo ou juste après). Il vérifie tout avant de demander OUI : vidéo de 15 s au plus, photo de référence de la persona, clé du service de vidéo, plafond vidéo de l'équipe Rencontres. Il annonce le coût estimé, puis envoie la vidéo dans ta conversation privée seulement (rien n'est publié). « Où en est le remplacement ? » et « annule le remplacement » marchent aussi.
- ✅ Même moteur que l'équipe Rencontres ; coût compté dans le plafond vidéo de l'équipe Rencontres (100 € par mois par défaut). Un seul remplacement à la fois.
- ✅ 19 tests ajoutés (sans réseau), tous verts. Détails techniques : `docs/DECISIONS-TECH.md` (section du 28 octobre).

## Reste
- ✅ En ligne le 28 octobre à 20 h 14 (site, worker, userbot : problèmes 1 et 2), depuis une copie propre de GitHub (le dossier du Mac contient du travail non terminé d'une autre session). Santé vérifiée : site, base, Redis et worker répondent ; le worker a démarré toutes ses files. Déploiements Railway en pause de 19 h 45 à 20 h 06 (incident chez Railway), repris automatiquement. Message Telegram envoyé à l'admin.
- ✅ Effet de bord du correctif du problème 1 corrigé : un compte avec persona lit les canaux d'inspiration (choix du client), mais ne sert jamais à la recherche de prospects (`freeReaderAccounts(…, { allowPersona: false })` et garde du userbot). Test du userbot resté à l'ancienne règle mis à jour.
- ⚠️ Un contrôle de code échoue déjà avant ce travail : `apps/worker/src/sync/aggregate-players.test.ts` ligne 34 (`any`).

## Test de 5 minutes (après la mise en ligne)
1. Vérifier dans Agents → Réglages que la clé « fal.ai » est enregistrée, et que Léa a une photo dans sa fiche (Conversations → Personas → Médias du personnage).
2. Envoyer à Kevin une vidéo de 15 secondes au plus, avec la phrase « mets Léa à la place de la personne dans cette vidéo ».
3. Répondre OUI quand Kevin annonce le coût.
4. Attendre la vidéo (jusqu'à 15 minutes). « où en est le remplacement ? » donne l'avancement.

## Problèmes et actions humaines
- Le test de 5 minutes ci-dessus (envoyé par Telegram).
- Pour une vidéo de plus de 20 Mo, le compte Telegram connecté doit l'être encore (Réglages → Connexions → Telegram).

---

# Statut — 28 octobre 2026 (journée)

## Fait
- ✅ Déploiement de 10 h 33 vérifié (site, worker, base, Redis : tout répond). Migration du proxy appliquée : Celsius lu par le serveur, Sportaza et Bet Portal réactivés.
- ✅ Bookmakers par le serveur : le proxy norvégien lève bien le blocage par pays, mais Celsius et Sportaza demandent alors un contrôle anti-robot au serveur. On ne le contourne pas. Celsius repasse en « serveur d'abord, Mac en secours » (migration `20261028140000_celsius_lecture_auto`), comme Sportaza.
- ✅ Statistiques : les offres sans fiches joueurs (applis de rencontre : Spiice, JM Rencontre) comptent enfin leurs inscriptions et premiers dépôts (joueurs agrégés tenus par la synchro, `apps/worker/src/sync/aggregate-players.ts`). Les 24 inscriptions Spiice du 15 au 22 octobre apparaîtront dans la campagne « Dating test ».
- ✅ Kevin parle comme un collègue : réponse écrite par Opus 5.5 avec la conversation récente, garde-fous inchangés (chiffres contrôlés, jamais « c'est fait » sans action, contrôle qualité), ancien texte en secours.
- ✅ Bot de recharge (Link Affi) : cause trouvée (l'ancienne adresse Lovable coupe la fin des adresses, 2 591 appels refusés depuis le 27 à 18 h). Correction prête sur la branche `migration` de Link Affi, pas encore en ligne.

## Reste
- ⏳ Mettre à jour Railway (site puis worker) pour la migration Celsius, les statistiques et Kevin.
- ⏳ Mettre en ligne la correction du bot de recharge (accord du client demandé).
- ⏳ Campagne « Jordan » : rattachée à l'offre « Jordan » (Crash gaming, sans activité) alors que les premiers dépôts de Jordan sont sur « Jordan Celsius » (paris sportifs) ; à rattacher seulement si ces joueurs viennent de nos canaux (question au client).

## Test de 5 minutes (après la mise à jour)
1. Campagnes → « Dating test » → période 30 jours : la ligne « Inscriptions » montre les inscriptions Spiice (24) après la synchro suivante (2 min) et le recalcul des chiffres (1 h).
2. Écrire « salut, ça se passe comment aujourd'hui ? » à Kevin : il répond en phrases normales, en suivant la conversation.
3. Agents → Bookmakers : Celsius « Lu par : le serveur (le Mac en secours) ».

## Problèmes et actions humaines
- Les contrôles anti-robot des bookmakers exigent un humain : le Mac reste nécessaire pour Celsius et Sportaza (« Ouvrir le navigateur sur le Mac » quand Kevin le demande).
- Kevin répond un peu plus lentement (interprétation, rédaction, contrôle qualité) et dépense environ 1 centime par réponse dans son plafond mensuel.
- Le dépôt GitHub `linkaffipro-mirror` est public : à passer en privé.
