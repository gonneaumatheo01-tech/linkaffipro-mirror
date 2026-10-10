"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { LinkError, createEntryLink, createGenericLink } from "@/lib/links/create";

function back(params: Record<string, string>): never {
  redirect(`/campaigns/links?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT") ?? false;
}

const entrySchema = z.object({
  channelId: z.string().min(1),
  names: z.string().min(1),
  platform: z.enum(["TIKTOK", "META", "OTHER"]),
  adCampaignName: z.string().trim().max(120).optional(),
  adSetName: z.string().trim().max(120).optional(),
  adName: z.string().trim().max(120).optional(),
  language: z.string().trim().min(2).max(5).toLowerCase(),
  approvalRuleId: z.string().optional(),
});

/** Crée un ou plusieurs liens d'entrée (une ligne par nom). */
export async function createEntryLinksAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = entrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    back({
      error:
        "Vérifiez le formulaire : le canal, au moins un nom, la plateforme et une langue (code de 2 à 5 lettres, ex. fr) sont obligatoires.",
    });
  const d = parsed.data;
  const names = [
    ...new Set(
      d.names
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
  if (names.length === 0) back({ error: "Indiquez au moins un nom de lien." });
  const created: string[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      const r = await createEntryLink({
        channelId: d.channelId,
        name,
        platform: d.platform,
        adCampaignName: d.adCampaignName,
        adSetName: d.adSetName,
        adName: d.adName,
        language: d.language,
        approvalRuleId: d.approvalRuleId || null,
        userId: user.id,
      });
      created.push(r.trackingLink.slug);
    } catch (err) {
      if (isRedirect(err)) throw err;
      errors.push(`${name} : ${err instanceof LinkError ? err.message : "erreur inattendue"}`);
      if (err instanceof LinkError && /Aucun bot administrateur|introuvable/.test(err.message))
        break;
    }
  }
  revalidatePath("/campaigns/links");
  if (errors.length > 0 && created.length === 0) back({ error: errors.join(" · ") });
  back({
    ok: `${created.length} lien(s) créé(s) : copiez les adresses à coller dans la pub, ci-dessous${errors.length ? ` · échecs : ${errors.join(" · ")}` : ""}.`,
    highlight: created.join(","),
  });
}

const genericSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
});

export async function createGenericLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = genericSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    back({ error: "Indiquez un nom et une adresse complète commençant par https://." });
  try {
    const link = await createGenericLink({
      label: parsed.data.label,
      url: parsed.data.url,
      userId: user.id,
    });
    revalidatePath("/campaigns/links");
    back({ ok: `Lien « ${link.label} » créé.`, highlight: link.slug });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error:
        err instanceof LinkError
          ? err.message
          : "Création impossible pour le moment. Réessayez dans un instant.",
    });
  }
}

export async function toggleLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("linkId"));
  const link = await prisma.trackingLink.findUniqueOrThrow({
    where: { id },
    include: { inviteLink: true },
  });
  const isActive = !link.isActive;
  await prisma.trackingLink.update({ where: { id }, data: { isActive } });
  if (link.inviteLinkId)
    await prisma.inviteLink.update({ where: { id: link.inviteLinkId }, data: { isActive } });
  await audit({
    userId: user.id,
    action: isActive ? "link.activated" : "link.deactivated",
    entityType: "TrackingLink",
    entityId: id,
  });
  revalidatePath("/campaigns/links");
  back({
    ok: `Lien « ${link.label} » ${isActive ? "réactivé : il fonctionne à nouveau" : "désactivé : il renvoie vers l'accueil du site"}.`,
  });
}
