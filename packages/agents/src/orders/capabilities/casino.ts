/**
 * Capacités du Chef Casino (phase 33) : uniquement avec les médias fournis par le client (thèmes de la médiathèque,
 * rotation 30 jours, jamais de média généré) ; stock insuffisant pour la période → raison et replis (moins de posts
 * par jour, moins de jours, posts texte, demande de médias au client). Question : stock, thèmes, rotation.
 */
import { nowOf } from "../../admin/journal";
import { matchNames } from "../../boss/resolve";
import { CASINO_DEFAULT_MIX } from "../../casino/format";
import { computeCasinoStock } from "../../casino/stock";
import { casinoPlans, channelThemes, loadCasinoAssets, loadUsages } from "../../casino/data";
import { blockedAssets, isKind } from "../../casino/pick";
import { assetHasTheme } from "../../casino/rotation";
import { casinoRequestQuestion } from "../../casino/requests";
import { loadCasinoSettings, themeKey } from "../../casino/settings";
import { readCasinoThemes } from "../../casino/themes";
import { askHuman } from "../../human/requests";
import type { AgentsDeps } from "../../types";
import { alt, defineCapability, done, list, ok, readOnly, refuse, type Mix } from "./kit";
import { changePlan, postUnique, programPosts, questionCapability, teamDayFacts, wantedMix, type PostsTeam, type ProgramPostsP } from "./posts";

const T = "casino" as const;
const AGENTS = ["mediatheque", "redaction", "planification", "controle", "publication"];

async function resolveCasinoThemes(deps: AgentsDeps, raw: readonly string[]): Promise<{ ok: true; themes: string[] } | { ok: false; unknown: string; known: string[] }> {
  const known = await readCasinoThemes(deps);
  const items = known.map((k) => ({ id: k, name: k, extra: [k.replace(/-/g, " ")] }));
  const out: string[] = [];
  for (const r of raw) {
    const k = themeKey(r);
    const hit = known.includes(k) ? k : (matchNames(r, items)[0]?.id ?? matchNames(r.replace(/s\b/g, ""), items)[0]?.id ?? null);
    if (!hit) return { ok: false, unknown: r, known };
    if (!out.includes(hit)) out.push(hit);
  }
  return { ok: true, themes: out };
}

/** Médias fournis (vidéos et images) utilisables sur un canal pour ces thèmes, rotation comprise (lecture seule). */
export async function casinoMediaAvailable(deps: AgentsDeps, channelId: string, themes: readonly string[]): Promise<number> {
  const now = nowOf(deps);
  const [settings, assets] = await Promise.all([loadCasinoSettings(deps.prisma), loadCasinoAssets(deps.prisma)]);
  const plans = await casinoPlans(deps.prisma);
  const wanted = themes.length ? themes : channelThemes(plans.get(channelId), settings).map((t) => t.theme);
  const usages = await loadUsages(deps.prisma, assets.map((a) => a.id));
  const blocked = blockedAssets(usages, channelId, now, settings.rotationDays);
  return assets.filter((a) => a.origin === "HUMAN" && (isKind(a, "video") || isKind(a, "photo")) && wanted.some((t) => assetHasTheme(a, t)) && !blocked.has(a.id)).length;
}

const mediaShare = (m: Mix) => (m.video + m.photo) / Math.max(1e-9, m.video + m.photo + m.text);

export const CASINO_TEAM: PostsTeam = {
  teamKey: T,
  agents: AGENTS,
  usesPersona: false,
  defaultMix: { ...CASINO_DEFAULT_MIX },
  async themes(deps, p) {
    if (!p.themes?.length) return { ok: true, themes: [] };
    const r = await resolveCasinoThemes(deps, p.themes);
    if (r.ok) return r;
    return {
      ok: false,
      check: refuse(
        `L'équipe Casino ne connaît pas le thème « ${r.unknown.slice(0, 40)} » : elle ne publie que tes médias, rangés par thèmes (${r.known.join(", ")}).`,
        r.known.slice(0, 4).map((k) => alt(`thème ${k}`, T, "programmer_posts", { ...p, themes: [k] })),
      ),
    };
  },
  async extraCheck(deps, p, c) {
    const s = await loadCasinoSettings(deps.prisma);
    const share = mediaShare(wantedMix(p) ?? c.mix);
    if (share <= 0) return ok();
    const days = Math.min(c.days, s.rotationDays);
    for (const ch of c.channels) {
      const available = await casinoMediaAvailable(deps, ch.id, c.themes);
      const needed = Math.ceil(c.perDay * days * share);
      if (available >= needed) continue;
      const perDayFit = Math.floor(available / Math.max(1e-9, days * share));
      const daysFit = Math.floor(available / Math.max(1e-9, c.perDay * share));
      const base: ProgramPostsP = { ...p };
      return refuse(
        `Pas assez de médias pour ${ch.isTest ? "le canal Test" : ch.title} : ${available} média${available > 1 ? "s" : ""} fourni${available > 1 ? "s" : ""}${c.themes.length ? ` (${c.themes.join(", ")})` : ""} pour ${needed} posts avec média sur ${c.days} jours. L'équipe Casino ne publie que tes médias.`,
        [
          ...(perDayFit >= 1 ? [alt(`${perDayFit} post${perDayFit > 1 ? "s" : ""} par jour au lieu de ${c.perDay}`, T, "programmer_posts", { ...base, posts_par_jour: perDayFit })] : []),
          ...(daysFit >= 1 && daysFit < c.days ? [alt(`${daysFit} jour${daysFit > 1 ? "s" : ""} au lieu de ${c.days}`, T, "programmer_posts", { ...base, jours: daysFit })] : []),
          alt("je te demande les médias qui manquent", T, "demander_medias", { themes: c.themes.length ? c.themes : undefined, nombre: needed - available }),
          alt("des posts texte en attendant", T, "programmer_posts", { ...base, format: "texte", video: undefined, photo: undefined, texte: undefined }),
        ],
      );
    }
    return ok();
  },
};

type AskMediaP = { themes?: string[]; nombre?: number };

export const demanderMedias = defineCapability<AskMediaP>({
  teamKey: T,
  key: "demander_medias",
  description: "Demander au client des vidéos casino (par thème) pour la médiathèque",
  agents: ["mediatheque"],
  spec: { themes: list("Thèmes casino", { optional: true, maxItems: 8 }), nombre: { kind: "int", description: "Vidéos voulues", min: 1, max: 100, optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    if (!p.themes?.length) return ok();
    const r = await resolveCasinoThemes(deps, p.themes);
    return r.ok ? ok() : refuse(`Thème casino inconnu : « ${r.unknown} ».`, r.known.slice(0, 4).map((k) => alt(`thème ${k}`, T, "demander_medias", { ...p, themes: [k] })));
  },
  async plan(deps, p) {
    const r = p.themes?.length ? await resolveCasinoThemes(deps, p.themes) : { ok: true as const, themes: await readCasinoThemes(deps) };
    const themes = r.ok ? r.themes.slice(0, 5) : [];
    return [{ stepKey: "demander_medias", capability: "demander_medias", teamKey: T, summary: `demander ${p.nombre ?? 5} vidéos casino (${themes.join(", ")})`, touches: readOnly(), params: { themes, nombre: p.nombre ?? 5 } }];
  },
  async run(deps, order, step) {
    const themes = (step.params.themes as string[]) ?? [];
    const n = Number(step.params.nombre ?? 5);
    const per = Math.max(1, Math.ceil(n / Math.max(1, themes.length)));
    const needs = themes.map((theme) => ({ theme, wanted: per, channels: [] as string[], channelIds: [] as string[] }));
    const r = await askHuman(deps, {
      teamKey: T,
      kind: "MEDIA",
      key: `media.casino.order.${order.id}`,
      question: casinoRequestQuestion(needs),
      expected: { count: n, tags: themes.length === 1 ? ["casino", themes[0]!] : ["casino"], channelIds: [] },
      onAnswer: { resume: false, themes },
    });
    return done(r.sent ? "Demande de médias envoyée." : "Demande de médias en file (une question à la fois).");
  },
  async report() {
    return {};
  },
});

async function casinoFacts(deps: AgentsDeps): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const [day, rows, themes, settings] = await Promise.all([teamDayFacts(deps, T), computeCasinoStock(deps.prisma, { now: nowOf(deps) }), readCasinoThemes(deps), loadCasinoSettings(deps.prisma)]);
  const low = rows.filter((r) => r.state !== "ok");
  return {
    facts: { ...day.facts, themes, rotationJours: settings.rotationDays, stock: rows.map((r) => ({ canal: r.channelTitle, theme: r.theme, nonUtilises: r.unused })) },
    lines: [
      ...day.lines,
      `Thèmes : ${themes.join(", ")} · rotation ${settings.rotationDays} jours.`,
      low.length ? `En manque : ${low.slice(0, 5).map((r) => `${r.channelTitle} / ${r.theme} (${r.unused})`).join(", ")}` : "Stock suffisant sur tous les thèmes.",
    ],
  };
}

export const CASINO_CAPABILITIES = [
  programPosts(CASINO_TEAM),
  postUnique(CASINO_TEAM),
  changePlan(CASINO_TEAM),
  demanderMedias,
  questionCapability(T, AGENTS, "Répondre à une question sur l'équipe Casino (stock de médias par thème, rotation, missions)", casinoFacts),
];
