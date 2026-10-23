/**
 * Manques de la médiathèque casino : demande de vidéos groupée et alerte `agents_media_low`.
 * - Demande : UN seul message Telegram par jour au plus pour tous les thèmes et canaux en manque (thème, nombre
 *   souhaité, canaux, mot-clé exact « #casino #roulette ») ; un thème déjà demandé n'est pas redemandé avant 3 jours ;
 *   rien tant qu'une demande casino précédente est encore ouverte (`HumanRequest` MEDIA, clé `media.casino.<jour>`).
 *   État dans `Setting` `agents.casino.mediaAsked` = `{ lastDay, themes: { <thème>: <jour> } }`.
 * - Alerte : une par canal en manque (clé = canal), une par 24 h, résolue quand le stock revient ; coupable dans
 *   Réglages → Alertes.
 * Seuls les canaux casino au plan activé comptent : on ne réclame rien pour un canal que l'équipe ne gère pas.
 */
import { ALERT_SETTINGS_KEY, parseAlertSwitches } from "@linkaffipro/core";
import { nowOf, readSetting, writeSetting } from "../admin/journal";
import { syncDropAlerts, type DropCandidate } from "../algo/alerts";
import { askHuman } from "../human/requests";
import { addDaysToDay, parisDay } from "../rules/time";
import type { AgentsDeps } from "../types";
import type { CasinoStockRow } from "./contracts";
import { casinoPlans } from "./data";
import { loadCasinoSettings } from "./settings";
import { computeCasinoStock } from "./stock";

export const CASINO_MEDIA_ASKED_KEY = "agents.casino.mediaAsked";
export const MEDIA_LOW_KIND = "agents_media_low";
/** Un thème demandé n'est pas redemandé avant ce nombre de jours. */
export const CASINO_REASK_DAYS = 3;
/** Vidéos visées par thème et par canal (le client en envoie 3 à 5). */
export const CASINO_TARGET_STOCK = 5;
/** Thèmes détaillés dans le message (5 lignes au plus) ; les autres sont résumés. */
const MAX_THEMES_IN_MESSAGE = 3;

export type MediaAskedState = { lastDay: string | null; themes: Record<string, string> };

export function parseAskedState(v: unknown): MediaAskedState {
  const r = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const themes: Record<string, string> = {};
  if (r.themes && typeof r.themes === "object")
    for (const [k, d] of Object.entries(r.themes as Record<string, unknown>)) if (typeof d === "string") themes[k] = d;
  return { lastDay: typeof r.lastDay === "string" ? r.lastDay : null, themes };
}

export type ThemeNeed = { theme: string; wanted: number; channels: string[]; channelIds: string[] };

/**
 * Demande du jour (pur) : null si une demande est déjà partie aujourd'hui ou si aucun thème en manque n'est à
 * (re)demander. Un thème par entrée, tous les canaux en manque de ce thème, nombre souhaité = de quoi revenir à 5.
 */
export function planCasinoRequest(rows: readonly CasinoStockRow[], state: MediaAskedState, today: string, lowStock: number): ThemeNeed[] | null {
  if (state.lastDay === today) return null;
  const by = new Map<string, { min: number; channels: string[]; channelIds: string[] }>();
  for (const r of rows) {
    if (r.state === "ok") continue;
    const asked = state.themes[r.theme];
    if (asked && today < addDaysToDay(asked, CASINO_REASK_DAYS)) continue;
    const g = by.get(r.theme) ?? { min: Number.POSITIVE_INFINITY, channels: [], channelIds: [] };
    g.min = Math.min(g.min, r.unused);
    if (!g.channels.includes(r.channelTitle)) g.channels.push(r.channelTitle);
    if (!g.channelIds.includes(r.channelId)) g.channelIds.push(r.channelId);
    by.set(r.theme, g);
  }
  if (!by.size) return null;
  const target = Math.max(CASINO_TARGET_STOCK, lowStock);
  return [...by.entries()]
    .map(([theme, g]) => ({ theme, wanted: Math.max(1, target - g.min), channels: g.channels, channelIds: g.channelIds }))
    .sort((a, b) => b.wanted - a.wanted || a.theme.localeCompare(b.theme));
}

/** Message groupé (pur) : 5 lignes au plus, mot-clé exact par thème. */
export function casinoRequestQuestion(needs: readonly ThemeNeed[]): string {
  const shown = needs.slice(0, MAX_THEMES_IN_MESSAGE);
  const lines = ["Il manque des vidéos casino. Envoie-les au bot avec la légende indiquée :"];
  for (const n of shown)
    lines.push(`• ${n.wanted} vidéo${n.wanted > 1 ? "s" : ""} ${n.theme} avec #casino #${n.theme} (${n.channels.slice(0, 3).join(", ")}${n.channels.length > 3 ? "…" : ""})`);
  const rest = needs.length - shown.length;
  lines.push(rest > 0 ? `Et ${rest} autre${rest > 1 ? "s" : ""} thème${rest > 1 ? "s" : ""} : voir Agents → Casino. Ou réponds « plus tard ».` : "Ou réponds « plus tard ».");
  return lines.join("\n");
}

/** Alertes par canal (pur). */
export function mediaLowCandidates(rows: readonly CasinoStockRow[]): DropCandidate[] {
  const by = new Map<string, { title: string; themes: CasinoStockRow[] }>();
  for (const r of rows) {
    if (r.state === "ok") continue;
    const g = by.get(r.channelId) ?? { title: r.channelTitle, themes: [] };
    g.themes.push(r);
    by.set(r.channelId, g);
  }
  return [...by.entries()].map(([channelId, g]) => ({
    kind: MEDIA_LOW_KIND,
    key: channelId,
    message: `Le canal « ${g.title} » manque de vidéos : ${g.themes.map((t) => `${t.theme} (${t.unused})`).join(", ")}. Envoyez-les au bot avec #casino #<thème>.`,
    payload: { key: channelId, channelId, themes: g.themes.map((t) => ({ theme: t.theme, unused: t.unused })) },
  }));
}

export type CasinoStockCheck = { lowRows: number; requested: string[] | null; alerts: { created: number; resolved: number } | { skipped: string } };

/** Passage de contrôle du stock (cycle du Grand Chef et après chaque choix de média). Ne lève jamais. */
export async function runCasinoStockCheck(deps: AgentsDeps): Promise<CasinoStockCheck | { error: string }> {
  try {
    const now = nowOf(deps);
    const [plans, settings] = await Promise.all([casinoPlans(deps.prisma), loadCasinoSettings(deps.prisma)]);
    const enabled = new Set([...plans.values()].filter((p) => p.enabled).map((p) => p.channelId));
    const rows = enabled.size ? (await computeCasinoStock(deps.prisma, { now })).filter((r) => enabled.has(r.channelId)) : [];
    const low = rows.filter((r) => r.state !== "ok");

    const switches = parseAlertSwitches((await deps.prisma.setting.findUnique({ where: { key: ALERT_SETTINGS_KEY } }))?.value);
    const alerts = switches[MEDIA_LOW_KIND]
      ? await syncDropAlerts(deps, MEDIA_LOW_KIND, mediaLowCandidates(low), now)
      : (await syncDropAlerts(deps, MEDIA_LOW_KIND, [], now), { skipped: "alerte désactivée" });

    const requested = await maybeRequestCasinoMedia(deps, low, settings.lowStock, now);
    return { lowRows: low.length, requested, alerts };
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[agents] contrôle du stock casino impossible");
    return { error: (err as Error).message };
  }
}

async function maybeRequestCasinoMedia(deps: AgentsDeps, low: readonly CasinoStockRow[], lowStock: number, now: Date): Promise<string[] | null> {
  if (!low.length) return null;
  const today = parisDay(now);
  const state = parseAskedState(await readSetting(deps, CASINO_MEDIA_ASKED_KEY));
  const needs = planCasinoRequest(low, state, today, lowStock);
  if (!needs) return null;
  // Une demande casino encore ouverte : le client ne reçoit pas une seconde liste par-dessus.
  const open = await deps.prisma.humanRequest.findFirst({
    where: { kind: "MEDIA", key: { startsWith: "media.casino." }, status: { in: ["QUEUED", "PENDING"] } },
    select: { id: true },
  });
  if (open) return null;
  // Marqué avant l'envoi : jamais deux demandes le même jour, même si deux passages se croisent.
  const themes = { ...state.themes };
  for (const n of needs) themes[n.theme] = today;
  await writeSetting(deps, CASINO_MEDIA_ASKED_KEY, { lastDay: today, themes });
  await askHuman(deps, {
    teamKey: "casino",
    kind: "MEDIA",
    key: `media.casino.${today}`,
    question: casinoRequestQuestion(needs),
    expected: {
      count: needs.reduce((s, n) => s + n.wanted, 0),
      tags: needs.length === 1 ? ["casino", needs[0]!.theme] : ["casino"],
      channelIds: [...new Set(needs.flatMap((n) => n.channelIds))],
    },
    onAnswer: { resume: false, themes: needs.map((n) => n.theme) },
  });
  return needs.map((n) => n.theme);
}
