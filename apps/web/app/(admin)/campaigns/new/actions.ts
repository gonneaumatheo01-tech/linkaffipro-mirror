"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { backUrl, webActorOf } from "@/lib/site-ops/ops/lot-c/common";
import { createCampaignWizard } from "@/lib/site-ops/ops/lot-c/campaigns";

/**
 * Création d'une campagne par l'assistant : campagne + offres + canaux (+ campagne pub importée du compte choisi, s'il
 * y en a une), puis « Groupe 1 » avec une pub précise et un lien d'entrée (goolink + invitation Telegram avec demande
 * d'adhésion sur le canal d'entrée choisi) par pub demandée. Si Telegram refuse un lien, la campagne reste créée et
 * l'erreur est affichée sur sa fiche (onglet Liens). Un double envoi ne crée jamais deux campagnes (jeton).
 * Toute la règle est dans le cœur de la phase 34 (`lib/site-ops/ops/lot-c/campaigns.ts`), appelé aussi par Kevin.
 */
export async function createCampaignWizardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await createCampaignWizard(
    { payload: String(formData.get("payload") ?? "{}") },
    webActorOf(user),
  );
  redirect(r.back ? backUrl(r.back) : "/campaigns");
}
