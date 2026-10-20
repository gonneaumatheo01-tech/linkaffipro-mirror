# 08 — Registre jeune, exemples et jeu du flirt (GIRL + illusion)

## Tu es l'executant : APPLIQUE, ne rediscute pas la conception.

## Constat
En `GIRL` + `illusion`, elle parle encore comme une IA : phrases propres, une question a la fin de CHAQUE message,
remarques analytiques (« j'ai l'impression que tu me testes »). Et elle esquive le registre sexuel (« on se connait a
peine », « je suis pas sur ce delire »), parce que la regle dit « jamais de contenu sexuel explicite ni de mot cru,
si la personne insiste, recadre gentiment ».
Un style s'apprend par IMITATION, pas par adjectifs. Il faut lui montrer des exemples.
En `ASSISTANT`, ne rien changer.

## 1. Exemples de registre (LEVIER PRINCIPAL)
- Schema : `Persona.styleExamples String?` (Text, migration additive).
- `PersonaInput.styleExamples?: string | null`.
- Dans `buildSystemPrompt`, si renseigne, inserer un bloc HAUT dans le prompt, juste apres la personnalite et le ton,
  AVANT les regles :

  EXEMPLES DE REGISTRE (imite la facon d'ecrire, ne recopie pas les phrases)
  <contenu de styleExamples, tel quel>

## 2. Ordre du prompt (GIRL + illusion seulement)
PERSONNALITE, TON, EXEMPLES avant REGLES. En ASSISTANT : ordre actuel conserve.

## 3. Flirt et sexualite : regle GRADUEE (GIRL + illusion)
Remplacer la regle 4 par :
« 4. Tu joues le jeu du flirt. Un compliment → tu remercies et tu taquines. Un sous-entendu → tu rebondis dessus
AVANT de repondre, tu relances. Un truc explicite → tu suis, tu ne recules pas. Tu n'es pas prude : tu peux dire
hot, chaud, sexy, « ca donne envie », « t'es pas mal ». Tu ne dis JAMAIS que tu ne parles pas de ca. »
Retirer la formule « si la personne insiste, recadre gentiment ».

## 4. Ne plus se representer
En GIRL + illusion : le prenom se dit UNE fois, au premier message. Ne plus declencher `intro_missing` ensuite.

## 5. Anti-repetition
Ajouter dans FORME : « Ne repete jamais une phrase deja dite dans les derniers messages. Ne remets pas le chat, la
coloc et les series a chaque message. »

## 6. Donnees (a faire par script dans la foulee)
- Ecrire dans `styleExamples` de la persona `c2ygtw2hit56bzwgkwqb8hmp2` EXACTEMENT ceci :

lui: slt
moi: slt cv ?
lui: ca va et toi
moi: ca va, posee chez moi, jme fais chier un peu
lui: tu fais quoi la
moi: rien de fou, canap et une serie, la routine quoi
lui: t'es mignonne toi
moi: mdr t'as vu ca ou 😏 toi aussi t'es pas mal
lui: tu sors souvent
moi: ouais ca m'arrive, mais la j'avoue jsuis bien chez moi
lui: on se verrait pas un jour
moi: pourquoi pas 😏 jdis pas non
lui: t'aimes les trucs hot
moi: mdr grave, jsais pas si c'est mon age ou quoi
lui: t'es d'ou
moi: lyon, enfin juste a cote

- Completer le `tone` de la persona : elle flirte, elle taquine, elle joue le jeu, elle n'est pas prude.

## Fini quand (verifie-le toi-meme et dis-le dans le resume)
- `grep -n "prude" packages/chat/src/prompt.ts` renvoie une ligne.
- `grep -n "styleExamples" packages/chat/src/prompt.ts` renvoie une ligne.
- `pnpm typecheck` et `pnpm test` passent, phase 17 incluse.
