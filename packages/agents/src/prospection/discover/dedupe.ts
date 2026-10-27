/**
 * Phase 31, chantier A (Sourceur) : dédoublonnage des candidats et journal des sessions de découverte.
 *
 * `upsertCandidates(deps, candidats, run)` :
 * - ouvre un `ProspectSourceRun` (source, détail, langues, verticale) et le ferme avec les comptes ;
 * - normalise chaque adresse (`normalizeProspectUrl`) : un `channelUrl` unique ; les dossiers `addlist` ne sont pas des
 *   prospects (le graphe les lit) ;
 * - lien d'invitation privé → prospect créé directement en `UNREADABLE` (jamais ouvert, jamais enrichi) ;
 * - candidat déjà connu → `cocitationCount + 1`, une seule fois par prospect d'origine (trace `ProspectEvent` `COCITED`
 *   `{ fromId }`), priorité relevée ; jamais recréé ; un prospect `BLACKLISTED` reste ignoré ;
 * - nouveau → `ProspectEvent` `DISCOVERED`, priorité (MANUAL 10, graphe : cocitations), puis `prospection.enrich`
 *   enfilé (jobId `prospection.enrich:<id>`) si lisible ;
 * - plafond `prospection.discovery_daily_cap` : nouveaux prospects créés depuis minuit (heure de Paris), toutes sources ;
 *   l'ajout manuel du client passe outre (`ignoreCap`).
 * Les abonnés annoncés par un annuaire sont indicatifs : gardés dans l'événement, jamais dans `subscribers` (mesure
 * exacte de l'Enrichisseur). Une fiche de place de marché va dans `monetization.marketplaceListing` / `adPrice`.
 */
import type { Prisma } from "@linkaffipro/db";
import { readSetting } from "../../admin/journal";
import { parisDay, parisDayStart } from "../../rules/time";
import { PROSPECTION_SETTINGS, type Candidate, type ProspectDiscoveryResult, type ProspectionDeps } from "../contract";
import { normalizeProspectUrl } from "./normalize";
import { prospectionClockOf } from "./polite";

export type DiscoveryRunInfo = { sourceType: string; sourceDetail: string | null; languages: string[]; vertical: string | null };

export type UpsertOptions = {
  /** Ajout demandé par le client : le plafond journalier ne s'applique pas. */
  ignoreCap?: boolean;
  /** Pause en cours de la source (journal). */
  pausedUntil?: Date | null;
  /** Erreurs déjà rencontrées par la source (journal). */
  errors?: string[];
  /** Qui a demandé (événements). */
  by?: "client" | "system";
};

export const MANUAL_PRIORITY = 10;
/** Priorité BullMQ (1 = la plus haute) d'un enrichissement demandé par le client. */
export const MANUAL_QUEUE_PRIORITY = 1;

/** Plafond journalier de découverte (réglage, sinon 300). */
export async function discoveryDailyCap(deps: ProspectionDeps): Promise<number> {
  const v = Number(await readSetting(deps, PROSPECTION_SETTINGS.discoveryDailyCap.key));
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : PROSPECTION_SETTINGS.discoveryDailyCap.value;
}

/** Nouveaux prospects créés depuis minuit (Paris). */
export async function discoveredToday(deps: ProspectionDeps, now: Date): Promise<number> {
  return deps.prisma.prospect.count({ where: { discoveredAt: { gte: parisDayStart(parisDay(now)) } } });
}

type Merged = Candidate & { channelUrl: string; username: string | null; invite: boolean };

/** Priorité d'un candidat : manuel 10, sinon nombre de citations (graphe). */
function priorityOf(c: Candidate, cocitations: number): number {
  return c.sourceType === "MANUAL" ? MANUAL_PRIORITY : cocitations;
}

function isUniqueError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "P2002" || /unique constraint/i.test(String(e?.message ?? ""));
}

export async function upsertCandidates(
  deps: ProspectionDeps,
  candidates: Candidate[],
  run: DiscoveryRunInfo,
  opts: UpsertOptions = {},
): Promise<ProspectDiscoveryResult> {
  const now = new Date(prospectionClockOf(deps));
  const by = opts.by ?? "system";
  const errors: string[] = [...(opts.errors ?? [])];
  const runRow = await deps.prisma.prospectSourceRun.create({
    data: {
      sourceType: run.sourceType,
      sourceDetail: run.sourceDetail?.slice(0, 500) ?? null,
      languages: run.languages,
      vertical: run.vertical,
      started: now,
      pausedUntil: opts.pausedUntil ?? null,
    },
  });

  // Normalisation et dédoublonnage à l'intérieur du lot (premier candidat gardé).
  const batch = new Map<string, Merged>();
  let inBatchDuplicates = 0;
  for (const c of candidates) {
    const n = normalizeProspectUrl(c.url);
    if (!n || n.folder) continue;
    const prev = batch.get(n.channelUrl);
    if (prev) {
      inBatchDuplicates++;
      // Garde les informations utiles du doublon (fiche de place de marché, titre).
      prev.marketplace ??= c.marketplace ?? null;
      prev.title ??= c.title ?? null;
      prev.announcedSubscribers ??= c.announcedSubscribers ?? null;
      continue;
    }
    batch.set(n.channelUrl, { ...c, channelUrl: n.channelUrl, username: n.username, invite: n.invite });
  }

  const cap = opts.ignoreCap ? Number.POSITIVE_INFINITY : await discoveryDailyCap(deps);
  let remaining = opts.ignoreCap ? Number.POSITIVE_INFINITY : Math.max(0, cap - (await discoveredToday(deps, now)));
  let newCount = 0;
  let duplicates = inBatchDuplicates;
  let capped = 0;
  const toEnrich: Array<{ id: string; manual: boolean }> = [];

  for (const c of batch.values()) {
    const existing = await deps.prisma.prospect.findFirst({
      where: c.username ? { OR: [{ channelUrl: c.channelUrl }, { username: c.username }] } : { channelUrl: c.channelUrl },
    });
    if (existing) {
      duplicates++;
      await recordKnown(deps, existing, c, now, by);
      continue;
    }
    if (remaining <= 0) {
      capped++;
      continue;
    }
    const cocitations = c.discoveredFromId ? 1 : 0;
    const monetization = c.marketplace ? { marketplaceListing: c.marketplace.url, adPrice: c.marketplace.price ?? null, sellsAds: true } : undefined;
    let created: { id: string };
    try {
      created = await deps.prisma.prospect.create({
        data: {
          username: c.username,
          channelUrl: c.channelUrl,
          kind: c.kind ?? "CHANNEL",
          title: (c.title ?? c.username ?? "").slice(0, 200),
          vertical: c.vertical ?? "OTHER",
          language: c.language ?? null,
          region: "UNKNOWN",
          status: c.invite ? "UNREADABLE" : "DISCOVERED",
          statusChangedAt: now,
          enrichError: c.invite ? "Lien d'invitation privé : jamais ouvert (il faudrait rejoindre le canal)." : null,
          ...(monetization ? { monetization } : {}),
          sourceType: c.sourceType,
          sourceDetail: c.sourceDetail?.slice(0, 500) ?? null,
          discoveredFromId: c.discoveredFromId ?? null,
          graphDepth: c.graphDepth ?? 0,
          cocitationCount: cocitations,
          priority: priorityOf(c, cocitations),
          discoveredAt: now,
        },
      });
    } catch (err) {
      // Course avec un autre lot (contrainte unique) : c'est un doublon, pas une erreur.
      if (isUniqueError(err)) {
        duplicates++;
        continue;
      }
      errors.push(`Création impossible pour ${c.channelUrl} : ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      continue;
    }
    remaining--;
    newCount++;
    await deps.prisma.prospectEvent.create({
      data: {
        prospectId: created.id,
        type: "DISCOVERED",
        payload: {
          by,
          runId: runRow.id,
          sourceType: c.sourceType,
          sourceDetail: c.sourceDetail?.slice(0, 500) ?? null,
          announcedSubscribers: c.announcedSubscribers ?? null,
          category: c.category ?? null,
          marketplace: c.marketplace ?? null,
          fromId: c.discoveredFromId ?? null,
          graphDepth: c.graphDepth ?? 0,
          ...(c.invite ? { unreadable: "invite" } : {}),
        },
        createdAt: now,
      },
    });
    if (c.discoveredFromId)
      await deps.prisma.prospectEvent.create({ data: { prospectId: created.id, type: "COCITED", payload: { fromId: c.discoveredFromId, by }, createdAt: now } });
    if (!c.invite) toEnrich.push({ id: created.id, manual: c.sourceType === "MANUAL" });
  }
  if (capped) errors.push(`Plafond journalier atteint (${cap} nouveaux canaux) : ${capped} candidat(s) remis à plus tard.`);

  // Enrichissement à la suite (le worker fournit la file ; absente : l'appelant enchaîne lui-même).
  const enqueue = deps.prospection?.enqueue;
  if (enqueue)
    for (const p of toEnrich) {
      try {
        await enqueue({ type: "prospection.enrich", prospectId: p.id }, { jobId: `prospection.enrich:${p.id}`, ...(p.manual ? { priority: MANUAL_QUEUE_PRIORITY } : {}) });
      } catch (err) {
        errors.push(`Mise en file impossible (${p.id}) : ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      }
    }

  const found = batch.size + inBatchDuplicates;
  await deps.prisma.prospectSourceRun.update({
    where: { id: runRow.id },
    data: { finished: new Date(prospectionClockOf(deps)), found, newCount, duplicates, errors: errors.length ? errors.slice(0, 50) : undefined },
  });
  return { runId: runRow.id, found, newCount, duplicates, errors, paused: Boolean(opts.pausedUntil) };
}

/** Candidat déjà connu : cocitation (une fois par canal d'origine), priorité, fiche de place de marché. */
async function recordKnown(
  deps: ProspectionDeps,
  existing: { id: string; status: string; priority: number; cocitationCount: number; monetization: unknown },
  c: Merged,
  now: Date,
  by: "client" | "system",
): Promise<void> {
  if (existing.status === "BLACKLISTED") return;
  const data: Prisma.ProspectUpdateInput = {};
  const fromId = c.discoveredFromId ?? null;
  if (fromId && fromId !== existing.id) {
    const seen = await deps.prisma.prospectEvent.findMany({ where: { prospectId: existing.id, type: "COCITED" } });
    const already = seen.some((e) => (e.payload as { fromId?: string } | null)?.fromId === fromId);
    if (!already) {
      await deps.prisma.prospectEvent.create({ data: { prospectId: existing.id, type: "COCITED", payload: { fromId, by }, createdAt: now } });
      const count = existing.cocitationCount + 1;
      data.cocitationCount = { increment: 1 };
      if (existing.priority < MANUAL_PRIORITY) data.priority = Math.max(existing.priority, Math.min(count, MANUAL_PRIORITY - 1));
    }
  }
  if (c.sourceType === "MANUAL" && existing.priority < MANUAL_PRIORITY) data.priority = MANUAL_PRIORITY;
  const mon = (existing.monetization && typeof existing.monetization === "object" ? existing.monetization : {}) as Record<string, unknown>;
  if (c.marketplace && !mon.marketplaceListing) data.monetization = { ...mon, marketplaceListing: c.marketplace.url, adPrice: mon.adPrice ?? c.marketplace.price ?? null, sellsAds: true };
  if (Object.keys(data).length) await deps.prisma.prospect.update({ where: { id: existing.id }, data });
}
