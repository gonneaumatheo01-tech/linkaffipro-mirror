# Phase 20 — Agents IA : équipe Dating (Média IA, médiathèque par persona, chaîne complète)

Si `docs/STATUS.md` indique déjà « phase 20 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phase 19), `docs/DECISIONS-TECH.md`, **`docs/AGENTS-ARCHITECTURE.md`** (sections « Chef Dating », « Les agents », « Outils et APIs externes », « Ce que tu devras fournir », « Risques et parades »), puis `packages/agents` tel que la phase 19 l'a laissé, les modèles `Persona` (phases 17-18 : `identityKind`, `styleExamples`, photo), `MediaAsset`, `Post`, et `apps/userbot` (comptes réels : rien à y changer). Décisions courantes : prends-les, note-les dans `docs/DECISIONS-TECH.md`, continue (99 % d'autonomie). Livre par étapes testables, un commit par étape.

## Étapes
1. Fournisseurs de médias : interfaces `video` et `image`, faux fournisseur, fal.ai (Wan 2.2 Animate « replace », Flux + LoRA), Magic Hour (repli) ; coûts ; clés dans Réglages → Agents.
2. Fiche persona enrichie (images de référence, adresse du LoRA et mot déclencheur, mélange photo / vidéo / texte par canal) ; médiathèque par persona (vidéos sources).
3. Agent Média IA (vidéo et photo, mode simulation, tâche asynchrone, coût, repli) ; Contrôle qualité enrichi (regard sur 3 images de la vidéo).
4. Chaîne complète du Chef Dating : Médiathèque → Média IA → Rédaction → Planification → Contrôle → Publication ; règles « toujours validé ».
5. Banc d'essai (`pnpm agents:bench-video`), tests, déploiement, STATUS, bilan Telegram avec la liste de ce que le client doit fournir, puis phase suivante.

## But de la phase
Première équipe de production complète. Elle fabrique pour chaque persona des posts **vidéo** (vidéo source dans laquelle la personne entière est remplacée par le personnage de la persona), **photo** (photos neuves du personnage générées avec son LoRA) et **texte**, dans le style de la persona, aux bons créneaux, avec contrôle qualité, validation selon le niveau, et budget plafonné. Tant que le client n'a pas collé de clé, tout tourne en simulation (faux fournisseur : la vidéo source est renvoyée telle quelle, marquée « simulation », la photo est la photo de la persona).

## Règles non négociables
1. **Toujours validés par le client, quel que soit le niveau** : une nouvelle persona (ses 3 premières vidéos et ses 3 premières photos), un nouveau canal, et toute vidéo pour laquelle le Contrôle qualité a un doute.
2. **Budget** : plafond mensuel vidéo (`AgentTeamConfig.monthlyBudgetCents.video`, 100 € = 10 000 centimes par défaut) et photo (15 € par défaut) ; coût estimé **avant** l'appel (durée × images par seconde ÷ 16 × tarif pour fal) et coût réel après ; au-delà, le Chef bascule sur des posts photo puis texte pour tenir le quota, sans dépasser.
3. **Rien ne part vers un vrai canal** tant que la simulation de l'équipe Dating est active ; les personas et comptes réels des phases 17-18 ne sont pas touchés (l'agent Conversation Dating = ce qui existe, affiché dans la fiche d'équipe avec un lien vers la rubrique Conversations, sans nouveau développement).
4. **Jamais de mention d'IA, jamais d'image présentée comme autre chose que ce que la fiche persona permet** ; légendes très courtes, style Telegram humain, dans le style de la persona (`styleExamples`), sans répéter les 30 derniers posts du canal.
5. **Aucune clé dans le code, git ou un message envoyé.** Clés fal.ai et Magic Hour chiffrées dans `Setting` `agents.providers`, jamais renvoyées au navigateur ni par Telegram. **Le bot les demande au client par Telegram** (mécanisme `HumanRequest` de la phase 19 : question, réponse au message, message supprimé aussitôt, vérification immédiate par un appel gratuit ou le moins cher possible) ; le site (ADMIN) reste possible en secours, avec le même bouton « Vérifier ».
6. **Aucun appel réseau dans les tests** : fournisseurs faux et réponses HTTP enregistrées (fixtures) pour les clients fal et Magic Hour.

## Fournisseurs (plan, section « Remplacement du personnage dans les vidéos »)
- Interface `packages/agents/src/providers/video.ts` : `startReplace({ sourceVideo, referenceImage, resolution, prompt? })` → `{ jobId, estimatedCents }` ; `poll(jobId)` → `{ status: "queued" | "running" | "done" | "failed", outputUrl?, actualCents?, error? }`. Interface `image.ts` : `generate({ loraUrl, triggerWord, prompt, count, aspect })` → `{ images: { url }[], cents }`.
- **fal.ai** (`@fal-ai/client` ou `fetch` direct, à toi de choisir ; clé `FAL_KEY` côté serveur seulement) :
  - vidéo : modèle `fal-ai/wan/v2.2-14b/animate/replace` (entrées : `video_url`, `image_url`, `prompt` facultatif, résolution ; fonctionnement en file d'attente asynchrone : soumission, puis état, puis résultat ; tarif constaté le 23 octobre : 0,08 $ par seconde facturée en 720p, 0,06 $ en 580p, 0,04 $ en 480p, facturé sur 16 images par seconde). **Vérifie dans la documentation officielle de fal** (docs.fal.ai et la page du modèle) les noms exacts des paramètres, la résolution par défaut, la durée maximale et le format de la réponse, et note ce qui est confirmé dans `docs/DECISIONS-TECH.md`. Les fichiers d'entrée doivent être accessibles par une adresse : utilise le stockage de fal (envoi des octets de `MediaAsset`, adresse temporaire), jamais une adresse de notre site.
  - photo : modèle Flux avec LoRA (`fal-ai/flux-lora` ou l'équivalent courant, à vérifier dans la documentation) : `loras: [{ path: <adresse du fichier LoRA>, scale }]`, prompt qui contient le mot déclencheur de la persona ; 1 à 4 images par appel ; coût relevé.
  - Résolution vidéo par défaut 580p (bon compromis prix / qualité, réglable 480 / 580 / 720 par équipe).
- **Magic Hour** (repli, visage seulement) : API REST asynchrone « face swap video » ; vérifie la documentation (docs.magichour.ai) pour les noms exacts ; utilisé seulement si fal échoue deux fois ou si le client choisit ce fournisseur dans les réglages.
- **Faux fournisseur** (`providers/fake.ts`) : utilisé en tests et en simulation sans clé ; renvoie la vidéo source (ou une vidéo de test de `docs/`), coût 0, délai simulé configurable.
- Attente asynchrone : l'étape `media-ia` soumet le travail, enregistre `jobId` dans la mission, puis **se ré-enfile avec un délai** (30 s, puis 60 s, 15 minutes au maximum) jusqu'au résultat (pas de webhook public : décision à noter, plus simple et robuste). Résultat téléchargé → nouveau `MediaAsset` (kind GENERATED, origin AI, persona, vidéo source liée) → `AgentUsage` mis à jour → étape suivante.
- Adresse du fichier LoRA : champ « adresse du fichier LoRA » dans la fiche persona (le client la colle) + commande `pnpm agents:upload-lora <fichier.safetensors> --persona <id>` qui envoie un fichier local sur le stockage fal et écrit l'adresse dans la persona (pour un client qui n'a que le fichier). Mot déclencheur : champ texte.

## Fiche persona et médiathèque Dating
- `Persona` : `referenceImageIds` (JSON : 1 à 3 `MediaAsset`, le premier sert au remplacement vidéo), `loraUrl`, `loraTrigger`, `loraScale` (défaut 0,8), `mediaNotes` (texte libre : tenue, ambiance à éviter…). Formulaire Conversations → Personas : nouvelle section « Médias du personnage » (dépôt d'images, adresse LoRA, mot déclencheur) ; le reste de la fiche ne change pas.
- `ChannelAgentPlan.mix` par canal Dating (défaut `{ video: 1, photo: 2, text: 1 }` par jour, modifiable), `personaId` obligatoire pour un canal Dating.
- Médiathèque : vidéos sources rangées par persona (`#dating #source #<prénom>` envoyé au bot, ou dépôt dans la fiche d'équipe), jamais réutilisées sur le même canal avant 30 jours, alerte « moins de 3 vidéos sources non utilisées » (demande groupée au client par Telegram, une fois par jour au plus). Les vidéos générées sont rangées aussi (réutilisables plus tard sur un autre canal de la même persona).

## Agents et chaîne du Chef Dating
- `chiefs/dating.ts` : pour chaque mission POST, selon le type tiré du mélange du jour : VIDEO → Médiathèque (source) → Média IA (remplacement) → Rédaction → Planification → Contrôle → Publication ; PHOTO → Média IA (génération) → Rédaction → … ; TEXT → Rédaction → … Repli : source manquante ou budget atteint → PHOTO ; échec photo → TEXT ; le repli est journalisé et compté dans le rapport.
- **Contrôle qualité** enrichi : pour une vidéo générée, extraire 3 images (début, milieu, fin ; `ffmpeg` dans l'image Docker du worker, comme le userbot l'a déjà pour l'audio) et les soumettre au modèle rapide avec une question fermée (« défaut visible : mains, visage, membres, texte déformé ? » → oui / non / doute, JSON strict) ; doute ou oui → validation humaine avec les 3 images jointes. Pour une photo : même contrôle sur l'image. Ne jamais publier une vidéo dont le contrôle a échoué techniquement (fichier illisible, durée hors bornes).
- **Rédaction** : prompt de persona (phase 19) + `styleExamples`, `mediaNotes`, type de média, et la consigne « légende très courte sous la vidéo/photo ».
- **Planification** : espace les vidéos (jamais deux vidéos à moins de 6 h sur un canal), respecte les fenêtres et les meilleurs horaires.
- Fiche d'équipe Dating (`/agents/dating`) : par persona, stock de vidéos sources non utilisées, vidéos et photos produites ce mois, dépense vidéo / photo et plafonds, dernières productions avec aperçu, bouton « Produire un post de test » (en simulation, vers le canal Test), bouton « Banc d'essai » (voir ci-dessous).

## Ce que le bot demande au client à la fin de la phase (file `HumanRequest`, une question à la fois)
1. SECRET `providers.fal.apiKey` : « Crée un compte sur fal.ai, mets quelques dollars de crédit, crée une clé (lien exact), puis réponds à ce message avec la clé » → chiffrée, message supprimé, vérification immédiate (appel le moins cher), « OK » ou « KO, réessaie ».
2. Pour chaque persona active de l'univers Dating : TEXT `persona.<id>.loraUrl` (« réponds avec l'adresse du fichier LoRA de <prénom>, ou "plus tard" ») puis TEXT `persona.<id>.loraTrigger` (mot déclencheur) ; MEDIA « envoie 1 à 3 photos de <prénom> avec #dating #reference #<prénom> » ; MEDIA « envoie 5 à 10 vidéos sources avec #dating #source #<prénom> ».
3. CHOICE « Plafond vidéo par mois : 1) 50 € 2) 100 € 3) 200 € ou un chiffre » (défaut 100 € si « plus tard »).
4. CONFIRM « Tout est là : je lance le banc d'essai (3 vidéos, environ X €) ? Réponds oui ou non ».

## Banc d'essai
- Commande `pnpm agents:bench-video --persona <id> [--count 3]` (aussi un bouton dans la fiche d'équipe et la demande CONFIRM ci-dessus) : prend les 3 vidéos sources les moins récentes de la persona, lance le remplacement chez chaque fournisseur disponible (fal 580p, fal 720p, Magic Hour si clé), envoie à l'admin par Telegram chaque résultat avec son coût et sa durée de traitement, puis une demande CHOICE « lequel préfères-tu ? Réponds 1, 2 ou 3 » ; la réponse règle le fournisseur et la résolution par défaut de l'équipe. Ne lance rien sans clé (message clair).

## Données
- `Persona` : colonnes ci-dessus (migration additive). `MediaAsset` ou `AgentMediaTag` : `personaId`, `sourceAssetId` (vidéo d'origine d'une vidéo générée), `providerJobId`, `providerName`, `resolution`. `AgentUsage` déjà en place. `docs/DATA-MODEL.md` à jour.

## Tests et livraison
- **Unitaires** : estimation du coût fal (durée, images par seconde, résolution) ; mélange du jour et replis ; médiathèque par persona (jamais deux fois en 30 jours, alerte sous 3) ; attente asynchrone (ré-enfilement, délai maximal, échec propre) ; règles « toujours validé » ; Contrôle qualité vidéo avec faux modèle ; clients fal et Magic Hour sur réponses enregistrées (soumission, état, résultat, erreur 4xx / 5xx, 429) ; chiffrement des clés et « Vérifier ».
- **Intégration sur base réelle** : trois missions (vidéo, photo, texte) pour une persona de test sur le canal Test, en simulation, avec le faux fournisseur : médias rangés, posts programmés et envoyés, coûts à 0, validation des « 3 premières vidéos » déclenchée puis acceptée par le callback.
- Tests de garde verts ; `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; sauvegarde ; déploiement (site puis worker ; image du worker avec `ffmpeg`) ; santé ; captures.
- `docs/STATUS.md`, `docs/A-FAIRE-HUMAIN.md` (section phase 20 : « le bot te pose les questions une par une sur Telegram : clé fal.ai, LoRA et photos de référence, vidéos sources, plafond, banc d'essai ; réponds à chaque message ; en secours, tout se fait aussi dans Réglages → Agents et dans la fiche persona » ; puis « quand les essais plaisent, réponds "vrai dating" puis OUI au bot, ou désactive la simulation dans le site, puis monte le niveau »), `docs/GUIDE-UTILISATEUR.md`, `docs/DECISIONS-TECH.md`, ligne « Phase 20 » dans `CLAUDE.md`, commit, push.
- **Bilan Telegram** (5 lignes maximum) : ce qui est fait, le test de 5 minutes (bouton « Produire un post de test » en simulation), et « je vais te demander ce qu'il me faut, une question à la fois ». Puis la file des demandes ci-dessus démarre (première question envoyée tout de suite ; les suivantes partent au fil des réponses, sans que tu attendes).
- Puis crée `docs/PHASE-DONE` (date + « Phase 20 (agents IA : équipe Dating) terminée, testée et déployée ») et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante (`docs/prompts/23-phase-21-agents-algorithme.md`) toute seule. **Ne l'enchaîne pas toi-même.**

## Fini quand
- Posts vidéo, photo et texte produits et envoyés sur le canal Test en simulation ; budget plafonné et replis testés ; clés chiffrées avec « Vérifier » ; banc d'essai prêt ; guide et STATUS à jour ; déploiement vérifié ; bilan envoyé.
