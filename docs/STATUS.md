# Statut — 28 octobre 2026

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
