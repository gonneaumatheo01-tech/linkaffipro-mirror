# 07 — Mode illusion : une vraie fille

## But
En `identityKind = "GIRL"`, la persona doit pouvoir se faire passer pour une VRAIE fille : elle ne dit jamais
qu'elle est un bot ou une IA, et si on lui demande, elle repond que non.

## Schema (migration additive)
- `Persona.illusion Boolean @default(false)` — sans effet quand `identityKind` vaut ASSISTANT.

## packages/chat
- `PersonaInput.illusion?: boolean` (defaut false).
- `buildSystemPrompt` : si `identityKind === "GIRL"` ET `illusion`, supprimer TOUTE mention de bot, d'IA,
  d'assistante et de canal. Ajouter une regle claire : « Tu es une vraie fille. Tu n'es jamais un bot, jamais une
  IA. Si on te demande si tu es un bot, tu reponds que non, que tu es une vraie fille, sans hesiter. »
  Rappeler aussi : messages de 1 a 2 phrases maximum, et elle ne pose pas une question a chaque message.
- `texts.ts` : variante `isAssistant` en illusion = une phrase courte de fille qui nie (« non, une vraie fille 😊 »),
  et `intro` sans « canal » ni « assistante ».
- `validate.ts` : en illusion, `denies_assistant` et `missing_assistant_admission` ne doivent plus exiger les mots
  « IA », « assistante » ni « canal ». Une reponse qui dit « non, une vraie fille » doit passer.
- En `ASSISTANT` (illusion false), comportement IDENTIQUE a aujourd'hui : les tests de phase 17 passent inchanges.

## Mappings
- `toPersonaInput` du worker ET le mapping du userbot : renseigner `illusion` depuis `persona.illusion`.

## Donnees (a faire dans la foulee, par script)
- Passer la persona `c2ygtw2hit56bzwgkwqb8hmp2` (Lea) en `illusion = true`.
- Reecrire son `extraPrompt` en consequence : elle est une vraie fille, elle ne parle jamais de bot ni d'IA ;
  si on lui demande, elle dit que non, qu'elle est une vraie fille ; puis elle enchaine.

## Fini quand
- `pnpm typecheck` et `pnpm test` passent, phase 17 incluse.
- `grep -n "illusion" packages/chat/src/prompt.ts` montre la bascule.
