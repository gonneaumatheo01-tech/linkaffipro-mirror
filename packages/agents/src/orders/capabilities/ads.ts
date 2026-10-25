/**
 * Capacités de l'Agent Ads (phase 33) : lecture seule (il recommande, il n'agit jamais chez Meta ou TikTok) : rapport,
 * recommandations ouvertes, seuils, question.
 */
import { nowOf } from "../../admin/journal";
import { loadAdsThresholdsView } from "../../agents/ads/analysis";
import { adsProposed, recommendationLabel } from "../../boss/facts";
import type { AgentsDeps } from "../../types";
import { defineCapability, done, ok, readOnly } from "./kit";

const T = "ads" as const;

type Facts = { facts: Record<string, unknown>; lines: string[] };

async function reportFacts(deps: AgentsDeps): Promise<Facts> {
  const r = (await deps.prisma.insightReport.findFirst({ where: { teamKey: T }, orderBy: { createdAt: "desc" }, select: { weekStart: true, content: true, stats: true, createdAt: true } })) as {
    weekStart: string;
    content: string;
    stats: unknown;
    createdAt: Date;
  } | null;
  if (!r) return { facts: { rapport: null }, lines: ["Pas encore de rapport pubs (aucune dépense pub importée)."] };
  return { facts: { rapport: { date: r.createdAt.toISOString(), chiffres: r.stats } }, lines: r.content.split("\n").filter(Boolean).slice(0, 8) };
}

async function recoFacts(deps: AgentsDeps): Promise<Facts> {
  const list = await adsProposed(deps);
  return {
    facts: { recommandations: list.map((r) => ({ libelle: recommendationLabel(r), gain: r.expectedGain })) },
    lines: list.length ? list.slice(0, 6).map((r, i) => `${i + 1}. ${recommendationLabel(r)}`) : ["Aucune recommandation pubs ouverte."],
  };
}

async function thresholdFacts(deps: AgentsDeps): Promise<Facts> {
  const view = await loadAdsThresholdsView(deps.prisma, nowOf(deps));
  const label: Record<string, string> = { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Rencontres" };
  return {
    facts: { seuils: view.thresholds },
    lines: Object.entries(view.thresholds).map(
      ([v, t]) => `${label[v] ?? v} : coût par inscription visé ${t.targetCostPerRegistration ?? "—"} €, retour sur dépense minimal ${t.minRoas ?? "—"}`,
    ),
  };
}

function readCap(key: string, description: string, facts: (deps: AgentsDeps) => Promise<Facts>) {
  return defineCapability<{ sujet?: string }>({
    teamKey: T,
    key,
    description,
    agents: ["ads"],
    spec: { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 200 } },
    limits: { modes: ["simulation", "real"] },
    async check() {
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: key, capability: key, teamKey: T, summary: description.split(" :")[0]!.toLowerCase(), touches: readOnly(), params: { sujet: p.sujet ?? null } }];
    },
    async run(deps) {
      return done((await facts(deps)).lines.join("\n"));
    },
    async report(deps) {
      return (await facts(deps)).facts;
    },
  });
}

export const ADS_CAPABILITIES = [
  readCap("rapport", "Rapport pubs : le dernier rapport de l'Agent Ads (dépense, coût par inscription, retour sur dépense)", reportFacts),
  readCap("recommandations", "Recommandations pubs ouvertes : arrêter, augmenter, tester (je n'agis jamais chez Meta ou TikTok)", recoFacts),
  readCap("seuils", "Seuils pubs : coût par inscription visé et retour sur dépense minimal par univers", thresholdFacts),
  readCap("question", "Question à l'Agent Ads : rapport, recommandations et seuils", async (deps) => {
    const [a, b, c] = await Promise.all([reportFacts(deps), recoFacts(deps), thresholdFacts(deps)]);
    return { facts: { ...a.facts, ...b.facts, ...c.facts }, lines: [...a.lines.slice(0, 4), ...b.lines.slice(0, 3), ...c.lines.slice(0, 1)] };
  }),
];
