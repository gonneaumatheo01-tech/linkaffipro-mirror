/**
 * Phase 27 — contrat FIGÉ du canal d'inspiration (`docs/prompts/29-phase-27-canal-inspiration.md`). Types et noms
 * partagés par quatre chantiers ; ne pas les renommer. Qui fournit quoi :
 *
 * - Chantier A, LECTURE (`inspiration/sources/{web-preview,account,forwarded}.ts`, `inspiration/features.ts`,
 *   `inspiration/store.ts`, `inspiration/read.ts`, worker) : `readWebPreview`, `readWithAccount`,
 *   `forwardedToReferencePost`, `postFeatures`, `storeReferencePosts`, `runReferenceRead` (tâche `agents-algo`
 *   `inspiration-read`), `purgeReferenceTexts` (30 jours), relecture hebdomadaire `inspiration-reread`.
 * - Chantier B, ANALYSE (`inspiration/analysis/*`, `inspiration/style.ts`, Rédaction / Contrôle qualité) :
 *   `analyzeReference`, `compareWithChannel`, `buildStyleProfile`, `styleContextForChannel` (lu par la Rédaction),
 *   contrôle de copie branché dans Contrôle qualité (`copiedSequence` de `./copy-check`).
 * - Chantier C, KEVIN (`inspiration/proposals.ts`, `inspiration/apply.ts`, `inspiration/kevin.ts`, entrées du catalogue
 *   de Kevin `boss/catalog-inspiration.ts`, réception des posts transférés) : `afterReferenceRead` (appelé par A à la
 *   fin d'une lecture : analyse B + profil B + résumé envoyé par Kevin), `inspirationProposals`, `applyInspiration`,
 *   `undoInspiration`, `removeReference`.
 * - Chantier D, SITE ET DOCS : page Agents → Inspiration, encart de la fiche canal, guide, A-FAIRE-HUMAIN.
 */
import type { AgentsDeps } from "../types";

/** Univers d'une référence (même univers obligatoire que les canaux cibles). */
export type InspirationUniverse = "dating" | "casino" | "sports";
export type ReferenceViaName = "WEB" | "ACCOUNT" | "FORWARDED";
export type ReferenceMediaKind = "text" | "photo" | "video" | "poll" | "document" | "other";

/** Limites (règles 2 et 6). */
export const INSPIRATION_LIMITS = {
  /** Posts lus au plus par lecture (aperçu web ou compte). */
  maxPostsPerRead: 200,
  /** Ancienneté maximale lue (jours). */
  maxAgeDays: 90,
  /** Aperçu web : une requête toutes les 3 secondes. */
  webDelayMs: 3000,
  /** Compte réel : lots de 50, un lot toutes les 5 secondes. */
  accountBatch: 50,
  accountDelayMs: 5000,
  /** Relecture hebdomadaire : 50 nouveaux posts au plus. */
  rereadMaxPosts: 50,
  /** 5 lectures ou relectures par jour au plus, une à la fois. */
  maxReadsPerDay: 5,
  /** Analyse : au moins 20 posts. */
  minPostsForAnalysis: 20,
  /** Texte brut gardé 30 jours. */
  textRetentionDays: 30,
  /** Posts transférés demandés quand le canal ne se lit pas : 10 à 30. */
  forwardMin: 10,
  forwardMax: 30,
  /** Bornes de l'équipe Algorithme reprises : mélange 20 points par semaine au plus. */
  maxMixShiftPerWeek: 20,
} as const;

/** Format commun des trois voies (règle 3). Aucun média téléchargé ; liens jamais suivis. */
export type ReferencePostInput = {
  externalId: number;
  postedAt: Date;
  text: string | null;
  mediaKind: ReferenceMediaKind;
  views: number | null;
  hasButton: boolean;
  /** Liens présents (comptés, jamais suivis ni réutilisés). */
  linkCount: number;
};

/** Résultat d'une lecture. `unavailable` : canal privé, restreint, introuvable, aperçu fermé… (raison en français). */
export type ReferenceReadResult =
  | { ok: true; title: string | null; username: string | null; chatId: bigint | null; posts: ReferencePostInput[] }
  | { ok: false; reason: "private" | "restricted" | "not_found" | "no_account" | "rate_limited" | "error"; message: string };

/** Accès réseau injecté (tests : pages `t.me/s` enregistrées). */
export type InspirationFetch = (url: string) => Promise<{ status: number; body: string }>;

/** Lecture par compte réel (phase 18) injectée (tests : faux MTProto). Jamais de `JoinChannel` sans CONFIRM. */
export type AccountHistoryReader = {
  /** Comptes réels membres du canal et libres (jamais un compte qui converse). */
  memberAccounts(channel: { username: string | null; chatId: bigint | null }): Promise<string[]>;
  history(
    accountId: string,
    channel: { username: string | null; chatId: bigint | null },
    opts: { limit: number; beforeId?: number },
  ): Promise<{ posts: ReferencePostInput[]; title: string | null; chatId: bigint | null } | { floodWaitSeconds: number }>;
};

/** Mesure chiffrée (toujours calculée par le code) avec l'effectif derrière. */
export type Measure = { key: string; label: string; value: number | string | null; unit?: string; sampleSize: number };

/** Analyse d'une référence (chantier B). Tous les chiffres viennent du code. */
export type InspirationAnalysis = {
  referenceChannelId: string;
  universe: InspirationUniverse;
  sampleSize: number;
  /** Rythme : posts par jour, régularité, heures de pointe (Paris, tranches de 30 min), jours, délai entre posts. */
  rhythm: Measure[];
  /** Forme : longueur, lignes, emojis, mélange des médias, liens, boutons, hashtags… */
  form: Measure[];
  /** Fond : appels au VIP, cotes, séries pari → résultat, bonus, gains annoncés (signalés)… */
  content: Measure[];
  /** Résultats : vues, meilleurs / plus faibles posts, corrélations avec effectifs. */
  results: Measure[];
  /** Heures de pointe (« HH:MM » de début de tranche, Paris), de la plus forte à la plus faible. */
  peakSlots: string[];
  /** Exemples courts (10 mots au plus chacun) pour illustrer, jamais réutilisés. */
  quotes: string[];
  /** Ce qui violerait une règle du client chez eux (promesse de gain, mention d'IA…) : signalé, jamais reproduit. */
  flagged: string[];
};

/** Écart « eux / nous » sur une mesure. */
export type InspirationGap = {
  key: string;
  label: string;
  theirs: number | string | null;
  ours: number | string | null;
  unit?: string;
  /** L'écart dépasse le seuil réglable : il compte. */
  matters: boolean;
};

export type ChannelComparison = { channelId: string; channelTitle: string; gaps: InspirationGap[]; ourSampleSize: number };

/** Profil de style (chantier B), reflète `StyleProfile`. */
export type StyleProfileData = {
  id: string;
  referenceChannelId: string;
  version: number;
  rules: string[];
  description: string | null;
  examples: string[];
  flagged: string[];
};

/** Fonctions attendues (signatures). Les implémentations vivent dans les fichiers des chantiers. */
export type InspirationApi = {
  /** A : lit (voie choisie selon la référence), range, puis appelle `afterReferenceRead`. Reprenable. */
  runReferenceRead(deps: AgentsDeps, referenceChannelId: string): Promise<{ ok: boolean; message: string }>;
  /** B */
  analyzeReference(deps: AgentsDeps, referenceChannelId: string): Promise<InspirationAnalysis | { tooFew: true; count: number }>;
  compareWithChannel(deps: AgentsDeps, analysis: InspirationAnalysis, channelId: string): Promise<ChannelComparison>;
  buildStyleProfile(deps: AgentsDeps, referenceChannelId: string, analysis: InspirationAnalysis): Promise<StyleProfileData | null>;
  /** C */
  afterReferenceRead(deps: AgentsDeps, referenceChannelId: string): Promise<void>;
};
