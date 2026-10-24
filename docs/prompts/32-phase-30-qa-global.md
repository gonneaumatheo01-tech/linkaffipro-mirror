# Phase 30 — Agent QA Global : vérification finale de tout ce qui sort du système, propulsé par le modèle le plus capable (Fable 5)

Si `docs/STATUS.md` indique déjà « phase 30 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phases 19 à 29), `docs/DECISIONS-TECH.md`, `docs/AGENTS-ARCHITECTURE.md` (toutes les équipes : Dating, Casino, Sports, Algorithme, Ads, Montage, Analystes), `docs/prompts/28-phase-26-boss-telegram.md` (Kevin), `packages/agents/src/boss/*`, `packages/agents/src/agents/*` (tous les agents existants, notamment Contrôle qualité de l'Algorithme, QC Montage, Supervision), `packages/agents/src/montage/*` (phase 28), `packages/agents/src/analysts/*` (phase 29), `packages/ai/` (providers, modèles disponibles), les règles par canal (`packages/agents/src/rules/*`), la config des modèles IA. Décisions courantes : prends-les, note-les, continue. Livre par étapes, un commit par étape.

## Étapes
1. Configuration du modèle Fable 5 dans le provider IA, dédié au QA.
2. Schéma : `QaCheck`, `QaVerdict`, historique, métriques.
3. Agent QA Global : intercepte tout output avant sortie, vérifie, approuve ou bloque.
4. Intégration avec chaque équipe (posts, shorts, rapports, réponses Kevin, recommandations).
5. Dashboard QA, tests, déploiement, documentation.

## But de la phase
Rien ne sort du système sans passer par l'agent QA Global. Ce n'est pas un contrôle qualité par équipe (ceux-là existent déjà et continuent de tourner) — c'est le **dernier verrou**, celui qui voit tout, qui croise les informations entre équipes, et qui a le droit de bloquer n'importe quelle sortie s'il détecte un problème. Il tourne sur **Claude Fable 5** (`claude-fable-5-1`), le modèle le plus capable, pour garantir zéro erreur.

L'agent QA Global vérifie :
- Que les **posts** (dating, casino, paris) respectent les règles du canal ET les règles de compliance détectées par les Analystes
- Que les **shorts** (Montage) n'ont pas de sous-titres erronés, de frames noires, de contenu qui violerait une règle
- Que les **rapports** (Analystes) ne contiennent pas de chiffres inventés, de sources mortes, d'affirmations non sourcées
- Que les **réponses de Kevin** au client sont correctes, complètes, et ne contiennent pas d'hallucinations
- Que les **recommandations** (Algorithme, Inspiration, Analystes) sont cohérentes entre elles et avec les règles de compliance
- Que les **alertes** envoyées au client sont justifiées et pas des faux positifs
- Qu'aucun contenu **copié** ne sort (contrôle de copie croisé entre toutes les sources de référence)
- Qu'aucune **donnée sensible** ne fuit (tokens, clés, identifiants internes, données personnelles de forum)

## Règles non négociables
1. **Fable 5 uniquement.** L'agent QA Global utilise exclusivement `claude-fable-5-1` pour toutes ses vérifications. Aucun fallback sur un modèle moins capable. Si Fable 5 est indisponible (quota, erreur API), la sortie est **bloquée** jusqu'à ce qu'il revienne — jamais approuvée par défaut. Kevin prévient le client : « Le contrôle qualité est en pause, je reprends dès que possible. »
2. **Dernier verrou, pas doublon.** L'agent QA Global ne remplace pas les contrôles par équipe (Contrôle qualité Algorithme, QC Montage, vérification de sources Analystes). Il passe **après** eux. Un contenu qui arrive au QA Global a déjà passé le contrôle de son équipe. Le QA Global vérifie ce que les contrôles locaux ne voient pas : la cohérence inter-équipes, les contradictions, les fuites de données, les hallucinations.
3. **Blocage = blocage.** Si le QA Global refuse un contenu, il est bloqué. Pas de contournement, pas de « on publie quand même ». Le contenu retourne à l'équipe concernée avec le motif du refus et les corrections demandées. L'équipe corrige et resoumet. Après 3 refus du même contenu, Kevin demande au client de trancher.
4. **Pas de latence excessive.** Le QA Global a un budget de 30 secondes par vérification (un post, un short, une réponse). Au-delà, c'est un timeout — le contenu est marqué `QA_TIMEOUT` et Kevin est prévenu. Les vérifications lourdes (rapport hebdo complet, lot de 10+ shorts) sont découpées en sous-vérifications parallèles.
5. **Traçabilité complète.** Chaque vérification produit un `QaCheck` avec le verdict, le motif, le temps pris, le modèle utilisé, et le contenu vérifié. Historique consultable sur le site et par Kevin (« Kevin, combien de refus cette semaine ? »).
6. **Pas de modification.** Le QA Global ne modifie jamais le contenu. Il approuve ou refuse avec un motif. C'est l'équipe qui corrige.
7. **Aucun appel réseau dans les tests.** Fausse IA (réponses QA simulées), faux contenus à vérifier, fixtures.

## Modèle IA (allocation validée)
| Agent / Tâche | Modèle | API model string | Pourquoi |
|---|---|---|---|
| QA Global — toutes les vérifications | **Fable 5.1** | `claude-fable-5-1` | Dernier verrou — doit être infaillible, vérifie ce qu'Opus et Sonnet ont produit |

**Aucun fallback.** Si Fable 5 est indisponible, tout est bloqué. C'est voulu.

## 0. Configuration Fable 5 (`packages/ai/`)

### Provider QA
Dans le fichier de configuration des modèles IA (`packages/ai/src/providers/` ou équivalent) :
- Nouveau provider ou nouveau profil : `qa-global`
- Modèle : `claude-fable-5-1` (Anthropic API)
- Pas de fallback. Si le modèle est indisponible → erreur `QA_MODEL_UNAVAILABLE`, pas de dégradation.
- Temperature : 0 (déterministe — on veut de la rigueur, pas de créativité)
- Max tokens : 2000 (le QA produit un verdict court, pas un essai)
- System prompt dédié (voir section 2)

### Vérification au démarrage
`pnpm qa:diag` : script qui vérifie que la clé API a accès à `claude-fable-5-1`, fait un appel test, mesure la latence, vérifie le quota restant. Sortie : tableau en français, 0 ou 1.

## 1. Schéma (`packages/db/prisma/`)

### `QaCheck`
```
model QaCheck {
  id              String   @id @default(cuid())
  contentType     QaContentType        // POST, SHORT, REPORT, KEVIN_RESPONSE, RECOMMENDATION, ALERT
  contentId       String               // ID du contenu vérifié (postId, shortClipId, strategyReportId, etc.)
  teamKey         String               // équipe d'origine
  verdict         QaVerdict            // APPROVED, REJECTED, TIMEOUT, ERROR
  reasons         Json                 // [{ code, message, severity }] — vide si APPROVED
  corrections     Json?                // [{ field, expected, got, suggestion }] — si REJECTED
  modelUsed       String               // "claude-fable-5-1"
  durationMs      Int                  // temps de vérification
  attempt         Int      @default(1) // numéro de tentative (1, 2, 3)
  checkedBy       String   @default("qa-global") // agent
  createdAt       DateTime @default(now())
}

enum QaContentType {
  POST
  SHORT
  REPORT
  KEVIN_RESPONSE
  RECOMMENDATION
  ALERT
  COMPLIANCE_RULE
}

enum QaVerdict {
  APPROVED
  REJECTED
  TIMEOUT
  ERROR
}
```

### Settings QA
- `qa.enabled` : `true`
- `qa.model` : `claude-fable-5-1`
- `qa.timeout_ms` : `30000`
- `qa.max_attempts` : `3`
- `qa.block_on_unavailable` : `true` (bloquer si Fable 5 indisponible)

## 2. Agent QA Global (`packages/agents/src/qa/`)

### `qa-global.ts` — Point d'entrée
Fonction `qaCheck(contentType, contentId, content, context)` → `QaVerdict`

Le QA Global est appelé **par chaque équipe** juste avant la sortie finale (publication, envoi, réponse). Il n'est pas dans une queue séparée — il est synchrone (await) dans le pipeline de chaque équipe, avec un timeout de 30 secondes.

### System prompt du QA (`qa-system-prompt.ts`)
```
Tu es l'agent QA Global. Tu vérifies tout contenu avant qu'il sorte du système.
Tu utilises Claude Fable 5, le modèle le plus capable. Ton standard est : zéro erreur.

Tu reçois :
- Le type de contenu (post, short, rapport, réponse Kevin, recommandation, alerte)
- Le contenu à vérifier
- Le contexte : règles du canal, règles de compliance actives, dernières recommandations, historique récent

Tu vérifies selon le type :

POST :
- Respecte les règles du canal (mots interdits, aucune mention d'IA, aucune promesse de gain, aucun lien hors plateforme, casino : jamais de média non fourni)
- Respecte les règles de compliance actives pour le pays et la plateforme cible
- Pas de copie (aucun segment de 8+ mots consécutifs provenant d'une source de référence)
- Pas de données sensibles (tokens, clés, identifiants, noms réels)
- Cohérent avec les posts précédents du canal (pas de contradiction)
- Français correct, ton adapté au canal

SHORT (vidéo) :
- Métadonnées cohérentes (durée, résolution, format)
- Sous-titres SRT fournis : vérifie la grammaire, la ponctuation, la cohérence
- Pas de contenu qui violerait les règles de compliance (texte overlay, sous-titres)
- Pas de données sensibles dans les sous-titres ou overlays

REPORT (rapport d'analyse) :
- Chaque affirmation a une source (URL, date)
- Les chiffres sont cohérents entre eux (pas de pourcentages qui dépassent 100, pas de contradiction)
- Pas de conseil juridique (seulement observations de plateforme)
- Résumé fidèle au contenu détaillé
- Sources accessibles (URL pas manifestement cassées)

KEVIN_RESPONSE (réponse de Kevin au client) :
- Répond à la question posée (pas de hors-sujet)
- Les chiffres cités correspondent aux données (si des données sont en contexte)
- Pas d'hallucination (n'invente pas de fonctionnalité, de résultat, de source)
- Ton adapté (ni trop formel, ni trop familier)
- Si c'est une question technique : la réponse est techniquement correcte

RECOMMENDATION :
- Cohérente avec les règles de compliance actives
- Cohérente avec les recommandations précédentes (pas de contradiction sans explication)
- Dans les bornes de l'équipe Algorithme
- Preuves citées et vérifiables

ALERT :
- L'événement déclencheur est réel (source fournie)
- Le niveau de risque est justifié
- Pas de faux positif évident

Tu réponds UNIQUEMENT en JSON :
{
  "verdict": "APPROVED" | "REJECTED",
  "reasons": [{ "code": "...", "message": "...", "severity": "critical|warning" }],
  "corrections": [{ "field": "...", "expected": "...", "got": "...", "suggestion": "..." }]
}

Un seul "critical" → REJECTED. Les "warning" seuls → APPROVED avec les warnings notés.
Sois exigeant. Zéro tolérance sur : copie, données sensibles, hallucinations, promesses de gain, conseil juridique.
```

### Vérifications croisées inter-équipes (`qa-cross-check.ts`)
Avant de vérifier un contenu, le QA charge le contexte pertinent des autres équipes :
- **Pour un post casino** : charge les `ComplianceRule` actives pour Meta/TikTok × pays du canal, les dernières `Recommendation` appliquées, le `StyleProfile` si inspiration active.
- **Pour un short** : charge les règles du canal cible (si le short sera posté), les `ComplianceRule` pour les ads.
- **Pour un rapport** : charge les `TrendEntry` sources et vérifie qu'elles existent.
- **Pour une réponse Kevin** : charge la question originale, les données consultées, les résultats attendus.
- **Pour une recommandation** : charge les recommandations actives (pas de contradiction), les `ComplianceRule` (pas de risque), les bornes Algorithme.

## 3. Intégration avec chaque équipe

### Posts (Dating, Casino, Sports) — `packages/agents/src/agents/*/`
Après le Contrôle qualité existant (Algorithme), avant `publishPost()` :
```typescript
const qa = await qaCheck("POST", post.id, {
  text: post.text,
  media: post.mediaType,
  channel: channel.name,
  vertical: channel.vertical,
  country: channel.country,
}, {
  channelRules: await getChannelRules(channel.id),
  complianceRules: await getActiveComplianceRules(channel.vertical, channel.country),
  recentPosts: await getRecentPosts(channel.id, 10),
  styleProfile: channel.styleProfileId ? await getStyleProfile(channel.styleProfileId) : null,
});
if (qa.verdict === "REJECTED") {
  // Retour au Contrôle qualité avec les corrections
  return { blocked: true, qaCheckId: qa.id, corrections: qa.corrections };
}
// Publier
```

### Shorts (Montage) — `packages/agents/src/montage/`
Après le QC Montage, avant l'envoi de la preview au client :
```typescript
const qa = await qaCheck("SHORT", clip.id, {
  durationMs: clip.durationMs,
  format: clip.format,
  subtitlesSrt: clip.subtitlesSrt,
  overlayText: clip.overlayText,
  resolution: probeResult.resolution,
}, {
  complianceRules: await getActiveComplianceRules("CASINO", targetCountries),
  channelRules: targetChannel ? await getChannelRules(targetChannel.id) : null,
});
if (qa.verdict === "REJECTED") {
  clip.status = "QC_FAILED";
  // Retour au Monteur/Habillage avec corrections
}
```

### Rapports (Analystes) — `packages/agents/src/analysts/`
Avant l'envoi du rapport via Kevin :
```typescript
const qa = await qaCheck("REPORT", report.id, {
  title: report.title,
  summary: report.summary,
  content: report.content,
  recommendations: report.recommendations,
}, {
  sourceEntries: await getTrendEntriesForReport(report.id),
});
if (qa.verdict === "REJECTED") {
  // Retour au Rapporteur/Stratège avec corrections
}
```

### Réponses Kevin — `packages/agents/src/boss/`
Avant chaque envoi de message au client (sauf les messages système courts : « ok », « compris », « j'ai bien reçu ») :
```typescript
if (message.length > 50) { // pas de QA sur les accusés de réception
  const qa = await qaCheck("KEVIN_RESPONSE", turnId, {
    question: originalQuestion,
    response: message,
    dataConsulted: queryResults,
  }, {});
  if (qa.verdict === "REJECTED") {
    // Régénérer la réponse avec les corrections
    message = await regenerateResponse(originalQuestion, qa.corrections);
    // Re-vérifier (max 3 tentatives)
  }
}
```

### Recommandations — `packages/agents/src/agents/algo/`
Avant présentation au client :
```typescript
const qa = await qaCheck("RECOMMENDATION", rec.id, {
  title: rec.title,
  changes: rec.changes,
  evidence: rec.evidence,
  source: rec.source,
}, {
  activeRecs: await getActiveRecommendations(rec.teamKey),
  complianceRules: await getActiveComplianceRules(rec.vertical),
  bounds: await getAlgoBounds(rec.teamKey),
});
```

### Alertes — `packages/agents/src/analysts/`
Avant envoi d'une alerte immédiate :
```typescript
const qa = await qaCheck("ALERT", alert.id, {
  message: alert.message,
  riskLevel: alert.riskLevel,
  source: alert.source,
}, {});
if (qa.verdict === "REJECTED") {
  // Alerte annulée (faux positif), journalisée
}
```

## 4. Métriques et monitoring

### Compteurs temps réel
- Taux d'approbation global (par heure, jour, semaine)
- Taux d'approbation par équipe et par type de contenu
- Latence moyenne du QA (doit rester < 30s)
- Nombre de blocages Fable 5 indisponible
- Top 5 des raisons de refus

### Alertes internes
- Taux de refus > 30 % sur une heure → Kevin prévient le client (« Beaucoup de contenus ne passent pas le contrôle qualité, je vérifie ce qui se passe »)
- Latence QA > 20s en moyenne sur 10 vérifications → log warning
- Fable 5 indisponible > 5 minutes → Kevin prévient

## 5. Catalogue Kevin (ajouts)
- `qa_status` : « Kevin, comment va le contrôle qualité ? » → taux d'approbation, derniers refus, latence
- `qa_history` : « Kevin, montre-moi les refus de cette semaine » → liste des `QaCheck` REJECTED avec motifs
- `qa_detail` : « Kevin, pourquoi le post 42 a été refusé ? » → détail du `QaCheck`

## 6. Site — Page Agents → Qualité (`apps/web/`)
- **Tableau de bord QA** : taux d'approbation en temps réel (graphique), par équipe, par type.
- **Historique** : liste des `QaCheck`, filtrable par verdict, type, équipe, date. Détail avec motifs et corrections.
- **Tendances** : quels types d'erreurs reviennent le plus, quelles équipes ont le plus de refus, évolution dans le temps.

## Tests et livraison
- **Fixtures** : 10 contenus de test par type (5 valides, 5 avec erreurs connues : copie, hallucination, donnée sensible, promesse de gain, contradiction, chiffre inventé, source morte, conseil juridique, hors-sujet, faux positif d'alerte).
- **Unitaires** : chaque type de vérification sur les fixtures → les 5 valides passent, les 5 invalides sont refusés avec le bon code de raison ; timeout simulé → `QA_TIMEOUT` ; modèle indisponible simulé → blocage ; vérification croisée (compliance × post) ; régénération de réponse Kevin après refus.
- **Intégration** : post casino publié → passe le QA → publié ; post avec mot interdit → refusé par QA → retour au Contrôle qualité → corrigé → repasse → publié ; short avec sous-titre erroné → refusé → retour Habillage → corrigé → repasse ; rapport avec chiffre inventé → refusé → retour Stratège → corrigé ; réponse Kevin hallucinée → refusée → régénérée → repasse ; recommandation qui contredit une ComplianceRule → refusée ; alerte faux positif → annulée ; 3 refus du même contenu → Kevin demande au client.
- **Relecture adverse** : contournement du QA (publication sans appel), fallback sur modèle moins capable (interdit), approbation par défaut sur timeout (interdit), modification du contenu par le QA (interdit), fuite de données dans les logs QA, non-régression des phases 19 à 29.
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` ; déploiement ; santé ; `docs/STATUS.md`, `docs/GUIDE-UTILISATEUR.md` (section « Contrôle qualité global » : ce que le QA vérifie, comment voir les refus, que faire si un contenu est bloqué), `docs/DECISIONS-TECH.md`, `docs/DATA-MODEL.md`, `docs/AGENTS-ARCHITECTURE.md` (nouvel agent QA Global, schéma d'intégration avec toutes les équipes), ligne « Phase 30 » dans `CLAUDE.md`, `docs/prompts/README.md`.
- **Bilan Telegram** par Kevin (5 lignes) : fait, ce que le QA vérifie, comment voir les refus, le taux d'approbation. Puis crée `docs/PHASE-DONE` et arrête-toi : aucune autre phase n'est en file.

## Fini quand
- Tout contenu sortant (posts, shorts, rapports, réponses Kevin, recommandations, alertes) passe par l'agent QA Global propulsé par Fable 5 avant sortie ; les contenus refusés retournent à leur équipe avec corrections ; après 3 refus, Kevin demande au client ; le QA ne modifie rien, il approuve ou bloque ; Fable 5 indisponible = tout est bloqué (jamais d'approbation par défaut) ; le dashboard QA est en ligne avec taux, historique et tendances ; tests, relecture, déploiement, documentation et bilan faits.
