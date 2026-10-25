/**
 * Phase 34, lot D — cœurs de la page Agent Ads (`/agents/ads`, phase 24). « Fait » / « Refuser » une recommandation
 * (managers compris : le client dit ce qu'il a fait lui-même chez Meta ou TikTok, rien n'est jamais changé sur les
 * plateformes) ; seuils par univers et réglages des alertes (administrateurs, `AuditLog` avant / après).
 */
import { markAdsRecommendation } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { MARK_WORDS, canMarkRecommendation, cleanComment } from "@/lib/agents/ads/display";
import { parseAdsAlertSettingsForm } from "@/lib/agents/ads/alert-settings";
import { saveAdsAlertSettings, saveAdsThresholds } from "@/lib/agents/ads/save";
import { parseAdsThresholdsForm } from "@/lib/agents/ads/thresholds";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, str, uid, type CoreRun, type Fail } from "./kit";

export const runMarkAdsRecommendation: CoreRun = async (fd, actor, opts = {}) => {
  const status = fd.get("status");
  const id = str(fd.get("id"));
  if ((status !== "DONE" && status !== "REJECTED") || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail("Recommandation inconnue.");
  const rec = await prisma.recommendation.findUnique({ where: { id }, select: { teamKey: true, status: true } });
  if (!rec || rec.teamKey !== "ads") return fail("Recommandation introuvable.", "not_found");
  if (!canMarkRecommendation(rec.status)) return fail("Cette recommandation a déjà changé d'état : rechargez la page.", "conflict");
  if (opts.dryRun)
    return preview(status === "DONE" ? "Noter la recommandation comme faite (rien n'est changé chez Meta ni TikTok)." : "Refuser la recommandation.");
  let result: { ok: boolean; message: string };
  try {
    result = await markAdsRecommendation(buildAgentsDeps(), { id, status, comment: cleanComment(fd.get("comment")) }, engineActor(actor));
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!result.ok) return fail(result.message || "Refusé par l'Agent Ads.", "conflict");
  return ok(result.message || MARK_WORDS[status].done);
};

/** Seuils par univers (ADMIN). */
export const runSaveAdsThresholds: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden("Les seuils de l'Agent Ads sont réservés aux administrateurs.");
  const parsed = parseAdsThresholdsForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  if (opts.dryRun) {
    const words: Record<string, string> = { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Rencontres" };
    return preview(
      Object.entries(parsed.data)
        .map(
          ([u, t]) =>
            `${words[u] ?? u} : coût par inscription visé ${t.targetCostPerRegistration ?? "automatique"}, retour sur dépense minimal ${t.minRoas ?? "automatique"}, ${t.observationDays} j, ${t.minSpend} € minimum`,
        )
        .join(" ; "),
    );
  }
  try {
    await saveAdsThresholds(parsed.data, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok("Seuils enregistrés : ils comptent dès le prochain passage de l'Agent Ads.");
};

/** Réglages des alertes de l'Agent Ads (ADMIN) : `Setting` `agents.ads.alerts`. */
export const runSaveAdsAlertSettings: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden("Les réglages des alertes de l'Agent Ads sont réservés aux administrateurs.");
  const parsed = parseAdsAlertSettingsForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  const d = parsed.data;
  if (opts.dryRun)
    return preview(
      `Alerte si la dépense monte de plus de ${d.spikePct} % (à partir de ${d.minDailySpend} € par jour) ou si les inscriptions baissent de plus de ${d.dropPct} % (à partir de ${d.minRegistrations} inscriptions).`,
    );
  try {
    await saveAdsAlertSettings(d, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok("Réglages des alertes enregistrés : ils comptent dès le prochain passage de l'Agent Ads (30 minutes au plus).");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

const UNIVERSES: Record<string, "CASINO" | "SPORTS" | "DATING"> = {
  casino: "CASINO",
  sports: "SPORTS",
  sport: "SPORTS",
  paris: "SPORTS",
  "paris sportifs": "SPORTS",
  dating: "DATING",
  rencontres: "DATING",
  rencontre: "DATING",
};

const THRESHOLD_KEYS = ["targetCostPerRegistration", "minRoas", "observationDays", "minSpend"] as const;

/**
 * Seuils par Kevin : `univers` (Casino, Paris sportifs, Rencontres) et les valeurs à changer ; les autres univers et
 * valeurs gardent leur réglage. `null` = « automatique » (coût visé, retour sur dépense).
 */
export async function kevinAdsThresholdsForm(input: In): Promise<Prepared> {
  const { ADS_THRESHOLDS_KEY, parseAdsThresholds, thresholdField, ADS_UNIVERSES } = await import("@/lib/agents/ads/thresholds");
  const row = await prisma.setting.findUnique({ where: { key: ADS_THRESHOLDS_KEY }, select: { value: true } });
  const cur = parseAdsThresholds(row?.value);
  const u = UNIVERSES[str(input.univers).trim().toLowerCase()] ?? (str(input.univers).toUpperCase() as "CASINO");
  if (!ADS_UNIVERSES.includes(u)) return { ok: false, result: fail("Pour quel univers ? Casino, Paris sportifs ou Rencontres.", "invalid", "univers") };
  const form: In = {};
  for (const x of ADS_UNIVERSES)
    for (const k of THRESHOLD_KEYS) {
      const given = x === u && k in input ? input[k] : undefined;
      const v = given !== undefined ? given : cur[x][k];
      if (v !== null && v !== "") form[thresholdField(x, k)] = v;
    }
  return { ok: true, fd: formOf(form) };
}

/** Alertes Ads par Kevin : valeurs actuelles gardées pour ce qu'il ne donne pas. */
export async function kevinAdsAlertsForm(input: In): Promise<Prepared> {
  const { ADS_ALERTS_KEY, parseAdsAlertSettingsValue, alertField } = await import("@/lib/agents/ads/alert-settings");
  const row = await prisma.setting.findUnique({ where: { key: ADS_ALERTS_KEY }, select: { value: true } });
  const cur = parseAdsAlertSettingsValue(row?.value);
  const form: In = {};
  for (const k of Object.keys(cur) as Array<keyof typeof cur>) form[alertField(k)] = input[k] ?? cur[k];
  return { ok: true, fd: formOf(form) };
}

export function kevinAdsMarkForm(input: In): Prepared {
  const s = str(input.status ?? input.etat).toLowerCase();
  const status = /^(done|fait|faite)$/.test(s) ? "DONE" : /^(rejected|refus|refuse|refusée|refusee)/.test(s) ? "REJECTED" : s;
  return { ok: true, fd: formOf({ id: input.id ?? input.recommandation, status, comment: input.commentaire ?? input.comment }) };
}
