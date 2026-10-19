# 03 — Transport MTProto (ChatSender)

## Objectif
Creer `apps/userbot/src/transport.ts` : un objet qui implemente l'interface `ChatSender` de `@linkaffipro/chat`
et envoie par la session GramJS persistante du compte (voir `apps/userbot/src/client.ts`).

## Capacites (exactement celles-ci){ canInitiate: true, canMarkRead: true, canSendButtons: false }

`canSendButtons: false` est VOLONTAIRE : le moteur met alors le lien d'offre en clair a la fin du texte.

## Methodes a implementer
- `sendTyping()` : action « typing » vers le pair.
- `sendText(text, opts)` : envoie le texte, rend `{ ok: true, telegramMessageId }`.
- `sendMedia(media, caption, opts)` : pour l'instant envoie `caption` comme texte (le visuel viendra plus tard).
- `markRead()` : marque le pair comme lu.

## Persistance
Chaque envoi REUSSI ecrit une ligne `ConversationMessage` :
`direction: "OUT"`, `author: "ASSISTANT"`, `text`, `turnId`, `partIndex` (0, 1, 2... croissant), `telegramMessageId`.
Le contexte (`conversationId`, `memberId`, identifiant du pair, `turnId`) est injecte a la construction.

## Erreurs
Ne jamais lever : rendre `{ ok: false, blocked, unreachable, error }`.
`blocked = true` si le message d'erreur contient « blocked » ; `unreachable = true` si « deactivated » ou « not found ».

## Perimetre
- `apps/userbot/src/transport.ts` (nouveau)
- `apps/userbot/src/client.ts` si besoin d'exposer le client et le pair.
Rien d'autre.

## Fini quand
- `pnpm typecheck` passe (14/14) et `pnpm test` passe.
- `transport.ts` compile et exporte une fabrique du transport.
