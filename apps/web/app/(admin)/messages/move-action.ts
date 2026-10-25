"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { postMove } from "@/lib/site-ops/ops/lot-b/posts";

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

/**
 * Déplace un brouillon ou un message programmé à une autre date (calendrier : glisser-déposer, ou « Déplacer » du
 * volet). Mêmes contrôles que la modification (ADMIN ou MANAGER) ; règles et écriture conditionnelle dans le cœur
 * partagé avec Kevin (`postMove`, `lib/site-ops/ops/lot-b/posts.ts`, phase 34). Journal `post.moved`.
 */
export async function movePostAction(input: {
  postId: string;
  scheduledAt: string;
}): Promise<MovePostResult> {
  const user = await requireUser();
  const r = await postMove(
    {
      postId: typeof input?.postId === "string" ? input.postId : "",
      scheduledAt: typeof input?.scheduledAt === "string" ? input.scheduledAt : undefined,
    },
    webActorOf(user),
  );
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data as { postId: string; from: string | null; to: string; moved: number };
  if (d.moved > 0) revalidatePath("/messages");
  return { ok: true, postId: d.postId, from: d.from, to: d.to, moved: d.moved, message: r.message };
}
