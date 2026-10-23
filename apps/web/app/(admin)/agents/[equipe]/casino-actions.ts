"use server";

import { revalidatePath } from "next/cache";
import { classifyCasinoMedia, createTestPostMission } from "@linkaffipro/agents";
import { audit } from "@linkaffipro/db";
import { addTheme, parseClassifyForm, parseCasinoTestPostForm, removeTheme, renameTheme } from "@/lib/agents/casino";
import { loadChannelsUsingTheme, loadThemeMediaCounts } from "@/lib/agents/casino-queries";
import { readCasinoSettingsRaw, writeCasinoSettings } from "@/lib/agents/casino-save";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche d'équipe Casino (phase 22). Classer un média et produire un post de test : ADMIN et MANAGER.
 * Liste des thèmes (ajout, renommage, retrait) : ADMIN seulement. Chaque action laisse sa trace dans `AuditLog`
 * (le classement est journalisé par le moteur, `classifyCasinoMedia`).
 */

const CASINO = "/agents/casino";
const FORMAT_WORDS = { video: "vidéo", photo: "image", text: "texte" } as const;

/** Classe un média « à classer » (ou en change les thèmes) depuis la fiche. */
export async function classifyCasinoMediaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const { settings } = await readCasinoSettingsRaw();
  const parsed = parseClassifyForm(formData, settings.themes);
  if (!parsed.ok) backTo(CASINO, { error: parsed.error }, "#a-classer");
  let message = "";
  try {
    const r = await classifyCasinoMedia(buildAgentsDeps(), parsed.data, { userId: user.id, via: "SITE" });
    if (!r.ok) backTo(CASINO, { error: r.message || "Classement refusé." }, "#a-classer");
    message = r.message;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(CASINO, { error: `Classement impossible : ${errorText(err)}.` }, "#a-classer");
  }
  revalidatePath(CASINO);
  backTo(CASINO, { ok: message || "Média rangé." }, "#a-classer");
}

/** « Produire un post de test » (vidéo, image ou texte) : simulation, canal Test. */
export async function createCasinoTestPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parseCasinoTestPostForm(formData);
  if (!parsed.ok) backTo(CASINO, { error: parsed.error }, "#production");
  const format = parsed.data;
  try {
    const r = await createTestPostMission(buildAgentsDeps(), { teamKey: "casino", byUserId: user.id, format });
    await audit({
      userId: user.id,
      action: "agents.test_post_requested",
      entityType: "AgentMission",
      entityId: r.ok ? r.missionId : undefined,
      metadata: { teamKey: "casino", format, ok: r.ok, reason: r.ok ? null : r.reason },
    });
    revalidatePath("/agents", "layout");
    if (!r.ok) backTo(CASINO, { error: `Post de test refusé : ${r.reason}` }, "#production");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(CASINO, { error: `Post de test impossible : ${errorText(err)}.` }, "#production");
  }
  backTo(
    CASINO,
    {
      ok: `Post de test (${FORMAT_WORDS[format]}) lancé en simulation : l'aperçu arrivera sur Telegram et dans Validations, puis sur le canal Test.`,
    },
    "#production",
  );
}

async function adminOrBack(): Promise<string> {
  const user = await requireUser();
  if (user.role !== "ADMIN") backTo(CASINO, { error: "Les thèmes de l'équipe sont réservés aux administrateurs." }, "#themes");
  return user.id;
}

export async function addCasinoThemeAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack();
  const { settings } = await readCasinoSettingsRaw();
  const r = addTheme(settings.themes, String(formData.get("label") ?? ""));
  if (!r.ok) backTo(CASINO, { error: r.error }, "#themes");
  const added = r.data[r.data.length - 1]!;
  try {
    await writeCasinoSettings({ ...settings, themes: r.data }, userId, "agents.casino_theme_added", { theme: added.key, label: added.label });
  } catch (err) {
    backTo(CASINO, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#themes");
  }
  revalidatePath(CASINO);
  backTo(CASINO, { ok: `Thème « ${added.label} » ajouté : mot-clé #casino #${added.key}.` }, "#themes");
}

export async function renameCasinoThemeAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack();
  const { settings } = await readCasinoSettingsRaw();
  const key = String(formData.get("key") ?? "");
  const before = settings.themes.find((t) => t.key === key)?.label ?? null;
  const r = renameTheme(settings.themes, key, String(formData.get("label") ?? ""));
  if (!r.ok) backTo(CASINO, { error: r.error }, "#themes");
  const after = r.data.find((t) => t.key === key)!.label;
  if (after === before) backTo(CASINO, { ok: "Nom du thème inchangé." }, "#themes");
  try {
    await writeCasinoSettings({ ...settings, themes: r.data }, userId, "agents.casino_theme_renamed", { theme: key, from: before, to: after });
  } catch (err) {
    backTo(CASINO, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#themes");
  }
  revalidatePath(CASINO);
  backTo(CASINO, { ok: `Thème renommé : « ${after} » (le mot-clé reste #${key}).` }, "#themes");
}

export async function removeCasinoThemeAction(formData: FormData): Promise<void> {
  const userId = await adminOrBack();
  const { settings } = await readCasinoSettingsRaw();
  const key = String(formData.get("key") ?? "");
  const [counts, channels] = await Promise.all([loadThemeMediaCounts([key]), loadChannelsUsingTheme(key)]);
  const r = removeTheme(settings.themes, key, { media: counts[key] ?? 0, channels });
  if (!r.ok) backTo(CASINO, { error: r.error }, "#themes");
  const label = settings.themes.find((t) => t.key === key)?.label ?? key;
  try {
    await writeCasinoSettings({ ...settings, themes: r.data }, userId, "agents.casino_theme_removed", { theme: key, label });
  } catch (err) {
    backTo(CASINO, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#themes");
  }
  revalidatePath(CASINO);
  backTo(CASINO, { ok: `Thème « ${label} » retiré.` }, "#themes");
}
