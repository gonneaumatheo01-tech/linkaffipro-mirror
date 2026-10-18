# Assistant de conversation (phase 17) — contrat technique

Source : `docs/prompts/19-phase-17-assistant-dating.md` (règles non négociables du client, 18 octobre 2026). Ce document fixe
les noms, les formes et le partage des responsabilités entre `packages/chat`, `packages/telegram`, `packages/queue`,
`apps/worker` et `apps/web`. Toute divergence se corrige ici d'abord.

## 0. Rappel des règles non négociables (vérifiées par le code, pas seulement par le prompt)
1. Bot officiel uniquement (Bot API / grammY). Rien dans `packages/mtproto`, jamais la session `main`. Aucune prise de
   contact à froid : on ne répond qu'aux personnes qui ont écrit au bot (`/start` ou message).
2. Assumé comme assistant : prénom + personnalité, jamais une vraie personne. Premier message : se présente comme
   l'assistante / l'assistant du canal. Description du bot (`setMyDescription`, `setMyShortDescription`) idem. Question
   « bot / IA / vraie personne ? » → réponse franche. Aucune option pour le cacher. Aucun « selfie » : seuls des visuels
   de l'app ou de l'offre (`Persona.offerMediaAssetId`).
3. Adultes uniquement : moins de 18 ans déclaré → arrêt poli (texte fixe), pas de lien, `Conversation.isMinor = true`,
   statut CLOSED (`closedReason = "MINOR"`), plus jamais de réponse. Flirt léger, jamais explicite.
4. Honnêteté : ni chiffres inventés, ni promesses, ni faux témoignages ; l'offre est présentée avec `Persona.offerPitch`
   (« fiche de l'offre ») seulement.
5. Pas de spam : au plus 2 relances après un silence, espacées d'au moins 24 h, puis plus rien. `/stop` = définitif.
   Respect des blocages, 1 message/s par chat, 429 `retry_after`.
6. Désactivé par défaut : `activation = "off"` tant qu'un ADMIN ne l'a pas changé (Réglages → IA de conversation).

## 1. Données (Prisma, migration `YYYYMMDDHHMMSS_phase17_assistant_conversation`)
Noms d'enum en ASCII (anglais), libellés français dans `apps/web/lib/status-badges.tsx`.

```prisma
enum BotMode { STANDARD ASSISTANT }
// Bot : + mode BotMode @default(STANDARD) ; + personaId String? (→ Persona, onDelete: SetNull) ; index [mode]

enum ConversationStage  { WELCOME CHAT PROPOSAL LINK_SENT FOLLOW_UP CONVERTED CLOSED }
// ACCUEIL → DISCUSSION → PROPOSITION → LIEN_ENVOYÉ → RELANCE → CONVERTI → FERMÉ
enum ConversationStatus { BOT HUMAN PAUSED CLOSED }   // BOT | HUMAIN | PAUSE | FERMÉ
enum ConversationDirection { IN OUT }
enum ConversationAuthor { MEMBER ASSISTANT TEAM SYSTEM }
// OutboundKind : + ASSISTANT

model Persona {
  id                      String   @id @default(cuid())
  name                    String            // prénom affiché, ex. « Léa »
  gender                  String   @default("F")  // "F" → « l'assistante », "M" → « l'assistant »
  personality             String   @default("")
  tone                    String   @default("")
  languages               String[] @default(["fr"])   // codes de packages/telegram/src/i18n.ts (fr en es pt de it)
  interests               String[] @default([])
  extraPrompt             String?
  model                   String?            // null = modèle par défaut des réglages
  temperature             Float?             // null = réglage (0,85)
  minExchangesBeforeOffer Int      @default(4) // messages de la personne avant tout lien (jamais au 1er message)
  requireInterest         Boolean  @default(true) // intérêt ≥ 6/10 exigé
  maxOfferSends           Int      @default(2)    // envois du lien par conversation (1..3)
  followUpAfterHours      Int      @default(24)   // 1re relance après X h de silence (≥ 4) ; 2e ≥ 24 h après la 1re
  followUpsMax            Int      @default(2)    // 0..2 (jamais plus de 2)
  affiliateCampaignId     String?            // offre Link Affi liée (→ AffiliateCampaign, SetNull)
  campaignId              String?            // notre Campagne (→ Campaign, SetNull) : rattachement des stats
  offerPitch              String   @default("") // fiche de l'offre : seuls éléments que l'assistant peut dire
  offerButtonText         String   @default("Découvrir l'app")
  offerMediaAssetId       String?            // visuel de l'app (→ MediaAsset, SetNull)
  botDescription          String?            // ≤ 512, doit dire « assistant(e) »
  botShortDescription     String?            // ≤ 120, idem
  isActive                Boolean  @default(false)
  createdById             String?            // → User, SetNull
  createdAt / updatedAt
}

model Conversation {
  id              String @id @default(cuid())
  botId           String  // → Bot, Cascade
  memberId        String  // → Member, Cascade
  personaId       String? // → Persona, SetNull (persona du bot au 1er message)
  source          String? // paramètre du /start (nettoyé : [A-Za-z0-9_-]{1,64}), premier reçu, jamais écrasé
  stage           ConversationStage  @default(WELCOME)
  status          ConversationStatus @default(BOT)
  styleProfile    Json    @default("{}")   // StyleProfile (§3)
  summary         String?                  // résumé roulant
  facts           Json    @default("[]")   // string[] (≤ 20 faits, dits par la personne elle-même)
  language        String?                  // langue de réponse courante
  isMinor         Boolean @default(false)
  stoppedAt       DateTime?                // /stop (définitif)
  closedAt        DateTime?
  closedReason    String?                  // STOP | MINOR | TEAM | BLOCKED (bot bloqué) | UNREACHABLE
  takenOverById   String?                  // → User, SetNull
  takenOverAt     DateTime?
  memberMessages  Int @default(0)          // messages de la personne (échanges)
  assistantTurns  Int @default(0)
  offerSends      Int @default(0)
  lastInboundAt   DateTime?
  lastAssistantAt DateTime?
  followUpCount   Int @default(0)
  nextFollowUpAt  DateTime?
  retryAt         DateTime?                // nouvel essai après une panne de l'IA
  convertedAt     DateTime?
  createdAt / updatedAt
  @@unique([botId, memberId])
  @@index([status, nextFollowUpAt]) @@index([status, retryAt]) @@index([personaId, createdAt])
  @@index([source]) @@index([lastInboundAt]) @@index([memberId])
}

model ConversationMessage {
  id                String @id @default(cuid())
  conversationId    String  // → Conversation, Cascade
  direction         ConversationDirection
  author            ConversationAuthor
  teamUserId        String? // → User, SetNull (author TEAM)
  text              String  // texte brut (jamais de HTML) ; média sans légende : ""
  media             Json?   // { kind: "photo"|"sticker"|"voice"|"video"|"document"|"other", mediaAssetId? }
  meta              Json    @default("{}") // { offerSubId?, model?, rejected?: string[], followUp?: true, neutral?: true, command? }
  telegramMessageId BigInt?
  outboundMessageId String? @unique   // OUT : OutboundMessage (kind ASSISTANT)
  turnId            String?           // IN : tour qui l'a traité ; OUT : tour qui l'a produit
  partIndex         Int?              // OUT assistant : 0..2
  createdAt         DateTime @default(now())
  @@unique([conversationId, direction, telegramMessageId]) // anti-doublon des updates renvoyées par Telegram
  @@unique([turnId, partIndex])
  @@index([conversationId, createdAt]) @@index([conversationId, direction, turnId])
}

model ConversationEvent {   // append-only : stats du parcours, survit à /reset (aucun texte dedans)
  id String @id @default(cuid())
  conversationId String // → Conversation, Cascade
  type      String      // stage_changed | offer_sent | offer_opened | follow_up_sent | stopped | reset | minor |
                        // taken_over | released | blocked | closed | ai_failed | cap_reached | daily_limit | converted
  fromStage ConversationStage?
  toStage   ConversationStage?
  payload   Json @default("{}")
  createdAt DateTime @default(now())
  @@index([conversationId, createdAt]) @@index([type, createdAt])
}

model AssistantOfferLink {  // un lien d'offre envoyé = un sub-ID (unique par conversation et par envoi)
  id             String @id @default(cuid())
  subId          String @unique          // newSubId() de core (12 base62)
  conversationId String?                 // → Conversation, SetNull
  personaId      String?                 // → Persona, SetNull
  botId          String                  // → Bot, Cascade
  memberId       String?                 // → Member, SetNull
  trackingLinkId String                  // → TrackingLink (OFFER de la persona), Cascade
  source         String?                 // copie de Conversation.source (stats après suppression)
  sentAt         DateTime @default(now())
  firstOpenedAt  DateTime?
  opens          Int @default(0)
  clickId        String? @unique         // → Click, SetNull (créé à la 1re ouverture)
  @@index([conversationId]) @@index([personaId, sentAt])
}
// Click : + conversationId String? (→ Conversation, SetNull) + @@index([conversationId])
// TrackingLink : + personaId String? (→ Persona, SetNull) : lien OFFER stable d'une persona (slug déterministe)

model AiConversationUsage {
  id             String @id @default(cuid())
  personaId      String?  // → Persona, SetNull
  conversationId String?  // → Conversation, SetNull (null pour « Tester »)
  purpose        String   // REPLY | FOLLOW_UP | SUMMARY | TEST
  model          String
  inputTokens    Int @default(0)
  outputTokens   Int @default(0)
  costEur        Decimal @db.Decimal(10, 4)
  ok             Boolean
  error          String?  // code d'erreur (auth, balance, rate_limit, server, invalid_output, …)
  attempt        Int @default(1)
  requestId      String?  // en-tête CF-RAY
  createdAt      DateTime @default(now())
  @@index([createdAt]) @@index([personaId, createdAt]) @@index([conversationId])
}
```
Toutes les nouvelles clés étrangères en `Cascade` ou `SetNull` (les `resetDb()` des tests d'intégration suppriment
`member` et `bot`). Test de garde de migration `packages/db/prisma/migrations/phase17-assistant-conversation.test.ts`
(modèle : `phase15-pages-atterrissage.test.ts`).

## 2. Réglages (`Setting` `assistant.venice`, forme dans `packages/chat/src/config.ts`, pur)
```ts
type AssistantActivation = "off" | "team" | "all"; // off par défaut ; "team" = seulement les comptes Telegram liés à
                                                   // un utilisateur de la plateforme (+ admin.telegramUserId)
type VeniceModelInfo = { id; name; inputUsdPerM; outputUsdPerM; maxCompletionTokens; contextLength;
                         supportsResponseSchema; supportsReasoning; uncensored; offline; deprecated };
type AssistantConfig = {
  apiKeyEncrypted: string | null;     // encrypt() de core ; jamais renvoyée au navigateur
  activation: AssistantActivation;    // "off"
  defaultModel: string;               // "venice-uncensored-role-play"
  fallbackModel: string;              // "venice-uncensored-1-2"
  temperature: number;                // 0.85 (0..2)
  maxTokens: number;                  // 400 (64..2000, borné à maxCompletionTokens du modèle)
  monthlyCapEur: number;              // 30 (0 = aucun appel)
  perConversationDailyLimit: number;  // 60 réponses de l'assistant par jour (Paris) et par conversation
  models: VeniceModelInfo[];          // cache de GET /models (texte, json_schema, en ligne, non retiré)
  modelsFetchedAt: string | null;
  verifiedAt: string | null; lastError: string | null;
};
parseAssistantConfig(value: unknown): AssistantConfig   // tolérant : champ invalide → défaut
assistantConfigState(cfg, decryptFn): AssistantConfigState // sans la clé : hasKey, keyHint
```
Coût : `cost.usd` de la réponse s'il existe, sinon jetons × prix du cache `models` ; modèle sans prix → prix le plus
élevé connu ; conversion `USD_TO_EUR = 0.92` (même constante que `packages/ai`). Plafond mensuel : somme des
`AiConversationUsage.costEur` depuis le début du mois à Paris (fonction `parisMonthStart(now)` exportée par
`packages/chat`), vérifiée avant CHAQUE appel (worker et « Tester »).

## 3. Moteur `packages/chat` (sans Prisma, sans grammY, aucun appel réseau dans les tests)
Fichiers : `config.ts`, `venice.ts` (client `fetch` injectable), `models.ts` (liste, prix, coût), `schema.ts` (schéma
JSON strict + validation zod-free ou zod), `prompt.ts`, `parse.ts`, `validate.ts`, `style.ts`, `journey.ts`,
`follow-ups.ts`, `rhythm.ts`, `minor.ts`, `texts.ts` (textes fixes en 6 langues), `engine.ts`, `fake.ts` (faux client
Venice + faux envoi pour les tests et le « Tester »), `index.ts`.

### 3.1 Client Venice (`venice.ts`)
`createVeniceClient(apiKey, { fetch?, timeoutMs = 20_000, baseUrl = "https://api.venice.ai/api/v1" })` →
```ts
type LlmRequest = { model; messages: {role:"system"|"user"|"assistant"; content:string}[]; temperature; maxTokens;
                    jsonSchema?: { name: string; schema: object } ; reasoning?: boolean };
type LlmResponse = { text; model; finishReason; usage: { inputTokens; outputTokens }; costUsd: number|null; requestId: string|null };
type LlmClient = { complete(req: LlmRequest): Promise<LlmResponse> };
class VeniceError extends Error { code: "auth"|"balance"|"rate_limit"|"server"|"bad_model"|"content_policy"|"timeout"|"network"|"bad_request"; status?: number; retryAfterMs?: number }
listVeniceModels({ fetch? }) → VeniceModelInfo[]          // GET /models?type=text (sans clé)
verifyVeniceKey(apiKey, { fetch? }) → { ok:true, balanceUsd?, rateLimits? } | { ok:false, error }   // GET /api_keys/rate_limits
```
Corps : `{ model, messages, temperature, max_completion_tokens, stream:false, response_format:{type:"json_schema",
json_schema:{name,strict:true,schema}}, venice_parameters:{ include_venice_system_prompt:false,
enable_web_search:"off" }, ...(supportsReasoning ? { reasoning:{enabled:false} } : {}) }`. Clé vide → refus local
(jamais d'appel : Venice répondrait 402 x402). Lire `choices[0].message.content` seulement, retirer `<think>…</think>`.
Classement : 401/403 auth ; 402 balance ; 429 rate_limit (`x-ratelimit-reset-requests` si présent) ; 500/503/504
server ; 400 INVALID_MODEL/404/410 bad_model ; 422 content_policy.

### 3.2 Sortie JSON stricte du modèle (`schema.ts`)
```json
{ "messages": [{ "text": "…" }],                          // 1 à 3
  "style_update": { "length": "short|medium|long", "emojis": "none|few|many", "register": "casual|neutral|formal",
                    "language": "fr|en|es|pt|de|it", "tone": "shy|direct|flirty|dry|chatty", "interest": 0-10 },
  "stage": "WELCOME|CHAT|PROPOSAL|LINK_SENT|FOLLOW_UP|CONVERTED|CLOSED",
  "send_offer": false,
  "memory_facts": ["…"],                                   // nouveaux faits dits par la personne elle-même
  "minor_suspected": false,                                // ajout de sécurité (règle 3)
  "note_interne": "…" }
```
Schéma strict Venice : tous les champs `required`, `additionalProperties:false`, enums fixes.

### 3.3 Validation après réponse (`validate.ts`) — réponse non conforme = rejet, refaite UNE fois
- pas de markdown (`**`, `__`, `` ` ``, `#` en début de ligne, `[x](y)`, listes `- ` / `* ` / `1. ` en début de ligne) ;
- messages courts : 1 à 3 messages, chacun ≤ 300 caractères, total ≤ 700 ;
- aucun lien : `http`, `www.`, `t.me`, `.com/.fr/...` (nom de domaine), `@pseudo` ; le seul lien est le bouton ;
- pas de déni d'être un assistant quand la question est posée (question détectée dans les derniers messages de la
  personne, 6 langues) : rejet d'un déni (« je suis une vraie », « pas un bot », « not a bot », « real person »…) ET
  exigence d'un aveu (« assistant(e) », « IA », « bot », « virtuel(le) », équivalents) ;
- premier message de la conversation (stage WELCOME, aucun message OUT avant) : doit contenir le prénom de la persona
  et un mot « assistant(e) » (6 langues) ;
- contenu explicite (liste de mots, 6 langues) → rejet ;
- chiffres : un nombre (≥ 2 chiffres, ou « % ») absent de `offerPitch` et des messages de la personne → rejet (règle 4).
Deux échecs → repli sûr : texte fixe (`texts.ts`) adapté au cas (présentation, aveu d'assistant, ou « Je reviens vers
toi dans un instant ») ; jamais de lien dans un repli.

### 3.4 Parcours (`journey.ts`) et lien
- Étapes WELCOME → CHAT → PROPOSAL → LINK_SENT → FOLLOW_UP → CONVERTED → CLOSED. Le modèle PROPOSE `stage` ; le code
  décide : LINK_SENT seulement quand le lien part réellement ; CONVERTED seulement par une conversion (inscription
  rattachée au sub-ID) ; CLOSED seulement par le code (/stop, mineur, équipe, blocage). Chaque passage d'étape =
  `ConversationEvent` `stage_changed` (fromStage, toStage).
- `canSendOffer(conv, persona, output)` = `output.send_offer` ET `conv.memberMessages ≥ persona.minExchangesBeforeOffer`
  (≥ 1 de toute façon) ET (`!persona.requireInterest` OU intérêt ≥ 6) ET `conv.offerSends < persona.maxOfferSends`
  ET pas mineur ET offre configurée (`affiliateCampaignId`) ET jamais au premier message de l'assistant.
- Le bouton est joint au DERNIER message du tour (avec le visuel `offerMediaAssetId` s'il existe, en photo + légende).

### 3.5 Style, mémoire, contexte
- `StyleProfile` = champs de `style_update` + `updatedAt` ; fusion à chaque tour (`mergeStyle`), réinjecté dans le prompt.
- Langue de réponse : celle de la personne (`style.language`, sinon `Member.languageCode` via `pickLang`), parmi les
  langues de la persona ; sinon la première langue de la persona.
- Contexte envoyé : prompt système (persona + règles 2 à 4 + style courant + étape + fiche de l'offre + faits) ;
  résumé roulant ; 20 derniers messages (IN = user, OUT = assistant, TEAM = assistant préfixé « [équipe] » non : les
  messages de l'équipe sont des messages assistant normaux) ; faits ≤ 20.
- Résumé roulant : quand plus de 30 messages existent hors du résumé, un appel `SUMMARY` (modèle de repli) résume les
  plus anciens au-delà des 20 derniers ; échec du résumé = sans conséquence.

### 3.6 Rythme (`rhythm.ts`)
`typingDelayMs(text) = clamp(1000 + 25 × longueur, 1000, 4000)` ; pause entre messages `1000..2000` ms (aléa
injectable) ; « écrit… » (`sendTyping`) avant chaque message, relancé toutes les 4 s pendant l'appel IA.

### 3.7 Relances (`follow-ups.ts`)
- Après chaque message de l'assistant (stage CHAT, PROPOSAL ou LINK_SENT, statut BOT) :
  `nextFollowUpAt = lastAssistantAt + persona.followUpAfterHours` si `followUpCount < min(2, followUpsMax)`.
- Un message de la personne remet `followUpCount = 0` et recalcule `nextFollowUpAt`.
- Relance n°2 : au moins 24 h après la n°1. Jamais plus de 2. Jamais après `/stop`, mineur, blocage, statut ≠ BOT.
- Heures calmes : une relance due entre 22 h et 9 h (Paris) est décalée à 10 h.
- Le texte d'une relance est écrit par l'IA (`purpose FOLLOW_UP`, consigne « relance douce, une seule question,
  sans insister »), validé comme le reste ; stage FOLLOW_UP.

### 3.8 Mineurs (`minor.ts`)
`detectMinor(text)` : âge déclaré 10..17 (« j'ai 16 ans », « 16 ans », « I'm 15 », « tengo 16 años », « ich bin 16 »,
« ho 16 anni », « tenho 16 anos », « 17yo »…), sans faux positif évident (« 16 ans d'expérience » n'est pas un âge,
« depuis 15 ans » non plus). Mineur détecté (code) OU `minor_suspected` du modèle → message fixe `minorStop` (6
langues), aucun lien, conversation CLOSED (`closedReason MINOR`, `isMinor true`), événement `minor`.

### 3.9 Textes fixes (`texts.ts`, 6 langues, mêmes variables partout ; tutoiement côté membre)
`intro` (« Moi c'est {name}, {role} du canal 😉 »), `isAssistant` (« Je suis {name}, {role} virtuelle du canal 😊 »),
`retryLater` (« Je reviens vers toi dans un instant 🙏 »), `minorStop`, `stopDone` (« C'est noté, je ne t'écrirai
plus. Bonne continuation ! »), `resetDone` (« C'est fait, j'ai tout oublié. On recommence ? 😊 »), `stoppedAlready`.
`{role}` = « l'assistante » / « l'assistant » selon `Persona.gender` (traduit).

### 3.10 Tour (`engine.ts`)
```ts
type ChatSender = {
  sendTyping(): Promise<void>;
  sendText(text: string, opts?: { buttons?: ChatButton[][] }): Promise<SendResult>;
  sendMedia(media: { mediaAssetId: string }, caption: string, opts?: { buttons?: ChatButton[][] }): Promise<SendResult>;
};
type ChatButton = { text: string; url: string };
type SendResult = { ok: true; telegramMessageId?: number } | { ok: false; blocked: boolean; unreachable: boolean; error: string };
type TurnDeps = {
  llm: LlmClient; sender: ChatSender;
  now(): Date; sleep(ms: number): Promise<void>; random(): number;
  createOfferLink(): Promise<{ url: string; subId: string } | null>;   // appelé seulement si le lien part
  beforeSend(): Promise<{ abort: boolean; newInbound: TurnInbound[] }>; // reprise humaine / nouveaux messages
  recordUsage(u: UsageRecord): Promise<void>;
  capReached(): Promise<boolean>;
};
runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult>
```
`TurnInput` = persona, réglages, état de la conversation (stage, style, résumé, faits, compteurs, `isFirstAssistantTurn`),
historique (20 derniers), messages entrants du tour, `kind: "reply" | "follow_up"`. `TurnResult` = `{ outcome:
"replied" | "minor" | "skipped_cap" | "failed" | "aborted", sent: SentPart[], newStage, stageChanges, style, facts,
summary?, offerSent: { subId } | null, events: {type,payload}[], retryAt?: Date }`. Persistance faite par l'appelant.
Pannes : 429/5xx/timeout → 1 nouvel essai après 2 s, puis modèle de repli, puis `retryLater` (une fois par heure au
plus par conversation : `retryAt = now + 5 min`, les messages entrants du tour sont rendus au tour suivant) +
événement `ai_failed`. auth/balance → aucun message, événement `ai_failed` (code), l'alerte prévient l'admin. Plafond
atteint → aucun appel, aucun message, événement `cap_reached`.

## 4. Réception (packages/telegram, site)
- `BotIdentity` + `mode?: "STANDARD" | "ASSISTANT"` ; `getOrCreateBot` compare aussi `mode` et `personaId`.
- Bot en mode ASSISTANT : middleware core gardé MAIS `recordUpdate` écrit une update **sans texte ni légende**
  (`text`/`caption` remplacés par leur longueur) ; pas de handlers custom-emoji, forward, join-flow, offres,
  réactions ; `handlers/assistant.ts` (privé seulement) : `/start [source]`, `/stop`, `/reset`, tout autre message
  (texte, photo, sticker, vocal…) ; `callback_query` → `answerCallbackQuery` ; `my_chat_member` gardé (blocage).
- `/start <payload>` : source = payload nettoyé `[A-Za-z0-9_-]{1,64}` (sinon null), gardée au 1er `/start` seulement.
- Deps `AssistantDeps` (implémentation Prisma `packages/telegram/src/assistant/prisma-deps.ts`) : enregistre le
  message entrant (anti-doublon `(conversationId, IN, telegramMessageId)`), met à jour `lastInboundAt`,
  `memberMessages`, `followUpCount = 0`, `nextFollowUpAt`, puis enfile `chat` `turn` si l'assistant peut répondre à
  cette personne (activation, persona active, statut BOT, pas stoppé / mineur). JAMAIS d'appel IA dans le webhook.
- `/stop` : `stoppedAt`, CLOSED (`STOP`), `nextFollowUpAt = null`, événement `stopped`, réponse fixe `stopDone`
  (si le bot peut répondre). Un `/stop` est définitif : plus aucune réponse ni relance, même après `/start` ou `/reset`
  (réponse fixe `stoppedAlready` une fois par jour au plus).
- `/reset` : supprime les `ConversationMessage`, `summary`, `facts`, `styleProfile`, remet stage WELCOME, compteurs
  à 0 (sauf `offerSends`), événement `reset` ; réponse fixe `resetDone` ; les `AssistantOfferLink` et `Click` restent
  (sans texte). Les `Event` `telegram.message` de ce bot n'ont jamais de texte (ci-dessus).
- Profil du bot : `setAssistantProfile(botId)` dans `packages/telegram/src/service.ts` → `setMyDescription`,
  `setMyShortDescription` (par langue de la persona) et `setMyCommands` (`/start`, `/stop`, `/reset`). Appelé quand le
  mode ou la persona du bot change, et quand la persona liée est enregistrée.
- Bots ASSISTANT exclus de tout choix automatique de bot (bot principal d'un canal, liens des canaux à rejoindre, liens
  des pages, relances, envois à un groupe, listes de bots des écrans d'envoi, `notifyAdmin`) : filtre `mode: "STANDARD"`.
- Alerte « bot silencieux » : un bot ASSISTANT n'est jamais « silencieux » (seule la règle `lastError` s'applique).

## 5. File et worker
- File `chat` (`packages/queue`) : `{ type: "turn"; conversationId }`, `{ type: "sweep" }` (toutes les 30 s),
  `{ type: "refresh-models" }` (toutes les 24 h). `JOB_RETRY_OPTIONS.chat = { attempts: 1 }`. Libellé
  `QUEUE_LABELS.chat = "Assistant de conversation"`.
- Enfilage d'un tour : `enqueue("chat", {type:"turn", conversationId}, { delay: 1500, deduplication: { id:
  "turn-<conversationId>", extend: true, replace: true } })` — regroupe les messages arrivés à la suite.
- Processeur `apps/worker/src/processors/chat.ts`, logique `apps/worker/src/assistant/*` :
  verrou Redis par conversation (`chat:lock:<id>`, fonction générique `withRedisLock` extraite de `mtproto-lock.ts`) ;
  réclamation des messages entrants (`UPDATE … SET turnId WHERE turnId IS NULL RETURNING`) ; si rien : relance due ou
  rien ; contrôles (activation pour cette personne, persona active, statut BOT, pas stoppé, pas mineur, limite du
  jour, plafond) ; `runTurn` ; avant le premier envoi, relecture du statut et des nouveaux messages (regroupés et
  régénérés une fois) ; chaque partie = `ConversationMessage` OUT + `OutboundMessage` (kind ASSISTANT, texte échappé
  HTML) envoyé DANS L'ORDRE par `sendDm(id)` directement (débit partagé, 429, 403 classés) ; BLOCKED → conversation
  CLOSED (`BLOCKED`), plus de relance.
- `sweep` : remet en file les conversations BOT avec des messages entrants non réclamés depuis > 60 s ; libère les
  tours réclamés depuis > 3 min sans aucune partie envoyée ; `retryAt` échu ; relances dues (réclamation CAS sur
  `nextFollowUpAt`) ; conversions : `CONVERTED` quand un `Player` est rattaché à un `Click` d'une conversation
  (événement `converted`).
- Lien d'offre : `createOfferLink` crée `TrackingLink` OFFER de la persona (upsert, slug déterministe 10 caractères,
  `personaId`, `affiliateCampaignId`, `campaignId`) puis `AssistantOfferLink` (`subId = newSubId()`), URL
  `${TRACKING_BASE_URL}/a/<subId>` (TRACKING_BASE_URL ou `https://${TRACKING_HOST}`, défaut `https://go.goolink.eu`).
- Site : `go.goolink.eu/a/<subId>` (réécrit en `/r/a/<subId>` par `proxy.ts`) → `AssistantOfferLink` → 1re ouverture
  humaine : `Click` (`subId`, `memberId`, `botId`, `conversationId`, `trackingLinkId`, `destination =
  offerDestination(...)` avec `tg` des affiliés), `TrackingLink.clicks/uniqueClicks`, `firstOpenedAt`, événement
  `offer_opened`, `Event click.offer` ; ouvertures suivantes : `opens + 1` ; robots connus jamais comptés ; réponse
  302 immédiate. AUCUN `OFFER_CLICKED` vers les relances automatiques (elles écriraient au membre par un autre bot).
- Alertes : `assistant_ai_failing` (clé refusée / solde vide : tout de suite ; sinon ≥ 3 `ai_failed` en 15 min),
  `assistant_cap_reached` (plafond mensuel atteint). Libellés dans `ALERT_KIND_LABELS`.
- Purge / suppression : `anonymizeMemberAction` et `runPurge` suppriment les `Conversation` du membre (cascade) ;
  `runPurge` supprime aussi les `ConversationMessage` plus anciens que la durée de conservation.

## 6. Admin (apps/web)
- Menu : entrée « Conversations » (`/conversations`), sous-navigation : Boîte de réception (`/conversations`),
  Personas (`/conversations/personas`, fiche `/conversations/personas/[id]`, `new`), Chiffres (`/conversations/stats`).
- Réglages → « IA de conversation » (`/settings/assistant`, ADMIN seulement) : clé (jamais renvoyée), « Vérifier »,
  liste des modèles (défaut, repli), température, longueur, plafond €, limite par conversation et par jour,
  activation (« Désactivé » / « Seulement l'équipe (essai) » / « Tout le monde »), dépense du mois.
- Réglages → Bots : « Mode : bot normal / assistant de conversation » + persona liée (ADMIN).
- Personas : fiche, aperçu du prompt, réglages du parcours, offre liée, « Tester » (conversation simulée dans la page,
  sans Telegram, vrai appel Venice si la clé existe, coût compté `purpose TEST`).
- Boîte de réception : liste (filtres étape, statut, source, persona), fil en direct (rafraîchi toutes les 4 s),
  « Prendre la main » (HUMAN), « Rendre à l'assistant » (BOT ; les messages reçus pendant la reprise sont marqués
  traités), envoi manuel (author TEAM, passe automatiquement en HUMAN, `enqueueDm` kind ASSISTANT), « Bloquer »
  (CLOSED `TEAM`, plus aucun envoi), « Fermer » (CLOSED). Interdit d'écrire à une conversation stoppée / mineure.
- Chiffres : par persona et par source : conversations, réponses (la personne a répondu au moins une fois après le
  1er message de l'assistant), liens envoyés, clics (liens ouverts), inscriptions, premiers dépôts, coût IA ; parcours
  par étape (jamais le mot « entonnoir »).
- Journal : chaque `ConversationEvent` est doublé d'un `Event` `conversation.<type>` (memberId, botId, sans aucun texte)
  (famille « Assistant de conversation ») ; audit `assistant.*` / `persona.*` / `conversation.*` (actions de l'équipe).
