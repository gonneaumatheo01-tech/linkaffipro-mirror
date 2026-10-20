# 06 — Identite de la persona : fille ou assistante

## But
Le prompt systeme presente la persona comme « l'assistante virtuelle du canal » (heritage phase 17). Un userbot doit
pouvoir etre une VRAIE fille. On ajoute un choix d'identite porte par la persona, SANS rien changer pour les personas
existantes.

## Schema (migration additive)
- `Persona.identityKind String @default("ASSISTANT")` — valeurs `ASSISTANT` | `GIRL`.
- `Persona.age Int?` — age declare (utile au prompt quand il est renseigne).

## packages/chat
- `PersonaInput` : `identity?: "ASSISTANT" | "GIRL"` (defaut ASSISTANT) et `age?: number | null`.
- `buildSystemPrompt` : si `GIRL`, remplacer le cadre « assistante du canal » par un cadre de fille :
  « Tu es {name}, {age} ans, une fille sur Telegram. Tu discutes en prive avec quelqu'un qui t'a ecrit. »
  Adapter la regle 1 : quand on lui demande si c'est un bot, elle repond simplement que non... puis, si on insiste,
  qu'elle est une IA — sans jamais dire « assistante » ni « le canal ».
- `texts.ts` : variantes `GIRL` pour `intro` et `isAssistant` (sans « canal », sans « assistante »).
- `validate.ts` : en `GIRL`, les codes `denies_assistant` et `missing_assistant_admission` doivent accepter une
  reponse de fille ; ne plus exiger les mots « canal » ou « assistante ».
- En `ASSISTANT`, le comportement doit rester IDENTIQUE a aujourd'hui : les tests de phase 17 passent inchanges.

## Mappings
- `toPersonaInput` du worker ET le mapping du userbot (`apps/userbot/src/turn.ts`) : renseigner `identity` depuis
  `persona.identityKind` et `age` depuis `persona.age`.

## Prompt : l'envoi du lien
Verifier que le prompt indique CLAIREMENT quand proposer l'appli : le modele doit lever `send_offer` apres plusieurs
echanges, quand le courant passe. Aujourd'hui `offerSends` reste a 0 alors que le seuil de messages est atteint.

## Hors perimetre
Le mode ILLUSION complet (nier etre une IA). Ici elle reste honnete si on lui demande.

## Fini quand
- `pnpm typecheck` et `pnpm test` passent, y compris les tests de phase 17.
- `grep -n "identityKind" packages/chat/src/prompt.ts` montre la bascule.
