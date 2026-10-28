/**
 * Phase 32, chantier A — réseaux de canaux en base (`ProspectNetwork`, `Prospect.networkId`).
 *
 * - `rebuildNetworks` (chaque matin, 06:30) : rapprochement par `cluster.ts` sur les canaux lus ; un réseau existant
 *   est repris (fusion du client d'abord, puis celui qui a le plus de membres) ; réseau = nom, contact principal,
 *   portée totale (somme des vues médianes), pays, verticales, preuves ; un réseau automatique sans membre est retiré.
 * - `mergeProspects` (« @a et @b c'est la même personne ») : réseau MANUAL, les séparations entre eux sont oubliées.
 * - `splitProspect` (« sépare @a ») : le canal sort de son réseau ; la paire n'est plus JAMAIS refusionnée
 *   automatiquement (paires gardées sur le réseau ET dans `Setting prospection.networks.split_pairs`).
 * - `networkOf`, `propagateNetworkStatus` : pour Kevin, le site et le Pipeline.
 * Chaque entrée / sortie d'un canal écrit un `ProspectEvent` (NETWORK_JOINED, NETWORK_LEFT, NETWORK_MERGED,
 * NETWORK_SPLIT).
 */
import type { ProspectionDeps, ProspectStatus } from "../contract";
import type { NetworkEvidence } from "../contract-advanced";
import { transitionProspect, type TransitionActor } from "../pipeline/status";
import { handleOf } from "../score/format";
import { objectOf, prospectionNow, rawProspectionSetting, stringArray } from "../score/settings";
import { buildClusters, pairEvidence, type ClusterProspect } from "./cluster";

export const SPLIT_PAIRS_KEY = "prospection.networks.split_pairs";

/** Canaux pris en compte : lus, jamais « à ne plus montrer ». */
const CLUSTER_STATUSES: readonly ProspectStatus[] = ["QUALIFIED", "DISQUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "CHURNED", "SKIPPED"];

type NetProspect = {
  id: string;
  username: string | null;
  title: string;
  status: ProspectStatus;
  tier: string | null;
  score: number | null;
  subscribers: number | null;
  medianViews: number | null;
  countries: unknown;
  vertical: string;
  descriptionRaw: string | null;
  brands: unknown;
  bestContact: string | null;
  networkId: string | null;
  valueEstimate?: unknown;
};

export type NetworkRow = {
  id: string;
  name: string;
  mainContact: string | null;
  totalReach: number;
  countries: unknown;
  verticals: unknown;
  status: string | null;
  evidence: unknown;
  score: number;
  origin: string;
  splitPairs: unknown;
  dossier: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Pair = [string, string];
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

function pairsOf(v: unknown): Pair[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Pair => Array.isArray(x) && x.length === 2 && typeof x[0] === "string" && typeof x[1] === "string").map(([a, b]) => (a < b ? [a, b] : [b, a]));
}

async function globalSplitPairs(deps: Pick<ProspectionDeps, "prisma">): Promise<Pair[]> {
  return pairsOf(await rawProspectionSetting(deps, SPLIT_PAIRS_KEY));
}

async function writeGlobalSplitPairs(deps: Pick<ProspectionDeps, "prisma">, pairs: readonly Pair[]): Promise<void> {
  const uniq = new Map(pairs.map((p) => [pairKey(p[0], p[1]), p]));
  const value = [...uniq.values()];
  await deps.prisma.setting.upsert({ where: { key: SPLIT_PAIRS_KEY }, create: { key: SPLIT_PAIRS_KEY, value }, update: { value } });
}

/** Données de rapprochement d'un canal (contacts, codes promo, signatures et transferts relus). */
async function clusterInputs(deps: ProspectionDeps, prospects: readonly NetProspect[]): Promise<ClusterProspect[]> {
  const ids = prospects.map((p) => p.id);
  if (!ids.length) return [];
  const contacts = (await deps.prisma.prospectContact.findMany({ where: { prospectId: { in: ids } } })) as Array<{ prospectId: string; type: string; value: string; confidence: string; source: string }>;
  const events = (await deps.prisma.prospectEvent.findMany({ where: { prospectId: { in: ids }, type: "REQUALIFIED" }, orderBy: { createdAt: "desc" } })) as Array<{ prospectId: string; payload: unknown }>;
  const hints = new Map<string, { signatures: string[]; forwards: Record<string, number> }>();
  for (const e of events) {
    if (hints.has(e.prospectId)) continue;
    const net = objectOf(objectOf(e.payload).network);
    if (!Object.keys(net).length) continue;
    const forwards: Record<string, number> = {};
    for (const [k, v] of Object.entries(objectOf(net.forwards))) if (typeof v === "number") forwards[k.toLowerCase()] = v;
    hints.set(e.prospectId, { signatures: stringArray(net.signatures), forwards });
  }
  const byProspect = new Map<string, ClusterProspect["contacts"]>();
  for (const c of contacts) byProspect.set(c.prospectId, [...(byProspect.get(c.prospectId) ?? []), { type: c.type, value: c.value, confidence: c.confidence, source: c.source }]);
  return prospects.map((p) => ({
    id: p.id,
    username: p.username,
    contacts: byProspect.get(p.id) ?? [],
    description: p.descriptionRaw,
    promoCodes: Array.isArray(p.brands) ? (p.brands as unknown[]).map((b) => objectOf(b).promoCode).filter((c): c is string => typeof c === "string" && !!c) : [],
    forwardsFrom: hints.get(p.id)?.forwards ?? {},
    signatures: hints.get(p.id)?.signatures ?? [],
  }));
}

/** Champs calculés d'un réseau à partir de ses membres et de ses preuves. Pur. */
export function networkFields(members: readonly NetProspect[], evidence: readonly NetworkEvidence[]): {
  name: string;
  mainContact: string | null;
  totalReach: number;
  countries: string[];
  verticals: string[];
  score: number;
} {
  const contactCount = new Map<string, number>();
  for (const e of evidence) if (e.kind === "same_contact") {
    const v = e.detail.replace(/^même contact /, "");
    contactCount.set(v, (contactCount.get(v) ?? 0) + 1);
  }
  const biggest = [...members].sort((a, b) => (b.medianViews ?? 0) - (a.medianViews ?? 0))[0];
  const mainContact = [...contactCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? biggest?.bestContact ?? null;
  const countries = [...new Set(members.map((m) => stringArray(m.countries)[0]?.toUpperCase()).filter((c): c is string => !!c))].sort();
  const verticals = [...new Set(members.map((m) => m.vertical).filter((v) => v && v !== "OTHER"))].sort();
  return {
    name: `Réseau ${mainContact ?? (biggest ? handleOf(biggest) : "sans nom")}`.slice(0, 80),
    mainContact,
    totalReach: members.reduce((s, m) => s + (m.medianViews ?? 0), 0),
    countries,
    verticals,
    score: Math.max(0, ...members.map((m) => m.score ?? 0)),
  };
}

async function event(deps: ProspectionDeps, prospectId: string, type: string, payload: Record<string, unknown>, now: Date): Promise<void> {
  await deps.prisma.prospectEvent.create({ data: { prospectId, type, payload: json(payload), createdAt: now } });
}

async function loadNetProspects(deps: ProspectionDeps, where: Record<string, unknown>): Promise<NetProspect[]> {
  return (await deps.prisma.prospect.findMany({ where })) as unknown as NetProspect[];
}

/** Recalcule les réseaux automatiques (jamais une paire séparée par le client). */
export async function rebuildNetworks(deps: ProspectionDeps): Promise<{ networks: number; members: number }> {
  const now = prospectionNow(deps);
  const prospects = await loadNetProspects(deps, { status: { in: [...CLUSTER_STATUSES] } });
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const networks = (await deps.prisma.prospectNetwork.findMany({})) as unknown as NetworkRow[];
  const netById = new Map(networks.map((n) => [n.id, n]));
  const splitPairs = [...(await globalSplitPairs(deps)), ...networks.flatMap((n) => pairsOf(n.splitPairs))];
  const manualGroups = networks.filter((n) => n.origin === "MANUAL").map((n) => prospects.filter((p) => p.networkId === n.id).map((p) => p.id));
  const clusters = buildClusters(await clusterInputs(deps, prospects), { splitPairs, manualGroups });

  const used = new Set<string>();
  const assigned = new Map<string, string>();
  let members = 0;
  for (const c of clusters) {
    const ids = c.members;
    const current = [...new Set(ids.map((id) => byId.get(id)?.networkId).filter((x): x is string => !!x && netById.has(x) && !used.has(x)))];
    current.sort((a, b) => Number(netById.get(b)!.origin === "MANUAL") - Number(netById.get(a)!.origin === "MANUAL") || ids.filter((id) => byId.get(id)?.networkId === b).length - ids.filter((id) => byId.get(id)?.networkId === a).length);
    const memberRows = ids.map((id) => byId.get(id)!);
    const fields = networkFields(memberRows, c.evidence);
    let networkId = current[0] ?? null;
    if (networkId) {
      const prev = netById.get(networkId)!;
      await deps.prisma.prospectNetwork.update({
        where: { id: networkId },
        data: { ...fields, evidence: json(c.evidence), origin: c.manual || prev.origin === "MANUAL" ? "MANUAL" : "AUTO" },
      });
    } else {
      const row = (await deps.prisma.prospectNetwork.create({ data: { ...fields, evidence: json(c.evidence), origin: c.manual ? "MANUAL" : "AUTO", splitPairs: [], status: null, createdAt: now } })) as unknown as NetworkRow;
      networkId = row.id;
      netById.set(row.id, row);
    }
    used.add(networkId);
    for (const id of ids) {
      assigned.set(id, networkId);
      const p = byId.get(id)!;
      if (p.networkId !== networkId) {
        await deps.prisma.prospect.update({ where: { id }, data: { networkId } });
        await event(deps, id, "NETWORK_JOINED", { networkId, name: fields.name, points: c.evidence.filter((e) => e.a === id || e.b === id).reduce((s, e) => s + e.points, 0), by: "system" }, now);
      }
    }
    members += ids.length;
  }
  // Canaux sortis d'un réseau automatique, puis réseaux vides retirés.
  for (const p of prospects)
    if (p.networkId && !assigned.has(p.id)) {
      await deps.prisma.prospect.update({ where: { id: p.id }, data: { networkId: null } });
      await event(deps, p.id, "NETWORK_LEFT", { networkId: p.networkId, by: "system" }, now);
    }
  for (const n of netById.values())
    if (!used.has(n.id)) {
      const stillMembers = await deps.prisma.prospect.count({ where: { networkId: n.id } });
      if (stillMembers < 2) {
        // Les paires séparées par le client survivent au réseau (réglage global).
        if (pairsOf(n.splitPairs).length) await writeGlobalSplitPairs(deps, [...(await globalSplitPairs(deps)), ...pairsOf(n.splitPairs)]);
        if (stillMembers) await deps.prisma.prospect.updateMany({ where: { networkId: n.id }, data: { networkId: null } });
        await deps.prisma.prospectNetwork.delete({ where: { id: n.id } });
      }
    }
  return { networks: used.size, members };
}

/** « @a et @b c'est la même personne » : réseau MANUAL (réseaux existants des canaux réunis). */
export async function mergeProspects(deps: ProspectionDeps, prospectIds: string[], by: TransitionActor): Promise<{ ok: boolean; networkId: string | null; message?: string | null }> {
  const ids = [...new Set(prospectIds)];
  if (ids.length < 2) return { ok: false, networkId: null, message: "il faut au moins deux canaux" };
  const rows = await loadNetProspects(deps, { id: { in: ids } });
  if (rows.length !== ids.length) return { ok: false, networkId: null, message: "canal introuvable" };
  if (rows.some((r) => r.status === "BLACKLISTED")) return { ok: false, networkId: null, message: "un de ces canaux est à ne plus montrer" };
  const now = prospectionNow(deps);
  const netIds = [...new Set(rows.map((r) => r.networkId).filter((x): x is string => !!x))];
  const nets = netIds.length ? ((await deps.prisma.prospectNetwork.findMany({ where: { id: { in: netIds } } })) as unknown as NetworkRow[]) : [];
  const others = netIds.length ? await loadNetProspects(deps, { networkId: { in: netIds } }) : [];
  const all = new Map<string, NetProspect>([...others, ...rows].map((p) => [p.id, p]));
  const memberIds = [...all.keys()];
  const inMerge = new Set(memberIds);

  // Le client dit « même personne » : les séparations entre ces canaux sont oubliées.
  const keep = (pairs: Pair[]) => pairs.filter(([a, b]) => !(inMerge.has(a) && inMerge.has(b)));
  await writeGlobalSplitPairs(deps, keep(await globalSplitPairs(deps)));
  const target = [...nets].sort((a, b) => Number(b.origin === "MANUAL") - Number(a.origin === "MANUAL") || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
  const inputs = await clusterInputs(deps, [...all.values()]);
  const evidence: NetworkEvidence[] = [];
  for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) evidence.push(...pairEvidence(inputs[i]!, inputs[j]!));
  const fields = networkFields([...all.values()], evidence);
  const splitPairs = keep(nets.flatMap((n) => pairsOf(n.splitPairs)));
  let networkId: string;
  if (target) {
    networkId = target.id;
    await deps.prisma.prospectNetwork.update({ where: { id: networkId }, data: { ...fields, evidence: json(evidence), origin: "MANUAL", splitPairs: json(splitPairs) } });
  } else {
    const row = (await deps.prisma.prospectNetwork.create({ data: { ...fields, evidence: json(evidence), origin: "MANUAL", splitPairs: json(splitPairs), status: null, createdAt: now } })) as unknown as NetworkRow;
    networkId = row.id;
  }
  for (const id of memberIds) {
    if (all.get(id)!.networkId !== networkId) await deps.prisma.prospect.update({ where: { id }, data: { networkId } });
    await event(deps, id, "NETWORK_MERGED", { networkId, with: memberIds.filter((x) => x !== id), by }, now);
  }
  for (const n of nets) if (n.id !== networkId) await deps.prisma.prospectNetwork.delete({ where: { id: n.id } });
  return { ok: true, networkId };
}

/** « sépare @a » : sort le canal de son réseau (la paire n'est plus jamais refusionnée automatiquement). */
export async function splitProspect(deps: ProspectionDeps, prospectId: string, by: TransitionActor): Promise<{ ok: boolean; message?: string | null }> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as NetProspect | null;
  if (!p) return { ok: false, message: "canal introuvable" };
  if (!p.networkId) return { ok: false, message: "ce canal n'est dans aucun réseau" };
  const now = prospectionNow(deps);
  const net = (await deps.prisma.prospectNetwork.findUnique({ where: { id: p.networkId } })) as unknown as NetworkRow | null;
  const others = (await loadNetProspects(deps, { networkId: p.networkId })).filter((x) => x.id !== p.id);
  const newPairs: Pair[] = others.map((o) => (p.id < o.id ? [p.id, o.id] : [o.id, p.id]));
  await writeGlobalSplitPairs(deps, [...(await globalSplitPairs(deps)), ...newPairs]);
  await deps.prisma.prospect.update({ where: { id: p.id }, data: { networkId: null } });
  await event(deps, p.id, "NETWORK_SPLIT", { networkId: p.networkId, from: others.map((o) => o.id), by }, now);
  if (!net) return { ok: true };
  if (others.length < 2) {
    for (const o of others) {
      await deps.prisma.prospect.update({ where: { id: o.id }, data: { networkId: null } });
      await event(deps, o.id, "NETWORK_LEFT", { networkId: net.id, reason: "réseau défait", by }, now);
    }
    await deps.prisma.prospectNetwork.delete({ where: { id: net.id } });
    return { ok: true };
  }
  const evidence = ((Array.isArray(net.evidence) ? net.evidence : []) as NetworkEvidence[]).filter((e) => e.a !== p.id && e.b !== p.id);
  await deps.prisma.prospectNetwork.update({
    where: { id: net.id },
    data: { ...networkFields(others, evidence), evidence: json(evidence), splitPairs: json([...pairsOf(net.splitPairs), ...newPairs]) },
  });
  return { ok: true };
}

export type NetworkMember = {
  id: string;
  username: string | null;
  title: string;
  handle: string;
  status: ProspectStatus;
  tier: string | null;
  score: number | null;
  subscribers: number | null;
  medianViews: number | null;
  countries: string[];
  vertical: string;
  valueEstimate: unknown;
};

export type NetworkView = { network: NetworkRow; members: NetworkMember[]; evidence: NetworkEvidence[] };

function memberOf(p: NetProspect): NetworkMember {
  return {
    id: p.id,
    username: p.username,
    title: p.title,
    handle: handleOf(p),
    status: p.status,
    tier: p.tier,
    score: p.score,
    subscribers: p.subscribers,
    medianViews: p.medianViews,
    countries: stringArray(p.countries).map((c) => c.toUpperCase()),
    vertical: p.vertical,
    valueEstimate: p.valueEstimate ?? null,
  };
}

/** Réseau d'un réseau donné (membres triés par portée, preuves). */
export async function networkById(deps: Pick<ProspectionDeps, "prisma">, networkId: string): Promise<NetworkView | null> {
  const network = (await deps.prisma.prospectNetwork.findUnique({ where: { id: networkId } })) as unknown as NetworkRow | null;
  if (!network) return null;
  const members = ((await deps.prisma.prospect.findMany({ where: { networkId } })) as unknown as NetProspect[]).map(memberOf).sort((a, b) => (b.medianViews ?? 0) - (a.medianViews ?? 0));
  return { network, members, evidence: (Array.isArray(network.evidence) ? network.evidence : []) as NetworkEvidence[] };
}

/** Réseau d'un canal (null s'il n'en a pas). */
export async function networkOf(deps: Pick<ProspectionDeps, "prisma">, prospectId: string): Promise<NetworkView | null> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as { networkId: string | null } | null;
  return p?.networkId ? networkById(deps, p.networkId) : null;
}

/** Tous les réseaux (site, Kevin), les plus grands d'abord. */
export async function listNetworks(deps: Pick<ProspectionDeps, "prisma">): Promise<NetworkView[]> {
  const rows = (await deps.prisma.prospectNetwork.findMany({ orderBy: { totalReach: "desc" } })) as unknown as NetworkRow[];
  const out: NetworkView[] = [];
  for (const r of rows) {
    const v = await networkById(deps, r.id);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Applique un statut aux membres d'un réseau (sauf `exceptProspectId`) par `transitionProspect` (règles et
 * `ProspectEvent` de chaque canal, sans nouvelle propagation) et le pose au niveau du réseau. Un membre pour lequel le
 * changement n'est pas permis (déjà à ne plus montrer, déjà dans ce statut…) est laissé tel quel.
 */
export async function propagateNetworkStatus(
  deps: ProspectionDeps,
  networkId: string,
  status: ProspectStatus,
  opts: { by: TransitionActor; exceptProspectId?: string | null; dealType?: "CPA" | "REVSHARE" | "HYBRID" | null; dealTerms?: Record<string, unknown> | null; payload?: Record<string, unknown> } = { by: "client" },
): Promise<{ updated: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const members = (await deps.prisma.prospect.findMany({ where: { networkId } })) as unknown as NetProspect[];
  const updated: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const m of members) {
    if (m.id === opts.exceptProspectId) continue;
    if (m.status === status) {
      skipped.push({ id: m.id, reason: "déjà dans ce statut" });
      continue;
    }
    const r = await transitionProspect(deps, m.id, status, {
      by: opts.by,
      payload: { ...(opts.payload ?? {}), via: "network", networkId, ...(opts.exceptProspectId ? { fromProspectId: opts.exceptProspectId } : {}) },
      ...(opts.dealType ? { dealType: opts.dealType } : {}),
      ...(opts.dealTerms ? { dealTerms: opts.dealTerms } : {}),
      propagate: false,
    });
    if (r.ok) updated.push(m.id);
    else skipped.push({ id: m.id, reason: r.reason });
  }
  await deps.prisma.prospectNetwork.update({ where: { id: networkId }, data: { status } }).catch(() => undefined);
  return { updated, skipped };
}
