/**
 * Phase 14 : accueils par défaut (« Ce que dit le bot » → Accueil) réécrits sans « puis appuie sur ✅ J'ai rejoint ».
 *
 * Chaque canal reçoit à sa découverte une séquence d'accueil par défaut (`ensureDefaultSequences`). Jusqu'à la phase 13,
 * son texte demandait d'appuyer sur « ✅ J'ai rejoint ». Depuis la phase 14, un canal aux canaux « Proposés » n'a plus ce
 * bouton (la personne est acceptée de toute façon) : le bot demandait d'appuyer sur un bouton absent, et le site
 * avertissait l'équipe d'adapter un texte que la plateforme avait elle-même écrit.
 *
 * Règle : un accueil n'est réécrit QUE s'il est resté tel que la plateforme l'a inséré : texte d'origine exact, en
 * français seulement (aucune traduction ajoutée), aucun bouton, aucun média. Un accueil modifié par l'équipe, sur
 * n'importe quel point, n'est jamais touché. La mise à jour est conditionnée en base (texte d'origine relu dans la même
 * requête) : une modification faite par l'équipe pendant le passage l'emporte. Résumé au journal des actions
 * (`maintenance.phase14_texts`). Lancé une seule fois par le rattrapage de la phase 14 (`pnpm db:phase14`, ou premier
 * passage du filet du worker), relançable sans risque.
 */
import { prisma, toJsonValue } from "@linkaffipro/db";
import { defaultSequenceText } from "./defaults";

type VerticalKey = "CASINO" | "SPORTS" | "DATING" | "DEFAULT";
const VERTICAL_KEYS: readonly VerticalKey[] = ["CASINO", "SPORTS", "DATING", "DEFAULT"];

/** Action du journal pour le résumé d'un passage. */
export const PHASE14_TEXTS_ACTION = "maintenance.phase14_texts";

/** Accueils par défaut d'avant la phase 14 (insérés par `ensureDefaultSequences` depuis la phase 1), par univers. */
export const PHASE13_JOIN_REQUEST_TEXTS: Readonly<Record<VerticalKey, string>> = {
  CASINO:
    "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue 🎰\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les puis appuie sur ✅ J'ai rejoint. Ton accès est validé {delai}.",
  SPORTS:
    "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue ⚽\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les puis appuie sur ✅ J'ai rejoint. Ton accès est validé {delai}.",
  DATING:
    "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue 💬\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les puis appuie sur ✅ J'ai rejoint. Ton accès est validé {delai}.",
  DEFAULT:
    "Salut {prenom} ! Ta demande pour rejoindre <b>{canal}</b> est bien reçue.\nSi des canaux partenaires apparaissent ci-dessous, rejoins-les puis appuie sur ✅ J'ai rejoint. Ton accès est validé {delai}.",
};

function newText(v: VerticalKey): string {
  return defaultSequenceText(v === "DEFAULT" ? null : v, "JOIN_REQUEST");
}

function frOnly(texts: unknown): string | null {
  if (!texts || typeof texts !== "object" || Array.isArray(texts)) return null;
  const keys = Object.keys(texts);
  if (keys.length !== 1 || keys[0] !== "fr") return null;
  const fr = (texts as Record<string, unknown>).fr;
  return typeof fr === "string" ? fr : null;
}

function isEmptyButtons(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/** Étape d'accueil telle que relue en base. */
export type StoredWelcomeStep = { texts: unknown; buttons: unknown; mediaAssetId: string | null };

/**
 * Nouveau texte d'un accueil resté au texte par défaut d'avant la phase 14 (même univers), sinon null : texte modifié,
 * traduit, avec bouton ou média (l'équipe y a touché), ou déjà au nouveau texte.
 */
export function rewrittenJoinRequestTexts(step: StoredWelcomeStep): { fr: string } | null {
  if (step.mediaAssetId || !isEmptyButtons(step.buttons)) return null;
  const fr = frOnly(step.texts);
  const v = VERTICAL_KEYS.find((k) => PHASE13_JOIN_REQUEST_TEXTS[k] === fr);
  return v ? { fr: newText(v) } : null;
}

/** Déjà au nouveau texte par défaut (passage précédent, ou canal découvert depuis la phase 14). */
export function isCurrentDefaultWelcome(step: StoredWelcomeStep): boolean {
  const fr = frOnly(step.texts);
  return VERTICAL_KEYS.some((k) => newText(k) === fr);
}

export type Phase14TextsReport = {
  /** Accueils réécrits par ce passage. */
  updated: number;
  /** Déjà au nouveau texte par défaut. */
  upToDate: number;
  /** Accueils de l'équipe (texte, traduction, bouton ou média) : jamais touchés. */
  keptByTeam: number;
};

/** Réécrit les accueils restés au texte par défaut d'avant la phase 14 (voir l'en-tête du fichier). */
export async function rewriteDefaultJoinRequestTexts(
  db: Pick<typeof prisma, "sequenceStep" | "auditLog"> = prisma,
): Promise<Phase14TextsReport> {
  const steps = await db.sequenceStep.findMany({
    where: { sequence: { trigger: "JOIN_REQUEST" } },
    select: { id: true, texts: true, buttons: true, mediaAssetId: true },
    orderBy: { id: "asc" },
  });
  const report: Phase14TextsReport = { updated: 0, upToDate: 0, keptByTeam: 0 };
  const updatedIds: string[] = [];
  for (const step of steps) {
    const next = rewrittenJoinRequestTexts(step);
    if (!next) {
      if (isCurrentDefaultWelcome(step) && !step.mediaAssetId && isEmptyButtons(step.buttons))
        report.upToDate++;
      else report.keptByTeam++;
      continue;
    }
    // Conditionnée au texte d'origine relu dans la même requête : une modification de l'équipe entre-temps l'emporte.
    const r = await db.sequenceStep.updateMany({
      where: { id: step.id, texts: { equals: toJsonValue(step.texts) }, mediaAssetId: null },
      data: { texts: next },
    });
    if (r.count > 0) {
      report.updated++;
      updatedIds.push(step.id);
    } else report.keptByTeam++;
  }
  if (updatedIds.length > 0)
    await db.auditLog.create({
      data: {
        action: PHASE14_TEXTS_ACTION,
        entityType: "SequenceStep",
        metadata: toJsonValue({ ...report, sequenceStepIds: updatedIds }),
      },
    });
  return report;
}
