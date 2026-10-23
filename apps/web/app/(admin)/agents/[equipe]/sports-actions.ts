"use server";

import { revalidatePath } from "next/cache";
import { createTestBetMission, deleteSecret, saveSecret, testBookmakerConnection } from "@linkaffipro/agents";
import { audit } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { loadChannelPlans, loadPlanChoices } from "@/lib/agents/queries";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import {
  SCREENSHOT_PROXY_KEY,
  bookmakerLabel,
  bookmakerSecretKeys,
  isBookmakerKey,
  parseBetCategoryForm,
  parseBookmakerCredentialsForm,
  parseProxyValue,
  parseTestBetForm,
} from "@/lib/agents/sports";
import { loadBetCategories } from "@/lib/agents/sports-queries";
import { loadCategoryKeys, saveBetCategory } from "@/lib/agents/sports-save";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche Paris sportifs (phase 23). « Produire un pari de test » : ADMIN et MANAGER. Catégories,
 * identifiants du bookmaker, adresse de secours des captures et « Tester la connexion » : ADMIN seulement. Chaque
 * action laisse sa trace dans `AuditLog` (les clés par `saveSecret` / `deleteSecret`, sans jamais leur valeur).
 */

const SPORTS = "/agents/sports";

async function adminOrBack(hash: string, what: string): Promise<string> {
  const user = await requireUser();
  if (user.role !== "ADMIN") backTo(SPORTS, { error: `${what} : réservé aux administrateurs.` }, hash);
  return user.id;
}

/** Crée ou modifie une catégorie de paris. */
export async function saveBetCategoryAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack("#categories", "Les catégories de paris");
  const [plans, choices, takenKeys] = await Promise.all([
    loadChannelPlans("sports"),
    loadPlanChoices("sports"),
    loadCategoryKeys(),
  ]);
  const parsed = parseBetCategoryForm(formData, {
    channelIds: plans.map((c) => c.id),
    campaignIds: choices.campaigns.map((c) => c.id),
    takenKeys,
  });
  if (!parsed.ok) backTo(SPORTS, { error: parsed.error }, "#categories");
  let message = "";
  try {
    const r = await saveBetCategory(parsed.data, userId);
    if (!r.ok) backTo(SPORTS, { error: r.error }, "#categories");
    message = !parsed.data.id
      ? `Catégorie « ${parsed.data.name} » créée${parsed.data.active ? "" : " (inactive : cochez « Active » pour qu'elle serve)"}.`
      : r.changed.length
        ? `Catégorie « ${parsed.data.name} » enregistrée.`
        : `Catégorie « ${parsed.data.name} » inchangée.`;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#categories");
  }
  revalidatePath(SPORTS);
  backTo(SPORTS, { ok: message }, "#categories");
}

/** « Produire un pari de test » : faux fournisseur de cotes, page locale, simulation, canal Test. */
export async function createTestBetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const categories = await loadBetCategories();
  const parsed = parseTestBetForm(
    formData,
    categories.map((c) => c.id),
  );
  if (!parsed.ok) backTo(SPORTS, { error: parsed.error }, "#paris");
  try {
    const r = await createTestBetMission(buildAgentsDeps(), { categoryId: parsed.data.categoryId, byUserId: user.id });
    await audit({
      userId: user.id,
      action: "agents.test_bet_requested",
      entityType: "AgentMission",
      entityId: r.ok ? r.missionId : undefined,
      metadata: { teamKey: "sports", categoryId: parsed.data.categoryId, ok: r.ok, reason: r.ok ? null : r.reason },
    });
    revalidatePath("/agents", "layout");
    if (!r.ok) backTo(SPORTS, { error: `Pari de test refusé : ${r.reason}` }, "#paris");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Pari de test impossible : ${errorText(err)}.` }, "#paris");
  }
  backTo(
    SPORTS,
    {
      ok: "Pari de test lancé en simulation (cotes d'essai, aucune vraie mise) : il apparaît dans « Paris du jour », puis sur le canal Test.",
    },
    "#paris",
  );
}

function bookmakerOf(formData: FormData): string {
  const v = formData.get("bookmaker");
  if (!isBookmakerKey(v)) backTo(SPORTS, { error: "Bookmaker inconnu : rechargez la page." }, "#bookmakers");
  return v;
}

/** Identifiant et mot de passe du compte bookmaker (secours du bot Telegram), chiffrés par le moteur. */
export async function saveBookmakerCredentialsAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack("#bookmakers", "Les comptes bookmaker");
  const parsed = parseBookmakerCredentialsForm(formData);
  if (!parsed.ok) backTo(SPORTS, { error: parsed.error }, "#bookmakers");
  const { bookmaker, login, password } = parsed.data;
  const keys = bookmakerSecretKeys(bookmaker);
  try {
    const deps = buildAgentsDeps();
    await saveSecret(deps, keys.login, login, { userId, via: "SITE" });
    await saveSecret(deps, keys.password, password, { userId, via: "SITE" });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#bookmakers");
  }
  revalidatePath(SPORTS);
  backTo(
    SPORTS,
    { ok: `Identifiants ${bookmakerLabel(bookmaker)} enregistrés (chiffrés). Cliquez sur « Tester la connexion ».` },
    "#bookmakers",
  );
}

export async function deleteBookmakerCredentialsAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack("#bookmakers", "Les comptes bookmaker");
  const bookmaker = bookmakerOf(formData);
  const keys = bookmakerSecretKeys(bookmaker);
  try {
    const deps = buildAgentsDeps();
    await deleteSecret(deps, keys.login, { userId, via: "SITE" });
    await deleteSecret(deps, keys.password, { userId, via: "SITE" });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Suppression impossible : ${errorText(err)}.` }, "#bookmakers");
  }
  revalidatePath(SPORTS);
  backTo(SPORTS, { ok: `Identifiants ${bookmakerLabel(bookmaker)} retirés.` }, "#bookmakers");
}

/** « Tester la connexion » : connexion au compte et capture de la page d'accueil, résultat sans aucun secret. */
export async function testBookmakerConnectionAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack("#bookmakers", "Le test de connexion");
  const bookmaker = bookmakerOf(formData);
  const name = bookmakerLabel(bookmaker);
  let params: Record<string, string> = {};
  try {
    const r = await testBookmakerConnection(buildAgentsDeps(), bookmaker);
    const ok = r.result.ok;
    await audit({
      userId,
      action: "agents.bookmaker_tested",
      entityType: "Bookmaker",
      entityId: bookmaker,
      metadata: {
        ok,
        kind: r.result.ok ? null : r.result.kind,
        message: r.message.slice(0, 300),
        assetId: r.assetId,
      },
    });
    params = ok
      ? { ok: `${name} : ${r.message || "connexion réussie."}` }
      : { error: `${name} : ${r.message || "connexion impossible."}` };
    if (r.assetId) params = { ...params, capture: r.assetId, bk: bookmaker };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Test impossible : ${errorText(err)}.` }, "#bookmakers");
  }
  revalidatePath(SPORTS);
  backTo(SPORTS, params, "#bookmakers");
}

/** Adresse internet de secours des captures (seulement si le bookmaker bloque), chiffrée. */
export async function saveScreenshotProxyAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack("#bookmakers", "L'adresse de secours");
  const raw = formData.get("proxy");
  const parsed = parseProxyValue(typeof raw === "string" ? raw : "");
  if (!parsed.ok) backTo(SPORTS, { error: parsed.error }, "#bookmakers");
  try {
    await saveSecret(buildAgentsDeps(), SCREENSHOT_PROXY_KEY, parsed.data, { userId, via: "SITE" });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#bookmakers");
  }
  revalidatePath(SPORTS);
  backTo(SPORTS, { ok: "Adresse de secours enregistrée (chiffrée). Refaites « Tester la connexion »." }, "#bookmakers");
}

export async function deleteScreenshotProxyAction(): Promise<void> {
  const userId = await adminOrBack("#bookmakers", "L'adresse de secours");
  try {
    await deleteSecret(buildAgentsDeps(), SCREENSHOT_PROXY_KEY, { userId, via: "SITE" });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(SPORTS, { error: `Suppression impossible : ${errorText(err)}.` }, "#bookmakers");
  }
  revalidatePath(SPORTS);
  backTo(SPORTS, { ok: "Adresse de secours retirée." }, "#bookmakers");
}
