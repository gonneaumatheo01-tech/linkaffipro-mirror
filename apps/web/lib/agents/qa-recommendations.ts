/**
 * Phase 30 (QA Global) — listes de recommandations du site : une proposition (PROPOSED) n'est montrée que si le QA
 * Global l'a approuvée pour son contenu actuel ; les autres sont « en vérification » (comptées, jamais affichées ni
 * applicables). Les recommandations déjà décidées (appliquées, refusées, faites) restent visibles. Lecture seule.
 */
import { splitApproved, type RecLike } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";

/** Retire les propositions non approuvées ; rend aussi leur nombre (« N en vérification »). */
export async function hideUnapprovedProposals<T extends { id: string; status: unknown }>(rows: readonly T[]): Promise<{ rows: T[]; inReview: number }> {
  const proposedIds = rows.filter((r) => String(r.status) === "PROPOSED").map((r) => r.id);
  if (!proposedIds.length) return { rows: [...rows], inReview: 0 };
  const full = (await prisma.recommendation.findMany({ where: { id: { in: proposedIds } } })) as unknown as RecLike[];
  // Lecture seule : seule la base sert (aucun envoi, aucune file).
  const { pending } = await splitApproved({ prisma } as never, full);
  const hidden = new Set(pending.map((r) => r.id));
  // Disparue entre-temps : jamais montrée sans vérification.
  for (const id of proposedIds) if (!full.some((r) => r.id === id)) hidden.add(id);
  return { rows: rows.filter((r) => !hidden.has(r.id)), inReview: hidden.size };
}
