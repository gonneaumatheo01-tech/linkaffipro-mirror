# 04 — Le tour de conversation sur message entrant

## Objectif
Quand un message prive arrive sur le compte, le userbot repond en utilisant le moteur `@linkaffipro/chat` (`runTurn`).
Le transport de la tache 03 fait deja partir les messages et ecrit les lignes `ConversationMessage` sortantes.

## Existant a REUTILISER (ne pas modifier)
- `apps/userbot/src/client.ts` : handler `NewMessage` (a brancher) et `LiveAccount` qui expose `client`.
- `apps/userbot/src/transport.ts` : `createMtprotoTransport` (ChatSender).
- `packages/chat` : `runTurn`, `TurnInput`, `TurnDeps`, `parseStyleProfile`, `parseFacts`, `HISTORY_LIMIT`,
  `estimateCostEur`, `findModel`, `modelSupportsReasoning`, `clampMaxTokens`, `createVeniceClient`.
- A LIRE pour s'en inspirer (sans les modifier) : `apps/worker/src/assistant/turn.ts`, `rules.ts`, `settings.ts`.
  Le worker reste inchange : on PORTE le necessaire dans `apps/userbot`.

## A faire
1. `apps/userbot/src/settings.ts` : lire le reglage `assistant.venice` (meme forme que le worker) : cle Venice,
   modele par defaut, modele de repli, temperature, maxTokens, plafond mensuel, liste des modeles.
2. `apps/userbot/src/turn.ts` :
   - resoudre l'expediteur : retrouver/creer le `Member` (par `telegramUserId`), puis la `Conversation`
     (`botId` = `account.botId`, `memberId`, `personaId` = `account.personaId`). La table a une contrainte unique
     `(botId, memberId)` : utiliser un upsert.
   - enregistrer le message entrant : `ConversationMessage` direction IN, author MEMBER, text.
   - construire `TurnInput` (kind `reply`) : persona (ligne `Persona` du compte ; `hasOffer` =
     `affiliateCampaignId` non nul), reglages, etat de la conversation (stage, style, faits, compteurs,
     `isFirstAssistantTurn` = `assistantTurns === 0`), historique (20 derniers messages AVANT ce tour),
     messages entrants du tour.
   - `TurnDeps` : `llm` = `createVeniceClient(cle)`, `sender` = le transport, `now`/`sleep`/`random` reels,
     `createOfferLink` = `null` pour l'instant, `beforeSend` = `{ abort: false, newInbound: [] }`,
     `recordUsage` = ecrire `AiConversationUsage`, `capReached` = depense du mois >= plafond,
     `costEur` = `estimateCostEur`.
   - appeler `runTurn`, puis enregistrer le resultat : stage, style, faits, `assistantTurns` (+1 si repondu),
     `lastAssistantAt`, `lastInboundAt`, `memberMessages` (+ nombre de messages entrants).
3. Brancher sur le handler `NewMessage` de `client.ts` : ne traiter que les messages PRIVES ENTRANTS.
4. Un verrou par conversation pour ne jamais repondre deux fois en meme temps (un simple `Set` en memoire suffit).
5. Journaliser chaque tour : expediteur, nombre de messages entrants, `outcome`, nombre de messages partis.

## Hors perimetre de cette tache
Lien d'offre, relances (`nextFollowUpAt`), plafonds du jour, reprise par l'equipe, resume roulant,
regroupement des messages arrives pendant la preparation.

## Fini quand
- `pnpm typecheck` et `pnpm test` passent.
- Le handler compile et appelle bien la fonction de tour.
