/**
 * Phase 34, lot D — cœurs de la fiche Casino (phase 22). Classer un média et produire un post de test : ADMIN et
 * MANAGER. Thèmes de l'équipe (ajouter, renommer, retirer) : ADMIN. Chaque geste laisse sa trace dans `AuditLog` (le
 * classement est journalisé par le moteur, `classifyCasinoMedia`).
 */
import { classifyCasinoMedia, createTestPostMission } from "@linkaffipro/agents";
import { audit } from "@linkaffipro/db";
import { addTheme, parseClassifyForm, parseCasinoTestPostForm, removeTheme, renameTheme } from "@/lib/agents/casino";
import { loadChannelsUsingTheme, loadThemeMediaCounts } from "@/lib/agents/casino-queries";
import { readCasinoSettingsRaw, writeCasinoSettings } from "@/lib/agents/casino-save";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, str, uid, type CoreRun, type Fail, type SiteOpActor } from "./kit";

const FORMAT_WORDS = { video: "vidéo", photo: "image", text: "texte" } as const;

/** Classe un média « à classer » (ou en change les thèmes). */
export const runClassifyCasinoMedia: CoreRun = async (fd, actor, opts = {}) => {
  const { settings } = await readCasinoSettingsRaw();
  const parsed = parseClassifyForm(fd, settings.themes);
  if (!parsed.ok) return fail(parsed.error);
  if (opts.dryRun) {
    const labels = parsed.data.themes.map((k) => settings.themes.find((t) => t.key === k)?.label ?? k);
    return preview(`Média rangé dans : ${labels.join(", ")}.`);
  }
  try {
    const r = await classifyCasinoMedia(buildAgentsDeps(), parsed.data, engineActor(actor));
    if (!r.ok) return fail(r.message || "Classement refusé.", "conflict");
    return ok(r.message || "Média rangé.");
  } catch (err) {
    return fail(`Classement impossible : ${errorText(err)}.`, "unavailable");
  }
};

/** « Produire un post de test » (vidéo, image ou texte) : simulation, canal Test. */
export const runCreateCasinoTestPost: CoreRun = async (fd, actor, opts = {}) => {
  const parsed = parseCasinoTestPostForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  const format = parsed.data;
  if (opts.dryRun) return preview(`Post de test Casino (${FORMAT_WORDS[format]}) en simulation sur le canal Test.`);
  try {
    const r = await createTestPostMission(buildAgentsDeps(), { teamKey: "casino", byUserId: actor.userId, format });
    await audit({
      userId: actor.userId,
      action: "agents.test_post_requested",
      entityType: "AgentMission",
      entityId: r.ok ? r.missionId : undefined,
      metadata: { teamKey: "casino", format, ok: r.ok, reason: r.ok ? null : r.reason, via: actor.via },
    });
    if (!r.ok) return fail(`Post de test refusé : ${r.reason}`, "conflict");
  } catch (err) {
    return fail(`Post de test impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(
    `Post de test (${FORMAT_WORDS[format]}) lancé en simulation : l'aperçu arrivera sur Telegram et dans Validations, puis sur le canal Test.`,
  );
};

const themesReserved = (actor: SiteOpActor): Fail | null =>
  actor.role === "ADMIN" ? null : forbidden("Les thèmes de l'équipe sont réservés aux administrateurs.");

export const runAddCasinoTheme: CoreRun = async (fd, actor, opts = {}) => {
  const denied = themesReserved(actor);
  if (denied) return denied;
  const { settings } = await readCasinoSettingsRaw();
  const r = addTheme(settings.themes, str(fd.get("label")));
  if (!r.ok) return fail(r.error, "invalid", "label");
  const added = r.data[r.data.length - 1]!;
  if (opts.dryRun) return preview(`Nouveau thème « ${added.label} » : mot-clé #casino #${added.key}.`);
  try {
    await writeCasinoSettings({ ...settings, themes: r.data }, uid(actor), "agents.casino_theme_added", {
      theme: added.key,
      label: added.label,
      via: actor.via,
    });
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(`Thème « ${added.label} » ajouté : mot-clé #casino #${added.key}.`, { key: added.key });
};

export const runRenameCasinoTheme: CoreRun = async (fd, actor, opts = {}) => {
  const denied = themesReserved(actor);
  if (denied) return denied;
  const { settings } = await readCasinoSettingsRaw();
  const key = str(fd.get("key"));
  const before = settings.themes.find((t) => t.key === key)?.label ?? null;
  const r = renameTheme(settings.themes, key, str(fd.get("label")));
  if (!r.ok) return fail(r.error);
  const after = r.data.find((t) => t.key === key)!.label;
  if (after === before) return ok("Nom du thème inchangé.");
  if (opts.dryRun) return preview(`Thème « ${before} » renommé « ${after} » (le mot-clé reste #${key}).`);
  try {
    await writeCasinoSettings({ ...settings, themes: r.data }, uid(actor), "agents.casino_theme_renamed", {
      theme: key,
      from: before,
      to: after,
      via: actor.via,
    });
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(`Thème renommé : « ${after} » (le mot-clé reste #${key}).`);
};

export const runRemoveCasinoTheme: CoreRun = async (fd, actor, opts = {}) => {
  const denied = themesReserved(actor);
  if (denied) return denied;
  const { settings } = await readCasinoSettingsRaw();
  const key = str(fd.get("key"));
  const [counts, channels] = await Promise.all([loadThemeMediaCounts([key]), loadChannelsUsingTheme(key)]);
  const r = removeTheme(settings.themes, key, { media: counts[key] ?? 0, channels });
  if (!r.ok) return fail(r.error, "conflict");
  const label = settings.themes.find((t) => t.key === key)?.label ?? key;
  if (opts.dryRun)
    return preview(`Retrait du thème « ${label} ».`, { impact: "Aucun média ni aucun plan de canal ne l'utilise." });
  try {
    await writeCasinoSettings({ ...settings, themes: r.data }, uid(actor), "agents.casino_theme_removed", { theme: key, label, via: actor.via });
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(`Thème « ${label} » retiré.`);
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();

/** Thème casino par son nom affiché ou son mot-clé (« Roulette », « #roulette »). */
export async function casinoThemeKey(raw: unknown): Promise<{ ok: true; key: string } | { ok: false; result: Fail }> {
  const { settings } = await readCasinoSettingsRaw();
  const n = norm(str(raw));
  const t = settings.themes.find((x) => x.key === n || norm(x.label) === n);
  if (t) return { ok: true, key: t.key };
  return {
    ok: false,
    result: fail(`Le thème « ${str(raw)} » n'existe pas. Thèmes : ${settings.themes.map((x) => x.label).join(", ")}.`, "not_found"),
  };
}

export async function kevinThemeForm(input: In, needKey: boolean): Promise<Prepared> {
  if (!needKey) return { ok: true, fd: formOf({ label: input.label ?? input.nom }) };
  const k = await casinoThemeKey(input.theme ?? input.key);
  if (!k.ok) return k;
  return { ok: true, fd: formOf({ key: k.key, label: input.label ?? input.nouveauNom }) };
}

/**
 * Classer un média par Kevin : `assetId` = identifiant, ou absent / « dernier » = le plus ancien média « à classer »
 * (photos et vidéos envoyées à Kevin avec #casino sans thème connu) ; `themes` = noms ou mots-clés.
 */
export async function kevinClassifyForm(input: In): Promise<Prepared> {
  let assetId = str(input.assetId ?? input.media).trim();
  if (!assetId || /^(dernier|derniere|dernière|suivant|le dernier)$/i.test(assetId)) {
    const { loadToClassify } = await import("@/lib/agents/casino-queries");
    const { rows } = await loadToClassify();
    const next = rows[0];
    if (!next) return { ok: false, result: fail("Aucun média à classer pour l'instant.", "not_found") };
    assetId = next.id;
  }
  const themes: string[] = [];
  for (const t of Array.isArray(input.themes) ? input.themes : input.themes !== undefined ? [input.themes] : []) {
    const k = await casinoThemeKey(t);
    if (!k.ok) return k;
    themes.push(k.key);
  }
  return { ok: true, fd: formOf({ assetId, theme: themes }) };
}

export function kevinCasinoTestPostForm(input: In): Prepared {
  const f = str(input.format).toLowerCase();
  const format = /^vid/.test(f) ? "video" : /^(photo|image)/.test(f) ? "photo" : /^text/.test(f) ? "text" : f;
  return { ok: true, fd: formOf({ format }) };
}
