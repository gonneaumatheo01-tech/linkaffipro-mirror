"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, recordEvent, type Prisma } from "@linkaffipro/db";
import { requireAdmin, requireUser } from "@/lib/session";
import { getTagRegistry, memberTags } from "@/lib/members/tags";

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

/** Modifier une note : son auteur, ou un administrateur. */
export async function editNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const noteId = z.string().min(1).parse(formData.get("noteId"));
  const note = await prisma.memberNote.findUnique({ where: { id: noteId } });
  if (!note) redirect("/members");
  if (user.role !== "ADMIN" && note.authorId !== user.id)
    redirect(
      `/members/${note.memberId}?error=${encodeURIComponent("Vous ne pouvez modifier que vos propres notes.")}`,
    );
  const text = z.string().trim().min(1).max(2000).safeParse(formData.get("text"));
  if (!text.success)
    redirect(
      `/members/${note.memberId}?error=${encodeURIComponent("La note est vide ou dépasse 2 000 caractères.")}`,
    );
  await prisma.memberNote.update({ where: { id: noteId }, data: { text: text.data } });
  await audit({
    userId: user.id,
    action: "member.note_edited",
    entityType: "Member",
    entityId: note.memberId,
    metadata: { noteId },
  });
  revalidatePath(`/members/${note.memberId}`);
  redirect(`/members/${note.memberId}?ok=${encodeURIComponent("Note modifiée.")}`);
}

/**
 * Étiquettes d'un membre : les cases cochées parmi le registre (Réglages → Étiquettes) remplacent
 * celles du registre ; les étiquettes hors registre (posées par une automatisation) sont conservées.
 */
export async function setMemberTagsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { tags: true, anonymizedAt: true } });
  if (!member) redirect("/members");
  if (member.anonymizedAt)
    redirect(`/members/${memberId}?error=${encodeURIComponent("Un membre anonymisé ne porte pas d'étiquette.")}`);
  const registry = await getTagRegistry();
  const known = new Set(registry.map((t) => t.name));
  const wanted = formData
    .getAll("tags")
    .map(String)
    .filter((t) => known.has(t));
  const before = memberTags(member.tags);
  const kept = before.filter((t) => !known.has(t));
  const next = [...new Set([...kept, ...wanted])];
  await prisma.member.update({ where: { id: memberId }, data: { tags: next as Prisma.InputJsonValue } });
  await recordEvent({ type: "member.tags_changed", memberId, payload: { from: before, to: next, by: user.id } });
  await audit({
    userId: user.id,
    action: "member.tags_changed",
    entityType: "Member",
    entityId: memberId,
    metadata: { from: before, to: next },
  });
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  redirect(`/members/${memberId}?ok=${encodeURIComponent("Étiquettes enregistrées.")}`);
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
