# Phase 18 — persona « Une fille » réglable dans le site (pour tous les comptes Telegram)

Tu travailles dans le dépôt LinkAffi Pro sur ce Mac : `/Users/utilisateur/Desktop/Platefome de statistiques`.
Lis d'abord `CLAUDE.md` (règles du projet, commandes, déploiement). L'utilisateur n'est pas technique : parle-lui en
français simple, une étape à la fois, et fais tout toi-même (il veut seulement approuver).

## Où on en est
- La base a déjà les colonnes de la phase 18 sur `Persona` : `identityKind` ("ASSISTANT" par défaut, ou "GIRL"),
  `age`, `illusion`, `styleExamples`. Le moteur de conversation les utilise déjà (`packages/chat/src/prompt.ts`,
  `packages/chat/src/validate.ts`, `apps/userbot/src/turn.ts`, `apps/worker/src/assistant/rules.ts`).
- Mais le formulaire Conversations → Personas ne les montre pas : la persona Léa a été passée en « fille » par des
  scripts qui ne touchent que la base LOCALE (`apps/web/scripts/set-persona-lea.ts`, `set-persona-lea-illusion.ts`,
  `set-style-lea.ts`). En production, Léa est restée « assistante du canal ».
- Le service Railway `userbot` tourne (compte +33…, persona Léa). Chaque compte Telegram choisit sa persona dans
  Réglages → Comptes Telegram.
- L'arbre de travail contient des changements NON commités et voulus (ne les annule pas, commite-les avec le reste) :
  Dockerfile du userbot (ffmpeg, node en PID 1), `apps/userbot/src/audio.ts` + `transcribe.ts` + test (vocaux faibles),
  migration `20261022120000_phase18_account_dm_welcome_dm`, correctif du bouton Activer
  (`apps/web/app/(admin)/settings/accounts/page.tsx`), 10 scripts `apps/web/scripts/*` corrigés pour le lint,
  `docs/DECISIONS-TECH.md`, scripts `scripts/railway-*.sh`, `scripts/*.command`, `scripts/persona-fille.mjs`.

## Ce qu'il faut faire
Permettre de régler une persona « fille » entièrement depuis le site, pour pouvoir en créer plusieurs et les mettre
chacune sur un compte Telegram différent.

1. `apps/web/lib/personas/form.ts`
   - Type `PersonaIdentity = "ASSISTANT" | "GIRL"` et liste `PERSONA_IDENTITIES` (libellés « Assistante du canal » /
     « Une fille », avec une ligne d'aide chacun).
   - `PERSONA_LIMITS` : `personality` 1 500, `tone` 800, `styleExamples` 4 000, `age` de 18 à 99.
   - Ajouter `identityKind`, `age` (texte dans le brouillon), `styleExamples` à `PersonaFormState`,
     `emptyPersonaForm`, `PersonaRecord`, `personaToForm`, `PersonaData`, `payloadSchema`, `validatePersonaForm`.
   - Âge : obligatoire pour une fille (18 ans au moins), facultatif pour une assistante mais vérifié s'il est donné ;
     `activationProblems` refuse l'activation d'une fille sans âge valide.
   - Exemples de style : retours à la ligne gardés (normaliser `\r\n`), longueur bornée.
   - `botProfileTextProblem(text, kind, identityKind)` : pour une fille, le mot « assistante » n'est pas exigé.
     Les contrôles existants (`hidesAssistant`, `deniesBeingAssistant`) restent appliqués à toutes les identités, y
     compris sur `styleExamples`.
2. `apps/web/lib/personas/save.ts` : ajouter les nouveaux champs à `COMPARED_FIELDS` et au `select` de l'avant ; le
   garde-fou du profil du bot n'exige pas « assistante » pour une fille.
3. `apps/web/components/personas/persona-form.tsx`, section « Identité » : le choix « Qui est-elle ? » (deux cartes
   radio), puis pour une fille le champ Âge, Personnalité et Ton en zones de texte plus grandes avec compteur, et le
   champ « Exemples de style » (un échange par ligne, « lui : » / « moi : »). Textes d'aide et encadré d'information
   adaptés à l'identité choisie ; description de la section « Profil du bot » adaptée (sans objet pour un compte réel).
4. Ne supprime rien : la colonne `illusion` et tout le code du moteur qui la lit restent tels quels. Le formulaire ne
   lit ni n'écrit `illusion` (pas dans `PersonaData`), donc sa valeur en base ne change pas quand on enregistre.
5. Honnêteté du moteur pour une fille : dans `packages/chat/src/prompt.ts` (règle 1 du cas `girl` sans illusion) et
   `packages/chat/src/validate.ts`, si on lui demande sincèrement si c'est un bot ou une IA, elle le dit dès la
   première question, avec son ton, puis continue la discussion (déni refusé, aveu exigé dès que la question est
   posée). Mets à jour `packages/chat/src/identity.test.ts` en conséquence.
6. Tests : dans `apps/web/lib/personas/form.test.ts`, complète la persona d'exemple (`PersonaRecord`) avec les
   nouveaux champs et ajoute des tests : profil d'une fille accepté sans « assistante », âge obligatoire et ≥ 18,
   exemples de style gardés ligne par ligne et bornés, consigne qui nie être une IA toujours refusée, persona
   enregistrée sans identité = assistante.
7. Documentation : `docs/GUIDE-UTILISATEUR.md` (section Personas : le choix « Qui est-elle ? », l'âge, les exemples de
   style) et une ligne dans `docs/DECISIONS-TECH.md` (phase 18).

## Vérifier puis publier
- `pnpm typecheck`, `pnpm --filter @linkaffipro/chat test`, `pnpm --filter web exec vitest run lib/personas`,
  `pnpm lint` : tout doit être vert.
- Publier : `bash scripts/railway-phase18-prod.sh deploy` (site puis worker, avec contrôle du typecheck), puis
  `bash scripts/railway-phase18-prod.sh up` (userbot, qui utilise le même moteur). Railway a eu des pannes : un build
  qui s'arrête sans erreur de code se relance 15 à 30 minutes plus tard, jamais en boucle.
- Contrôle : `https://app.linkaffipro.com/api/health` doit répondre `"status":"ok"`, et
  `bash scripts/railway-phase18-prod.sh diag` doit montrer `comptes connectes … connectes=1`.
- Commit (messages en français) et push de tout l'arbre de travail, pour remettre le CI GitHub au vert.

## Ensuite, avec l'utilisateur (dans le site)
Conversations → Personas → Léa : « Qui est-elle ? » = Une fille, Âge 23, recopier la personnalité, le ton et les
exemples de style des scripts locaux (sans les échanges explicites), Enregistrer. Pour un autre compte : créer une
nouvelle persona, puis la choisir sur ce compte dans Réglages → Comptes Telegram, et redémarrer le userbot
(`bash scripts/railway-phase18-prod.sh restart`) quand on ajoute ou active un compte.
