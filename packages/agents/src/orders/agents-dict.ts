/**
 * Phase 33, chantier C — annuaire des agents (`docs/AGENTS-ARCHITECTURE.md`) : chaque agent nommable par son nom ou
 * en français courant (« l'agent des paris », « celui qui écrit », « le correcteur », « celui des heures »), son
 * équipe, son Chef et sa clé dans le code. `findAgent(text)` retrouve un agent (fautes et accents tolérés ; plusieurs
 * candidats → liste, jamais de devinette). `agentCard(deps, clé)` : sa fiche (rôle, ce qu'il a fait aujourd'hui, ce
 * qu'il va faire, ses réglages actuels, ce qu'on peut lui demander), en LECTURE SEULE.
 *
 * Aucun agent ne reçoit d'ordre directement : « dis à l'agent X de … » passe par Kevin (chantier B) → Grand Chef →
 * Chef de X (capacité du registre). L'annuaire ne sert qu'à nommer et à décrire.
 */
import { nowOf, readSetting } from "../admin/journal";
import { editDistance, normName } from "../boss/resolve";
import { ACTIVE_STATUSES, parsePayload, parseSteps } from "../missions/mission";
import { parisDay } from "../rules/time";
import { parseSportsSettings } from "../sports/settings";
import { TEAM_LABELS, type AgentsDeps, type TeamKey } from "../types";
import type { Capability, OrderTeamKey } from "./contract";
import { capabilitiesForAgent } from "./registry";
import { dayLabel, hourLabel, plainPreview, readTeamState, slotRange, type DaySlot, type ViewResult } from "./view/common";

export type AgentKind = "direction" | "chef" | "agent";

export type AgentEntry = {
  /** Clé dans le code (`AgentKey` pour les agents des chaînes ; `grand-chef`, `chef-<équipe>`, `conversation`…). */
  key: string;
  label: string;
  kind: AgentKind;
  /** Équipes où il travaille (les métiers communs sont dans plusieurs équipes). */
  teams: OrderTeamKey[];
  /** Clé de son Chef dans l'annuaire (le Grand Chef pour les Chefs et l'agent Ads). */
  chief: string | null;
  /** Une ligne en français courant. */
  role: string;
  /** Façons de le nommer (sans article, normalisées à la lecture). */
  synonyms: string[];
  /** Faux = emplacement réservé (l'équipe arrive dans une phase suivante). */
  available: boolean;
  /** Pour un emplacement réservé : quand il arrive. */
  arrives?: string;
};

const e = (x: Omit<AgentEntry, "available"> & { available?: boolean }): AgentEntry => ({ available: true, ...x });

/** Annuaire complet, dans l'ordre de `docs/AGENTS-ARCHITECTURE.md`. */
export const AGENT_DIRECTORY: readonly AgentEntry[] = [
  e({
    key: "grand-chef",
    label: "Grand Chef",
    kind: "direction",
    teams: ["transverse"],
    chief: null,
    role: "Fixe le plan du jour de chaque canal, tient les budgets, évite les collisions et met une équipe en pause après 3 échecs.",
    synonyms: ["grand chef", "chef de la production", "le chef de tout", "directeur", "patron des agents", "orchestrateur"],
  }),
  e({
    key: "chef-dating",
    label: "Chef Rencontres",
    kind: "chef",
    teams: ["dating"],
    chief: "grand-chef",
    role: "Transforme le plan du jour des canaux Rencontres en posts et les fait passer par ses agents, dans l'ordre.",
    synonyms: ["chef rencontres", "chef rencontre", "chef dating", "chef des rencontres", "chef de l'equipe rencontres"],
  }),
  e({
    key: "chef-casino",
    label: "Chef Casino",
    kind: "chef",
    teams: ["casino"],
    chief: "grand-chef",
    role: "Transforme le plan du jour des canaux Casino en posts, uniquement avec tes médias.",
    synonyms: ["chef casino", "chef du casino", "chef de l'equipe casino"],
  }),
  e({
    key: "chef-sports",
    label: "Chef Paris sportifs",
    kind: "chef",
    teams: ["sports"],
    chief: "grand-chef",
    role: "Lance la recherche de paris à chaque passage (10 h, 15 h, 18 h par défaut) et fait suivre chaque pari jusqu'à la publication.",
    synonyms: ["chef paris", "chef paris sportifs", "chef des paris", "chef sport", "chef sports", "chef de l'equipe paris"],
  }),
  e({
    key: "chef-algo",
    label: "Chef Algorithme",
    kind: "chef",
    teams: ["algo", "inspiration"],
    chief: "grand-chef",
    role: "Mesure ce qui marche et règle les autres équipes dans leurs bornes ; ne publie rien.",
    synonyms: ["chef algorithme", "chef algo", "chef de l'algo", "chef de l'equipe algorithme"],
  }),
  e({
    key: "mediatheque",
    label: "Médiathèque",
    kind: "agent",
    teams: ["dating", "casino"],
    chief: "chef-dating",
    role: "Range tes vidéos et photos, choisit le prochain média pas encore utilisé et te demande des vidéos quand il en manque.",
    synonyms: ["mediatheque", "bibliotheque", "videotheque", "celui qui range les videos", "celui des medias", "stock de medias", "videos"],
  }),
  e({
    key: "media-ia",
    label: "Média IA",
    kind: "agent",
    teams: ["dating"],
    chief: "chef-dating",
    role: "Fabrique les vidéos et photos du personnage (Rencontres seulement), dans le plafond du mois.",
    synonyms: ["media ia", "medias ia", "videos ia", "photos ia", "celui qui fait les videos", "celui qui fabrique les photos", "face swap", "faceswap", "videos"],
  }),
  e({
    key: "redaction",
    label: "Rédaction",
    kind: "agent",
    teams: ["dating", "casino", "sports"],
    chief: "chef-dating",
    role: "Écrit les légendes des posts : très courtes, dans le ton du canal et de la persona, sans se répéter.",
    synonyms: ["redaction", "redacteur", "redactrice", "celui qui ecrit", "celle qui ecrit", "ecrivain", "plume", "legendes", "textes", "copywriter"],
  }),
  e({
    key: "cotes",
    label: "Cotes et sélection",
    kind: "agent",
    teams: ["sports"],
    chief: "chef-sports",
    role: "Cherche les matchs à venir, compare les cotes des bookmakers et retient les paris les plus intéressants de chaque catégorie.",
    synonyms: ["cotes", "cotes et selection", "selection", "agent des paris", "agent des paris sportifs", "agent paris", "agent paris sportifs", "celui qui choisit les paris", "celui des cotes", "pronostiqueur", "agent des matchs"],
  }),
  e({
    key: "capture",
    label: "Capture écran",
    kind: "agent",
    teams: ["sports"],
    chief: "chef-sports",
    role: "Ouvre le site du bookmaker, vérifie que la cote est toujours là et en fait la capture, sans jamais miser.",
    synonyms: ["capture", "capture ecran", "capture d'ecran", "captures", "screenshot", "celui qui fait les captures", "photographe"],
  }),
  e({
    key: "planification",
    label: "Planification",
    kind: "agent",
    teams: ["dating", "casino"],
    chief: "chef-dating",
    role: "Choisit l'heure de chaque post : fenêtre du canal, meilleurs horaires, espacement, heures calmes.",
    synonyms: ["planification", "planificateur", "planning", "agenda", "celui qui programme", "celui qui choisit l'heure"],
  }),
  e({
    key: "controle",
    label: "Contrôle qualité",
    kind: "agent",
    teams: ["dating", "casino", "sports"],
    chief: "chef-dating",
    role: "Dernier filtre avant la publication : longueur, mots interdits, doublons, média, cote ; publie, fait refaire ou te demande.",
    synonyms: ["controle", "controle qualite", "correcteur", "correctrice", "relecteur", "qualite", "celui qui verifie", "celui qui relit", "filtre", "moderateur"],
  }),
  e({
    key: "publication",
    label: "Publication",
    kind: "agent",
    teams: ["dating", "casino", "sports"],
    chief: "chef-dating",
    role: "Programme le post dans la plateforme, qui l'envoie par le bot ou par le compte connecté.",
    synonyms: ["publication", "publieur", "celui qui publie", "celui qui envoie", "diffusion", "envoi"],
  }),
  e({
    key: "conversation",
    label: "Conversation",
    kind: "agent",
    teams: ["dating"],
    chief: "chef-dating",
    role: "L'assistante qui répond en privé aux personnes qui écrivent au bot de conversation (Rencontres).",
    synonyms: ["conversation", "assistante", "assistante de conversation", "celle qui discute", "celui qui repond en prive", "chatbot", "messages prives"],
  }),
  e({
    key: "ads",
    label: "Ads",
    kind: "agent",
    teams: ["ads"],
    chief: "grand-chef",
    role: "Lit les pubs Meta et TikTok et nos chiffres, et propose chaque jour quoi arrêter, augmenter ou tester ; ne touche jamais aux pubs.",
    synonyms: ["ads", "pubs", "publicites", "agent pub", "agent pubs", "agent des pubs", "celui des pubs", "meta", "tiktok"],
  }),
  e({
    key: "posts",
    label: "Posts",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Fait la fiche de résultats de chaque post (vues, clics, inscriptions) et classe ce qui marche par canal.",
    synonyms: ["posts", "agent des posts", "analyste des posts", "celui qui analyse les posts", "resultats des posts"],
  }),
  e({
    key: "horaires",
    label: "Horaires",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Calcule les meilleures heures de publication de chaque canal et les fenêtres conseillées.",
    synonyms: ["horaires", "horaire", "heures", "celui des heures", "agent des heures", "meilleures heures", "creneaux", "meilleurs horaires"],
  }),
  e({
    key: "conversations",
    label: "Conversations",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Mesure les conversations de chaque persona (réponses, décrochage, inscriptions) et propose des réglages.",
    synonyms: ["conversations", "analyste des conversations", "celui qui analyse les conversations", "agent des conversations"],
  }),
  e({
    key: "experimentation",
    label: "Expérimentation",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Monte des tests A/B propres, attend assez de données et déclare un gagnant ou « pas de différence ».",
    synonyms: ["experimentation", "experimentations", "tests ab", "test ab", "tests a b", "celui des tests", "experiences"],
  }),
  e({
    key: "synthese",
    label: "Synthèse et réglages",
    kind: "agent",
    teams: ["algo"],
    chief: "chef-algo",
    role: "Transforme les analyses en réglages concrets par canal, chiffres à l'appui, et écrit le rapport « Ce qui marche ».",
    synonyms: ["synthese", "synthese et reglages", "reglages", "celui qui regle", "celui des reglages", "rapport de la semaine"],
  }),
  e({
    key: "inspiration",
    label: "Inspiration",
    kind: "agent",
    teams: ["inspiration"],
    chief: "chef-algo",
    role: "Lit un canal qui marche, en tire un profil de style et des idées, sans jamais copier.",
    synonyms: ["inspiration", "agent inspiration", "canal d'inspiration", "veille", "celui qui lit les autres canaux", "concurrents", "espion"],
  }),
  e({
    key: "montage",
    label: "Montage",
    kind: "agent",
    teams: [],
    chief: null,
    role: "Montera les vidéos courtes (shorts, reels).",
    synonyms: ["montage", "monteur", "monteuse", "celui qui monte les videos", "shorts", "reels"],
    available: false,
    arrives: "phase 28",
  }),
  e({
    key: "analystes",
    label: "Analystes",
    kind: "agent",
    teams: [],
    chief: null,
    role: "Étudieront le marché et la concurrence.",
    synonyms: ["analystes", "analyste", "analyste marche", "analystes marche", "etude de marche"],
    available: false,
    arrives: "phase 29",
  }),
  e({
    key: "qa",
    label: "QA global",
    kind: "agent",
    teams: [],
    chief: null,
    role: "Relira tout ce qui sort, toutes équipes confondues.",
    synonyms: ["qa", "qa global", "controle global", "assurance qualite"],
    available: false,
    arrives: "phase 30",
  }),
  e({
    key: "prospection",
    label: "Prospection",
    kind: "agent",
    teams: [],
    chief: null,
    role: "Cherchera de nouveaux affiliés.",
    synonyms: ["prospection", "prospecteur", "prospectrice", "chercheur d'affilies", "recrutement d'affilies"],
    available: false,
    arrives: "phase 31",
  }),
];

const BY_KEY = new Map(AGENT_DIRECTORY.map((a) => [a.key, a]));

/** Tout l'annuaire (copie). */
export function agentDirectory(): AgentEntry[] {
  return AGENT_DIRECTORY.map((a) => ({ ...a, teams: [...a.teams], synonyms: [...a.synonyms] }));
}

export function agentEntry(key: string): AgentEntry | null {
  return BY_KEY.get(key) ?? null;
}

export type FindAgentResult =
  | { status: "found"; agent: AgentEntry }
  | { status: "ambiguous"; candidates: AgentEntry[] }
  | { status: "unknown"; known: string[] };

/** Mots qui ne nomment pas un agent (« dis à l'agent … », « il fait quoi ? »). */
const FILLER = new Set(["l", "le", "la", "les", "un", "une", "des", "du", "de", "d", "a", "au", "agent", "agents", "dis", "demande", "il", "elle", "fait", "quoi", "stp"]);

const forms = (a: AgentEntry): string[] => [...new Set([a.label, a.key.replace(/-/g, " "), ...a.synonyms].map(normName).filter(Boolean))];

/** Tolérance aux fautes : 0 sous 4 lettres, 1 jusqu'à 6, 2 au-delà. */
function close(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  const max = len < 4 ? 0 : len <= 6 ? 1 : 2;
  return editDistance(a, b) <= max;
}

const contains = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/**
 * Retrouve un agent dans une phrase (« l'agent Rédaction », « celui des heures », « le corecteur ») : forme exacte
 * (articles et « agent » retirés), puis plus longue expression contenue dans la phrase, puis fautes tolérées mot à
 * mot. Plusieurs agents au même niveau → `ambiguous` (liste à proposer), aucun → `unknown` avec les noms connus.
 */
export function findAgent(text: string): FindAgentResult {
  const n = normName(text);
  const known = AGENT_DIRECTORY.map((a) => a.label);
  if (!n) return { status: "unknown", known };
  const core = n
    .split(" ")
    .filter((w) => !FILLER.has(w))
    .join(" ");
  const done = (list: AgentEntry[]): FindAgentResult | null => {
    const uniq = [...new Map(list.map((a) => [a.key, a])).values()];
    if (uniq.length === 1) return { status: "found", agent: uniq[0]! };
    if (uniq.length > 1) return { status: "ambiguous", candidates: uniq };
    return null;
  };
  // 1. Forme exacte.
  const exact = AGENT_DIRECTORY.filter((a) => forms(a).some((f) => f === n || f === core));
  const r1 = done(exact);
  if (r1) return r1;
  // 2. Expression contenue dans la phrase : la plus longue gagne.
  let best = 0;
  let hits: AgentEntry[] = [];
  for (const a of AGENT_DIRECTORY)
    for (const f of forms(a)) {
      if (!contains(n, f) && !contains(core, f)) continue;
      if (f.length > best) {
        best = f.length;
        hits = [a];
      } else if (f.length === best) hits.push(a);
    }
  const r2 = done(hits);
  if (r2) return r2;
  // 3. Fautes : chaque mot (significatif) d'une forme retrouvé dans la phrase à une faute près ; la plus petite
  // distance totale gagne (« corecteur » → correcteur à 1, pas directeur à 2).
  const words = core.split(" ").filter(Boolean);
  const scoreOf = (f: string): number | null => {
    const fw = f.split(" ").filter((w) => !FILLER.has(w));
    if (!fw.length) return null;
    let total = 0;
    for (const w of fw) {
      const d = Math.min(...words.map((x) => (x === w ? 0 : w.length >= 4 && close(x, w) ? editDistance(x, w) : Infinity)));
      if (!Number.isFinite(d)) return null;
      total += d;
    }
    return total;
  };
  let bestScore = Infinity;
  let fuzzy: AgentEntry[] = [];
  for (const a of AGENT_DIRECTORY) {
    const sc = Math.min(...forms(a).map((f) => scoreOf(f) ?? Infinity));
    if (!Number.isFinite(sc)) continue;
    if (sc < bestScore) {
      bestScore = sc;
      fuzzy = [a];
    } else if (sc === bestScore) fuzzy.push(a);
  }
  return done(fuzzy) ?? { status: "unknown", known };
}

/** Libellé de l'équipe (« Rencontres », « Ads », « transverse »). */
export function orderTeamLabel(t: OrderTeamKey): string {
  if (t === "ads") return "Ads";
  if (t === "inspiration") return "Inspiration";
  if (t === "transverse") return "toutes les équipes";
  return TEAM_LABELS[t as TeamKey] ?? t;
}

/** Ce qu'on peut demander à cet agent (registre des capacités, chantier A) ; vide si le registre n'en a pas. */
export function agentAbilities(agentKey: string): Capability[] {
  try {
    // Les plus propres à cet agent d'abord (une capacité de toute une équipe le concerne moins).
    return [...(capabilitiesForAgent(agentKey) as Capability[])].sort((a, b) => a.agents.length - b.agents.length);
  } catch {
    return [];
  }
}

export type AgentCardOptions = { channelId?: string | null; day?: string | null; slot?: DaySlot | null };

type RunRow = { id: string; missionId: string; agentKey: string; status: string; startedAt: Date; outputSummary: string | null; error: string | null };
type MissionLite = { id: string; teamKey: string; channelId: string | null; status: string; currentStep: number; steps: unknown; payload: unknown; scheduledFor: Date | null };

const PLURAL = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/**
 * Fiche d'un agent (lecture seule) : rôle, Chef, ce qu'il a fait ce jour-là (passages enregistrés, `AgentRun`), ce
 * qu'il a en cours (posts dont il est la prochaine étape), ses réglages actuels, ce qu'on peut lui demander.
 */
export async function agentCard(deps: AgentsDeps, agentKey: string, opts: AgentCardOptions = {}): Promise<ViewResult & { agent: AgentEntry | null }> {
  const agent = agentEntry(agentKey);
  if (!agent) return { agent: null, facts: { agent: agentKey, connu: false }, lines: [`Je ne connais pas d'agent « ${agentKey} ».`] };
  const chief = agent.chief ? agentEntry(agent.chief) : null;
  const teamText = agent.teams.length ? agent.teams.map(orderTeamLabel).join(", ") : null;
  if (!agent.available) {
    return {
      agent,
      facts: { agent: agent.label, disponible: false, arrive: agent.arrives ?? null },
      lines: [`${agent.label} n'est pas encore là : il arrive avec la ${agent.arrives ?? "prochaine phase"}.`, `Il ${agent.role.charAt(0).toLowerCase()}${agent.role.slice(1)}`],
    };
  }
  const now = nowOf(deps);
  const day = opts.day ?? parisDay(now);
  const range = slotRange(day, opts.slot ?? null);
  const facts: Record<string, unknown> = { agent: agent.label, equipes: teamText, chef: chief?.label ?? null, jour: day, moment: opts.slot ?? null };
  const lines: string[] = [];
  lines.push(`${agent.label}${teamText ? ` (${teamText}${chief ? `, sous le ${chief.label}` : ""})` : ""} : ${agent.role}`);

  // Ce qu'il a fait (passages des agents des chaînes).
  const runs = (await deps.prisma.agentRun.findMany({
    where: { agentKey: agent.key, startedAt: { gte: range.from, lt: range.to } },
    orderBy: { startedAt: "asc" },
    take: 200,
  })) as RunRow[];
  const missionIds = [...new Set(runs.map((r) => r.missionId))];
  const missions = missionIds.length
    ? ((await deps.prisma.agentMission.findMany({ where: { id: { in: missionIds } } })) as MissionLite[])
    : [];
  const missionById = new Map(missions.map((m) => [m.id, m]));
  const scoped = opts.channelId ? runs.filter((r) => missionById.get(r.missionId)?.channelId === opts.channelId) : runs;
  const ok = scoped.filter((r) => r.status === "OK").length;
  const failed = scoped.filter((r) => r.status === "ERROR").length;
  facts.fait = { passages: scoped.length, reussis: ok, rates: failed };
  const when = `${dayLabel(day, now)}${opts.slot ? ` (${slotWord(opts.slot)})` : ""}`;
  if (scoped.length) {
    lines.push(`${capitalize(when)} : ${PLURAL(ok, "passage réussi", "passages réussis")}${failed ? `, ${PLURAL(failed, "raté")}` : ""}.`);
    if (agent.key === "redaction") {
      const texts = scoped
        .filter((r) => r.status === "OK")
        .map((r) => missionById.get(r.missionId))
        .filter((m): m is MissionLite => !!m)
        .map((m) => ({ m, text: plainPreview(String(parsePayload(m.payload).text ?? ""), 90) }))
        .filter((x) => x.text);
      facts.textes = texts.slice(0, 3).map((x) => x.text);
      for (const x of texts.slice(0, 3)) lines.push(`« ${x.text} »`);
    } else {
      const last = scoped.filter((r) => r.outputSummary).slice(-2);
      for (const r of last) lines.push(`${hourLabel(r.startedAt)} : ${plainPreview(r.outputSummary ?? "", 110)}`);
    }
  } else lines.push(`${capitalize(when)} : rien fait pour le moment.`);

  // Ce qu'il va faire : posts en cours dont il est la prochaine étape.
  const active = (await deps.prisma.agentMission.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] }, ...(opts.channelId ? { channelId: opts.channelId } : {}) },
    take: 300,
  })) as MissionLite[];
  const queued = active.filter((m) => parseSteps(m.steps)[m.currentStep]?.agent === agent.key);
  facts.enAttente = queued.length;
  if (queued.length) lines.push(`Il a ${PLURAL(queued.length, "post")} à traiter juste après.`);

  // Réglages actuels.
  const settings = await agentSettingsLines(deps, agent, opts.channelId ?? null);
  facts.reglages = settings.facts;
  lines.push(...settings.lines);

  // Ce qu'on peut lui demander (registre des capacités).
  const abilities = agentAbilities(agent.key).map((c) => c.description);
  facts.peutFaire = abilities;
  if (abilities.length) lines.push(`Tu peux par exemple lui demander de ${lowerFirst(shortAbility(abilities[0]!))}.`);
  return { agent, facts, lines };
}

function slotWord(s: DaySlot): string {
  return s === "apres-midi" ? "après-midi" : s;
}
/** Début d'une description de capacité (avant « : » ou « ( »), 12 mots au plus. */
function shortAbility(d: string): string {
  const head = d.split(/\s*[:(;]\s*/)[0]!.trim();
  const words = head.split(/\s+/);
  return words.length > 12 ? words.slice(0, 12).join(" ") : head;
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type PlanLite = { channelId: string; teamKey: string; enabled: boolean; postsPerDay: number; windowStart: string; windowEnd: string; minSpacingMinutes: number; suggestedWindows: unknown; styleNotes: string | null };

const WEEKDAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Réglages actuels d'un agent, en lignes courtes (lecture seule). */
async function agentSettingsLines(deps: AgentsDeps, agent: AgentEntry, channelId: string | null): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const facts: Record<string, unknown> = {};
  const lines: string[] = [];
  const firstTeam = agent.teams.find((t): t is TeamKey => t === "dating" || t === "casino" || t === "sports" || t === "algo");
  const team = firstTeam ? await readTeamState(deps, firstTeam) : null;
  const plans = (await deps.prisma.channelAgentPlan.findMany({ where: channelId ? { channelId } : {}, take: 200 })) as PlanLite[];
  const titles = await channelTitles(deps, plans.map((p) => p.channelId));
  switch (agent.key) {
    case "redaction": {
      if (team) facts.longueurMax = team.settings.maxTextLength;
      const notes = plans.filter((p) => p.styleNotes && p.styleNotes.trim());
      facts.consignes = notes.map((p) => ({ canal: titles.get(p.channelId) ?? p.channelId, consignes: plainPreview(p.styleNotes ?? "", 120) }));
      if (team) lines.push(`Textes de ${team.settings.maxTextLength} caractères au plus${team.settings.styleGuidelines.trim() ? `, consignes de l'équipe : ${plainPreview(team.settings.styleGuidelines, 80)}` : ""}.`);
      for (const p of notes.slice(0, 2)) lines.push(`Sur ${titles.get(p.channelId) ?? "ce canal"} : ${plainPreview(p.styleNotes ?? "", 100)}`);
      break;
    }
    case "controle": {
      if (team) {
        facts.motsInterdits = team.settings.forbiddenWords;
        facts.longueurMax = team.settings.maxTextLength;
        lines.push(
          team.settings.forbiddenWords.length
            ? `Mots interdits (${team.label}) : ${team.settings.forbiddenWords.slice(0, 8).join(", ")}${team.settings.forbiddenWords.length > 8 ? "…" : ""}.`
            : `Aucun mot interdit réglé pour l'équipe ${team.label}.`,
        );
      }
      break;
    }
    case "horaires": {
      const advised: Array<{ canal: string; jour: string; debut: string; fin: string }> = [];
      for (const p of plans) {
        const w = Array.isArray(p.suggestedWindows) ? (p.suggestedWindows as Array<{ day?: number; start?: string; end?: string; score?: number }>) : [];
        const top = [...w].filter((x) => typeof x.start === "string" && typeof x.end === "string").sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
        if (top) advised.push({ canal: titles.get(p.channelId) ?? p.channelId, jour: WEEKDAYS[Number(top.day)] ?? "chaque jour", debut: top.start!, fin: top.end! });
      }
      for (const p of plans) {
        if (advised.some((a) => a.canal === (titles.get(p.channelId) ?? p.channelId))) continue;
        const best = (await readSetting(deps, `besthours.${p.channelId}`)) as { categories?: Record<string, { recommendation?: { day: number; hour: number } | null }> } | null;
        const rec = best?.categories?.all?.recommendation;
        if (rec) advised.push({ canal: titles.get(p.channelId) ?? p.channelId, jour: WEEKDAYS[rec.day] ?? "", debut: `${rec.hour} h`, fin: `${(rec.hour + 1) % 24} h` });
      }
      facts.conseils = advised;
      if (advised.length) for (const a of advised.slice(0, 4)) lines.push(`${a.canal} : plutôt le ${a.jour} entre ${a.debut} et ${a.fin}.`);
      else lines.push("Pas encore assez de posts mesurés pour conseiller une heure.");
      break;
    }
    case "planification": {
      facts.plans = plans.map((p) => ({ canal: titles.get(p.channelId) ?? p.channelId, postsParJour: p.postsPerDay, debut: p.windowStart, fin: p.windowEnd, espacement: p.minSpacingMinutes, actif: p.enabled }));
      for (const p of plans.filter((x) => x.enabled).slice(0, 3))
        lines.push(`${titles.get(p.channelId) ?? "Canal"} : ${PLURAL(p.postsPerDay, "post")} par jour entre ${p.windowStart} et ${p.windowEnd}, ${p.minSpacingMinutes} min d'écart au moins.`);
      break;
    }
    case "cotes":
    case "capture": {
      const s = parseSportsSettings((await readTeamState(deps, "sports")).settings.settings);
      facts.passages = s.runHours;
      facts.appelsMax = s.maxApiCallsPerMonth;
      const cats = (await deps.prisma.betCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })) as Array<{ name: string; minOdds: number; maxOdds: number; picksPerDay: number }>;
      facts.categories = cats.map((c) => ({ nom: c.name, coteMin: c.minOdds, coteMax: c.maxOdds, parisParJour: c.picksPerDay }));
      if (agent.key === "cotes") {
        lines.push(`Passages à ${s.runHours.map((h) => `${h} h`).join(", ")}, matchs jusqu'à ${s.lookaheadHours} h à l'avance.`);
        if (cats.length) lines.push(`Catégories actives : ${cats.slice(0, 4).map((c) => `${c.name} (cotes ${c.minOdds} à ${c.maxOdds})`).join(", ")}.`);
        else lines.push("Aucune catégorie de paris active.");
      } else lines.push(`Écart de cote toléré avant l'envoi : ${s.maxOddsDriftPct} %.`);
      break;
    }
    case "media-ia": {
      if (team) {
        const b = team.settings.monthlyBudgetCents;
        facts.plafonds = b;
        lines.push(`Plafonds du mois : vidéo ${euros(b.video)}, photo ${euros(b.image)}.`);
      }
      break;
    }
    default: {
      if (team) {
        facts.equipe = { pourDeFaux: team.simulation, pause: team.paused, niveau: team.level };
        lines.push(`Équipe ${team.label} : ${team.paused ? "en pause" : team.simulation ? "pour de faux (canal Test)" : "pour de vrai"}, niveau ${team.level}.`);
      }
    }
  }
  return { facts, lines };
}

const euros = (c: number | undefined) => (typeof c === "number" ? `${(c / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €` : "sans plafond");

export async function channelTitles(deps: Pick<AgentsDeps, "prisma">, ids: readonly string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = (await deps.prisma.channel.findMany({ where: { id: { in: uniq } }, select: { id: true, title: true } })) as Array<{ id: string; title: string }>;
  return new Map(rows.map((r) => [r.id, r.title]));
}
