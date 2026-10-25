/**
 * Capacités transverses du Grand Chef (phase 33) :
 * - `faire_comme_si` : le canal Test est traité comme un canal d'une autre équipe pendant la période (dérogation
 *   `teamKey` = l'équipe, `isTest = true`, simulation forcée). Jamais sur un vrai canal : il garde son univers ;
 *   repli = le canal Test, ou créer un canal de cet univers. Les étapes sont celles de l'équipe (programmer_paris,
 *   programmer_posts) : c'est son Chef qui produit.
 * - `pause_reprise` (reprend `setTeamPaused`), `mode` (simulation / vrai, reprend `setSimulation` ; toujours à confirmer).
 */
import { setSimulation, setTeamPaused } from "../../admin/team";
import { channelRefs, matchNames, teamOf } from "../../boss/resolve";
import { TEAM_LABELS, type TeamKey } from "../../types";
import type { Capability } from "../contract";
import { CASINO_CAPABILITIES } from "./casino";
import { DATING_CAPABILITIES } from "./dating";
import { alt, defineCapability, done, failed, ok, orderActor, refuse } from "./kit";
import { programmerParis } from "./sports";

const T = "transverse" as const;

type AsIfP = {
  equipe: string;
  canaux?: string[];
  test?: boolean;
  jours?: number;
  debut?: string;
  par_jour?: number;
  theme?: string;
  persona?: string;
  format?: "video" | "photo" | "texte";
};

type Producing = "sports" | "dating" | "casino";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function teamCapability(team: Producing): Capability<any> {
  if (team === "sports") return programmerParis;
  return (team === "dating" ? DATING_CAPABILITIES : CASINO_CAPABILITIES).find((c) => c.key === "programmer_posts")!;
}

function asTeam(raw: string): Producing | null {
  const t = teamOf(raw);
  return t === "sports" || t === "dating" || t === "casino" ? t : null;
}

/** Paramètres de la capacité de l'équipe, sur le canal Test, en simulation. */
function teamParams(team: Producing, p: AsIfP): Record<string, unknown> {
  const base = { test: true, jours: p.jours, debut: p.debut, mode: "simulation" };
  if (team === "sports") return { ...base, theme: p.theme, paris_par_jour: p.par_jour };
  return { ...base, posts_par_jour: p.par_jour, format: p.format, ...(team === "dating" && p.persona ? { persona: p.persona } : {}), ...(p.theme ? { themes: [p.theme] } : {}) };
}

const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const faireCommeSi = defineCapability<AsIfP>({
  teamKey: T,
  key: "faire_comme_si",
  description:
    "Faire tourner le canal Test comme un canal d'une autre équipe (paris sportifs, rencontres, casino) pendant N jours, toujours pour de faux ; jamais sur un vrai canal",
  agents: ["planification", "publication"],
  spec: {
    equipe: { kind: "string", description: "Équipe imitée : paris sportifs, rencontres ou casino", maxLength: 40 },
    canaux: { kind: "list", description: "Canal visé (le canal Test seulement)", optional: true },
    test: { kind: "bool", description: "true = canal Test", optional: true },
    jours: { kind: "int", description: "Durée en jours (30 au plus)", min: 1, max: 365, optional: true },
    debut: { kind: "string", description: "Premier jour AAAA-MM-JJ", optional: true, maxLength: 10 },
    par_jour: { kind: "int", description: "Paris ou posts par jour", min: 1, max: 500, optional: true },
    theme: { kind: "string", description: "Thème (hors-jeux, corners, roulette…)", optional: true, maxLength: 60 },
    persona: { kind: "string", description: "Persona (Rencontres)", optional: true, maxLength: 60 },
    format: { kind: "enum", description: "video, photo ou texte", values: ["video", "photo", "texte"], optional: true },
  },
  limits: { maxDays: 30, channels: "test", modes: ["simulation"] },
  async check(deps, p) {
    const team = asTeam(p.equipe);
    if (!team)
      return refuse(`Je ne peux faire « comme si » qu'avec une équipe qui publie : Paris sportifs, Rencontres ou Casino.`, (["sports", "dating", "casino"] as const).map((t) => alt(`comme un canal ${TEAM_LABELS[t]}`, T, "faire_comme_si", strip({ ...p, equipe: TEAM_LABELS[t] }))));
    // Un vrai canal garde son univers : refus et replis.
    const refs = await channelRefs(deps);
    for (const raw of p.canaux ?? []) {
      if (/^(le )?canal (de )?test$|^test$/i.test(raw.trim())) continue;
      const c = matchNames(raw, refs)[0];
      if (c && c.isTest) continue;
      const same = refs.filter((r) => !r.isTest && r.team === team);
      return refuse(
        `${c?.name ?? raw} est un vrai canal : il garde son univers, je ne le fais pas tourner comme un canal ${TEAM_LABELS[team]}.`,
        [
          alt(`le faire sur le canal Test, pour de faux`, T, "faire_comme_si", strip({ ...p, canaux: undefined, test: true })),
          { label: `créer un canal ${TEAM_LABELS[team]} (page Canaux), puis je le programme` },
          ...same.slice(0, 2).map((s) => alt(`le programmer sur ${s.name}, un canal ${TEAM_LABELS[team]}`, team, teamCapability(team).key, strip({ ...teamParams(team, p), test: undefined, canaux: [s.name] }))),
        ],
      );
    }
    const cap = teamCapability(team);
    const parsed = cap.parse(strip(teamParams(team, p)));
    if (!parsed.ok) return refuse(`Paramètres impossibles : ${parsed.error}.`, []);
    const r = await cap.check(deps, parsed.params);
    if (r.ok) return ok();
    // Replis de l'équipe ramenés à « comme si » (mêmes valeurs, canal Test).
    return refuse(
      r.reason,
      r.alternatives.map((a) => {
        const params = (a.capability?.params ?? {}) as Record<string, unknown>;
        if (a.capability?.key !== cap.key) return a;
        return alt(a.label, T, "faire_comme_si", strip({ ...p, theme: (params.theme as string | undefined) ?? (Array.isArray(params.themes) ? (params.themes as string[])[0] : p.theme), par_jour: (params.paris_par_jour ?? params.posts_par_jour ?? p.par_jour) as number | undefined, jours: (params.jours as number | undefined) ?? p.jours }));
      }),
    );
  },
  async plan(deps, p, ctx) {
    const team = asTeam(p.equipe);
    if (!team) return [];
    const cap = teamCapability(team);
    const parsed = cap.parse(strip(teamParams(team, p)));
    if (!parsed.ok) return [];
    const steps = await cap.plan(deps, parsed.params, { ...ctx, mode: "simulation" });
    // Le Chef de l'équipe produit : les étapes restent les siennes ; simulation forcée sur le canal Test.
    return steps.map((s) => ({
      ...s,
      overrides: s.overrides?.map((o) => ({ ...o, teamKey: team as TeamKey, isTest: true })),
      clamped: [...(s.clamped ?? []), `le canal Test fait comme un canal ${TEAM_LABELS[team]}, pour de faux`],
      params: { ...s.params, asIfTeamKey: team },
    }));
  },
  async run() {
    // Jamais appelé : les étapes planifiées appartiennent à la capacité de l'équipe imitée.
    return done("Canal Test programmé.");
  },
  async report() {
    return {};
  },
});

type TeamP = { equipe: string; pause: boolean };

export const pauseReprise = defineCapability<TeamP>({
  teamKey: T,
  key: "pause_reprise",
  description: "Mettre en pause une équipe (ou tout), ou la faire reprendre",
  agents: [],
  spec: { equipe: { kind: "string", description: "Équipe (rencontres, casino, paris sportifs, algorithme) ou « tout »", maxLength: 40 }, pause: { kind: "bool", description: "true = pause, false = reprise" } },
  limits: { modes: ["simulation", "real"] },
  async check(_deps, p) {
    return teamOf(p.equipe, { allowAll: true }) ? ok() : refuse(`Je ne connais pas l'équipe « ${p.equipe} ».`, (["dating", "casino", "sports", "algo"] as const).map((t) => alt(TEAM_LABELS[t], T, "pause_reprise", { ...p, equipe: TEAM_LABELS[t] })));
  },
  async plan(_deps, p) {
    const t = teamOf(p.equipe, { allowAll: true });
    if (!t) return [];
    return [{ stepKey: `pause_reprise:${t}:${p.pause}`, capability: "pause_reprise", teamKey: T, summary: `${p.pause ? "pause" : "reprise"} : ${t === "all" ? "toutes les équipes" : `équipe ${TEAM_LABELS[t]}`}`, params: { team: t, pause: p.pause } }];
  },
  async run(deps, order, step) {
    const r = await setTeamPaused(deps, step.params.team as TeamKey | "all", step.params.pause === true, orderActor(order), step.params.pause ? `ordre n°${order.number}` : undefined);
    return r.ok ? done(r.message) : failed(r.message);
  },
  async report() {
    return {};
  },
});

type ModeP = { equipe: string; mode: "simulation" | "vrai" };

export const modeEquipe = defineCapability<ModeP>({
  teamKey: T,
  key: "mode",
  description: "Passer une équipe en vrai (vrais canaux) ou la remettre en simulation (canal Test) ; toujours confirmé",
  agents: [],
  spec: { equipe: { kind: "string", description: "Équipe", maxLength: 40 }, mode: { kind: "enum", description: "simulation ou vrai", values: ["simulation", "vrai"] } },
  limits: { modes: ["simulation", "real"] },
  async check(_deps, p) {
    const t = teamOf(p.equipe);
    return t && t !== "all" ? ok() : refuse(`Je ne connais pas l'équipe « ${p.equipe} ».`, (["dating", "casino", "sports"] as const).map((x) => alt(TEAM_LABELS[x], T, "mode", { ...p, equipe: TEAM_LABELS[x] })));
  },
  async plan(_deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    return [{ stepKey: `mode:${t}:${p.mode}`, capability: "mode", teamKey: T, summary: `équipe ${TEAM_LABELS[t]} ${p.mode === "vrai" ? "en vrai" : "en simulation"}`, params: { team: t, simulation: p.mode !== "vrai" } }];
  },
  async run(deps, order, step) {
    const r = await setSimulation(deps, step.params.team as TeamKey, step.params.simulation === true, orderActor(order));
    return r.ok ? done(r.message) : failed(r.message);
  },
  async report() {
    return {};
  },
});

export const TRANSVERSE_CAPABILITIES = [faireCommeSi, pauseReprise, modeEquipe];
