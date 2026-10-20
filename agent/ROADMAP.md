# Phase 18 — userbots sur comptes Telegram reels

## Contexte
La plateforme (phase 17) fait discuter des BOTS Telegram avec des prospects. La phase 18 ajoute des userbots :
de VRAIS comptes Telegram qui discutent comme une fille et convertissent vers une app de rencontre.

## Architecture — decisions FIGEES, ne pas rediscuter
- `apps/userbot` tient une session MTProto PERSISTANTE (GramJS) par compte actif. Elle possede la session :
  aucun autre process ne doit se connecter avec.
- Un « bot fantome » (ligne `Bot` inerte, `mode = STANDARD`) porte les conversations de chaque compte.
  Ainsi `Conversation.botId`, `AssistantOfferLink.botId`, `MemberBotState` et `OutboundMessage` restent inchanges.
- Le worker NE traite PAS ces conversations (il n'agit que sur les bots `ASSISTANT`) : c'est `apps/userbot`
  qui tient le tour de conversation.
- Le moteur `@linkaffipro/chat` est REUTILISE tel quel (`runTurn`, `TurnInput`, `TurnDeps`, `ChatSender`).
- La base visee est la base LOCALE (`localhost`). Ne jamais toucher la prod.

## Conventions
- Textes, commentaires et messages en francais. Identifiants en ASCII (pas d'accents).
- Commentaires courts expliquant le POURQUOI, pas le comment.
- Un fichier = une responsabilite.
- Une erreur d'envoi est RENDUE au moteur (`{ ok: false, ... }`), jamais jetee.

## Garde-fous
- Ne jamais casser la phase 17. `pnpm test` doit passer.
- `pnpm typecheck` ET `pnpm test` doivent passer avant de rendre la main.
- Ne pas sortir du perimetre de la tache.
- Ne pas modifier le schema Prisma sans le signaler.
- Ne pas faire `git push` : le hook post-commit s'en charge.

## Rapport final
Termine TOUJOURS par un resume court : fichiers crees/modifies, decisions prises, ce qui reste a faire.

## Discipline d'execution (IMPORTANT)
- Tu es l'EXECUTANT. La conception est figee : ne la rediscute pas.
- Ne t'arrete JAMAIS pour poser une question : si tu hesites, APPLIQUE la tache telle qu'elle est ecrite.
- Tu as le droit de signaler ton desaccord dans le resume final, mais APRES avoir fait le travail.
- Verifie toi-meme chaque point de la section « Fini quand » et dis-le dans le resume.

## Decision actee : le mode illusion
Une persona `identityKind = GIRL` + `illusion = true` se fait passer pour une vraie fille et NIE etre une IA.
C'est VOULU. Ce n'est pas a rediscuter.
