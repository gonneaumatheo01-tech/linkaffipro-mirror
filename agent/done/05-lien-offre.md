# 05 — Lien d'offre suivi

## Objectif
Quand le moteur decide d'envoyer le lien, il appelle `deps.createOfferLink()`. Aujourd'hui le userbot rend `null`
(tache 04), donc aucun lien ne part. Cette tache cree le lien d'offre suivi.
Le transport mettra le lien en clair dans le texte (`canSendButtons: false`) : rien a faire cote envoi.

## Reference a LIRE (ne pas modifier)
`apps/worker/src/assistant/offer-link.ts` : `createAssistantOfferLink` et `dropUnsentOfferLink`.
Porter la meme logique dans `apps/userbot/src/offer-link.ts`.

## A faire
1. `apps/userbot/src/offer-link.ts` :
   - creer un `AssistantOfferLink` : `subId` via `newSubId()` de `@linkaffipro/core`, `personaId`,
     `conversationId`, `botId` (celui du compte), `memberId`, `source`, et le `trackingLinkId` du lien OFFER
     de la persona ;
   - construire l'URL a partir de `trackingUrlTemplate` de la campagne d'affiliation, comme le worker ;
   - rendre `{ url, subId }`, ou `null` si l'offre n'est pas exploitable (pas de campagne active, pas de modele
     d'URL, pas de lien de suivi OFFER) — dans ce cas journaliser la raison une fois, clairement.
   - `dropUnsentOfferLink(subId)` : retirer la ligne quand le lien n'est finalement pas parti.
2. `apps/userbot/src/turn.ts` :
   - `createOfferLink` du `TurnDeps` appelle cette fonction et rend le lien au moteur ;
   - si `result.unsentOfferSubId` est renseigne, appeler `dropUnsentOfferLink`.
   - aligner le calcul de `hasOffer` de la persona sur celui du worker : campagne active ET modele d'URL non vide.
3. `apps/userbot/src/settings.ts` : rien a changer sauf si necessaire.

## Fini quand
- `pnpm typecheck` et `pnpm test` passent.
- Un tour qui envoie le lien ecrit bien une ligne `AssistantOfferLink` avec un `subId`.
