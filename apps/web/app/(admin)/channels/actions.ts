"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";

const schema = z.object({
  channelId: z.string().min(1),
  vertical: z.enum(["", "CASINO", "SPORTS", "DATING"]),
  language: z.string().trim().min(2).max(5).toLowerCase(),
  primaryBotId: z.string(),
  isTest: z.boolean(),
  isMediaLibrary: z.boolean(),
  isActive: z.boolean(),
});

export async function updateChannelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    channelId: formData.get("channelId"),
    vertical: formData.get("vertical") ?? "",
    language: formData.get("language") ?? "fr",
    primaryBotId: formData.get("primaryBotId") ?? "",
    isTest: formData.get("isTest") === "on",
    isMediaLibrary: formData.get("isMediaLibrary") === "on",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success)
    redirect(
      `/channels?error=${encodeURIComponent("Vérifiez les réglages du canal : la langue doit être un code de 2 à 5 lettres (fr, en, pt-br…).")}`,
    );
  const d = parsed.data;
  await prisma.channel.update({
    where: { id: d.channelId },
    data: {
      vertical: d.vertical === "" ? null : d.vertical,
      language: d.language,
      primaryBotId: d.primaryBotId === "" ? null : d.primaryBotId,
      isTest: d.isTest,
      isMediaLibrary: d.isMediaLibrary,
      isActive: d.isActive,
    },
  });
  await audit({
    userId: user.id,
    action: "channel.updated",
    entityType: "Channel",
    entityId: d.channelId,
    metadata: {
      vertical: d.vertical,
      language: d.language,
      primaryBotId: d.primaryBotId,
      isTest: d.isTest,
      isMediaLibrary: d.isMediaLibrary,
      isActive: d.isActive,
    },
  });
  revalidatePath("/channels");
  redirect(`/channels?ok=${encodeURIComponent("Réglages du canal enregistrés.")}`);
}
