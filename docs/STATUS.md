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
