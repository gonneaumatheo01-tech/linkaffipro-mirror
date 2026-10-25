"use server";

import { revalidatePath } from "next/cache";
import { ANALYSES_PATH, viewHref } from "@/lib/agents/analyses";
import { backTo } from "@/lib/agents/redirect";
import {
  runActivateSource,
  runDeactivateSource,
  runDecideMarketRecommendation,
  runDeleteSource,
} from "@/lib/site-ops/ops/lot-analystes/cores";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agents → Analyses (phase 29). Sources de la veille (Activer, Désactiver, Supprimer avec le mot
 * SUPPRIMER) : administrateurs. Recommandations du marché (Accepter, Refuser) : managers compris ; aucune action
 * externe. La logique vit dans les cœurs uniques (`@/lib/site-ops/ops/lot-analystes/cores`), que Kevin appelle aussi ;
 * chaque geste est noté dans le journal des actions (`AuditLog`).
 */

type Result = { ok: true; message: string } | { ok: false; error: string; code?: string };

function finish(view: "sources" | "recommandations", r: Result, hash: string): never {
  if (r.ok || r.code === "conflict") revalidatePath(ANALYSES_PATH);
  const [path, query] = viewHref(view).split("?");
  const params = Object.fromEntries(new URLSearchParams(query ?? "").entries());
  backTo(path ?? ANALYSES_PATH, { ...params, ...(r.ok ? { ok: r.message } : { error: r.error }) }, hash);
}

export async function activateSourceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish("sources", await runActivateSource(formData, siteActor(user)), "#sources");
}

export async function deactivateSourceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish("sources", await runDeactivateSource(formData, siteActor(user)), "#sources");
}

export async function deleteSourceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish("sources", await runDeleteSource(formData, siteActor(user)), "#sources");
}

export async function decideMarketRecommendationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish("recommandations", await runDecideMarketRecommendation(formData, siteActor(user)), "#recommandations");
}
