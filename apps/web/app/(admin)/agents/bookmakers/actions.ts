"use server";

import { revalidatePath } from "next/cache";
import { BOOKMAKERS_PATH } from "@/lib/agents/bookmakers";
import { backTo } from "@/lib/agents/redirect";
import { runOpenBrowser, runRelearnSite, runSetSiteUrl, runTestSite } from "@/lib/site-ops/ops/lot-d/bookmakers";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agents → Bookmakers (phase 35), réservées aux administrateurs : « Tester », « Ré-apprendre »,
 * « Ouvrir le navigateur sur le Mac » et « Changer l'adresse ». Elles ne font que déposer des LECTURES pour le
 * service d'arrière-plan (ou le Mac) : jamais de mise. Chaque geste est noté dans le journal des actions (`AuditLog`,
 * par les fonctions des agents, « via SITE ») ; Kevin donne le résultat sur Telegram.
 */

// Phase 34 : logique dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/bookmakers`), que Kevin appelle aussi.

function finish(r: { ok: true; message: string } | { ok: false; error: string }): never {
  if (!r.ok) backTo(BOOKMAKERS_PATH, { error: r.error });
  revalidatePath(BOOKMAKERS_PATH);
  backTo(BOOKMAKERS_PATH, { ok: r.message });
}

export async function testSiteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runTestSite(formData, siteActor(user)));
}

export async function relearnSiteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runRelearnSite(formData, siteActor(user)));
}

export async function openBrowserAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runOpenBrowser(formData, siteActor(user)));
}

export async function setSiteUrlAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runSetSiteUrl(formData, siteActor(user)));
}
