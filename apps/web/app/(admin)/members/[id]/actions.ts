"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, recordEvent } from "@linkaffipro/db";
import { requireAdmin, requireUser } from "@/lib/session";

export async function addNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const text = z.string().trim().min(1).max(2000).safeParse(formData.get("text"));
  if (!text.success)
    redirect(
      `/members/${memberId}?error=${encodeURIComponent("La note est vide ou dépasse 2 000 caractères.")}`,
    );
  await prisma.memberNote.create({ data: { memberId, authorId: user.id, text: text.data } });
  await audit({
    userId: user.id,
    action: "member.note_added",
    entityType: "Member",
    entityId: memberId,
  });
  revalidatePath(`/members/${memberId}`);
  redirect(`/members/${memberId}?ok=${encodeURIComponent("Note ajoutée.")}`);
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const noteId = z.string().min(1).parse(formData.get("noteId"));
  const note = await prisma.memberNote.findUnique({ where: { id: noteId } });
  if (!note) redirect("/members");
  if (user.role !== "ADMIN" && note.authorId !== user.id)
    redirect(
      `/members/${note.memberId}?error=${encodeURIComponent("Vous ne pouvez supprimer que vos propres notes.")}`,
    );
  await prisma.memberNote.delete({ where: { id: noteId } });
  await audit({
    userId: user.id,
    action: "member.note_deleted",
    entityType: "Member",
    entityId: note.memberId,
  });
  revalidatePath(`/members/${note.memberId}`);
  redirect(`/members/${note.memberId}?ok=${encodeURIComponent("Note supprimée.")}`);
}

/**
 * Suppression d'un membre sur demande (RGPD) = anonymisation : identité effacée, notes supprimées,
 * événements et statistiques conservés sans donnée personnelle. Le telegramUserId est remplacé par un
 * entier négatif aléatoire (jamais attribué par Telegram) pour préserver l'unicité et les relations.
 */
export async function anonymizeMemberAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "SUPPRIMER")
    redirect(
      `/members/${memberId}?error=${encodeURIComponent("Pour confirmer, tapez SUPPRIMER en majuscules dans le champ.")}`,
    );
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) redirect("/members");
  if (member.anonymizedAt)
    redirect(`/members/${memberId}?ok=${encodeURIComponent("Ce membre est déjà anonymisé.")}`);
  const fake = -BigInt(`0x${randomBytes(6).toString("hex")}`);
  await prisma.$transaction([
    prisma.memberNote.deleteMany({ where: { memberId } }),
    prisma.memberBotState.updateMany({
      where: { memberId },
      data: { canDm: false, blockedAt: new Date() },
    }),
    prisma.member.update({
      where: { id: memberId },
      data: {
        firstName: null,
        lastName: null,
        username: null,
        languageCode: null,
        isPremium: false,
        telegramUserId: fake,
        anonymizedAt: new Date(),
      },
    }),
  ]);
  await recordEvent({ type: "member.anonymized", memberId, payload: { by: admin.id } });
  await audit({
    userId: admin.id,
    action: "member.anonymized",
    entityType: "Member",
    entityId: memberId,
  });
  revalidatePath(`/members/${memberId}`);
  redirect(
    `/members/${memberId}?ok=${encodeURIComponent("Membre supprimé : identité effacée, historique conservé sans donnée personnelle.")}`,
  );
}
