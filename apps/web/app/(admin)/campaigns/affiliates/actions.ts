"use server";

import { requireUser } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-c/common";
import { dismissAffiliatesTutorial } from "@/lib/site-ops/ops/lot-c/campaigns";

/**
 * « J'ai compris » du mini-tutoriel « Affiliés sur vos canaux » : il ne s'affiche plus pour cet utilisateur (il reste
 * accessible par « Mode d'emploi »). Journalisé comme les autres réglages de la visite guidée (cœur de la phase 34).
 */
export async function dismissAffiliatesTutorialAction(): Promise<void> {
  const user = await requireUser();
  await dismissAffiliatesTutorial({}, webActorOf(user));
}
