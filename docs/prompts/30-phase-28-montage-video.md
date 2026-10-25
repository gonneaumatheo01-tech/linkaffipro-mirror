# Phase 28 — Équipe Montage : découpe automatique de vidéos longues en shorts casino, prévisualisés par Kevin avant publication

Si `docs/STATUS.md` indique déjà « phase 28 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 27), `docs/DECISIONS-TECH.md`, `docs/AGENTS-ARCHITECTURE.md` (équipes, niveaux d'autonomie, bornes, missions reprenables), `docs/prompts/28-phase-26-boss-telegram.md` (Kevin : catalogue, interprète, mémoire, groupe, `BossUnmet`), `packages/agents/src/boss/*`, `packages/agents/src/agents/*`, le worker BullMQ (`apps/worker`), `packages/telegram/src/admin-bot.ts`, la médiathèque (`MediaAsset`, `MediaAssetKind`, `MediaUsage`, `MediaAssetTelegramFile`), `packages/core/src/crypto.ts`, et ffmpeg (`which ffmpeg`, vérifie les codecs disponibles). Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Ordres de Kevin (phase 33, déjà en place avant cette phase)
La phase 33 (`docs/prompts/35-phase-33-kevin-ordres-equipes.md`) a construit le registre des capacités (`packages/agents/src/orders/`) : toute demande libre de l'admin devient un `TeamOrder` planifié, récapitulé, confirmé si nécessaire, exécuté et suivi. **Cette équipe s'y branche** : déclare ses capacités dans le registre (`capabilities/<equipe>.ts` : description, schéma, limites, `check` avec raisons et replis, `plan`, `run` idempotent, `report`), de sorte que « Kevin, … » en français courant lui parvienne sans entrée de catalogue dédiée. Les entrées de catalogue listées plus bas restent des raccourcis instantanés. **Phase 34 (tout par Kevin)** : chaque action serveur ajoutée au site par cette phase doit aussi être faisable par Kevin (capacité dans `orders/capabilities/` + ligne dans `orders/site-parity.ts`), sinon `pnpm kevin:parity` et la CI échouent ; ajoute aussi les agents de cette équipe à `orders/agents-dict.ts` (nommables, capacité `voir` : ce qu'ils ont fait et vont faire). **Voix de Kevin** : tout texte que Kevin envoie pour cette équipe (réponses, récapitulatifs, alertes, rapports, bilan) suit `docs/KEVIN-VOIX.md` (phase 33 : tutoiement, phrases courtes, pas de formules d'IA, pas de jargon, variantes) et passe `voiceCheck` (test CI). `docs/STATUS.md` contient donc les phases 33 et 34 en plus des phases citées ci-dessus.

## Étapes
1. Schéma et queue : `MontageJob`, `ShortClip`, nouveaux `MediaAssetKind`, queue `agents-montage`.
2. Réception : Kevin reçoit une vidéo longue + instructions texte/voix, crée le `MontageJob`.
3. Découpe IA : analyse par frames (Claude Vision), plan de coupe, propositions.
4. Monteur : exécution ffmpeg (trim, PiP, redim, vitesse).
5. Habillage : sous-titres (speech-to-text + vérification + burn-in), texte, overlay.
6. QC Montage : vérification automatique + envoi preview à Kevin → client.
7. Site, tests, déploiement, documentation.

## But de la phase
Le client envoie une vidéo longue (30 min à 1 h, MP4 1080p) à Kevin par Telegram avec des instructions naturelles : « Kevin, découpe ça en shorts de 15 secondes, mets la cam en haut à droite, thème roulette » ou « fais des shorts pour TikTok avec sous-titres ». Kevin lance l'équipe de montage qui produit 10 à 15 shorts par vidéo (objectif : 30-40 shorts/semaine, 2-3 vidéos). Chaque short est envoyé en preview au client via Kevin **avant** toute publication. Le client valide (« ok », « ok sauf le 3 ») ou demande des modifications (« le 5, raccourcis de 2 secondes »). Rien n'est publié sans validation.

Le montage est **100 % ffmpeg côté serveur** (aucun outil externe, aucune API vidéo payante). Le casino est le premier marché ; l'architecture accepte d'autres verticales plus tard.

## Règles non négociables
1. **Zéro publication sans preview.** Chaque short est envoyé au client par Kevin (vidéo Telegram + miniature + métadonnées : durée, résolution, poids). Le client répond « ok » ou « modifie ». Un short non validé n'est jamais publié, jamais envoyé à un canal, jamais poussé vers une plateforme pub.
2. **Sous-titres sans erreur.** Le speech-to-text (Whisper via l'API déjà configurée, ou un provider dans `packages/ai`) produit une transcription. La transcription est **vérifiée par Claude** (texte comparé à l'audio, segment par segment, via le prompt « vérifie que chaque mot correspond à l'audio »). Si la confiance est < 95 % sur un segment, Kevin demande au client de relire ce passage. Le burn-in ne se fait qu'après validation. Jamais de sous-titre approximatif.
3. **Pas de perte de qualité.** Les shorts sont produits en 1080p minimum, codec H.264 (ou H.265 si la source l'est), audio AAC. ffmpeg utilise `-c:v libx264 -crf 18 -preset slow` (qualité haute) et jamais de ré-encodage en chaîne (un seul passage du source au short final). Le framerate source est conservé.
4. **Fichiers temporaires nettoyés.** Les frames extraites, fichiers intermédiaires et segments sont supprimés après production du short final. Seuls le `MediaAsset` source (LONG_VIDEO) et les shorts finaux (SHORT) restent. Un `MontageJob` terminé garde ses métadonnées mais pas les fichiers temporaires.
5. **Pas de contenu inventé.** Le montage ne génère pas de contenu (pas de fal.ai, pas de Magic Hour dans cette équipe). Il coupe, assemble, redimensionne et habille ce que le client a filmé. Les seuls ajouts sont les sous-titres (transcrits de l'audio réel) et les overlays texte demandés par le client.
6. **Missions reprenables.** Un `MontageJob` qui plante (OOM, timeout ffmpeg, crash worker) reprend à la dernière étape réussie (champ `currentStep`). Les shorts déjà produits ne sont pas recalculés.
7. **Taille Telegram.** Un short > 50 Mo est ré-encodé avec un CRF plus élevé avant envoi. Kevin indique au client que le fichier a été compressé et propose le fichier original par lien de téléchargement.
8. **Aucun appel réseau dans les tests.** Faux ffmpeg (commandes mockées, fixtures vidéo de 5 secondes), fausse IA (transcription et vision), faux Telegram (envoi de preview).

## Modèles IA par agent (allocation validée)
| Agent / Tâche | Modèle | API model string | Pourquoi |
|---|---|---|---|
| Kevin — parser les instructions vidéo (« cam en haut, 15 sec ») | **Haiku 5.5** | `claude-haiku-5-5` | Extraction de mots-clés, classification d'intention — pas besoin de raisonnement |
| Kevin — accusés de réception (« j'ai reçu ta vidéo ») | **Haiku 5.5** | `claude-haiku-5-5` | Messages templates avec variables |
| Réception — extraire métadonnées, créer le MontageJob | **Haiku 5.5** | `claude-haiku-5-5` | Parsing + création d'objet structuré |
| Découpe IA — analyse frames, plan de coupe | **Opus 5.5** | `claude-opus-5-5` | Vision + raisonnement sur 200+ frames, comprendre ce qui est « intéressant » |
| Monteur — commandes ffmpeg | _(pas d'IA)_ | — | 100 % ffmpeg, pas d'appel IA |
| Habillage — vérification sous-titres | **Opus 5.5** | `claude-opus-5-5` | Tâche critique zéro erreur : comparer SRT à l'audio segment par segment |
| QC Montage — vérifier durée/résolution/frames noires | **Haiku 5.5** | `claude-haiku-5-5` | Comparaison de chiffres ffprobe à des seuils |
| QC Montage — vérifier lisibilité sous-titres (Vision) | **Opus 5.5** | `claude-opus-5-5` | Vision sur frames avec sous-titres — besoin de précision |
| Kevin — envoi preview, gestion validations | **Haiku 5.5** | `claude-haiku-5-5` | Routage de réponses, mise à jour de statuts |

Configuration dans `packages/ai/` : chaque agent de montage utilise le profil correspondant. Le profil détermine le modèle, la température et le max tokens. Ne jamais fallback un appel Opus vers Haiku — mieux vaut échouer et signaler.

## 0. Diagnostic montage (`pnpm montage:diag`)
Script `packages/agents/scripts/montage-diag.ts` : vérifie ffmpeg (version, codecs h264/h265/aac, filtres drawtext/overlay/scale/pad/subtitles), espace disque tmp, queue `agents-montage` (taille, workers), dernier `MontageJob` (état, erreurs). Sortie : tableau en français, 0 ou 1.

## 1. Schéma (`packages/db/prisma/`)

### Nouveaux `MediaAssetKind`
Ajouter à l'enum : `LONG_VIDEO` (vidéo source longue envoyée par le client), `SHORT` (short produit par le montage).

### `MontageJob`
```
model MontageJob {
  id              String   @id @default(cuid())
  teamKey         String               // FK vers l'équipe
  sourceAssetId   String               // FK → MediaAsset (LONG_VIDEO)
  sourceAsset     MediaAsset @relation(...)
  instructions    Json                 // { theme, format, duration_target, pip_position, subtitles, overlay_text, raw_text }
  instructionsMsgId BigInt?            // message Telegram original (pour référence)
  status          MontageJobStatus     // PENDING → ANALYZING → CUTTING → DRESSING → QC → PREVIEW → DONE / FAILED
  currentStep     String?              // pour reprise
  error           String?
  shortCount      Int      @default(0) // nombre de shorts produits
  shorts          ShortClip[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  completedAt     DateTime?
}

enum MontageJobStatus {
  PENDING
  ANALYZING
  CUTTING
  DRESSING
  QC
  PREVIEW
  APPROVED
  DONE
  FAILED
}
```

### `ShortClip`
```
model ShortClip {
  id              String   @id @default(cuid())
  montageJobId    String
  montageJob      MontageJob @relation(...)
  assetId         String?              // FK → MediaAsset (SHORT) — null tant que pas produit
  asset           MediaAsset? @relation(...)
  index           Int                  // numéro du short dans le job (1, 2, 3...)
  startMs         Int                  // timestamp début dans la source (ms)
  endMs           Int                  // timestamp fin dans la source (ms)
  durationMs      Int                  // durée finale
  format          ShortFormat          // VERTICAL_9_16, HORIZONTAL_16_9, SQUARE_1_1
  pipPosition     PipPosition?         // TOP_RIGHT, TOP_LEFT, BOTTOM_RIGHT, BOTTOM_LEFT, NONE
  subtitles       Boolean  @default(false)
  subtitlesSrt    String?              // contenu SRT vérifié
  overlayText     String?              // texte overlay demandé
  status          ShortClipStatus      // PLANNED → CUTTING → DRESSING → QC → PREVIEW_SENT → APPROVED → REJECTED → REDO
  previewMsgId    BigInt?              // message Telegram de la preview envoyée au client
  clientFeedback  String?              // retour du client
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum ShortFormat {
  VERTICAL_9_16
  HORIZONTAL_16_9
  SQUARE_1_1
}

enum PipPosition {
  TOP_RIGHT
  TOP_LEFT
  BOTTOM_RIGHT
  BOTTOM_LEFT
  NONE
}

enum ShortClipStatus {
  PLANNED
  CUTTING
  DRESSING
  QC
  QC_FAILED
  PREVIEW_SENT
  APPROVED
  REJECTED
  REDO
}
```

### Settings montage
- `montage.default_format` : `VERTICAL_9_16` (défaut)
- `montage.default_duration` : `15` (secondes, défaut)
- `montage.max_shorts_per_job` : `20`
- `montage.subtitle_confidence_threshold` : `0.95`
- `montage.ffmpeg_crf` : `18`
- `montage.ffmpeg_preset` : `slow`

## 2. Queue et worker (`apps/worker/`)
- Nouvelle queue BullMQ : `agents-montage`, concurrency 1 (ffmpeg est lourd en CPU), timeout 10 minutes par short.
- Jobs : `montage.analyze` (Découpe IA), `montage.cut` (Monteur), `montage.dress` (Habillage), `montage.qc` (QC), `montage.preview` (envoi preview).
- Chaque job porte le `montageJobId` et le `shortClipId` (sauf analyze qui porte le job entier).
- Reprise : si un job échoue, il est retenté 2 fois avec backoff exponentiel. Après 3 échecs, le `MontageJob` passe en `FAILED` et Kevin prévient le client avec l'erreur.

## 3. Réception (`packages/agents/src/montage/reception.ts`)
- Nouvelle entrée dans le catalogue de Kevin : `montage_video` (le client envoie une vidéo + instructions).
- Phrases attendues : « Kevin, découpe ça », « fais des shorts », « monte cette vidéo », « 15 secondes, cam en haut ».
- Kevin reçoit la vidéo (grammY : `message.video` ou `message.document` avec mimetype video/*).
- Téléchargement de la vidéo via l'API Telegram Bot (`getFile`), stockage en `MediaAsset` (kind `LONG_VIDEO`).
- Parse des instructions du client (texte du message ou message suivant) par l'interprète du Boss (phase 26) :
  - `theme` : roulette, blackjack, slots, etc. (optionnel, défaut : détecté par l'IA)
  - `format` : vertical, horizontal, carré (défaut : `VERTICAL_9_16`)
  - `duration_target` : en secondes (défaut : 15)
  - `pip_position` : « cam en haut », « cam en bas à gauche » → enum (défaut : `NONE`)
  - `subtitles` : oui/non (défaut : oui)
  - `overlay_text` : texte libre à incruster (optionnel)
  - `count` : nombre de shorts souhaités (optionnel, défaut : l'IA décide)
- Création du `MontageJob` (status `PENDING`) et dispatch du job `montage.analyze`.
- Kevin confirme : « J'ai reçu ta vidéo (47 min, 1080p). Je l'analyse et je te propose un plan de coupe. »

## 4. Découpe IA (`packages/agents/src/montage/analyze.ts`)
- Extraction de frames : une frame toutes les 5 secondes via ffmpeg (`-vf fps=1/5`), stockées en tmp.
- Envoi des frames par lots de 20 à Claude Vision (**Opus 5.5** — `claude-opus-5-5`, voir tableau « Modèles IA par agent ») avec le prompt :
  ```
  Tu es un monteur vidéo expert en contenu casino/gambling pour les réseaux sociaux.
  Voici {n} frames extraites d'une vidéo de {duration} minutes, espacées de 5 secondes.
  Frame 1 = 0:00, Frame 2 = 0:05, etc.
  
  Instructions du client : {instructions}
  
  Identifie les moments les plus intéressants pour des shorts de {duration_target} secondes.
  Pour chaque short proposé, donne :
  - start_seconds, end_seconds (précis à la seconde)
  - description courte (ce qui se passe)
  - score d'intérêt (1-10)
  - pourquoi c'est un bon moment (action, réaction, gain, suspense)
  
  Propose {count} shorts, classés par score décroissant.
  Évite les passages calmes, les pauses, les moments de chargement.
  ```
- Résultat : liste de `ShortClip` (status `PLANNED`) avec timestamps.
- Kevin envoie le plan au client : « J'ai trouvé {n} moments intéressants. Voici le plan : \n1. 2:30-2:45 — Gros gain à la roulette (⭐ 9/10)\n2. 5:10-5:25 — Série de mises (⭐ 8/10)\n... \nJe lance le montage ? Tu veux modifier quelque chose ? »
- Le client répond « ok », « ok lance », « enlève le 3 », « le 2, commence 2 secondes plus tôt » → Kevin ajuste les `ShortClip` et lance `montage.cut` pour chacun.

## 5. Monteur (`packages/agents/src/montage/cut.ts`)
Fonctions ffmpeg pures, testées unitairement, chacune produit un fichier et retourne son chemin :

### `trimSegment(source, startMs, endMs, output)`
```bash
ffmpeg -ss {startMs/1000} -to {endMs/1000} -i {source} -c:v libx264 -crf {crf} -preset {preset} -c:a aac -b:a 128k -movflags +faststart {output}
```
Utilise `-ss` avant `-i` pour un seek rapide (keyframe-accurate avec `-avoid_negative_ts make_zero`).

### `applyPip(main, pip_position, output)`
Si `pip_position != NONE` : overlay picture-in-picture. Le client a filmé avec une webcam en overlay — ffmpeg crop + position :
```bash
ffmpeg -i {main} -filter_complex "[0:v]split[bg][fg];[fg]crop=iw/4:ih/4:3*iw/4:0[cam];[bg][cam]overlay={x}:{y}" {output}
```
Positions : `TOP_RIGHT` → `overlay=W-w-10:10`, `TOP_LEFT` → `overlay=10:10`, etc.

### `reformatVideo(source, format, output)`
- `VERTICAL_9_16` : `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`
- `HORIZONTAL_16_9` : `scale=1920:1080:...`
- `SQUARE_1_1` : `scale=1080:1080:...`

### `adjustSpeed(source, factor, output)`
Si le client demande un changement de vitesse :
```bash
ffmpeg -i {source} -filter_complex "[0:v]setpts={1/factor}*PTS[v];[0:a]atempo={factor}[a]" -map "[v]" -map "[a]" {output}
```

Le Monteur enchaîne : trim → pip → reformat → speed (si demandé) → un seul ré-encodage final (pas de chaîne de ré-encodages : utiliser `-filter_complex` pour tout combiner en un seul passage).

## 6. Habillage (`packages/agents/src/montage/dress.ts`)

### Sous-titres (le plus critique — zéro erreur)
1. **Extraction audio** : `ffmpeg -i {short} -vn -acodec pcm_s16le -ar 16000 {wav}`
2. **Speech-to-text** : provider dans `packages/ai` (Whisper API ou équivalent configuré). Résultat : SRT avec timestamps et scores de confiance par segment.
3. **Vérification** : **Opus 5.5** (`claude-opus-5-5`) reçoit l'audio (ou sa transcription phonétique) + le SRT et vérifie segment par segment. Prompt :
   ```
   Voici une transcription SRT avec timestamps. Vérifie chaque segment :
   - Le texte correspond-il exactement à ce qui est dit ?
   - Les timestamps sont-ils corrects (le texte apparaît quand il est prononcé) ?
   - Y a-t-il des mots manquants ou en trop ?
   Corrige les erreurs. Si un segment a une confiance < 95%, marque-le [INCERTAIN].
   ```
4. **Si segments incertains** : Kevin envoie au client : « J'ai un doute sur le sous-titre à 0:08 : "martingale" ou "martindale" ? Écoute et dis-moi. » → Le client corrige → SRT mis à jour.
5. **Burn-in** : `ffmpeg -i {short} -vf "subtitles={srt}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=30'" {output}`
   - Style configurable par Setting (`montage.subtitle_style`).

### Overlay texte
Si `overlay_text` fourni :
```bash
ffmpeg -i {short} -vf "drawtext=text='{text}':fontfile=/path/font.ttf:fontsize=36:fontcolor=white:borderw=2:bordercolor=black:x=(w-tw)/2:y=h-th-50" {output}
```

### Tout en un seul passage ffmpeg
Combiner sous-titres + overlay + reformat en un seul `-filter_complex` pour éviter le ré-encodage multiple.

## 7. QC Montage (`packages/agents/src/montage/qc.ts`)
Vérifications automatiques (toutes par ffprobe + Claude Vision) :
- **Durée** : dans la tolérance (±2 secondes du `duration_target`). Hors tolérance → `QC_FAILED`, Kevin prévient.
- **Résolution** : ≥ 1080p dans la dimension principale. Sous le seuil → `QC_FAILED`.
- **Frames noires** : détection via `ffmpeg -vf blackdetect`. Plus de 0,5 seconde de noir → `QC_FAILED`.
- **Audio** : pas de silence total (loudness via `ffmpeg -af loudnorm`), pas de clipping.
- **Sous-titres** : si activés, vérifier qu'ils sont lisibles (**Opus 5.5** Vision sur 3 frames avec sous-titres visibles).
- **Taille fichier** : si > 50 Mo, ré-encoder avec CRF+4 et prévenir.

Si tout passe → status `PREVIEW_SENT`, envoi au client via Kevin.

## 8. Preview et validation (`packages/agents/src/montage/preview.ts`)
- Kevin envoie chaque short au client en message Telegram (vidéo + caption) :
  ```
  Short {index}/{total} — {duration}s — {format}
  {description}
  
  ✅ Valider  |  ✏️ Modifier  |  ❌ Refuser
  ```
- Boutons inline (callback_data : `short_approve:{clipId}`, `short_modify:{clipId}`, `short_reject:{clipId}`).
- `✅ Valider` → status `APPROVED`, le short est prêt (pas de publication automatique — le client décide où le poster).
- `✏️ Modifier` → Kevin demande quoi changer → client répond → `ShortClip` mis à jour → re-dispatch `montage.cut` (status `REDO`).
- `❌ Refuser` → status `REJECTED`, le short est archivé.
- Kevin : « {approved}/{total} shorts validés. Tu veux que je les envoie quelque part ? (canal, dossier, ou je les garde ici) »
- Le client peut dire « envoie les 10 validés dans le canal Roulette » → Kevin poste via l'équipe existante, ou « garde-les, je les prendrai » → shorts disponibles dans la médiathèque (kind `SHORT`).

## 9. Catalogue Kevin (ajouts au Boss, phase 26)
Nouvelles entrées dans le catalogue :
- `montage_video` : « Kevin, découpe/monte cette vidéo » + vidéo jointe + instructions
- `voir_montage` : « Kevin, montre-moi les shorts / le montage en cours / le job 3 »
- `modifier_short` : « Kevin, le short 5 raccourcis de 2 secondes / ajoute un texte / change la cam »
- `annuler_montage` : « Kevin, annule le montage en cours »
- `montage_status` : « Kevin, où en est le montage ? »

Phrases naturelles reconnues par l'interprète : « découpe ça », « fais des shorts », « monte cette vidéo », « fais-moi 10 clips de 15 secondes », « cam en haut à droite », « mets des sous-titres », « vertical pour TikTok », « c'est quoi le format ? ».

## 10. Site — Page Agents → Montage (`apps/web/`)
- **Liste des `MontageJob`** : source (miniature), statut, nombre de shorts, date.
- **Détail d'un job** : vidéo source (player), plan de coupe (timeline visuelle), shorts produits (miniatures, statut, feedback client).
- **Shorts** : lecture en ligne, statut (validé/refusé/en attente), boutons Valider/Modifier/Refuser (mêmes actions que Telegram).
- **Médiathèque** : filtre `kind = SHORT`, tag par thème.

## Tests et livraison
- **Fixtures** : 3 vidéos de test (5 secondes chacune, fabriquées par ffmpeg : `ffmpeg -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:duration=5 -c:v libx264 -c:a aac fixture_casino.mp4`). Une avec parole simulée (pour tester les sous-titres).
- **Unitaires** : chaque fonction ffmpeg (trim, pip, reformat, speed, subtitles, overlay, qc checks) sur les fixtures. Vérification que le output a la bonne durée, résolution, codec. Vérification du contrôle qualité (frame noire insérée → détectée, audio silence → détecté).
- **Intégration** : « Kevin, découpe ça en shorts de 15 secondes, cam en haut, sous-titres » sur une fixture → `MontageJob` créé → analyse → plan de coupe → « lance » → shorts produits → QC → preview envoyée → « ok » → status APPROVED ; modification → « le 2, 10 secondes au lieu de 15 » → short re-coupé ; refus → archivé ; annulation → job annulé.
- **Relecture adverse** : perte de qualité (ré-encodages multiples), sous-titres erronés, publication sans preview, fichiers temp non nettoyés, crash mi-job (reprise), short > 50 Mo, vidéo source corrompue (erreur propre, pas de crash).
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; déploiement ; santé ; `docs/STATUS.md`, `docs/GUIDE-UTILISATEUR.md` (section « Montage vidéo » : comment envoyer une vidéo à Kevin, les instructions possibles, le workflow de validation), `docs/DECISIONS-TECH.md`, `docs/DATA-MODEL.md`, `docs/AGENTS-ARCHITECTURE.md` (nouvelle équipe Montage), ligne « Phase 28 » dans `CLAUDE.md`, `docs/prompts/README.md`.
- **Bilan Telegram** par Kevin (5 lignes) : fait, comment envoyer une vidéo, exemples d'instructions, le workflow de preview. Puis crée `docs/PHASE-DONE` et arrête-toi : la file d'attente `docs/prompts/QUEUE`, lue par `scripts/run-phase.sh`, lance la phase suivante (`docs/prompts/31-phase-29-analystes-marche.md`) toute seule.

## Fini quand
- Le client envoie une vidéo longue à Kevin avec des instructions en langage naturel ; Kevin lance le montage ; l'IA analyse et propose un plan de coupe ; le client valide le plan ; les shorts sont produits en un seul passage ffmpeg (qualité 1080p, pas de ré-encodage en chaîne) ; les sous-titres sont transcrits, vérifiés par Claude (zéro erreur), et brûlés ; le QC passe (durée, résolution, frames noires, audio) ; chaque short est envoyé en preview au client via Kevin ; le client valide, modifie ou refuse chaque short ; les shorts validés sont stockés dans la médiathèque ; la page Montage est en ligne ; tests, relecture, déploiement, documentation et bilan faits.
