/**
 * Phase 33 (chantier B) — rapports de Kevin sur les ordres (règle 7 : les chiffres viennent du code). Branchés sur les
 * événements du Grand Chef (`setOrderEventHook`) : au lancement, chaque jour à la fin de la fenêtre (un message par
 * ordre), à la fin (bilan), et sur incident (plus de 2 échecs, budget). Jamais plus d'un message par ordre et par
 * jour hors fin et incident (`progress.kevinReportedDays`). Dans la conversation d'origine (`TeamOrder.chatId`).
 * Textes écrits par le code à partir des faits de la capacité (`report`) ; aucune IA ici (aucun chiffre ne peut
 * être inventé) ; chaque texte passe `voiceCheck`.
 */
import { esc } from "../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import type { AgentsDeps } from "../types";
import type { OrderFacts } from "./contract";
import { channelNames, interpretationOf, orderById, periodLabel, type StoredInterpretation } from "./current";
import { setOrderEventHook, type OrderEvent } from "./ports";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** Étiquettes des paris ou posts d'un jour (« cartons, corners »), si les faits les donnent. */
function labelsOf(facts: OrderFacts, day?: string | null): string[] {
  const perDay = Array.isArray(facts.perDay) ? (facts.perDay as Array<Record<string, unknown>>) : [];
  const d = day ? perDay.find((x) => x.day === day) : null;
  // Clés du Grand Chef (`orderPicksFacts` : `marches`) ou des capacités de posts (`labels`, `themes`).
  const raw = (d?.labels ?? facts.labels ?? facts.marches ?? facts.themes) as unknown;
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && x.trim() !== ""))].slice(0, 4) : [];
}

function dayFacts(facts: OrderFacts, day?: string | null): { done: number; failed: number; waiting: number } {
  const perDay = Array.isArray(facts.perDay) ? (facts.perDay as Array<Record<string, unknown>>) : [];
  const d = day ? perDay.find((x) => x.day === day) : null;
  return {
    done: num(d?.done) ?? num(facts.done) ?? 0,
    failed: num(d?.failed) ?? num(facts.failed) ?? 0,
    waiting: num(d?.waitingValidation) ?? num(facts.waitingValidation) ?? 0,
  };
}

async function whereOf(deps: AgentsDeps, interp: StoredInterpretation | null): Promise<string> {
  const ids = interp?.channelIds ?? [];
  if (!ids.length) return (interp?.scope as { test?: boolean } | undefined)?.test ? "le canal Test" : "les canaux de l'équipe";
  const names = await channelNames(deps, ids);
  return ids.map((id) => names.get(id)?.name ?? "un canal").slice(0, 2).join(" et ");
}

/** Textes fixes des rapports (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const ORDER_REPORTS_VARIANTS = {
  firstAt: voiceTemplate<{ at: string }>([{ at: "10 h" }], (p) => [`Première production vers ${p.at}.`, `Ça démarre vers ${p.at}.`]),
  started: voiceTemplate<{ n: number; first: string }>(
    [
      { n: 4, first: "" },
      { n: 4, first: " Première production vers 10 h." },
    ],
    (p) => [`C'est lancé, ordre n°${p.n}.${p.first}`, `Ordre n°${p.n} parti.${p.first}`, `Ça tourne, ordre n°${p.n}.${p.first}`],
  ),
  dayHead: voiceTemplate<{ index: number; days: number; where: string }>([{ index: 1, days: 3, where: "Test" }], (p) => [`Jour ${p.index}/${p.days} sur ${p.where}`, `${p.where}, jour ${p.index}/${p.days}`]),
  dayHeadPlain: voiceTemplate<{ where: string }>([{ where: "Roulette Pro" }], (p) => [`Point du jour sur ${p.where}`, `Aujourd'hui sur ${p.where}`]),
  day: voiceTemplate<{ head: string; parts: string }>(
    [
      { head: "Jour 1/3 sur Test", parts: "2 paris publiés (Hors-jeux)" },
      { head: "Point du jour sur Roulette Pro", parts: "aucun post publié, 1 attend ta validation, 2 ratés" },
    ],
    (p) => [`${p.head} : ${p.parts}.`],
  ),
  finished: voiceTemplate<{ n: number; bits: string }>([{ n: 7, bits: "6 paris sur Test, 4 gagnés, 2 perdus, cote moyenne 1,9" }], (p) => [
    `Ordre n°${p.n} terminé : ${p.bits}.`,
    `C'est fini pour l'ordre n°${p.n} : ${p.bits}.`,
  ]),
  failures: voiceTemplate<{ n: number; count: string; where: string; why: string }>(
    [
      { n: 3, count: "3 ratés", where: "Test", why: " Dernière erreur : aucune cote." },
      { n: 3, count: "1 raté", where: "Roulette Pro", why: "" },
    ],
    (p) => [
      `⚠️ Ordre n°${p.n} : ${p.count} sur ${p.where}.${p.why} Je continue, dis-moi « arrête l'ordre » si tu préfères couper.`,
      `⚠️ ${p.count} sur ${p.where} pour l'ordre n°${p.n}.${p.why} Je continue ; écris « arrête l'ordre » pour couper.`,
    ],
  ),
  lastError: voiceTemplate<{ reason: string }>([{ reason: "aucune cote" }], (p) => [` Dernière erreur : ${p.reason}.`, ` Dernier souci : ${p.reason}.`]),
  blocked: voiceTemplate<{ n: number; why: string }>(
    [
      { n: 3, why: " : plafond vidéo atteint" },
      { n: 3, why: "" },
    ],
    (p) => [`⚠️ L'ordre n°${p.n} est bloqué${p.why}. Rien ne part tant que ce n'est pas réglé.`, `⚠️ L'ordre n°${p.n} est bloqué${p.why}. Rien ne sort avant que ce soit réglé.`],
  ),
} satisfies VoiceTable;

const V = ORDER_REPORTS_VARIANTS;

/** « sur Test » plutôt que « sur le canal Test » dans les lignes courtes. */
const shortWhere = (w: string) => (w === "le canal Test" ? "Test" : w);

/** Texte d'un rapport (pur une fois les faits lus), ou null s'il n'y a rien à dire. */
export function orderReportText(
  event: Pick<OrderEvent, "type" | "number" | "teamKey" | "day" | "dayIndex" | "days" | "failures" | "reason" | "chatId">,
  facts: OrderFacts,
  ctx: { where: string; unit: "paris" | "posts"; firstAt?: string | null; recapLine?: string | null; period?: string | null },
): string | null {
  const one = ctx.unit === "paris" ? "pari" : "post";
  const many = ctx.unit;
  const chat = event.chatId;
  const w = shortWhere(ctx.where);
  switch (event.type) {
    case "started": {
      const first = ctx.firstAt ? ` ${pick(V.firstAt({ at: ctx.firstAt }), "order.report.first", chat)}` : "";
      return pick(V.started({ n: event.number, first }), "order.report.started", chat);
    }
    case "day_done": {
      const f = dayFacts(facts, event.day);
      const labels = labelsOf(facts, event.day);
      const head =
        event.dayIndex && event.days
          ? pick(V.dayHead({ index: event.dayIndex, days: event.days, where: w }), "order.report.dayhead", chat)
          : pick(V.dayHeadPlain({ where: w }), "order.report.dayhead", chat);
      const parts = [
        f.done ? `${plural(f.done, `${one} publié`, `${many} publiés`)}${labels.length ? ` (${labels.join(", ")})` : ""}` : `aucun ${one} publié`,
        f.waiting ? `${f.waiting} attend${f.waiting > 1 ? "ent" : ""} ta validation` : null,
        f.failed ? `${plural(f.failed, "raté", "ratés")}` : null,
      ].filter(Boolean);
      return pick(V.day({ head, parts: parts.join(", ") }), "order.report.day", chat);
    }
    case "finished": {
      const done = num(facts.done) ?? 0;
      // Faits du Grand Chef pour les paris (`orderPicksFacts`) : `parisGagnes`, `parisPerdus`, `coteMoyenne`. Gagnés et
      // perdus seulement s'il y a au moins un pari réglé (sinon « 0 gagné, 0 perdu » ferait croire à un résultat).
      const wonRaw = num(facts.won) ?? num(facts.parisGagnes);
      const lostRaw = num(facts.lost) ?? num(facts.parisPerdus);
      const settled = (wonRaw ?? 0) + (lostRaw ?? 0) > 0;
      const won = settled ? wonRaw : null;
      const lost = settled ? lostRaw : null;
      const avg = num(facts.avgOdds) ?? num(facts.averageOdds) ?? num(facts.coteMoyenne);
      const bits = [
        `${plural(done, one, many)} sur ${w}`,
        won !== null ? plural(won, "gagné", "gagnés") : null,
        lost !== null ? plural(lost, "perdu", "perdus") : null,
        avg !== null ? `cote moyenne ${fr(avg)}` : null,
      ].filter(Boolean);
      return pick(V.finished({ n: event.number, bits: bits.join(", ") }), "order.report.finished", chat);
    }
    case "failures": {
      const n = num(event.failures) ?? num(facts.failed) ?? 0;
      const why = event.reason ? pick(V.lastError({ reason: event.reason.slice(0, 120) }), "order.report.lasterror", chat) : "";
      return pick(V.failures({ n: event.number, count: plural(n, "raté", "ratés"), where: w, why }), "order.report.failures", chat);
    }
    case "blocked": {
      const why = event.reason ? ` : ${event.reason.slice(0, 140)}` : "";
      return pick(V.blocked({ n: event.number, why }), "order.report.blocked", chat);
    }
  }
}

type ProgressLite = Record<string, unknown> & { kevinReportedDays?: string[] };

/**
 * Crochet des rapports : un message par ordre et par jour au plus (hors fin et incident), dans la conversation
 * d'origine. Ne lève jamais (le Grand Chef continue quoi qu'il arrive).
 */
export async function sendOrderReport(deps: AgentsDeps, event: OrderEvent): Promise<boolean> {
  try {
    const order = await orderById(deps, event.orderId);
    if (!order) return false;
    const progress = (order.progress && typeof order.progress === "object" ? order.progress : {}) as ProgressLite;
    const reported = Array.isArray(progress.kevinReportedDays) ? progress.kevinReportedDays : [];
    const dayKey = event.type === "day_done" ? `day:${event.day ?? ""}` : event.type === "started" ? "started" : null;
    if (dayKey && reported.includes(dayKey)) return false;
    const interp = interpretationOf(order);
    const where = await whereOf(deps, interp);
    const team = interp?.asIfTeamKey ?? order.teamKey;
    const firstAt = event.type === "started" ? firstProductionAt(interp, event.facts) : null;
    const text = orderReportText(event, event.facts ?? {}, {
      where,
      unit: team === "sports" ? "paris" : "posts",
      firstAt,
      period: interp?.fromDay && interp.toDay ? periodLabel(interp.fromDay, interp.toDay) : null,
    });
    if (!text) return false;
    if (dayKey) {
      const fresh = await orderById(deps, order.id);
      const p = (fresh?.progress && typeof fresh.progress === "object" ? fresh.progress : {}) as ProgressLite;
      await deps.prisma.teamOrder.update({
        where: { id: order.id },
        data: { progress: JSON.parse(JSON.stringify({ ...p, kevinReportedDays: [...(p.kevinReportedDays ?? []), dayKey].slice(-60) })) as never },
      });
    }
    const html = esc(text);
    const chat = order.chatId ? BigInt(order.chatId) : null;
    if (chat !== null && deps.admin?.sendTo) await deps.admin.sendTo(chat, html);
    else await deps.admin?.send(html);
    return true;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, orderId: event.orderId }, "[orders] rapport de Kevin non envoyé");
    return false;
  }
}

/** Heure de la première production (« 10 h ») : faits de la capacité, sinon début de fenêtre de la dérogation. */
function firstProductionAt(interp: StoredInterpretation | null, facts?: OrderFacts | null): string | null {
  const f = facts?.firstAt ?? facts?.firstProductionAt;
  if (typeof f === "string" && /^\d{1,2}:\d{2}$/.test(f)) return hourLabel(f);
  for (const st of interp?.plannedSteps ?? []) for (const o of st.overrides ?? []) if (o.windowStart) return hourLabel(o.windowStart);
  return null;
}

function hourLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Branche les rapports de Kevin sur les événements des ordres (appelé au chargement du paquet). */
export function installOrderReports(): void {
  setOrderEventHook(async (deps, event) => {
    await sendOrderReport(deps, event);
  });
}

installOrderReports();
