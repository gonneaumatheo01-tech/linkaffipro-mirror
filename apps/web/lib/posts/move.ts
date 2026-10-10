/**
 * Déplacement d'un message dans le calendrier (glisser-déposer ou « Déplacer » du volet) : contrôles purs, testés
 * dans move.test.ts, appliqués par l'action serveur `movePostAction` (app/(admin)/messages/move-action.ts).
 * Mêmes règles que la modification (accès : tout utilisateur connecté, ADMIN ou MANAGER) et que la programmation
 * (une date passée de plus d'une minute est refusée), plus une règle propre : seuls un brouillon et un message
 * programmé se déplacent ; jamais un message parti, en cours d'envoi, supprimé, annulé ou en échec, ni un modèle.
 */
import type { PostStatus } from "@linkaffipro/db";
import { canMove, PAST_TOLERANCE_MS, splitLocal } from "./calendar";
import { fromParisLocal } from "./time";

export type MovablePost = {
  status: PostStatus;
  isTemplate: boolean;
  scheduledAt: Date | null;
};

export type MoveCheck = { ok: true; at: Date } | { ok: false; error: string };

/** Message d'erreur pour un statut qui ne se déplace pas. */
export function moveRefusal(status: PostStatus): string {
  switch (status) {
    case "SENT":
    case "DELETED":
      return "Ce message est déjà parti : il ne peut plus être déplacé. Dupliquez-le pour le reprogrammer.";
    case "SENDING":
      return "Ce message est en train de partir : il ne peut plus être déplacé.";
    default:
      return "Seuls un brouillon et un message programmé se déplacent. Ouvrez ce message pour le reprogrammer.";
  }
}

/** Le message peut-il aller à `local` (« AAAA-MM-JJTHH:MM », heure de Paris) ? */
export function checkMove(
  post: MovablePost | null,
  local: string,
  now: Date = new Date(),
): MoveCheck {
  if (!post) return { ok: false, error: "Ce message n'existe plus : rechargez la page." };
  if (post.isTemplate)
    return { ok: false, error: "Un modèle n'a pas de date : il ne se déplace pas." };
  if (!canMove(post)) return { ok: false, error: moveRefusal(post.status) };
  const at = splitLocal(local) ? fromParisLocal(local) : null;
  if (!at) return { ok: false, error: "Date ou heure invalide : choisissez un jour et une heure." };
  if (at.getTime() < now.getTime() - PAST_TOLERANCE_MS)
    return {
      ok: false,
      error: "Ce moment est déjà passé : choisissez un jour et une heure à venir.",
    };
  return { ok: true, at };
}

export type Sibling = { id: string; status: PostStatus; scheduledAt: Date | null };

/**
 * Autres versions d'un test A/B : elles suivent le message déplacé du même écart (B reste 30 minutes après A, ou à
 * la même heure dans l'autre canal). Seules celles qui ne sont pas parties bougent ; refus si l'une tomberait dans
 * le passé.
 */
export function siblingMoves(
  siblings: Sibling[],
  deltaMs: number,
  now: Date = new Date(),
):
  | { ok: true; moves: Array<{ id: string; status: PostStatus; from: Date; to: Date }> }
  | {
      ok: false;
      error: string;
    } {
  const moves = siblings
    .filter(
      (s): s is Sibling & { scheduledAt: Date } =>
        s.scheduledAt !== null && canMove({ status: s.status }),
    )
    .map((s) => ({
      id: s.id,
      status: s.status,
      from: s.scheduledAt,
      to: new Date(s.scheduledAt.getTime() + deltaMs),
    }));
  if (moves.some((m) => m.to.getTime() < now.getTime() - PAST_TOLERANCE_MS))
    return {
      ok: false,
      error:
        "L'autre version du test A/B tomberait dans le passé : choisissez un moment un peu plus tard.",
    };
  return { ok: true, moves };
}
