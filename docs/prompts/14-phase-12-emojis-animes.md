# Phase 12 — Emojis animés (packs Premium) dans les messages

Si `docs/STATUS.md` indique déjà « phase 12 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/REFONTE-UX.md`, `docs/STATUS.md`, puis la documentation officielle à jour (WebFetch) : Bot API « Formatting options » (`<tg-emoji emoji-id="…">`, entité `custom_emoji`), `getCustomEmojiStickers`, `getStickerSet`, le changelog (Bot API 9.4 de février 2026 : les bots peuvent utiliser les emojis personnalisés dans les messages envoyés en privé, en groupe et en supergroupe **si le propriétaire du bot a Telegram Premium** ; les canaux sont exclus), et la doc MTProto (`messageEntityCustomEmoji`, `messages.getStickerSet` pour les packs d'emojis, `messages.sendMessage` / `sendMedia` avec entités, `users.getFullUser` pour le statut Premium). Mode autonome, aucune question, décisions dans `docs/DECISIONS-TECH.md`.

## Ce que veut le client (validé le 11 octobre)
- Pouvoir mettre les **emojis animés des packs Premium** de Telegram dans les messages programmés et les messages du bot.
- Le compte Telegram propriétaire des 3 bots **a Telegram Premium**.
- Dans les **canaux**, Telegram interdit ces emojis aux bots : le client accepte que ces posts soient **publiés par son propre compte Premium** (session Telegram connectée en phase 7, Réglages → Connecteurs → Telegram), **sans boutons** (Telegram réserve les boutons aux bots).

## 1. « Mes emojis animés » (bibliothèque)
- Nouvelle bibliothèque partagée par l'équipe (Messages → Emojis animés, et accessible depuis l'éditeur) : chaque emoji = `customEmojiId`, emoji de remplacement (le caractère standard affiché si l'animation n'est pas disponible), pack, aperçu.
- Trois façons d'ajouter des emojis, de la plus simple à la plus complète :
  1. **Transférer au bot un message** qui contient les emojis voulus (n'importe quel message Telegram) : le bot lit les entités `custom_emoji`, enregistre chaque emoji et répond « 6 emojis animés ajoutés ✅ ». Accepté uniquement depuis un utilisateur de la plateforme ou l'admin.
  2. **Coller le lien d'un pack** (`t.me/addemoji/<nom>`) : `getStickerSet` → tous les emojis du pack.
  3. Si la session Telegram du client est connectée : **importer ses packs d'emojis installés** et ses emojis récents.
- Aperçus animés dans le navigateur : récupère les fichiers (`getCustomEmojiStickers` + `getFile`), stocke-les (comme les médias), affiche les `.tgs` avec un lecteur Lottie, les `.webm` en vidéo muette en boucle, les `.webp` en image ; vignettes légères, chargement paresseux.

## 2. Éditeur de message
- Dans la barre de l'éditeur (à côté de l'emoji standard), un bouton « Emoji animé » ouvre un sélecteur : onglets par pack, emojis récents de l'équipe, recherche par emoji de remplacement. L'emoji s'insère dans le texte comme une puce animée, que l'on peut supprimer comme un caractère.
- Stockage dans le texte HTML Telegram : `<tg-emoji emoji-id="ID">😀</tg-emoji>`. L'éditeur sans balises de la phase 9, l'aperçu Telegram, le compteur de caractères (un emoji animé compte comme son caractère de remplacement), les modèles, l'assistant IA (qui ne doit jamais supprimer ni modifier ces balises) et la traduction doivent tous les conserver.
- Fonctionne dans : messages de canal, messages du bot (accueil, rappels, accepté, réponse d'offre), relances automatiques (cartes et éditeur à branches), « écrire à un groupe », modèles.

## 3. Envoi : qui publie quoi
- **Messages privés du bot** (accueil, rappels, relances, écrire à un groupe, réponses d'offre) : envoi normal par le bot avec les balises `tg-emoji` (Bot API, propriétaire Premium). Si Telegram refuse (Premium expiré, emoji indisponible), renvoyer aussitôt le même message avec les emojis de remplacement, journaliser, et prévenir l'admin une fois par jour au maximum.
- **Posts de canal** : si le message contient au moins un emoji animé, il est **publié par le compte Telegram connecté** (MTProto, GramJS) au lieu du bot :
  - le formulaire l'annonce clairement : « Ce message contient des emojis animés : il sera publié par votre compte Telegram, sans boutons » ; les boutons sont alors désactivés, et une offre peut être ajoutée comme **lien dans le texte** (lien goolink traqué de type BUTTON : clics comptés, sans identifiant par membre) ;
  - si le message contient aussi des boutons, l'utilisateur choisit : « Garder les emojis animés (sans boutons) » ou « Garder les boutons (emojis normaux) » ; ce dernier remplace automatiquement chaque emoji animé par son emoji de remplacement ;
  - prérequis vérifiés avant de programmer : session connectée, compte Premium (`users.getFullUser`), compte administrateur du canal avec le droit de publier ; sinon message clair et lien vers Réglages → Connecteurs → Telegram ;
  - médias (photo, vidéo, album) avec légende contenant des emojis animés : même logique via MTProto ;
  - épingler, désépingler, silencieux, supprimer après N minutes : réalisés par la même session MTProto ; **ne jamais modifier ensuite ces posts par le bot** (une modification par le bot ferait disparaître les emojis animés) ;
  - limites MTProto : un seul client, file d'attente, respect de `FLOOD_WAIT`, nouvelle tentative, alerte si la session est expirée ;
  - les vues et transferts de ces posts sont relevés comme les autres (phase 7) ; les clics passent par le lien goolink.
- Calendrier et fiche message : badge « publié par votre compte · emojis animés ».

## 4. Tests et livraison
- Tests unitaires : conversion éditeur ↔ HTML `tg-emoji` (aller-retour sans perte), compteur de caractères, remplacement par l'emoji de secours, choix bot / compte selon le contenu, conservation des balises par l'IA (avec API simulée) et par la traduction.
- Tests d'intégration simulés : transfert d'un message au bot → emojis ajoutés ; envoi privé avec emojis animés ; refus Telegram → renvoi avec les emojis de remplacement ; post de canal avec emojis animés → file MTProto (client simulé) ; post avec boutons → choix imposé.
- Test réel en fin de phase, en sécurité : un message privé avec un emoji animé envoyé par le bot casino **à l'admin uniquement**, et, si la session Telegram est connectée, un post dans le **canal TEST uniquement**. Aucun envoi vers de vrais membres ni de vrais canaux.
- `pnpm lint && pnpm build && pnpm test` verts, déploiement vérifié, captures 1440 / 390 de l'éditeur et du sélecteur, `docs/STATUS.md` et guide (section Messages : « Ajouter des emojis animés ») à jour, commit et push.
- Bilan Telegram en 5 lignes : comment ajouter ses emojis (transférer un message au bot) et ce qui change pour les posts de canal. Puis `docs/PHASE-DONE`.
