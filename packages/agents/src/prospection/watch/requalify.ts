/**
 * Phase 32, chantier A — Veilleur : relecture allégée d'un prospect (section 1 du prompt).
 *
 * Cadences (`WATCH_LIMITS.cadenceDays`) : QUALIFIED A / B tous les 7 jours, C (et D) tous les 21 ; CONTACTED /
 * RESPONDED / NEGOTIATING tous les 7 ; SIGNED / ACTIVE tous les 3 (suivi) ; SKIPPED tous les 60 ; DISQUALIFIED pour
 * « audience trop faible » ou « quasi mort » tous les 45 (un canal peut décoller) ; jamais BLACKLISTED, NON_EU, ni un
 * prospect jamais lu (lien privé, pas encore enrichi).
 *
 * Relecture : page `t.me/<nom>` + UNE page d'aperçu (20 posts), par la lecture polie de la phase 31 (même débit,
 * robots.txt, pauses) ; mesures, marques (code, sans IA) et contacts recalculés par les fonctions de l'Enrichisseur ;
 * filtres durs puis nouveau score par l'Évaluateur ; point d'historique (`ProspectSnapshot`, 26 au plus) ; changements
 * (`diff.ts`), suivi des affiliés signés (`affiliates-watch.ts`) ; alertes (`alerts.ts`) ; prochaine relecture.
 * Le texte des posts reste dans la mémoire du job (effacé à la fin). Seuls les noms d'auteur (signatures) et les
 * canaux d'origine des transferts, publics, sont gardés dans l'événement REQUALIFIED : ils servent aux réseaux.
 */
import type { ContactConfidence, ProspectPost, ProspectStatus, ProspectTier, ProspectVertical } from "../contract";
import { PROSPECTION_SETTINGS } from "../contract";
import { WATCH_LIMITS, type SnapshotPoint } from "../contract-advanced";
import type { EnrichDeps } from "../enrich/ai";
import { detectBrandLinks, mergeBrands } from "../enrich/brands";
import { extractContacts, findLinkedGroup } from "../enrich/contacts";
import { hardFilters } from "../enrich/filters";
import { computeMetrics } from "../enrich/metrics";
import { fetchChannelPage } from "../enrich/page";
import { readProspectPosts, tmeUsernameOf } from "../enrich/posts";
import { scoreAndStore } from "../score/store";
import { DAY_MS, numberSetting, objectOf, prospectionNow, stringArray } from "../score/settings";
import { recordAlerts } from "./alerts";
import { watchAffiliate } from "./affiliates-watch";
import { WATCH_SIGNED_STATUSES, diffSnapshots, growthCheck } from "./diff";
import { baselinePointOf, compactionPlan, snapshotData, snapshotPointOf, type SnapshotBrand, type SnapshotRow } from "./snapshots";

type WatchProspect = {
  id: string;
  username: string | null;
  title: string;
  status: ProspectStatus;
  region: string;
  tier: ProspectTier | null;
  tierReason: string | null;
  score: number | null;
  subscribers: number | null;
  medianViews: number | null;
  viewRate: number | null;
  postsPerDay: number | null;
  lastPostAt: Date | null;
  brands: unknown;
  competitiveState: string | null;
  bestContact: string | null;
  contactConfidence: string;
  monetization: unknown;
  fakeFlags: unknown;
  countries: unknown;
  vertical: ProspectVertical;
  descriptionRaw: string | null;
  signedAt: Date | null;
  watchMuted?: boolean | null;
  lastRequalifiedAt?: Date | null;
  nextRequalifyAt?: Date | null;
  lastEnrichedAt?: Date | null;
  enrichedAt?: Date | null;
  discoveredAt?: Date | null;
};

/** Statuts relus par le Veilleur. */
export const WATCHED_STATUSES: readonly ProspectStatus[] = ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "SKIPPED", "DISQUALIFIED"];

const LOW_AUDIENCE = /audience trop faible|quasi[\s-]?mort/i;

/** Cadence de relecture en jours, ou null (jamais relu). Pur. */
export function cadenceDaysFor(p: { status: ProspectStatus | string; tier: ProspectTier | null; tierReason?: string | null; region?: string | null; username?: string | null }): number | null {
  const c = WATCH_LIMITS.cadenceDays;
  if (p.region === "NON_EU" || p.username === null) return null;
  switch (p.status) {
    case "QUALIFIED":
      return p.tier === "A" || p.tier === "B" ? c.qualifiedAB : c.qualifiedC;
    case "CONTACTED":
    case "RESPONDED":
    case "NEGOTIATING":
      return c.pipeline;
    case "SIGNED":
    case "ACTIVE":
      return c.signed;
    case "SKIPPED":
      return c.skipped;
    case "DISQUALIFIED":
      return p.tierReason && LOW_AUDIENCE.test(p.tierReason) ? c.disqualifiedLow : null;
    default:
      return null;
  }
}

/** Date de la prochaine relecture due (null : jamais). Pur. */
export function nextDueAt(p: Parameters<typeof cadenceDaysFor>[0] & { nextRequalifyAt?: Date | null; lastRequalifiedAt?: Date | null; lastEnrichedAt?: Date | null; enrichedAt?: Date | null }): Date | null {
  const days = cadenceDaysFor(p);
  if (days === null) return null;
  if (p.nextRequalifyAt) return p.nextRequalifyAt;
  const base = p.lastRequalifiedAt ?? p.lastEnrichedAt ?? p.enrichedAt ?? null;
  return base ? new Date(base.getTime() + days * DAY_MS) : null;
}

/** Prospects dont la relecture est due, les plus en retard d'abord. */
export async function dueForRequalify(deps: EnrichDeps, now: Date, limit: number): Promise<string[]> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: [...WATCHED_STATUSES] }, username: { not: null } }, take: 20_000 })) as unknown as WatchProspect[];
  const due: Array<{ id: string; at: number }> = [];
  for (const p of rows) {
    const at = nextDueAt(p);
    if (at && at.getTime() <= now.getTime()) due.push({ id: p.id, at: at.getTime() });
  }
  return due
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, limit))
    .map((d) => d.id);
}

/** Rythme sur une page de 20 posts : posts de la fenêtre ÷ jours réellement couverts par la page. Pur. */
export function lightPostsPerDay(posts: readonly ProspectPost[], now: Date, pageFull: boolean): number | null {
  if (!posts.length) return null;
  const windowStart = now.getTime() - WATCH_LIMITS.windowDays * DAY_MS;
  const inWindow = posts.filter((p) => p.postedAt.getTime() >= windowStart);
  const oldest = Math.min(...posts.map((p) => p.postedAt.getTime()));
  const span = pageFull && oldest > windowStart ? Math.max(1, (now.getTime() - oldest) / DAY_MS) : WATCH_LIMITS.windowDays;
  return Math.round((inWindow.length / span) * 1000) / 1000;
}

/** Étiquettes de contact qui parlent de pub (« pub : @x », « werbung », « ads »…). */
const AD_LABEL = /^(pub|publicit|pour la pub|achat de pub|annonceur|ads?\b|advertis|for ads|paid promotion|promo(tion)?|sponsor|werbung|anzeigen|pubblicit|sponsorizz|publicidad|patrocin|publicidade|reclame|adverteren|reklam|annons)/i;

/** Noms d'auteur et origines des transferts (publics) : servent au rapprochement des réseaux. Pur. */
export function networkHints(posts: readonly ProspectPost[], self: string | null): { signatures: string[]; forwards: Record<string, number> } {
  const sigs = new Map<string, number>();
  const forwards: Record<string, number> = {};
  for (const p of posts) {
    if (p.signature && !p.forwardedFrom) sigs.set(p.signature.trim().slice(0, 64), (sigs.get(p.signature.trim().slice(0, 64)) ?? 0) + 1);
    if (p.forwardedFrom) {
      const u = tmeUsernameOf(p.forwardedFrom.startsWith("http") ? p.forwardedFrom : `https://t.me/${p.forwardedFrom.replace(/^@/, "")}`);
      if (u && u !== self) forwards[u] = (forwards[u] ?? 0) + 1;
    }
  }
  return { signatures: [...sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s), forwards };
}

const RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

/** Relit un prospect (page + 20 posts), enregistre un point d'historique, détecte et écrit les alertes. */
export async function requalifyProspect(deps: EnrichDeps, prospectId: string): Promise<{ alerts: number; status: string }> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as WatchProspect | null;
  if (!p) return { alerts: 0, status: "skipped" };
  const now = prospectionNow(deps);
  const cadence = cadenceDaysFor(p);
  if (cadence === null || !p.username) {
    if (p.nextRequalifyAt) await deps.prisma.prospect.update({ where: { id: p.id }, data: { nextRequalifyAt: null } });
    return { alerts: 0, status: "skipped" };
  }
  const username = p.username;

  // 1. Page publique.
  const page = await fetchChannelPage(deps, username);
  if (!page.ok) {
    if (page.reason === "error") {
      await deps.prisma.prospect.update({ where: { id: p.id }, data: { nextRequalifyAt: new Date(now.getTime() + DAY_MS) } });
      await deps.prisma.prospectEvent.create({ data: { prospectId: p.id, type: "REQUALIFY_FAILED", payload: { reason: page.message.slice(0, 200) }, createdAt: now } });
      return { alerts: 0, status: "error" };
    }
    await deps.prisma.prospect.update({ where: { id: p.id }, data: { lastRequalifiedAt: now, nextRequalifyAt: new Date(now.getTime() + cadence * DAY_MS) } });
    await deps.prisma.prospectEvent.create({ data: { prospectId: p.id, type: "REQUALIFIED", payload: { unreadable: page.reason }, createdAt: now } });
    return { alerts: 0, status: "unreadable" };
  }

  let posts: ProspectPost[] = [];
  try {
    // 2. Une page d'aperçu (20 posts au plus).
    if (page.hasPreview && page.kind === "CHANNEL") {
      const read = await readProspectPosts(deps, username, { maxPosts: WATCH_LIMITS.previewPosts, maxPages: 1 });
      if (read.ok) posts = read.posts.slice(0, WATCH_LIMITS.previewPosts);
    }
    const description = page.description ?? p.descriptionRaw;
    const subscribers = page.subscribers ?? p.subscribers;

    // 3. Mesures (rythme corrigé pour une seule page).
    const metrics = computeMetrics(posts, subscribers, now);
    const postsPerDay = posts.length ? lightPostsPerDay(posts, now, posts.length >= WATCH_LIMITS.previewPosts) : p.postsPerDay;
    const medianViews = posts.length ? metrics.medianViews : p.medianViews;
    const viewRate = medianViews !== null && subscribers ? Math.round((medianViews / subscribers) * 10_000) / 10_000 : p.viewRate;
    const lastPostAt = metrics.lastPostAt ?? p.lastPostAt;

    // 4. Marques (code) et texte lu, en mémoire seulement.
    const offers = (await deps.prisma.affiliateOffer.findMany({ where: { isActive: true } })) as Array<{ brand: string; isActive: boolean }>;
    const corpus = [description ?? "", ...posts.map((x) => `${x.text} ${x.buttons.map((b) => `${b.text} ${b.url}`).join(" ")}`)].join("\n");
    const merged = mergeBrands([], detectBrandLinks(posts), offers, { firstPostAt: metrics.firstSeenPostAt, lastPostAt: metrics.lastPostAt, postCount: posts.length, corpus });
    const currentBrands: SnapshotBrand[] = merged.brands.map((b) => ({ brand: b.brand, intensity: b.intensity, lastSeenAt: b.lastSeenAt }));

    // 5. Contacts (sans page liée : relecture allégée).
    const mon = objectOf(p.monetization);
    const marketplaceListing = typeof mon.marketplaceListing === "string" && mon.marketplaceListing ? mon.marketplaceListing : null;
    const contacts = extractContacts({
      description,
      pinned: null,
      posts,
      linkedPage: null,
      marketplace: marketplaceListing ? { url: marketplaceListing, price: typeof mon.marketplacePrice === "string" ? mon.marketplacePrice : null } : null,
      linkedGroup: findLinkedGroup(description, posts),
      channelUsername: username,
      analysis: null,
    });
    for (const c of contacts.contacts)
      await deps.prisma.prospectContact.upsert({
        where: { prospectId_type_value: { prospectId: p.id, type: c.type, value: c.value } },
        create: { prospectId: p.id, type: c.type, value: c.value, label: c.label, source: c.source, confidence: c.confidence, evidence: c.evidence },
        update: {},
      });
    // Le meilleur contact : celui relu s'il est au moins aussi sûr ; sinon l'ancien s'il vient d'une source non relue
    // (page liée, annuaire) ou s'il figure encore dans le texte lu ; sinon il a disparu.
    let bestContact = contacts.best;
    let contactConfidence: string = contacts.confidence;
    if (p.bestContact && (!bestContact || RANK[contacts.confidence]! < (RANK[p.contactConfidence] ?? 0))) {
      const prevRow = (await deps.prisma.prospectContact.findFirst({ where: { prospectId: p.id, value: p.bestContact } })) as { source: string } | null;
      const notReread = !!prevRow && (prevRow.source.startsWith("linked_page") || prevRow.source.startsWith("directory:"));
      if (notReread || corpus.toLowerCase().includes(p.bestContact.replace(/^@/, "").toLowerCase())) {
        bestContact = p.bestContact;
        contactConfidence = p.contactConfidence;
      }
    }
    const sellsAds = mon.sellsAds === true || contacts.contacts.some((c) => !!c.label && AD_LABEL.test(c.label.trim()));

    // 6. Historique (premier point tiré de la fiche si besoin).
    let history = ((await deps.prisma.prospectSnapshot.findMany({ where: { prospectId: p.id }, orderBy: { takenAt: "asc" } })) as unknown as SnapshotRow[]).map(snapshotPointOf);
    if (!history.length) {
      const base = baselinePointOf({ ...p, competitiveState: p.competitiveState }, now);
      await deps.prisma.prospectSnapshot.create({ data: snapshotData(p.id, base, p.contactConfidence) as never });
      history = [base];
    }
    const point: SnapshotPoint = {
      takenAt: now,
      subscribers,
      medianViews,
      viewRate,
      postsPerDay,
      brands: currentBrands,
      competitiveState: posts.length >= 5 ? merged.competitiveState : p.competitiveState,
      bestContact,
      sellsAds,
      marketplace: !!marketplaceListing,
      lastPostAt,
      tier: p.tier,
      score: p.score,
    };

    // 7. Hausse suspecte (vues qui ne suivent pas) → signal de faux AVANT le nouveau score.
    const fakeFlags = stringArray(p.fakeFlags);
    if (growthCheck(history, point, now).kind === "suspect" && !fakeFlags.includes("GROWTH_SPIKE")) fakeFlags.push("GROWTH_SPIKE");

    // 8. Fiche à jour.
    const brands = mergeStoredBrands(p.brands, currentBrands);
    await deps.prisma.prospect.update({
      where: { id: p.id },
      data: {
        subscribers,
        medianViews,
        viewRate,
        postsPerDay,
        lastPostAt,
        descriptionRaw: description?.slice(0, 1000) ?? null,
        brands: JSON.parse(JSON.stringify(brands)),
        competitiveState: point.competitiveState,
        bestContact,
        contactConfidence: contactConfidence as ContactConfidence,
        fakeFlags,
        monetization: JSON.parse(JSON.stringify({ ...mon, sellsAds })),
      },
    });

    // 9. Filtres durs puis nouveau score (un prospect du pipeline garde son statut : seul le score change).
    const minPosts30d = await numberSetting(deps, PROSPECTION_SETTINGS.minPosts30d.key, PROSPECTION_SETTINGS.minPosts30d.value);
    const minMedianViews = await numberSetting(deps, PROSPECTION_SETTINGS.minMedianViews.key, PROSPECTION_SETTINGS.minMedianViews.value);
    const hits = posts.length ? hardFilters({ ...metrics, postsPerDay, medianViews }, { minPosts30d, minMedianViews, now }).filter((h) => h.code !== "REPOST") : [];
    if (hits.length && (p.status === "QUALIFIED" || p.status === "DISQUALIFIED")) {
      await deps.prisma.prospect.update({
        where: { id: p.id },
        data: { status: "DISQUALIFIED", ...(p.status !== "DISQUALIFIED" ? { statusChangedAt: now } : {}), tier: "D", tierReason: hits.map((h) => h.reason).join(" ; ").slice(0, 300) },
      });
    } else {
      try {
        await scoreAndStore(deps, p.id);
      } catch (err) {
        deps.logger?.warn({ err: String((err as Error)?.message ?? err).slice(0, 120), prospectId: p.id }, "[prospection] nouveau score impossible");
      }
    }
    const after = (await deps.prisma.prospect.findUnique({ where: { id: p.id } })) as unknown as WatchProspect;
    point.tier = after.tier;
    point.score = after.score;

    // 10. Point d'historique, puis compactage (26 au plus).
    await deps.prisma.prospectSnapshot.create({ data: snapshotData(p.id, point, contactConfidence) as never });
    const rows = (await deps.prisma.prospectSnapshot.findMany({ where: { prospectId: p.id }, orderBy: { takenAt: "asc" } })) as unknown as SnapshotRow[];
    const plan = compactionPlan(rows);
    for (const u of plan.update) await deps.prisma.prospectSnapshot.update({ where: { id: u.id }, data: { ...u.data, brands: JSON.parse(JSON.stringify(u.data.brands)) } as never });
    if (plan.deleteIds.length) await deps.prisma.prospectSnapshot.deleteMany({ where: { id: { in: plan.deleteIds } } });

    // 11. Changements, suivi des affiliés signés, alertes.
    const diff = diffSnapshots({ history, current: point, now, status: after.status, postsRead: posts.length, corpus });
    const detected = [...diff.alerts];
    let affiliate: { postsWithOurLink: number; ai: string } | null = null;
    if (WATCH_SIGNED_STATUSES.includes(after.status)) {
      const w = await watchAffiliate(deps, {
        prospect: { id: p.id, username, title: p.title, status: after.status, signedAt: p.signedAt, countries: stringArray(p.countries), vertical: p.vertical },
        posts,
        now,
      });
      detected.push(...w.alerts);
      affiliate = { postsWithOurLink: w.stats.postsWithOurLink, ai: w.ai };
    }
    const created = await recordAlerts(deps, { id: p.id, watchMuted: p.watchMuted }, detected, now);

    // 12. Prochaine relecture.
    const nextCadence = cadenceDaysFor(after) ?? cadence;
    await deps.prisma.prospect.update({ where: { id: p.id }, data: { lastRequalifiedAt: now, nextRequalifyAt: new Date(now.getTime() + nextCadence * DAY_MS) } });
    await deps.prisma.prospectEvent.create({
      data: {
        prospectId: p.id,
        type: "REQUALIFIED",
        payload: JSON.parse(
          JSON.stringify({
            posts: posts.length,
            alerts: created.length,
            kinds: created.map((a) => a.kind),
            fakeFlagAdded: diff.fakeFlags.length > 0 || fakeFlags.length > stringArray(p.fakeFlags).length,
            affiliate,
            network: networkHints(posts, username),
            by: "system",
          }),
        ),
        createdAt: now,
      },
    });
    return { alerts: created.length, status: "done" };
  } finally {
    // Texte brut effacé à la fin du job, quel que soit le résultat (règle 3).
    for (const x of posts) x.text = "";
    posts.length = 0;
  }
}

/**
 * Marques gardées sur la fiche : celles de la lecture complète (IA comprise), dates et intensité mises à jour pour les
 * marques relues, nouvelles marques ajoutées. Une marque absente garde sa dernière date (vraie). Pur.
 */
export function mergeStoredBrands(stored: unknown, current: readonly SnapshotBrand[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = Array.isArray(stored) ? stored.map((b) => ({ ...objectOf(b) })).filter((b) => typeof b.brand === "string") : [];
  for (const c of current) {
    const prev = out.find((b) => String(b.brand).toLowerCase() === c.brand.toLowerCase());
    if (prev) {
      prev.intensity = c.intensity;
      if (c.lastSeenAt && (!prev.lastSeenAt || String(prev.lastSeenAt) < c.lastSeenAt)) prev.lastSeenAt = c.lastSeenAt;
    } else out.push({ brand: c.brand, country: null, links: 0, promoCode: null, firstSeenAt: c.lastSeenAt, lastSeenAt: c.lastSeenAt, intensity: c.intensity, evidence: null });
  }
  return out;
}
