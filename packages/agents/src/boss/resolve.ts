/**
 * Résolution des noms donnés au Boss (phase 26) : équipe (nom ou alias, fautes comprises), canal (titre, tolérance aux
 * fautes et aux accents, ou prénom de la persona du canal), persona (prénom), catégorie de paris, bookmaker. Jamais de
 * devinette : plusieurs candidats → question avec liste numérotée (réponse par le numéro, `Setting` `boss.clarify`),
 * aucun → « je ne trouve pas » avec les noms connus. Une valeur `id:<identifiant>` (choix d'une liste) est exacte.
 */
import { normalizeText } from "../human/answer";
import { esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import { supportedBookmakers } from "../providers/screenshot/adapters";
import { TEAM_KEYS, TEAM_LABELS, type AgentsDeps, type TeamKey } from "../types";
import type { BossReply } from "./contract";

export type Resolved<T> = { ok: true; value: T } | { ok: false; reply: BossReply };

export type ClarifyOption = { label: string; value: string };
/** Choix en attente après une question numérotée : la réponse « 2 » relance l'action avec la 2e option. */
export type BossClarify = {
  actionKey: string;
  params: Record<string, unknown>;
  field: string;
  options: ClarifyOption[];
  createdAt: string;
  expiresAt: string;
  /**
   * Qui a reçu la question : « admin », ou l'identifiant Telegram du membre (chaîne). Seule cette personne y répond
   * par le numéro, avec SES droits. Absent (ancienne question) = l'admin.
   */
  askedBy?: string | null;
  /** Conversation de la question (chaîne d'un BigInt) ; absente = n'importe laquelle de l'admin. */
  chatId?: string | null;
};
export const BOSS_CLARIFY_SETTING = "boss.clarify";
/** Une question numérotée reste valable 30 minutes (correctif du 25 octobre : 10 minutes, c'était trop court). */
export const BOSS_CLARIFY_TTL_MS = 30 * 60_000;

/**
 * Minuscules, sans accents ni ponctuation, espaces réduits ; emojis retirés. NFKD d'abord : les lettres stylisées
 * d'un titre de canal (« 🚩𝑪𝑶𝑹𝑵𝑬𝑹 ») redeviennent des lettres ordinaires (« corner »).
 */
export function normName(s: string): string {
  return normalizeText(s.normalize("NFKD"))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distance d'édition (Levenshtein), bornée pour rester rapide sur des noms courts. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** Faute tolérée selon la longueur du mot (1 pour 4-6 lettres, 2 au-delà). */
function closeEnough(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  const max = len < 4 ? 0 : len <= 6 ? 1 : 2;
  return editDistance(a, b) <= max;
}

const TEAM_ALIASES: Record<string, TeamKey> = {
  dating: "dating",
  dateing: "dating",
  datting: "dating",
  datin: "dating",
  rencontre: "dating",
  rencontres: "dating",
  "l equipe rencontres": "dating",
  meet: "dating",
  casino: "casino",
  casinos: "casino",
  cazino: "casino",
  kasino: "casino",
  paris: "sports",
  pari: "sports",
  "paris sportifs": "sports",
  "paris sportif": "sports",
  "pari sportif": "sports",
  sport: "sports",
  sports: "sports",
  foot: "sports",
  football: "sports",
  bet: "sports",
  bets: "sports",
  paries: "sports",
  algo: "algo",
  algorithme: "algo",
  algorythme: "algo",
  algoritme: "algo",
  algorithm: "algo",
};
const ALL_WORDS = new Set(["tout", "tous", "toutes", "all", "tout le monde", "toutes les equipes", "les equipes", "partout"]);

/** Équipe nommée (pur) ; `"all"` pour « tout » si permis ; null si inconnue. */
export function teamOf(raw: string, opts: { allowAll?: boolean } = {}): TeamKey | "all" | null {
  let n = normName(raw).replace(/^(l |la |le |les |equipe |l equipe |team )+/, "").trim();
  n = n.replace(/^(equipe |team )/, "").trim();
  if (opts.allowAll && ALL_WORDS.has(n)) return "all";
  if (TEAM_ALIASES[n]) return TEAM_ALIASES[n]!;
  for (const k of TEAM_KEYS) if (normName(TEAM_LABELS[k]) === n) return k;
  // Fautes de frappe : alias le plus proche, s'il est seul.
  const near = [...new Set(Object.entries(TEAM_ALIASES).filter(([a]) => closeEnough(a, n)).map(([, t]) => t))];
  if (near.length === 1) return near[0]!;
  return null;
}

export function resolveTeam(raw: string | undefined, opts: { allowAll?: boolean } = {}): Resolved<TeamKey | "all"> {
  if (!raw) return { ok: false, reply: { reply: `Quelle équipe ? ${teamChoices(opts.allowAll)}` } };
  const t = teamOf(raw, opts);
  if (t) return { ok: true, value: t };
  return { ok: false, reply: { reply: `Je ne connais pas l'équipe « ${esc(raw)} ». ${teamChoices(opts.allowAll)}` } };
}

function teamChoices(all?: boolean): string {
  return `Équipes : ${TEAM_KEYS.map((k) => TEAM_LABELS[k]).join(", ")}${all ? " (ou « tout »)" : ""}.`;
}

type Named = { id: string; name: string; extra?: string[] };

/** Candidats d'une liste de noms (pur) : exact, puis début / mot contenu, puis faute tolérée. */
export function matchNames<T extends Named>(raw: string, items: readonly T[]): T[] {
  if (raw.startsWith("id:")) return items.filter((i) => i.id === raw.slice(3));
  const n = normName(raw);
  if (!n) return [];
  const names = (i: T) => [i.name, ...(i.extra ?? [])].map(normName).filter(Boolean);
  const exact = items.filter((i) => names(i).includes(n));
  if (exact.length) return exact;
  const words = n.split(" ").filter((w) => w.length >= 2);
  const contains = items.filter((i) => names(i).some((x) => x.includes(n) || (n.length >= 3 && x.split(" ").some((w) => w.startsWith(n)))));
  if (contains.length) return contains;
  const allWords = items.filter((i) => names(i).some((x) => words.length > 0 && words.every((w) => x.split(" ").some((y) => y === w || closeEnough(y, w)))));
  if (allWords.length) return allWords;
  return items.filter((i) => names(i).some((x) => closeEnough(x, n) || x.split(" ").some((y) => y.length >= 4 && closeEnough(y, n))));
}

/** Auteur d'un message pour une question numérotée : « admin » ou l'identifiant du membre (pur). */
export function clarifyOwnerOf(speaker?: { kind: string; telegramUserId: bigint } | null): string {
  return speaker && speaker.kind === "member" ? speaker.telegramUserId.toString() : "admin";
}

/** Cette réponse par numéro vient-elle de la personne et de la conversation de la question (pur) ? */
export function clarifyIsFor(
  clarify: Pick<BossClarify, "askedBy" | "chatId">,
  input: { speaker?: { kind: string; telegramUserId: bigint } | null; chatId?: bigint | null },
): boolean {
  if ((clarify.askedBy ?? "admin") !== clarifyOwnerOf(input.speaker)) return false;
  return !clarify.chatId || input.chatId == null || clarify.chatId === input.chatId.toString();
}

/**
 * Mémorise la question numérotée (réponse par le numéro) et rend la réponse à afficher. L'auteur et la conversation
 * viennent des dépendances d'exécution du Boss (`speaker`, `chat`) quand l'action les a.
 */
export async function askToChoose(
  deps: AgentsDeps,
  input: { actionKey: string; params: Record<string, unknown>; field: string; question: string; options: ClarifyOption[] },
): Promise<BossReply> {
  const now = nowOf(deps);
  const options = input.options.slice(0, 9);
  const who = deps as AgentsDeps & { speaker?: { kind: string; telegramUserId: bigint } | null; chat?: { chatId: bigint } | null };
  const clarify: BossClarify = {
    actionKey: input.actionKey,
    params: input.params,
    field: input.field,
    options,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + BOSS_CLARIFY_TTL_MS).toISOString(),
    askedBy: clarifyOwnerOf(who.speaker),
    chatId: who.chat?.chatId != null ? who.chat.chatId.toString() : null,
  };
  await writeSetting(deps, BOSS_CLARIFY_SETTING, clarify);
  return {
    reply: [esc(input.question), ...options.map((o, i) => `${i + 1}. ${esc(o.label)}`), "Réponds par le numéro."].join("\n"),
  };
}

export async function readClarify(deps: AgentsDeps): Promise<BossClarify | null> {
  const v = (await readSetting(deps, BOSS_CLARIFY_SETTING)) as BossClarify | null | undefined;
  if (!v || typeof v !== "object" || typeof v.actionKey !== "string" || !Array.isArray(v.options)) return null;
  if (new Date(v.expiresAt).getTime() <= nowOf(deps).getTime()) return null;
  return v;
}

export async function clearClarify(deps: AgentsDeps): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: BOSS_CLARIFY_SETTING } });
}

type Ctx = { actionKey: string; params: Record<string, unknown>; field: string };

async function pickOne<T extends Named>(
  deps: AgentsDeps,
  ctx: Ctx,
  raw: string,
  items: readonly T[],
  what: { one: string; question: string; known: string },
): Promise<Resolved<T>> {
  const found = matchNames(raw, items);
  if (found.length === 1) return { ok: true, value: found[0]! };
  if (found.length > 1)
    return {
      ok: false,
      reply: await askToChoose(deps, {
        ...ctx,
        question: what.question.replace("{x}", raw),
        options: found.map((f) => ({ label: f.name, value: `id:${f.id}` })),
      }),
    };
  const names = items.slice(0, 8).map((i) => i.name);
  return {
    ok: false,
    reply: {
      reply: names.length
        ? `Je ne trouve pas ${what.one} « ${esc(raw)} ». ${what.known} : ${names.map(esc).join(", ")}${items.length > 8 ? "…" : ""}.`
        : `Je ne trouve pas ${what.one} « ${esc(raw)} » : il n'y en a aucun pour le moment.`,
    },
  };
}

export type ChannelRef = { id: string; name: string; vertical: string | null; isTest: boolean; personaName: string | null; team: TeamKey | null };

const VERTICAL_TEAM: Record<string, TeamKey> = { DATING: "dating", CASINO: "casino", SPORTS: "sports" };

/** Canaux actifs (titre, univers, persona du plan). */
export async function channelRefs(deps: Pick<AgentsDeps, "prisma">, team?: TeamKey | null): Promise<ChannelRef[]> {
  const [channels, plans, personas] = await Promise.all([
    deps.prisma.channel.findMany({ where: { isActive: true }, select: { id: true, title: true, vertical: true, isTest: true }, orderBy: { title: "asc" } }),
    deps.prisma.channelAgentPlan.findMany({ select: { channelId: true, personaId: true, teamKey: true } }),
    deps.prisma.persona.findMany({ select: { id: true, name: true } }),
  ]);
  const personaName = new Map((personas as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const planOf = new Map((plans as { channelId: string; personaId: string | null; teamKey: string }[]).map((p) => [p.channelId, p]));
  const out = (channels as { id: string; title: string; vertical: string | null; isTest: boolean }[]).map((c) => {
    const plan = planOf.get(c.id);
    return {
      id: c.id,
      name: c.title,
      vertical: c.vertical,
      isTest: c.isTest,
      personaName: plan?.personaId ? (personaName.get(plan.personaId) ?? null) : null,
      team: (plan?.teamKey as TeamKey | undefined) ?? (c.vertical ? (VERTICAL_TEAM[c.vertical] ?? null) : null),
    };
  });
  return team ? out.filter((c) => c.team === team || c.isTest) : out;
}

/** Canal par titre (ou par prénom de la persona de son plan). */
export async function resolveChannel(
  deps: AgentsDeps,
  ctx: Ctx,
  raw: string | undefined,
  opts: { team?: TeamKey | null } = {},
): Promise<Resolved<ChannelRef>> {
  const refs = await channelRefs(deps, opts.team ?? null);
  if (!raw)
    return {
      ok: false,
      reply: refs.length
        ? await askToChoose(deps, { ...ctx, question: "Quel canal ?", options: refs.slice(0, 9).map((c) => ({ label: c.name, value: `id:${c.id}` })) })
        : { reply: "Aucun canal actif pour le moment." },
    };
  const items = refs.map((c) => ({ ...c, extra: c.personaName ? [c.personaName] : [] }));
  return pickOne(deps, ctx, raw, items, { one: "de canal", question: "Plusieurs canaux correspondent à « {x} » :", known: "Canaux" });
}

export type PersonaRef = { id: string; name: string; isActive: boolean; universe: string };

export async function personaRefs(deps: Pick<AgentsDeps, "prisma">): Promise<PersonaRef[]> {
  return (await deps.prisma.persona.findMany({ select: { id: true, name: true, isActive: true, universe: true }, orderBy: { createdAt: "asc" } })) as PersonaRef[];
}

export async function resolvePersona(deps: AgentsDeps, ctx: Ctx, raw: string | undefined): Promise<Resolved<PersonaRef>> {
  const refs = await personaRefs(deps);
  if (!raw)
    return {
      ok: false,
      reply: refs.length
        ? await askToChoose(deps, { ...ctx, question: "Quelle persona ?", options: refs.slice(0, 9).map((p) => ({ label: p.name, value: `id:${p.id}` })) })
        : { reply: "Aucune persona pour le moment (Conversations → Personas)." },
    };
  return pickOne(deps, ctx, raw, refs, { one: "de persona", question: "Plusieurs personas s'appellent « {x} » :", known: "Personas" });
}

export type CategoryRef = { id: string; name: string; key: string; active: boolean; extra: string[] };

/** « corners » → catégorie dont la clé ou le nom contient « corner » ; pluriels et fautes tolérés. */
export async function resolveBetCategory(deps: AgentsDeps, ctx: Ctx, raw: string | undefined): Promise<Resolved<CategoryRef>> {
  const rows = (await deps.prisma.betCategory.findMany({ select: { id: true, key: true, name: true, active: true }, orderBy: { sortOrder: "asc" } })) as {
    id: string;
    key: string;
    name: string;
    active: boolean;
  }[];
  const refs: CategoryRef[] = rows.map((r) => ({ ...r, extra: [r.key.replace(/[-_]/g, " ")] }));
  if (!raw)
    return {
      ok: false,
      reply: refs.length
        ? await askToChoose(deps, { ...ctx, question: "Quelle catégorie de paris ?", options: refs.slice(0, 9).map((c) => ({ label: c.name, value: `id:${c.id}` })) })
        : { reply: "Aucune catégorie de paris pour le moment." },
    };
  const singular = normName(raw).replace(/\b(\p{L}{3,})s\b/gu, "$1");
  const found = matchNames(raw, refs);
  const list = found.length ? found : matchNames(singular, refs);
  if (list.length === 1) return { ok: true, value: list[0]! };
  return pickOne(deps, ctx, list.length ? raw : singular, list.length ? list : refs, {
    one: "de catégorie",
    question: "Plusieurs catégories correspondent à « {x} » :",
    known: "Catégories",
  });
}

/** Bookmaker avec adaptateur de capture (« sportaza », fautes tolérées). */
export function resolveBookmaker(raw: string | undefined): Resolved<string> {
  const list = supportedBookmakers();
  if (!raw) {
    if (list.length === 1) return { ok: true, value: list[0]! };
    return { ok: false, reply: { reply: `Quel bookmaker ? ${list.join(", ")}.` } };
  }
  const n = normName(raw).replace(/\s+/g, "");
  const hit = list.filter((b) => b === n || closeEnough(b, n) || b.startsWith(n));
  if (hit.length === 1) return { ok: true, value: hit[0]! };
  return { ok: false, reply: { reply: `Je ne connais pas le bookmaker « ${esc(raw)} ». Bookmakers : ${list.join(", ") || "aucun"}.` } };
}

/** Bornes communes (pures) : niveau 0-2, plafond ≥ 0, quota entre 0 et le maximum réglé. */
export function checkLevel(n: number): string | null {
  return n === 0 || n === 1 || n === 2 ? null : "Le niveau va de 0 à 2.";
}
export function checkCap(euros: number): string | null {
  return Number.isFinite(euros) && euros >= 0 && euros <= 100_000 ? null : "Un plafond va de 0 à 100 000 €.";
}
export function checkQuota(n: number, max: number): string | null {
  if (!Number.isInteger(n) || n < 0) return "Un quota est un nombre entier de posts par jour (0 ou plus).";
  if (n > max) return `Au-dessus du maximum réglé (${max} posts par jour, réglage de l'équipe Algorithme).`;
  return null;
}
