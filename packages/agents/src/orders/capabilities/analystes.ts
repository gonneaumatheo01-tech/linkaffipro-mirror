/**
 * Capacités de l'équipe Analystes (phase 29) : « Kevin, dis aux analystes de regarder le casino en Allemagne »,
 * « demande à l'équipe Analystes ce qui marche en dating » arrivent aussi par le planificateur des ordres (phase 33).
 * Tout est en LECTURE : l'équipe lit la veille, les règles des plateformes pub et les rapports, et recommande ; elle ne
 * touche jamais aux pubs, aux canaux, aux budgets ni aux créatives (règle 6). Les questions longues (Stratège, Opus)
 * partent dans la file `agents-analystes` : Kevin envoie la réponse dans la conversation de l'ordre.
 */
import { nowOf } from "../../admin/journal";
import type { Market } from "../../analysts/contract";
import { composeAnalystsAnswer } from "../../analysts/kevin-jobs";
import type { AnalystsKevinDeps } from "../../analysts/kevin-port";
import { alertsReply, currentAlerts, listSources, recentTrends, rulesReply, sourcesReply, trendsReply } from "../../analysts/kevin-read";
import { analystsEnabled, createAnalystsRequest, type AnalystsRequestKind } from "../../analysts/kevin-state";
import { countriesOf, marketOf, platformOf } from "../../analysts/kevin-texts";
import type { AgentsDeps } from "../../types";
import type { OrderRow } from "../contract";
import { defineCapability, done, ok, readOnly } from "./kit";

const T = "analystes" as const;
const ALL = ["chef-analystes", "veille", "compliance", "stratege", "rapporteur"];

const MARKETS = ["casino", "paris_sportifs", "rencontres"] as const;
const MARKET_OF: Record<string, Market> = { casino: "CASINO", paris_sportifs: "SPORTS", rencontres: "DATING" };

type ScopeP = { marche?: string; pays?: string; plateforme?: string; question?: string; sujet?: string };

const scopeSpec = {
  marche: { kind: "enum", description: "casino, paris_sportifs ou rencontres (absent = tous)", values: MARKETS, optional: true },
  pays: { kind: "string", description: "Pays cités, tels que dits (« France », « France et Allemagne »)", optional: true, maxLength: 120 },
  plateforme: { kind: "string", description: "Plateforme pub citée (Meta, TikTok, Google…)", optional: true, maxLength: 40 },
} as const;

function scopeOf(p: ScopeP) {
  const text = p.question ?? p.sujet ?? "";
  return {
    market: (p.marche ? MARKET_OF[p.marche] : null) ?? marketOf(text),
    countries: p.pays ? countriesOf(p.pays) : countriesOf(text),
    platform: platformOf(p.plateforme ?? null) ?? platformOf(text),
  };
}

const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Lecture instantanée (aucune IA). */
function readCap(key: string, description: string, agents: string[], read: (deps: AgentsDeps, p: ScopeP & { jours?: number }) => Promise<string>, extra: Record<string, unknown> = {}) {
  return defineCapability<ScopeP & { jours?: number }>({
    teamKey: T,
    key,
    description,
    agents,
    spec: { ...scopeSpec, ...extra } as never,
    limits: { modes: ["simulation", "real"] },
    async check() {
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: key, capability: key, teamKey: T, summary: description.split(" (")[0]!.toLowerCase(), touches: readOnly(), params: { ...p } }];
    },
    async run(deps, _order, step) {
      return done(plain(await read(deps, step.params as ScopeP & { jours?: number })));
    },
    async report(deps, _order) {
      const [trends, alerts, sources] = await Promise.all([recentTrends(deps, {}, 5), currentAlerts(deps), listSources(deps)]);
      return { tendances: trends.length, alertes: alerts.rules.length + alerts.viral.length, sourcesSuivies: sources.filter((s) => s.isActive).length };
    },
  });
}

/** Question longue (Stratège) : rangée et traitée par la file, Kevin répond dans la conversation de l'ordre. */
function askCap(key: string, kind: AnalystsRequestKind, description: string, agents: string[]) {
  return defineCapability<ScopeP>({
    teamKey: T,
    key,
    description,
    agents,
    spec: { question: { kind: "string", description: "La question telle que posée", maxLength: 500, optional: kind === "briefing" }, ...scopeSpec } as never,
    limits: { modes: ["simulation", "real"] },
    async check() {
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: key, capability: key, teamKey: T, summary: description.split(" (")[0]!.toLowerCase(), touches: readOnly(), params: { ...p } }];
    },
    async run(deps, order: OrderRow, step) {
      const d = deps as AnalystsKevinDeps;
      if (!(await analystsEnabled(d))) return done("La veille du marché est coupée pour le moment.");
      const p = step.params as ScopeP;
      const s = scopeOf(p);
      const req = await createAnalystsRequest(d, { kind, question: (p.question ?? `briefing ${p.marche ?? ""} ${p.pays ?? ""}`).trim().slice(0, 600), ...s, chatId: order.chatId, askedBy: "admin" });
      if (d.analysts?.enqueue) {
        await d.analysts.enqueue({ type: "analysts.strategy", kind: "on_demand", requestId: req.id }, { jobId: `analysts-ask-${req.id}` });
        return done("Je regarde, je te réponds dans une minute.");
      }
      return done(plain((await composeAnalystsAnswer(d, req)).text));
    },
    async report(deps) {
      return { reponduesLe: nowOf(deps).toISOString() };
    },
  });
}

export const ANALYSTES_CAPABILITIES = [
  readCap("question", "Question à l'équipe Analystes : tendances du marché, alertes et règles des plateformes pub, d'après la veille", ALL, async (deps, p) => {
    const s = scopeOf(p);
    const [t, a] = await Promise.all([trendsReply(deps, { market: s.market, countries: s.countries }, null), alertsReply(deps, { market: s.market }, null)]);
    return `${t}\n${a}`;
  }, { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 300 } }),
  readCap("tendances", "Tendances du marché relevées par la veille (forums, réseaux, actualités), par marché et pays", ["veille"], async (deps, p) => {
    const s = scopeOf(p);
    return trendsReply(deps, { market: s.market, countries: s.countries, ...(p.jours ? { days: p.jours } : {}) }, null);
  }, { jours: { kind: "int", description: "Nombre de jours (7 par défaut)", min: 1, max: 30, optional: true } }),
  readCap("regles_pub", "Règles des plateformes pub (Meta, TikTok…) par marché et pays, avec le risque et les sources (pas un avis juridique)", ["compliance"], async (deps, p) => rulesReply(deps, scopeOf(p), null)),
  readCap("alertes_marche", "Alertes du moment : règles pub à risque, bannissements, tendances qui explosent", ["compliance", "rapporteur"], async (deps, p) => alertsReply(deps, { market: scopeOf(p).market }, null)),
  readCap("sources_veille", "Sources surveillées par la veille du marché (forums, Reddit, Telegram public, X, actualités)", ["veille"], async (deps, p) => sourcesReply(deps, null, { market: scopeOf(p).market })),
  askCap("analyse_marche", "analysis", "Analyser un marché et des pays d'après la veille (ce qui marche, ce qui fait bannir, comparaison de pays)", ["stratege", "veille", "compliance"]),
  askCap("strategie_ads", "strategy", "Conseiller le type de pub, l'angle et le format pour un marché et un pays, avec des propositions numérotées (le client décide)", ["stratege"]),
  askCap("briefing_marche", "briefing", "Faire le point sur un marché et un pays (briefing du Rapporteur)", ["rapporteur", "stratege"]),
];
