/**
 * Chef Algorithme (phase 21, logique programmée) : l'équipe ne publie rien, elle mesure et règle les autres.
 * - chaque nuit (à partir de 4 h Paris, après les statistiques journalières) : Posts → Horaires → Conversations
 *   (chiffres par profil, chantier B) → état des tests ;
 * - le lundi (à partir de 6 h) : Expérimentation (clôture, nouveaux tests) → relecture des conversations (B) →
 *   Synthèse (recommandations, application selon le niveau, rapport « Ce qui marche ») ;
 * - toutes les heures : alertes de décrochage.
 * Une erreur d'une partie n'arrête pas les autres. Pause de l'équipe ou pause générale : rien ne tourne.
 * La chaîne de missions reste inactive : le plan du jour ne crée aucune mission pour cette équipe.
 */
import type { Chain } from "./chain";
import type { AgentsDeps } from "../types";
import { agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { computeConversationProfiles, reviewConversations } from "../algo/conversations-contract";
import type { ConversationProfileStats } from "../algo/contracts";
import { runDropAlerts } from "../algo/alerts";
import { loadAlgoTeam } from "../algo/settings";
import { parisWeekStart } from "../algo/week";
import { isAgentsPausedAll } from "../missions/settings";
import { parisDay, parisParts, parisWeekday } from "../rules/time";
import { runPostsAgent, type PostsAgentResult } from "../agents/posts";
import { NOT_ENOUGH_DATA } from "../agents/posts/rank";
import { runHorairesAgent, type HorairesResult } from "../agents/horaires";
import { closeExperiments, experimentsState, proposeExperiments, type ClosedExperiment } from "../agents/experimentation";
import { runSynthese, type SyntheseResult } from "../agents/synthese";

export const algoChain: Chain = {
  teamKey: "algo",
  post: ["posts", "horaires", "experimentation", "synthese"],
  active: false,
};

export const ALGO_NIGHTLY_KEY = "agents.algo.lastNightly";
export const ALGO_WEEKLY_KEY = "agents.algo.lastWeekly";
export const ALGO_NIGHTLY_HOUR = 4;
export const ALGO_WEEKLY_HOUR = 6;

type Out = Record<string, unknown>;

async function part<T>(deps: AgentsDeps, name: string, out: Out, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    out[name] = r;
    return r;
  } catch (err) {
    out[name] = { error: (err as Error).message };
    deps.logger?.error({ err: (err as Error).message, part: name }, "[agents] partie de l'équipe Algorithme en erreur");
    return null;
  }
}

export type NightlyResult = { out: Out; posts: PostsAgentResult | null; horaires: HorairesResult | null; conversations: ConversationProfileStats[] };

export async function runAlgoNightly(deps: AgentsDeps, opts: { full?: boolean } = {}): Promise<NightlyResult> {
  const out: Out = {};
  const posts = await part(deps, "posts", out, () => runPostsAgent(deps, opts));
  const horaires = await part(deps, "horaires", out, () => runHorairesAgent(deps));
  // Agent Conversations (chantier B) : « à écrire » tant qu'il n'est pas livré, l'erreur est gardée dans le résultat.
  const conversations = (await part(deps, "conversations", out, () => computeConversationProfiles(deps, { days: 30 }))) ?? [];
  await part(deps, "experiments", out, () => experimentsState(deps));
  await writeSetting(deps, ALGO_NIGHTLY_KEY, parisDay(nowOf(deps)));
  // Résumé léger dans le résultat de la tâche (les classements complets restent en mémoire pour la synthèse).
  out.posts = posts ? { computed: posts.computed, considered: posts.considered, channels: posts.channels.length } : out.posts;
  out.horaires = horaires ? { channels: horaires.channels, plans: horaires.plans } : out.horaires;
  out.conversations = Array.isArray(conversations) ? { profiles: conversations.length } : out.conversations;
  return { out, posts, horaires, conversations };
}

export type WeeklyResult = { out: Out; synthese: SyntheseResult | null; closed: ClosedExperiment[] };

export async function runAlgoWeekly(deps: AgentsDeps, nightly: NightlyResult, opts: { send?: boolean } = {}): Promise<WeeklyResult> {
  const out: Out = {};
  const weekStart = parisWeekStart(nowOf(deps));
  const closed = (await part(deps, "closeExperiments", out, () => closeExperiments(deps))) ?? [];
  const insufficient = new Set((nightly.posts?.channels ?? []).filter((c) => c.dimensions.format.note === NOT_ENOUGH_DATA).map((c) => c.id));
  const bestHour = new Map<string, number>();
  for (const [id, w] of Object.entries(nightly.horaires?.windows ?? {})) {
    const top = [...w.all].sort((a, b) => b.score - a.score)[0];
    if (top) bestHour.set(id, Number(top.start.slice(0, 2)));
  }
  await part(deps, "proposeExperiments", out, () => proposeExperiments(deps, { formatsInsufficient: insufficient, bestHour }));
  const review = await part(deps, "conversationReview", out, () => reviewConversations(deps, nightly.conversations, { weekStart }));
  const synthese = await part(deps, "synthese", out, () =>
    runSynthese(
      deps,
      {
        channels: nightly.posts?.channels ?? [],
        verticals: nightly.posts?.verticals ?? [],
        windows: nightly.horaires?.windows ?? {},
        conversations: nightly.conversations,
        conversationReview: review?.review ?? null,
        closedTests: closed.map((c) => ({ id: c.id, sentence: c.sentence, winner: c.winner })),
      },
      opts,
    ),
  );
  await writeSetting(deps, ALGO_WEEKLY_KEY, weekStart);
  return { out, synthese, closed };
}

/** La nuit / le lundi sont-ils dus (pur) ? */
export function algoDue(now: Date, last: { nightly: string | null; weekly: string | null }): { nightly: boolean; weekly: boolean } {
  const hour = parisParts(now).hour;
  const nightly = hour >= ALGO_NIGHTLY_HOUR && last.nightly !== parisDay(now);
  const weekly = parisWeekday(now) === 1 && hour >= ALGO_WEEKLY_HOUR && last.weekly !== parisWeekStart(now);
  return { nightly, weekly };
}

/** Passage horaire de la file `agents-algo`. */
export async function runAlgoTick(deps: AgentsDeps): Promise<Out> {
  const out: Out = {};
  const team = await loadAlgoTeam(deps.prisma);
  if (team.paused || (await isAgentsPausedAll(deps.prisma))) return { skipped: "équipe Algorithme en pause" };
  await part(deps, "alerts", out, () => runDropAlerts(deps));
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const due = algoDue(nowOf(deps), { nightly: str(await readSetting(deps, ALGO_NIGHTLY_KEY)), weekly: str(await readSetting(deps, ALGO_WEEKLY_KEY)) });
  if (due.nightly || due.weekly) {
    const nightly = await runAlgoNightly(deps);
    out.nightly = nightly.out;
    if (due.weekly) out.weekly = (await runAlgoWeekly(deps, nightly)).out;
  }
  await agentEvent(deps, "agents.algo.tick", { nightly: due.nightly, weekly: due.weekly });
  return out;
}

/** « Rapport maintenant » : tout recalculer et envoyer le rapport de la semaine en cours. */
export async function runAlgoReportNowImpl(deps: AgentsDeps, opts: { send?: boolean } = {}): Promise<{ ok: boolean; message: string; reportIds: string[] }> {
  const nightly = await runAlgoNightly(deps);
  const weekly = await runAlgoWeekly(deps, nightly, { send: opts.send !== false });
  const s = weekly.synthese;
  if (!s) return { ok: false, message: `Rapport impossible : ${String((weekly.out.synthese as { error?: string } | undefined)?.error ?? "erreur inconnue")}`, reportIds: [] };
  return {
    ok: true,
    message: `Rapport « Ce qui marche » ${s.sent ? "envoyé" : "enregistré"} (${s.writtenBy === "ai" ? "rédigé par l'IA" : "assemblé par le code"}) ; ${s.recommendations.length} recommandation(s), ${s.applied.length} appliquée(s).`,
    reportIds: s.reportIds,
  };
}
