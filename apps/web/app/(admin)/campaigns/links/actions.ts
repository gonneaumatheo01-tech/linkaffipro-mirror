"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { backUrl, formInput, webActorOf, type Core } from "@/lib/site-ops/ops/lot-c/common";
import { createEntryLinks, createGeneric, toggleLink } from "@/lib/site-ops/ops/lot-c/links";

/** Toute la règle est dans les cœurs de la phase 34 (`lib/site-ops/ops/lot-c/links.ts`), appelés aussi par Kevin. */
async function run(formData: FormData, core: Core): Promise<void> {
  const user = await requireUser();
  const r = await core(formInput(formData), webActorOf(user));
  redirect(r.back ? backUrl(r.back) : "/campaigns/links");
}

/** Crée un ou plusieurs liens d'entrée (une ligne par nom). */
export async function createEntryLinksAction(formData: FormData): Promise<void> {
  await run(formData, createEntryLinks);
}

export async function createGenericLinkAction(formData: FormData): Promise<void> {
  await run(formData, createGeneric);
}

export async function toggleLinkAction(formData: FormData): Promise<void> {
  z.string().min(1).parse(formData.get("linkId"));
  await run(formData, toggleLink);
}
