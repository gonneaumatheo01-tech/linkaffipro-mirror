/**
 * Phase 30, chantier C — lectures du contrôle qualité global pour Kevin (`qa_status`, `qa_history`, `qa_detail`), les
 * capacités de l'équipe « qa » et la fiche de l'agent dans l'annuaire. LECTURE SEULE : rien n'est vérifié, relancé ni
 * approuvé ici (le moteur est au chantier A, les branchements au chantier B).
 *
 * Ce que Kevin montre : chiffres (vérifiés, acceptés, refusés, bloqués), motifs en français courant (codes traduits,
 * message du contrôle masqué et coupé), corrections demandées (champ et conseil), tentative, durée. Jamais le contenu
 * vérifié lui-même (`QaCheck.content`, même masqué) ni un code technique : un secret ou une donnée personnelle citée
 * par le contrôle dans son motif est masquée par `maskQaText` avant l'affichage.
 */
import { esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { parisDay, parisDayStart } from "../rules/time";
import type { AgentsDeps } from "../types";
import { QA_SETTINGS, type QaContentType, type QaVerdict } from "./contract";

const DAY_MS = 86_400_000;
/** Vérifications lues au plus pour un tableau (les plus récentes). */
export const QA_KEVIN_READ_LIMIT = 5000;
/** Refus listés au plus dans une réponse (8 lignes avec l'en-tête, les motifs et la phrase de fin). */
export const QA_KEVIN_LIST_MAX = 5;
/** Un blocage « modèle indisponible » plus récent que la dernière vérification réussie, depuis moins d'une heure = pause. */
export const QA_PAUSE_WINDOW_MS = 60 * 60_000;

// ------------------------------------------------------------------------------------------------ libellés

/** Motifs de refus en français courant (codes du contrat et codes de blocage du moteur). */
export const QA_REASON_WORDS: Readonly<Record<string, string>> = {
  COPY: "texte copié sur une source",
  SENSITIVE_DATA: "donnée sensible (clé, identifiant, coordonnées)",
  HALLUCINATION: "information inventée",
  GAIN_PROMISE: "promesse de gain",
  LEGAL_ADVICE: "conseil juridique",
  CHANNEL_RULE: "règle du canal pas respectée",
  COMPLIANCE: "règle publicitaire pas respectée",
  CONTRADICTION: "contradiction avec un autre contenu",
  INVENTED_NUMBER: "chiffre inventé",
  UNSOURCED: "affirmation sans source",
  DEAD_SOURCE: "source qui ne répond plus",
  OFF_TOPIC: "hors sujet",
  FALSE_ALERT: "fausse alerte",
  SUBTITLE_ERROR: "erreur dans les sous-titres",
  METADATA: "durée, format ou image incohérents",
  AI_MENTION: "parle de l'IA",
  LANGUAGE: "français à corriger",
  OUT_OF_BOUNDS: "réglage hors des limites",
  QA_TIMEOUT: "contrôle trop long",
  QA_MODEL_UNAVAILABLE: "contrôle indisponible",
  QA_BUDGET: "plafond du contrôle atteint",
};

export function qaReasonWord(code: string | null | undefined): string {
  return (code && QA_REASON_WORDS[code.toUpperCase()]) || "autre motif";
}

/** Type de contenu, avec l'article (« un post », « une alerte »). */
export const QA_CONTENT_WORDS: Readonly<Record<QaContentType, { one: string; many: string }>> = {
  POST: { one: "un post", many: "posts" },
  SHORT: { one: "un short", many: "shorts" },
  REPORT: { one: "un rapport", many: "rapports" },
  KEVIN_RESPONSE: { one: "une de mes réponses", many: "mes réponses" },
  RECOMMENDATION: { one: "une recommandation", many: "recommandations" },
  ALERT: { one: "une alerte", many: "alertes" },
  COMPLIANCE_RULE: { one: "une règle publicitaire", many: "règles publicitaires" },
};

const TEAM_WORDS: Readonly<Record<string, string>> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
  algo: "Algorithme",
  ads: "Ads",
  // Montage : retiré le 28 octobre 2026 ; libellé gardé pour les anciens contrôles.
  montage: "Montage",
  analystes: "Analystes",
  inspiration: "Inspiration",
  boss: "Kevin",
  qa: "Contrôle qualité",
};

export function qaTeamWord(teamKey: string): string {
  return TEAM_WORDS[teamKey] ?? teamKey;
}

/** Type cité par le client (« post », « rapport », « alerte »…) → type de contenu (pur). */
export const QA_TYPE_PARAM = ["post", "rapport", "reponse", "recommandation", "alerte", "regle"] as const;
export type QaTypeParam = (typeof QA_TYPE_PARAM)[number];
export const QA_TYPE_OF_PARAM: Readonly<Record<QaTypeParam, QaContentType>> = {
  post: "POST",
  rapport: "REPORT",
  reponse: "KEVIN_RESPONSE",
  recommandation: "RECOMMENDATION",
  alerte: "ALERT",
  regle: "COMPLIANCE_RULE",
};

// ------------------------------------------------------------------------------------------------ masquage

/**
 * Masque ce qu'un motif pourrait citer (pur) : jetons de bot, clés, mots de passe écrits, courriels, téléphones,
 * identifiants internes longs, paramètres d'adresse ; retire les codes techniques en majuscules ; coupe à `max`.
 */
export function maskQaText(raw: unknown, max = 180): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\s+/g, " ").trim();
  s = s
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1")
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[jeton masqué]")
    .replace(/\b(?:sk|pk|rk|key|tok|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{10,}\b/gi, "[clé masquée]")
    .replace(/\b(mot de passe|password|passwd|pwd|secret|token|jeton|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1 : [masqué]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[courriel masqué]")
    .replace(/(?:\+|00)\d[\d .-]{7,}\d/g, "[téléphone masqué]")
    .replace(/\b0[1-9](?:[ .-]?\d{2}){4}\b/g, "[téléphone masqué]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, (m) => (/\d/.test(m) && /[a-z]/i.test(m) ? "[identifiant masqué]" : m))
    .replace(/\b[A-Z]{2,}_[A-Z_]{2,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ------------------------------------------------------------------------------------------------ lignes

export type QaRow = {
  id: string;
  contentType: QaContentType;
  contentId: string;
  teamKey: string;
  verdict: QaVerdict;
  reasons: unknown;
  corrections: unknown;
  modelUsed: string;
  durationMs: number;
  attempt: number;
  createdAt: Date;
};

export type QaReasonView = { code: string; word: string; message: string; critical: boolean };
export type QaCorrectionView = { field: string; suggestion: string };

/** Motifs lisibles d'une vérification (pur ; message masqué). */
export function reasonsOf(raw: unknown): QaReasonView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const code = typeof r.code === "string" ? r.code : "";
      return { code, word: qaReasonWord(code), message: maskQaText(r.message), critical: r.severity !== "warning" };
    });
}

/** Corrections demandées (pur ; champ et conseil masqués ; « attendu » et « reçu » jamais montrés tels quels). */
export function correctionsOf(raw: unknown): QaCorrectionView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ field: maskQaText(r.field, 40), suggestion: maskQaText(r.suggestion ?? r.expected, 160) }))
    .filter((c) => c.suggestion);
}

export type QaWindowStats = { total: number; approved: number; rejected: number; timeout: number; error: number; rate: number | null };

export function windowStats(rows: readonly Pick<QaRow, "verdict">[]): QaWindowStats {
  const s = { total: rows.length, approved: 0, rejected: 0, timeout: 0, error: 0 };
  for (const r of rows) {
    if (r.verdict === "APPROVED") s.approved++;
    else if (r.verdict === "REJECTED") s.rejected++;
    else if (r.verdict === "TIMEOUT") s.timeout++;
    else s.error++;
  }
  return { ...s, rate: s.total ? s.approved / s.total : null };
}

/** Motifs les plus fréquents des refus (pur). */
export function topReasons(rows: readonly Pick<QaRow, "verdict" | "reasons">[], n = 3): Array<{ word: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.verdict !== "REJECTED") continue;
    const words = new Set(reasonsOf(r.reasons).filter((x) => x.critical).map((x) => x.word));
    for (const w of words) by.set(w, (by.get(w) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, n);
}

export type QaModelState = "off" | "paused" | "ok" | "idle";

/** État du contrôle (pur) : coupé, en pause (modèle indisponible plus récent que la dernière réussite), en marche. */
export function qaModelState(rowsDesc: readonly Pick<QaRow, "verdict" | "createdAt">[], enabled: boolean, now: Date): QaModelState {
  if (!enabled) return "off";
  const last = rowsDesc[0];
  if (!last) return "idle";
  if (last.verdict === "ERROR" && now.getTime() - last.createdAt.getTime() <= QA_PAUSE_WINDOW_MS) return "paused";
  return "ok";
}

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)} %`);
const secs = (ms: number) => `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function whenLabel(at: Date, now: Date): string {
  const day = parisDay(at);
  const time = at.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
  if (day === parisDay(now)) return `aujourd'hui à ${time}`;
  if (day === parisDay(new Date(now.getTime() - DAY_MS))) return `hier à ${time}`;
  const date = at.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });
  return `le ${date} à ${time}`;
}

// ------------------------------------------------------------------------------------------------ textes fixes

export const QA_KEVIN_VARIANTS = {
  paused: ["Le contrôle qualité est en pause, je reprends dès que possible.", "Le contrôle qualité est en pause pour le moment. Je reprends dès que possible, rien ne sort en attendant."],
  off: ["Le contrôle qualité global est coupé dans les réglages.", "Le contrôle qualité global est éteint pour le moment, dans les réglages."],
  running: ["Le contrôle qualité tourne normalement.", "Le contrôle qualité marche bien en ce moment."],
  nothingYet: ["Rien n'est encore passé par le contrôle qualité ces 7 jours.", "Le contrôle qualité n'a encore rien vérifié ces 7 jours."],
  noRefusal: voiceTemplate<{ days: number }>([{ days: 7 }, { days: 1 }], (p) => [
    `Aucun refus ${p.days === 1 ? "aujourd'hui" : `ces ${p.days} jours`} : tout ce qui a été vérifié est passé.`,
    `Pas un seul refus ${p.days === 1 ? "aujourd'hui" : `sur ${p.days} jours`}.`,
  ]),
  askDetail: ["Demande « pourquoi le 2 ? » pour le détail d'un refus.", "Pour le détail, dis-moi « pourquoi le 1 ? »."],
  notFound: [
    "Je ne trouve pas de contrôle pour ce contenu. Dis-moi par exemple « pourquoi le post 42 a été refusé ? ».",
    "Aucun contrôle qualité pour ce contenu. Essaie avec son numéro, par exemple « le post 42 ».",
  ],
  noProblem: ["Aucun contenu bloqué en ce moment, rien à expliquer.", "Rien n'a été refusé récemment, tout est passé."],
  timeout: [
    "Le contrôle a pris plus de 30 secondes : le contenu reste bloqué et repasse au contrôle tout seul.",
    "Le contrôle a été trop long, donc le contenu attend. Il repasse au contrôle tout seul.",
  ],
  error: [
    "Le contrôle qualité n'a pas pu le vérifier : le contenu reste bloqué jusqu'à son retour.",
    "Pas de contrôle possible à ce moment-là, donc rien n'est sorti. Il repasse dès que le contrôle revient.",
  ],
  approved: ["Il est passé au contrôle qualité sans souci.", "Le contrôle qualité l'a accepté."],
  thirdRefusal: ["C'est le 3e refus : c'est à toi de trancher, l'équipe ne le renvoie plus seule.", "Trois refus pour ce contenu : la décision te revient."],
  backToTeam: ["Il est reparti chez l'équipe, qui corrige et le renvoie au contrôle.", "L'équipe corrige et le renvoie au contrôle."],
} satisfies VoiceTable;

const V = QA_KEVIN_VARIANTS;

// ------------------------------------------------------------------------------------------------ lectures

async function qaEnabled(deps: Pick<AgentsDeps, "prisma">): Promise<boolean> {
  const v = await readSetting(deps, QA_SETTINGS.enabled.key);
  return v === undefined || v === null ? QA_SETTINGS.enabled.value : v !== false && v !== "false";
}

export type QaRowFilter = { contentType?: QaContentType | null; teamKey?: string | null };

async function rowsSince(deps: Pick<AgentsDeps, "prisma">, since: Date, f: QaRowFilter = {}): Promise<QaRow[]> {
  return (await deps.prisma.qaCheck.findMany({
    where: { createdAt: { gte: since }, ...(f.contentType ? { contentType: f.contentType } : {}), ...(f.teamKey ? { teamKey: f.teamKey } : {}) },
    orderBy: { createdAt: "desc" },
    take: QA_KEVIN_READ_LIMIT,
  })) as unknown as QaRow[];
}

/** Nom court d'un contenu vérifié (« le post 42 sur Casino VIP »), sans jamais son texte. */
export async function contentLabel(deps: Pick<AgentsDeps, "prisma">, row: Pick<QaRow, "contentType" | "contentId" | "teamKey">): Promise<string> {
  const p = deps.prisma;
  try {
    switch (row.contentType) {
      case "POST": {
        const post = (await p.post.findFirst({ where: { id: row.contentId } })) as { id: string; channelId: string } | null;
        const mission = (await p.agentMission.findFirst({ where: { OR: [{ postId: row.contentId }, { id: row.contentId }] } })) as { id: string; channelId: string | null } | null;
        const validation = mission ? ((await p.agentValidation.findFirst({ where: { missionId: mission.id }, orderBy: { createdAt: "desc" } })) as { number: number } | null) : null;
        const channelId = post?.channelId ?? mission?.channelId ?? null;
        const channel = channelId ? ((await p.channel.findFirst({ where: { id: channelId } })) as { title: string } | null) : null;
        const head = validation ? `le post ${validation.number}` : "un post";
        return channel ? `${head} sur ${esc(channel.title)}` : `${head} (${qaTeamWord(row.teamKey)})`;
      }
      case "REPORT": {
        const rep = (await p.strategyReport.findFirst({ where: { id: row.contentId } })) as { title: string } | null;
        return rep ? `le rapport « ${esc(maskQaText(rep.title, 60))} »` : "un rapport";
      }
      default:
        return `${QA_CONTENT_WORDS[row.contentType]?.one ?? "un contenu"} (${qaTeamWord(row.teamKey)})`;
    }
  } catch {
    return QA_CONTENT_WORDS[row.contentType]?.one ?? "un contenu";
  }
}

/** « comment va le contrôle qualité ? » : aujourd'hui, 7 jours, temps moyen, derniers refus, état. */
export async function qaStatusReply(deps: AgentsDeps, chatKey: string | null): Promise<{ text: string; facts: Record<string, unknown> }> {
  const now = nowOf(deps);
  const enabled = await qaEnabled(deps);
  const week = await rowsSince(deps, new Date(now.getTime() - 7 * DAY_MS));
  const dayStart = parisDayStart(parisDay(now));
  const today = week.filter((r) => r.createdAt >= dayStart);
  const d = windowStats(today);
  const w = windowStats(week);
  const state = qaModelState(week, enabled, now);
  const timed = week.filter((r) => r.verdict === "APPROVED" || r.verdict === "REJECTED");
  const avgMs = timed.length ? Math.round(timed.reduce((s, r) => s + r.durationMs, 0) / timed.length) : null;
  const facts = { aujourdhui: d, semaine: w, tempsMoyenMs: avgMs, etat: state };
  const lines: string[] = [];
  if (state === "off") lines.push(pick(V.off, "qa.off", chatKey));
  else if (state === "paused") lines.push(pick(V.paused, "qa.paused", chatKey));
  if (!w.total) {
    lines.push(pick(V.nothingYet, "qa.nothing", chatKey));
    return { text: lines.join("\n"), facts };
  }
  lines.push(
    d.total
      ? `Aujourd'hui : ${plural(d.total, "contenu vérifié", "contenus vérifiés")}, ${pct(d.rate)} acceptés, ${plural(d.rejected, "refus", "refus")}.`
      : "Aujourd'hui : rien de vérifié pour le moment.",
  );
  const blocked = w.timeout + w.error;
  lines.push(`Sur 7 jours : ${plural(w.total, "contenu vérifié", "contenus vérifiés")}, ${pct(w.rate)} acceptés, ${plural(w.rejected, "refus", "refus")}${blocked ? `, ${plural(blocked, "bloqué faute de contrôle", "bloqués faute de contrôle")}` : ""}.`);
  if (avgMs !== null) lines.push(`Temps moyen d'une vérification : ${secs(avgMs)}.`);
  const lastRejected = week.filter((r) => r.verdict === "REJECTED").slice(0, 2);
  if (lastRejected.length) {
    const parts: string[] = [];
    for (const r of lastRejected) {
      const why = reasonsOf(r.reasons).find((x) => x.critical)?.word ?? "autre motif";
      parts.push(`${await contentLabel(deps, r)} (${why})`);
    }
    lines.push(`Derniers refus : ${parts.join(", ")}.`);
  }
  if (state === "ok") lines.push(pick(V.running, "qa.running", chatKey));
  return { text: lines.join("\n"), facts };
}

/** Clé du dernier relevé numéroté des refus d'une conversation (« pourquoi le 2 ? »). */
export const qaListKey = (chatKey: string | null) => `boss.qa.list.${chatKey ?? "admin"}`;

export type QaHistoryParams = { days?: number; contentType?: QaContentType | null; teamKey?: string | null };

/** « montre-moi les refus de cette semaine » / « combien de refus cette semaine ? » : compte, motifs, liste numérotée. */
export async function qaHistoryReply(deps: AgentsDeps, chatKey: string | null, p: QaHistoryParams = {}): Promise<{ text: string; facts: Record<string, unknown> }> {
  const now = nowOf(deps);
  const days = Math.min(30, Math.max(1, p.days ?? 7));
  const since = days === 1 ? parisDayStart(parisDay(now)) : new Date(now.getTime() - days * DAY_MS);
  const rows = await rowsSince(deps, since, p);
  const s = windowStats(rows);
  const rejected = rows.filter((r) => r.verdict === "REJECTED");
  const top = topReasons(rows);
  const facts = { jours: days, verifies: s.total, refus: s.rejected, bloques: s.timeout + s.error, motifs: top };
  if (!rejected.length) {
    const blocked = s.timeout + s.error;
    const head = pick(V.noRefusal({ days }), "qa.noRefusal", chatKey);
    return { text: blocked ? `${head}\n${plural(blocked, "contenu bloqué", "contenus bloqués")} faute de contrôle, ${blocked > 1 ? "ils repassent" : "il repasse"} tout seul.` : head, facts };
  }
  const period = days === 1 ? "Aujourd'hui" : `Sur ${days} jours`;
  const what = p.contentType ? ` (${QA_CONTENT_WORDS[p.contentType].many})` : p.teamKey ? ` (${qaTeamWord(p.teamKey)})` : "";
  const lines = [`${period}${what} : ${plural(rejected.length, "refus", "refus")} sur ${plural(s.total, "contenu vérifié", "contenus vérifiés")}.`];
  if (top.length) lines.push(`Motifs les plus fréquents : ${top.map((t) => `${t.word} (${t.count})`).join(", ")}.`);
  const shown = rejected.slice(0, QA_KEVIN_LIST_MAX);
  let n = 0;
  for (const r of shown) {
    n++;
    const why = reasonsOf(r.reasons).find((x) => x.critical)?.word ?? "autre motif";
    lines.push(`${n}. ${await contentLabel(deps, r)}, ${whenLabel(r.createdAt, now)} : ${why}`);
  }
  await writeSetting(deps, qaListKey(chatKey), { at: now.toISOString(), ids: shown.map((r) => r.id) });
  lines.push(rejected.length > shown.length ? `Et ${rejected.length - shown.length} de plus sur le site, Agents puis Qualité.` : pick(V.askDetail, "qa.askDetail", chatKey));
  return { text: lines.join("\n"), facts };
}

export type QaDetailParams = { type?: QaTypeParam | null; numero?: number | null; rang?: number | null };

/** Retrouve le contenu visé : numéro de la dernière liste, post N (numéro de validation), sinon le dernier refus. */
async function findTarget(deps: AgentsDeps, chatKey: string | null, p: QaDetailParams): Promise<QaRow | null> {
  const prisma = deps.prisma;
  const type = p.type ? QA_TYPE_OF_PARAM[p.type] : null;
  const list = (await readSetting(deps, qaListKey(chatKey))) as { ids?: unknown } | undefined;
  const ids = Array.isArray(list?.ids) ? (list!.ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const rank = p.rang ?? (!type && p.numero && p.numero <= ids.length ? p.numero : null);
  const latestOf = async (contentType: QaContentType, contentIds: string[]) =>
    contentIds.length
      ? ((await prisma.qaCheck.findFirst({ where: { contentType, contentId: { in: contentIds } }, orderBy: { createdAt: "desc" } })) as unknown as QaRow | null)
      : null;
  if (rank) {
    const id = ids[rank - 1];
    const row = id ? ((await prisma.qaCheck.findFirst({ where: { id } })) as unknown as QaRow | null) : null;
    return row ? ((await latestOf(row.contentType, [row.contentId])) ?? row) : null;
  }
  if (p.numero && (type === "POST" || !type)) {
    const v = (await prisma.agentValidation.findFirst({ where: { number: p.numero } })) as { missionId: string } | null;
    if (!v) return null;
    const m = (await prisma.agentMission.findFirst({ where: { id: v.missionId } })) as { id: string; postId: string | null } | null;
    return latestOf("POST", [m?.postId, v.missionId].filter((x): x is string => !!x));
  }
  return (await prisma.qaCheck.findFirst({
    where: { verdict: { in: ["REJECTED", "TIMEOUT", "ERROR"] }, ...(type ? { contentType: type } : {}) },
    orderBy: { createdAt: "desc" },
  })) as unknown as QaRow | null;
}

/** « pourquoi le post 42 a été refusé ? » : dernier contrôle du contenu, motifs, corrections, tentative, durée. */
export async function qaDetailReply(deps: AgentsDeps, chatKey: string | null, p: QaDetailParams = {}): Promise<{ text: string; facts: Record<string, unknown> }> {
  const now = nowOf(deps);
  const row = await findTarget(deps, chatKey, p);
  if (!row) {
    const anything = p.numero || p.rang || p.type;
    return { text: pick(anything ? V.notFound : V.noProblem, anything ? "qa.notFound" : "qa.noProblem", chatKey), facts: { trouve: false } };
  }
  const label = await contentLabel(deps, row);
  const subject = label.charAt(0).toUpperCase() + label.slice(1);
  const reasons = reasonsOf(row.reasons);
  const corrections = correctionsOf(row.corrections);
  const facts = { trouve: true, resultat: row.verdict, tentative: row.attempt, dureeMs: row.durationMs, motifs: reasons.map((r) => r.word) };
  const lines: string[] = [];
  const when = whenLabel(row.createdAt, now);
  if (row.verdict === "APPROVED") {
    lines.push(`${subject} : vérifié ${when}, en ${secs(row.durationMs)}.`);
    lines.push(pick(V.approved, "qa.approved", chatKey));
    for (const r of reasons.slice(0, 2)) lines.push(`⚠️ Remarque : ${r.word}${r.message ? `, ${esc(r.message)}` : ""}`);
    return { text: lines.join("\n"), facts };
  }
  if (row.verdict === "TIMEOUT" || row.verdict === "ERROR") {
    lines.push(`${subject} : bloqué ${when}.`);
    lines.push(pick(row.verdict === "TIMEOUT" ? V.timeout : V.error, `qa.${row.verdict.toLowerCase()}`, chatKey));
    return { text: lines.join("\n"), facts };
  }
  lines.push(`${subject} : refusé ${when}, tentative ${row.attempt} sur 3, contrôle de ${secs(row.durationMs)}.`);
  const critical = reasons.filter((r) => r.critical);
  for (const r of (critical.length ? critical : reasons).slice(0, 3)) lines.push(`❌ ${r.word}${r.message ? ` : ${esc(r.message)}` : ""}`);
  const fix = corrections.slice(0, 2);
  if (fix.length) lines.push(`À corriger : ${fix.map((c) => esc(c.field ? `${c.field}, ${c.suggestion}` : c.suggestion)).join(" ; ")}`);
  lines.push(pick(row.attempt >= 3 ? V.thirdRefusal : V.backToTeam, row.attempt >= 3 ? "qa.third" : "qa.back", chatKey));
  return { text: lines.join("\n"), facts };
}

/** Fiche de l'agent dans l'annuaire (« le QA global, il a fait quoi ? ») : ce qu'il a vérifié et refusé (7 jours). */
export async function qaAgentCard(deps: AgentsDeps): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const now = nowOf(deps);
  const enabled = await qaEnabled(deps);
  const week = await rowsSince(deps, new Date(now.getTime() - 7 * DAY_MS));
  const dayStart = parisDayStart(parisDay(now));
  const d = windowStats(week.filter((r) => r.createdAt >= dayStart));
  const w = windowStats(week);
  const top = topReasons(week, 2);
  const state = qaModelState(week, enabled, now);
  const lines: string[] = [];
  if (state === "off") lines.push(pick(V.off, "qa.off"));
  else if (state === "paused") lines.push(pick(V.paused, "qa.paused"));
  lines.push(`Aujourd'hui : ${plural(d.total, "contenu vérifié", "contenus vérifiés")}, ${plural(d.rejected, "refus", "refus")}.`);
  lines.push(
    w.total
      ? `Sur 7 jours : ${plural(w.total, "contenu vérifié", "contenus vérifiés")}, ${pct(w.rate)} acceptés${top.length ? `, surtout refusés pour ${top.map((t) => t.word).join(" et ")}` : ""}.`
      : "Sur 7 jours : 0 contenu vérifié pour le moment.",
  );
  lines.push("Il passe après le contrôle de chaque équipe et ne modifie jamais rien : il accepte ou il bloque.");
  const ratePct = w.rate === null ? null : Math.round(w.rate * 100);
  return { facts: { jours: 7, aujourdhui: d, semaine: w, partAcceptee: ratePct, motifs: top, etat: state }, lines };
}
