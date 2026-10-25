"use server";

import { revalidatePath } from "next/cache";
import { backTo } from "@/lib/agents/redirect";
import { isBookmakerKey } from "@/lib/agents/sports";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import {
  runCreateTestBet,
  runDeleteBookmakerCredentials,
  runDeleteScreenshotProxy,
  runSaveBetCategory,
  runSaveBookmakerCredentials,
  runSaveScreenshotProxy,
  runTestBookmakerConnection,
} from "@/lib/site-ops/ops/lot-d/sports";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche Paris sportifs (phase 23). « Produire un pari de test » : ADMIN et MANAGER. Catégories,
 * identifiants du bookmaker, adresse de secours des captures et « Tester la connexion » : ADMIN seulement. Chaque
 * action laisse sa trace dans `AuditLog` (les clés par `saveSecret` / `deleteSecret`, sans jamais leur valeur).
 * Phase 34 : la logique est dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/sports`), que Kevin appelle aussi.
 */

const SPORTS = "/agents/sports";

type Result = { ok: true; message: string } | { ok: false; error: string; code?: string };

function finish(r: Result, hash: string, revalidate = r.ok): never {
  if (revalidate) revalidatePath(SPORTS);
  backTo(SPORTS, r.ok ? { ok: r.message } : { error: r.error }, hash);
}

/** Crée ou modifie une catégorie de paris. */
export async function saveBetCategoryAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runSaveBetCategory(formData, siteActor(user)), "#categories");
}

/** « Produire un pari de test » : faux fournisseur de cotes, page locale, simulation, canal Test. */
export async function createTestBetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runCreateTestBet(formData, siteActor(user));
  if (r.ok || r.code === "conflict") revalidatePath("/agents", "layout");
  backTo(SPORTS, r.ok ? { ok: r.message } : { error: r.error }, "#paris");
}

/** Identifiant et mot de passe du compte bookmaker (secours du bot Telegram), chiffrés par le moteur. */
export async function saveBookmakerCredentialsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runSaveBookmakerCredentials(formData, siteActor(user)), "#bookmakers");
}

export async function deleteBookmakerCredentialsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runDeleteBookmakerCredentials(formData, siteActor(user)), "#bookmakers");
}

/** « Tester la connexion » : connexion au compte et capture de la page d'accueil, résultat sans aucun secret. */
export async function testBookmakerConnectionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runTestBookmakerConnection(formData, siteActor(user));
  if (!r.ok && (r.code === "forbidden" || r.code === "invalid" || r.code === "unavailable"))
    backTo(SPORTS, { error: r.error }, "#bookmakers");
  const bookmaker = formData.get("bookmaker");
  let params: Record<string, string> = r.ok ? { ok: r.message } : { error: r.error };
  if (r.assetId && isBookmakerKey(bookmaker)) params = { ...params, capture: r.assetId, bk: bookmaker };
  revalidatePath(SPORTS);
  backTo(SPORTS, params, "#bookmakers");
}

/** Adresse internet de secours des captures (seulement si le bookmaker bloque), chiffrée. */
export async function saveScreenshotProxyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runSaveScreenshotProxy(formData, siteActor(user)), "#bookmakers");
}

export async function deleteScreenshotProxyAction(): Promise<void> {
  const user = await requireUser();
  finish(await runDeleteScreenshotProxy(new FormData(), siteActor(user)), "#bookmakers");
}
