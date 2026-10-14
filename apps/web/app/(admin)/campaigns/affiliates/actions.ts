"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@linkaffipro/db";
import { dismissTutorial } from "@/lib/affiliates/tutorial";
import { requireUser } from "@/lib/session";

/**
 * « J'ai compris » du mini-tutoriel « Affiliés sur vos canaux » : il ne s'affiche plus pour cet utilisateur (il reste
 * accessible par « Mode d'emploi »). Journalisé comme les autres réglages de la visite guidée.
 */
export async function dismissAffiliatesTutorialAction(): Promise<void> {
  const user = await requireUser();
  await dismissTutorial(user.id);
  await audit({
    userId: user.id,
    action: "settings.affiliates_tutorial_hidden",
    entityType: "user",
    entityId: user.id,
  });
  revalidatePath("/campaigns/affiliates");
}
