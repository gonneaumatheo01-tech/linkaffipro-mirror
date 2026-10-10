"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, type PostStatus } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { momentLabel, toLocal } from "@/lib/posts/calendar";
import { checkMove, siblingMoves } from "@/lib/posts/move";

export type MovePostResult =
  | {
      ok: true;
      postId: string;
      /** Ancienne date (heure de Paris « AAAA-MM-JJTHH:MM »), pour « Annuler ». */
      from: string | null;
      to: string;
      /** Messages déplacés (2 pour un test A/B dans le même canal). */
      moved: number;
      message: string;
    }
  | { ok: false; error: string };

const inputSchema = z.object({
  postId: z.string().min(1),
  scheduledAt: z.string().min(1),
});

/** Le message a changé entre la lecture et l'écriture (le worker l'a pris pour l'envoyer, ou un autre écran). */
class Conflict extends Error {}

/**
 * Déplace un brouillon ou un message programmé à une autre date (calendrier : glisser-déposer, ou « Déplacer » du
 * volet). Mêmes contrôles que la modification : utilisateur connecté (ADMIN ou MANAGER, comme `updatePostAction`),
 * jamais un message parti ni un modèle, jamais dans le passé (règles dans lib/posts/move.ts). L'écriture est
 * conditionnelle (statut et date inchangés depuis la lecture) : un message que le worker vient de prendre pour
 * l'envoyer n'est jamais modifié. Les autres versions d'un test A/B suivent du même écart. Journal `post.moved`.
 */
export async function movePostAction(input: {
  postId: string;
  scheduledAt: string;
}): Promise<MovePostResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Demande invalide : rechargez la page." };
  const { postId, scheduledAt } = parsed.data;
  const now = new Date();

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, status: true, isTemplate: true, scheduledAt: true, abGroupId: true },
  });
  const check = checkMove(post, scheduledAt, now);
  if (!check.ok) return check;
  const current = post!;
  const at = check.at;
  const from = current.scheduledAt ? toLocal(current.scheduledAt) : null;
  if (current.scheduledAt && current.scheduledAt.getTime() === at.getTime())
    return {
      ok: true,
      postId,
      from,
      to: toLocal(at),
      moved: 0,
      message: "Le message est déjà à cette heure.",
    };

  // Test A/B : les autres versions suivent du même écart (seulement si ce message avait déjà une date).
  const siblings =
    current.abGroupId && current.scheduledAt
      ? await prisma.post.findMany({
          where: { abGroupId: current.abGroupId, id: { not: postId }, isTemplate: false },
          select: { id: true, status: true, scheduledAt: true },
        })
      : [];
  const delta = current.scheduledAt ? at.getTime() - current.scheduledAt.getTime() : 0;
  const followers = siblingMoves(siblings, delta, now);
  if (!followers.ok) return followers;

  try {
    await prisma.$transaction(async (tx) => {
      const guard = (id: string, status: PostStatus, was: Date | null) => ({
        id,
        status,
        scheduledAt: was,
        isTemplate: false,
      });
      const main = await tx.post.updateMany({
        where: guard(postId, current.status, current.scheduledAt),
        data: { scheduledAt: at, updatedById: user.id },
      });
      if (main.count !== 1) throw new Conflict();
      for (const m of followers.moves) {
        const r = await tx.post.updateMany({
          where: guard(m.id, m.status, m.from),
          data: { scheduledAt: m.to, updatedById: user.id },
        });
        if (r.count !== 1) throw new Conflict();
      }
    });
  } catch (err) {
    if (err instanceof Conflict)
      return {
        ok: false,
        error: "Ce message vient de changer (il part peut-être en ce moment) : rechargez la page.",
      };
    throw err;
  }

  const to = toLocal(at);
  await audit({
    userId: user.id,
    action: "post.moved",
    entityType: "Post",
    entityId: postId,
    metadata: {
      from: current.scheduledAt?.toISOString() ?? null,
      to: at.toISOString(),
      abGroupId: current.abGroupId,
      followers: followers.moves.map((m) => m.id),
    },
  });
  revalidatePath("/messages");
  const moved = 1 + followers.moves.length;
  return {
    ok: true,
    postId,
    from,
    to,
    moved,
    message:
      moved > 1
        ? `Test A/B déplacé : ce message part le ${momentLabel(to)}, l'autre version suit du même écart.`
        : `Message déplacé au ${momentLabel(to)}.`,
  };
}
