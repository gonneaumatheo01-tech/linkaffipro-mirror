/**
 * Phase 31, chantier B — Agent Enrichisseur : un prospect `DISCOVERED` → toutes les colonnes de mesure, de
 * classification et de contact (section 3). `QUALIFIED` est posé par l'Évaluateur (chantier C), jamais ici.
 *
 * Déroulé (une tâche `prospection.enrich`, 5 minutes au plus) :
 * page `t.me/<nom>` → posts `t.me/s/<nom>` → mesures → filtres durs (DISQUALIFIED, niveau D) → signaux de faux →
 * langue → pays → (hors Europe : DISQUALIFIED sans lecture IA, décision de coût) → lecture IA (Sonnet) → concordance
 * code / IA → contacts (page liée : 1 requête) → marques et concurrence → signal réglementaire → contrôle local →
 * écriture, `ProspectEvent` ENRICHED, graphe (Sourceur) et mise en file du score.
 *
 * - Page introuvable / privée → UNREADABLE. Aperçu fermé ou groupe → abonnés et description gardés, on continue
 *   (`tierReason` : « aperçu fermé : pas de posts lisibles », le score est plafonné par l'Évaluateur).
 * - Erreur technique (réseau, IA, contrôle) → ENRICH_FAILED, `enrichAttempts + 1`, un seul nouvel essai 6 h plus
 *   tard ; au 2e échec, `ProspectEvent` ALERT pour que Kevin prévienne.
 * - Plafond journalier `prospection.enrich_daily_cap` : au-delà, la tâche est remise au lendemain.
 * - Données minimales (règle 3) : le texte des posts reste dans la mémoire du job. Seuls `descriptionRaw` (texte public
 *   court), `summaryFr` (200 caractères) et au plus 3 preuves de 15 mots tirées des posts sont écrits.
 * - Aucun contact, aucun canal rejoint, aucun lien d'invitation suivi, aucune lecture de membres.
 */
import { readSetting } from "../../admin/journal";
import { fromParis, parisDay } from "../../rules/time";
import { DEFAULT_COUNTRIES_SCOPE, PROSPECTION_LIMITS, PROSPECTION_SETTINGS, type ChannelAnalysis, type ContactFound, type FakeFlag, type ProspectPost, type ProspectStatus, type ProspectVertical, type RiskFlag } from "../contract";
import { expandGraph } from "../discover/sources/graph";
import { enrichNow, enrichNumberSetting, type EnrichDeps } from "./ai";
import { analyzeChannel } from "./analyze";
import { detectBrandLinks, isAffiliateLink, mergeBrands } from "./brands";
import { extractContacts, fetchLinkedPage, findLinkedGroup, findLinkedPageUrl } from "./contacts";
import { fakeSignals } from "./fake";
import { hardFilters } from "./filters";
import { detectGeo } from "./geo";
import { detectLanguageConfirmed } from "./language";
import { computeMetrics } from "./metrics";
import { fetchChannelPage } from "./page";
import { readProspectPosts } from "./posts";
import { qcEnrichment } from "./qc";
import { regulatoryFlagFor } from "./regulatory";

export type EnrichOutcome = { status: ProspectStatus; reason: string | null; scoreQueued: boolean };

/** Statuts que l'Enrichisseur peut (re)lire ; un prospect déjà dans le pipeline du client n'est jamais touché. */
const ENRICHABLE: ReadonlySet<ProspectStatus> = new Set(["DISCOVERED", "ENRICHING", "ENRICH_FAILED", "UNREADABLE", "QUALIFIED", "DISQUALIFIED"]);
export const NO_PREVIEW_REASON = "aperçu fermé : pas de posts lisibles";

const DAY = 86_400_000;
const MAX_WORDS_COPIED = PROSPECTION_LIMITS.evidenceMaxWords;

type ProspectRow = {
  id: string;
  username: string | null;
  channelUrl: string;
  status: ProspectStatus;
  title: string;
  graphDepth: number;
  enrichAttempts: number;
  nextEnrichAt: Date | null;
  monetization: unknown;
};

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Le texte reprend-il plus de 15 mots d'affilée d'un post ? (règle 3 : jamais de texte de post en base) */
export function copiesPostText(text: string | null | undefined, posts: ProspectPost[], maxWords: number = MAX_WORDS_COPIED): boolean {
  if (!text) return false;
  const w = words(text);
  if (w.length <= maxWords) return false;
  const grams = new Set<string>();
  for (let i = 0; i + maxWords < w.length; i++) grams.add(w.slice(i, i + maxWords + 1).join(" "));
  if (!grams.size) return false;
  for (const p of posts) {
    const pw = words(p.text);
    for (let i = 0; i + maxWords < pw.length; i++) if (grams.has(pw.slice(i, i + maxWords + 1).join(" "))) return true;
  }
  return false;
}

const firstWords = (s: string, n = MAX_WORDS_COPIED) => s.split(/\s+/).slice(0, n).join(" ");

/** Verticale devinée sur la description seule (aperçu fermé : aucune lecture IA possible). */
export function guessVerticalFromText(text: string): ProspectVertical {
  const t = text.toLowerCase();
  const casino = /casino|casinò|kasyno|slots?\b|machines? à sous|freispiele|tragamonedas|roulette|ruleta|blackjack|aviator|crash|jackpot|free ?spins|tours gratuits|giri gratis/.test(t);
  const sports = /pronos?|pronostic|paris sportifs|tipster|tips?\b|wett|scommess|pronostici|apuestas|apostas|palpites|zakłady|typy|bets?\b|football|foot\b|fußball|calcio|fútbol|futebol|tennis|ligue 1|serie a|bundesliga|liga/.test(t);
  return casino && sports ? "BOTH" : casino ? "CASINO" : sports ? "SPORTS" : "OTHER";
}

async function scopeOf(deps: EnrichDeps): Promise<string[]> {
  const v = await readSetting(deps, PROSPECTION_SETTINGS.countriesScope.key).catch(() => undefined);
  return Array.isArray(v) && v.every((x) => typeof x === "string") && v.length ? (v as string[]).map((c) => c.toUpperCase()) : [...DEFAULT_COUNTRIES_SCOPE];
}

async function settingNumber(deps: EnrichDeps, s: { key: string; value: number }): Promise<number> {
  return enrichNumberSetting(deps, s.key, s.value);
}

async function event(deps: EnrichDeps, prospectId: string, type: string, payload: Record<string, unknown>): Promise<void> {
  await deps.prisma.prospectEvent.create({ data: { prospectId, type, payload: JSON.parse(JSON.stringify(payload)) } });
}

/** Garde au plus 3 preuves tirées des posts (marques puis contacts) ; les preuves de la description restent. */
export function limitPostEvidence<B extends { evidence?: string | null }>(brands: B[], contacts: ContactFound[]): { brands: B[]; contacts: ContactFound[] } {
  let left = PROSPECTION_LIMITS.maxEvidencePerProspect;
  const fromPosts = (c: ContactFound) => !(c.source === "description" || c.source.startsWith("directory:") || c.source.startsWith("linked_page:"));
  const outContacts = contacts.map((c) => {
    if (!c.evidence || !fromPosts(c)) return c;
    if (left > 0 && c.confidence !== "LOW") {
      left--;
      return c;
    }
    return { ...c, evidence: null };
  });
  const outBrands = brands.map((b) => {
    if (!b.evidence) return b;
    if (left > 0) {
      left--;
      return b;
    }
    return { ...b, evidence: null };
  });
  return { brands: outBrands, contacts: outContacts };
}

/** Échec technique : ENRICH_FAILED, un nouvel essai 6 h plus tard, puis alerte pour Kevin au 2e échec. */
async function technicalFailure(deps: EnrichDeps, p: ProspectRow, step: string, reason: string): Promise<EnrichOutcome> {
  const now = enrichNow(deps);
  const attempts = p.enrichAttempts + 1;
  const retry = attempts < PROSPECTION_LIMITS.maxEnrichAttempts;
  const message = `${step} : ${reason}`.slice(0, 300);
  await deps.prisma.prospect.update({
    where: { id: p.id },
    data: {
      status: "ENRICH_FAILED",
      statusChangedAt: now,
      enrichError: message,
      enrichAttempts: attempts,
      nextEnrichAt: retry ? new Date(now.getTime() + PROSPECTION_LIMITS.enrichRetryMs) : null,
      lastEnrichedAt: now,
    },
  });
  await event(deps, p.id, "STATUS_CHANGED", { from: p.status, to: "ENRICH_FAILED", by: "system", step, reason: message });
  if (retry) {
    await deps.prospection?.enqueue?.({ type: "prospection.enrich", prospectId: p.id }, { jobId: `prospection.enrich:${p.id}:retry${attempts}`, delayMs: PROSPECTION_LIMITS.enrichRetryMs });
  } else {
    await event(deps, p.id, "ALERT", { kind: "enrich_failed", attempts, step, reason: message, username: p.username });
  }
  return { status: "ENRICH_FAILED", reason: message, scoreQueued: false };
}

/** Enrichit un prospect. Jamais d'exception pour une erreur de lecture : le statut le dit. */
export async function enrichProspect(deps: EnrichDeps, prospectId: string): Promise<EnrichOutcome> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as ProspectRow | null;
  if (!p) return { status: "UNREADABLE", reason: "prospect introuvable", scoreQueued: false };
  if (!ENRICHABLE.has(p.status)) return { status: p.status, reason: "déjà dans le suivi du client : rien n'est relu", scoreQueued: false };
  const now = enrichNow(deps);
  if (p.status === "ENRICH_FAILED" && p.nextEnrichAt && p.nextEnrichAt.getTime() > now.getTime())
    return { status: p.status, reason: "nouvel essai prévu plus tard", scoreQueued: false };
  if (p.status === "ENRICH_FAILED" && p.enrichAttempts >= PROSPECTION_LIMITS.maxEnrichAttempts && !p.nextEnrichAt)
    return { status: p.status, reason: "deux échecs : Kevin a prévenu, rien n'est relu", scoreQueued: false };

  // Lien d'invitation privé : jamais ouvert (règle 2).
  if (!p.username) {
    await deps.prisma.prospect.update({ where: { id: p.id }, data: { status: "UNREADABLE", statusChangedAt: now, enrichError: "lien d'invitation privé : jamais ouvert", lastEnrichedAt: now } });
    await event(deps, p.id, "ENRICHED", { status: "UNREADABLE", reason: "invitation privée" });
    return { status: "UNREADABLE", reason: "lien d'invitation privé : jamais ouvert", scoreQueued: false };
  }

  // Plafond journalier (jour de Paris) : au-delà, remis au lendemain.
  const cap = await settingNumber(deps, PROSPECTION_SETTINGS.enrichDailyCap);
  const dayStart = fromParis(parisDay(now), 0);
  const doneToday = await deps.prisma.prospectEvent.count({ where: { type: "ENRICHED", createdAt: { gte: dayStart } } });
  if (doneToday >= cap) {
    const tomorrow = fromParis(parisDay(new Date(dayStart.getTime() + DAY + 3_600_000)), 5);
    await deps.prospection?.enqueue?.({ type: "prospection.enrich", prospectId: p.id }, { jobId: `prospection.enrich:${p.id}:${parisDay(tomorrow)}`, delayMs: Math.max(0, tomorrow.getTime() - now.getTime()) });
    return { status: p.status, reason: `plafond de ${cap} lectures par jour atteint : remis à demain`, scoreQueued: false };
  }

  await deps.prisma.prospect.update({ where: { id: p.id }, data: { status: "ENRICHING", statusChangedAt: p.status === "ENRICHING" ? undefined : now } });
  const username = p.username;
  let posts: ProspectPost[] = [];
  let step = "page publique";
  try {
    // 1. Page t.me/<nom>.
    const page = await fetchChannelPage(deps, username);
    if (!page.ok) {
      if (page.reason === "error") return await technicalFailure(deps, p, step, page.message);
      await deps.prisma.prospect.update({
        where: { id: p.id },
        data: { status: "UNREADABLE", statusChangedAt: now, enrichError: page.message, lastEnrichedAt: now, enrichedAt: now, tier: null },
      });
      await event(deps, p.id, "ENRICHED", { status: "UNREADABLE", reason: page.reason });
      return { status: "UNREADABLE", reason: page.message, scoreQueued: false };
    }

    // 2. Posts de l'aperçu (canaux seulement ; un groupe n'a pas d'aperçu public).
    step = "posts de l'aperçu";
    let subscribersShown: number | null = null;
    let previewDescription: string | null = null;
    let previewClosed = !page.hasPreview || page.kind === "GROUP";
    if (!previewClosed) {
      const read = await readProspectPosts(deps, username);
      if (read.ok) {
        posts = read.posts;
        subscribersShown = read.subscribersShown;
        previewDescription = read.description;
      } else if (read.reason === "error") return await technicalFailure(deps, p, step, read.message);
      else previewClosed = true;
    }
    if (!posts.length) previewClosed = true;
    const subscribers = page.subscribers ?? subscribersShown;
    const description = page.description ?? previewDescription;

    // 3. Mesures et 4. filtres durs.
    step = "mesures";
    const metrics = computeMetrics(posts, subscribers, now);
    const measured = {
      kind: page.kind,
      title: page.title.slice(0, 200),
      descriptionRaw: description?.slice(0, 1000) ?? null,
      subscribers,
      postsPerDay: metrics.postsPerDay,
      medianViews: metrics.medianViews,
      avgViews: metrics.avgViews,
      viewRate: metrics.viewRate,
      viewVarianceCv: metrics.viewVarianceCv,
      forwardRatio: metrics.forwardRatio,
      reactionRate: metrics.reactionRate,
      commentRate: metrics.commentRate,
      linkDensity: metrics.linkDensity,
      postingHours: metrics.postingHours ?? undefined,
      firstSeenPostAt: metrics.firstSeenPostAt,
      lastPostAt: metrics.lastPostAt,
      enrichedAt: now,
      lastEnrichedAt: now,
      enrichError: null,
    };
    const minPosts30d = await settingNumber(deps, PROSPECTION_SETTINGS.minPosts30d);
    const minMedianViews = await settingNumber(deps, PROSPECTION_SETTINGS.minMedianViews);
    const hits = posts.length ? hardFilters(metrics, { minPosts30d, minMedianViews, now }) : [];
    if (hits.length) {
      const repost = hits.some((h) => h.code === "REPOST");
      await deps.prisma.prospect.update({
        where: { id: p.id },
        data: {
          ...measured,
          status: "DISQUALIFIED",
          statusChangedAt: now,
          tier: "D",
          tierReason: hits.map((h) => h.reason).join(" ; ").slice(0, 300),
          authenticity: repost ? "REPOST" : undefined,
          authenticityReason: repost ? hits.find((h) => h.code === "REPOST")!.reason : undefined,
          enrichAttempts: 0,
          nextEnrichAt: null,
        },
      });
      await event(deps, p.id, "ENRICHED", { status: "DISQUALIFIED", filters: hits.map((h) => h.code), posts: posts.length });
      return { status: "DISQUALIFIED", reason: hits[0]!.reason, scoreQueued: false };
    }

    // 5. Signaux de faux, 6. langue, 7. pays.
    step = "langue et pays";
    const fakeFlags: FakeFlag[] = fakeSignals(posts, metrics);
    const texts = posts.map((x) => x.text).filter((t) => t.trim());
    const lang = await detectLanguageConfirmed(deps, description ? [description, ...texts] : texts, { channel: username });
    const detected = detectBrandLinks(posts);
    const allLinks = [...posts.flatMap((x) => [...x.links, ...x.buttons.map((b) => b.url)]), ...(description?.match(/https?:\/\/\S+/g) ?? [])];
    const geo = detectGeo({ texts, description, brands: [...new Set(detected.map((d) => d.key))], links: allLinks, language: lang.language }, await scopeOf(deps));
    const classified = {
      language: lang.language,
      languageConfidence: lang.confidence,
      countries: geo.countries,
      geoSignals: JSON.parse(JSON.stringify(geo.geoSignals)),
      geoConfidence: geo.geoConfidence,
      region: geo.region,
      fakeFlags,
    };
    if (geo.region === "NON_EU") {
      const ev = [...geo.geoSignals.brands, ...geo.geoSignals.offshoreBrands, ...geo.geoSignals.currency, ...geo.geoSignals.competitions, ...(geo.geoSignals.languageDefault ? [`langue ${geo.geoSignals.languageDefault}`] : [])];
      const reason = `hors Europe : ${geo.countries[0]}${ev.length ? ` (${[...new Set(ev)].slice(0, 4).join(", ")})` : ""}`;
      await deps.prisma.prospect.update({
        where: { id: p.id },
        data: { ...measured, ...classified, status: "DISQUALIFIED", statusChangedAt: now, tier: "D", tierReason: reason.slice(0, 300), enrichAttempts: 0, nextEnrichAt: null },
      });
      await event(deps, p.id, "ENRICHED", { status: "DISQUALIFIED", region: "NON_EU", country: geo.countries[0], posts: posts.length });
      return { status: "DISQUALIFIED", reason, scoreQueued: false };
    }

    // 8. Lecture IA (posts lisibles seulement).
    step = "lecture IA";
    let analysis: ChannelAnalysis | null = null;
    if (posts.length) {
      const res = await analyzeChannel(deps, {
        title: page.title,
        url: `https://t.me/${username}`,
        subscribers,
        medianViews: metrics.medianViews,
        language: lang.language,
        countries: geo.countries,
        description,
        posts,
      });
      if (!res.ok) return await technicalFailure(deps, p, step, res.error);
      analysis = res.analysis;
    }

    // Concordance code / IA.
    let authenticity = analysis?.authenticity ?? null;
    let authenticityReason = analysis?.authenticityReason ?? null;
    if (authenticity === "REAL" && fakeFlags.length >= 2) {
      authenticity = "SUSPECT_GENERIC";
      authenticityReason = `lecture « vraie » de l'IA, mais ${fakeFlags.length} signaux de faux mesurés (${fakeFlags.join(", ")})`;
    }
    if (authenticityReason && copiesPostText(authenticityReason, posts)) authenticityReason = firstWords(authenticityReason);
    let summaryFr = analysis?.summaryFr ?? null;
    if (summaryFr && copiesPostText(summaryFr, posts)) summaryFr = firstWords(summaryFr);
    const vertical: ProspectVertical = analysis?.vertical ?? guessVerticalFromText(`${page.title}\n${description ?? ""}`);
    const aiDisqualifies = authenticity === "SUSPECT_BOT" || authenticity === "REPOST";

    // 9. Contacts (page liée : 1 requête), 10. marques, 11. réglementaire.
    step = "contacts et marques";
    const monetizationPrev = (p.monetization ?? {}) as { marketplaceListing?: string | null; marketplacePrice?: string | null };
    let contacts: ContactFound[] = [];
    let best: string | null = null;
    let contactConfidence: "NONE" | "LOW" | "MEDIUM" | "HIGH" = "NONE";
    const linkedGroup = findLinkedGroup(description, posts);
    if (!aiDisqualifies) {
      const linkedUrl = findLinkedPageUrl(description, posts);
      const linkedPage = linkedUrl ? await fetchLinkedPage(deps, linkedUrl) : null;
      const r = extractContacts({
        description,
        pinned: null,
        posts,
        linkedPage,
        marketplace: monetizationPrev.marketplaceListing ? { url: monetizationPrev.marketplaceListing, price: monetizationPrev.marketplacePrice ?? null } : null,
        linkedGroup,
        channelUsername: username,
        analysis,
      });
      contacts = r.contacts;
      best = r.best;
      contactConfidence = r.confidence;
    }
    const offers = (await deps.prisma.affiliateOffer.findMany({ where: { isActive: true } })) as Array<{ brand: string; isActive: boolean }>;
    const merged = mergeBrands(analysis?.brands ?? [], detected, offers, {
      firstPostAt: metrics.firstSeenPostAt,
      lastPostAt: metrics.lastPostAt,
      postCount: posts.length,
      corpus: [description ?? "", ...texts, ...posts.flatMap((x) => x.buttons.map((b) => `${b.text} ${b.url}`))].join("\n"),
    });
    const limited = limitPostEvidence(merged.brands, contacts);
    const riskFlags: RiskFlag[] = [...new Set([...(analysis?.riskFlags ?? []), ...merged.riskFlags])];
    const regulatoryFlag = geo.region === "EU" ? await regulatoryFlagFor(deps, geo.countries[0] ?? null, vertical) : null;
    const affiliateLinks = allLinks.filter(isAffiliateLink).length;
    const monetization = {
      ...(analysis?.monetization ?? { sellsVip: false, vipPrice: null, sellsAds: false, adPrice: null, pushesAffiliate: false }),
      pushesAffiliate: (analysis?.monetization.pushesAffiliate ?? false) || (affiliateLinks > 0 && merged.brands.length > 0),
      marketplaceListing: monetizationPrev.marketplaceListing ?? null,
    };

    // 12. Contrôle local.
    step = "contrôle";
    const qc = qcEnrichment({ username, title: page.title, subscribers, metrics, analysis, hasPosts: posts.length > 0, now });
    if (!qc.ok) return await technicalFailure(deps, p, step, qc.problems.join(", "));

    const status: ProspectStatus = aiDisqualifies ? "DISQUALIFIED" : "ENRICHING";
    const tierReason = aiDisqualifies
      ? `${authenticity === "REPOST" ? "ne fait que reprendre d'autres canaux" : "faux canal (contenu de robot)"} selon la lecture`
      : previewClosed
        ? NO_PREVIEW_REASON
        : null;
    await deps.prisma.prospect.update({
      where: { id: p.id },
      data: {
        ...measured,
        ...classified,
        summaryFr,
        vertical,
        verticalDetails: analysis ? analysis.verticalDetails : undefined,
        contentType: analysis?.contentType ?? null,
        authenticity,
        authenticityReason: authenticityReason?.slice(0, 300) ?? null,
        riskFlags,
        monetization: JSON.parse(JSON.stringify(monetization)),
        brands: JSON.parse(JSON.stringify(limited.brands)),
        hasCompetitor: merged.hasCompetitor,
        competitiveState: merged.competitiveState,
        contactConfidence,
        bestContact: best,
        regulatoryFlag,
        status,
        statusChangedAt: status !== "ENRICHING" ? now : undefined,
        tier: aiDisqualifies ? "D" : undefined,
        tierReason,
        enrichAttempts: 0,
        nextEnrichAt: null,
      },
    });
    for (const c of limited.contacts) {
      await deps.prisma.prospectContact.upsert({
        where: { prospectId_type_value: { prospectId: p.id, type: c.type, value: c.value } },
        create: { prospectId: p.id, type: c.type, value: c.value, label: c.label, source: c.source, confidence: c.confidence, evidence: c.evidence },
        update: { label: c.label, source: c.source, confidence: c.confidence, evidence: c.evidence },
      });
    }
    await event(deps, p.id, "ENRICHED", {
      status,
      posts: posts.length,
      region: geo.region,
      fakeFlags: fakeFlags.length,
      contacts: limited.contacts.length,
      previewClosed,
      languageConfirmedByAi: lang.confirmedByAi,
    });

    // Graphe (Sourceur) : seulement depuis un canal lisible, européen ou à trancher, ni faux, ni repost, ni scam.
    const excluded = aiDisqualifies || riskFlags.includes("SCAM_FIXED_MATCHES") || !posts.length;
    if (!excluded) {
      try {
        await expandGraph(deps, { id: p.id, graphDepth: p.graphDepth }, { posts, description, linkedGroup });
      } catch (err) {
        deps.logger?.warn({ err: String((err as Error)?.message ?? err).slice(0, 120), prospectId: p.id }, "[prospection] graphe non étendu");
      }
    }
    if (aiDisqualifies) return { status, reason: tierReason, scoreQueued: false };

    let scoreQueued = false;
    if (deps.prospection?.enqueue) {
      await deps.prospection.enqueue({ type: "prospection.score", prospectId: p.id }, { jobId: `prospection.score:${p.id}` });
      scoreQueued = true;
    }
    return { status, reason: tierReason, scoreQueued };
  } catch (err) {
    return await technicalFailure(deps, p, step, String((err as Error)?.message ?? err).slice(0, 200));
  } finally {
    // Texte brut effacé à la fin du job, quel que soit le résultat (règle 3).
    for (const x of posts) x.text = "";
    posts.length = 0;
  }
}
