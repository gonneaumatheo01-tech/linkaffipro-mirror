"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { backUrl, formInput, webActorOf, type Core } from "@/lib/site-ops/ops/lot-c/common";
import {
  addAd,
  addAdSet,
  addEntryLink,
  addManualCost,
  addOffer,
  attachImportedCampaign,
  attachLinkToAd,
  deleteAd,
  deleteAdSet,
  deleteCampaign,
  removeOffer,
  updateCampaign,
  updateCampaignChannels,
} from "@/lib/site-ops/ops/lot-c/campaigns";

/**
 * Fiche campagne. Toute la règle est dans les cœurs de la phase 34 (`lib/site-ops/ops/lot-c/campaigns.ts`), appelés
 * aussi par Kevin : mêmes validations, mêmes messages, même journal. Ici : session, identifiants requis du formulaire,
 * retour vers la page.
 */
async function run(formData: FormData, core: Core, required: string[]): Promise<void> {
  const user = await requireUser();
  for (const k of required) z.string().min(1).parse(formData.get(k));
  const r = await core(formInput(formData), webActorOf(user));
  if (r.back) redirect(backUrl(r.back));
  redirect("/campaigns");
}

/**
 * Vue d'ensemble → « Modifier la campagne » : nom, plateforme, univers, statut, budget, dates, canaux, compte pub
 * connecté, notes. Changer de compte détache la campagne pub suivie (identifiant externe) : le nouveau compte la
 * retrouvera par son nom, ou elle se rattache depuis l'onglet Pubs.
 */
export async function updateCampaignAction(formData: FormData): Promise<void> {
  await run(formData, updateCampaign, ["campaignId"]);
}

export async function addAdSetAction(formData: FormData): Promise<void> {
  await run(formData, addAdSet, ["campaignId"]);
}

export async function addAdAction(formData: FormData): Promise<void> {
  await run(formData, addAd, ["campaignId", "adSetId"]);
}

export async function attachLinkAction(formData: FormData): Promise<void> {
  await run(formData, attachLinkToAd, ["campaignId", "adId"]);
}

/** Saisie manuelle d'une dépense pour un jour (remplace la valeur manuelle existante du même jour). */
export async function addManualCostAction(formData: FormData): Promise<void> {
  await run(formData, addManualCost, []);
}

/** Onglet Liens : ajoute une pub précise et son lien d'entrée (goolink + invitation Telegram) à la campagne. */
export async function addEntryLinkAction(formData: FormData): Promise<void> {
  await run(formData, addEntryLink, ["campaignId"]);
}

/** Onglet Canaux : enregistre les canaux cochés (les canaux désactivés déjà rattachés sont conservés). */
export async function updateChannelsAction(formData: FormData): Promise<void> {
  await run(formData, updateCampaignChannels, ["campaignId"]);
}

/** Onglet Offres : ajoute une campagne Link Affi (choisie dans la liste ou collée sous forme de lien linkaffi.me/go/<clé>). */
export async function addOfferAction(formData: FormData): Promise<void> {
  await run(formData, addOffer, ["campaignId"]);
}

/** Onglet Offres : retire une campagne Link Affi (les boutons déjà publiés passent à une autre offre de la campagne). */
export async function removeOfferAction(formData: FormData): Promise<void> {
  await run(formData, removeOffer, ["campaignId", "affiliateCampaignId"]);
}

/** Onglet Pubs : « Rattacher une campagne pub importée » (voir lib/campaigns/merge.ts). */
export async function attachImportedCampaignAction(formData: FormData): Promise<void> {
  await run(formData, attachImportedCampaign, ["campaignId"]);
}

/** Onglet Pubs : supprime une pub précise (ADMIN). Ses coûts propres sont supprimés ; son lien d'entrée reste dans la campagne. */
export async function deleteAdAction(formData: FormData): Promise<void> {
  await run(formData, deleteAd, ["campaignId", "adId"]);
}

/** Onglet Pubs : supprime un groupe et ses pubs précises (ADMIN). Leurs liens d'entrée restent dans la campagne. */
export async function deleteAdSetAction(formData: FormData): Promise<void> {
  await run(formData, deleteAdSet, ["campaignId", "adSetId"]);
}

/**
 * Vue d'ensemble : supprime la campagne (ADMIN). Groupes, pubs, coûts et statistiques de la campagne sont supprimés ;
 * ses liens d'entrée et liens traqués restent (Campagnes → Tous les liens) mais ne sont plus rattachés à une campagne ; les membres,
 * clics et joueurs sont conservés.
 */
export async function deleteCampaignAction(formData: FormData): Promise<void> {
  await run(formData, deleteCampaign, ["campaignId"]);
}
