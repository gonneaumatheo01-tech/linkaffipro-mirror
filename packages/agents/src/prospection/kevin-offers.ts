/**
 * Phase 31, chantier D — offres du client (`AffiliateOffer`) par Kevin :
 * - premier démarrage sans aucune offre : 3 questions courtes au client (marque ; pays acceptés ; CPA et/ou revshare),
 *   par la file des demandes (`HumanRequest`, une question à la fois), une seule fois (`Setting prospection.offers_asked`,
 *   marqué AVANT les questions) ; à la dernière réponse, l'offre est créée à partir des réponses gardées dans
 *   `Setting prospection.offer_draft` ;
 * - « ajoute une offre : Winamax, FR BE, CPA 120 », « mes offres », « désactive l'offre Winamax ».
 * Sans offre, l'adéquation du score se fait sur « Europe, thème » seulement, et Kevin le dit dans le Top du jour.
 */
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { pick } from "../boss/voice";
import type { AgentsDeps } from "../types";
import { PROSPECTION_SETTINGS } from "./contract";
import { activeOffers, type OfferRow } from "./kevin-read";
import { countriesOf, countriesText, dealText, parseDeal, parseOfferText, PROSPECTION_KEVIN_VARIANTS as V, verticalOf, type ParsedOffer } from "./kevin-texts";

export const PROSPECTION_OFFER_DRAFT_SETTING = "prospection.offer_draft";
export const PROSPECTION_OFFER_KEYS = { brand: "prospection.offer.brand", countries: "prospection.offer.countries", deal: "prospection.offer.deal" } as const;

type Draft = { brand?: string | null; countries?: string[]; vertical?: "CASINO" | "SPORTS" | "BOTH" | null };

/**
 * Questions des offres, une seule fois et seulement si aucune offre n'existe. Rend le nombre de questions rangées.
 */
export async function ensureProspectionOfferQuestions(deps: AgentsDeps): Promise<{ queued: number }> {
  if ((await readSetting(deps, PROSPECTION_SETTINGS.offersAsked.key)) != null) return { queued: 0 };
  const now = nowOf(deps).toISOString();
  if ((await deps.prisma.affiliateOffer.count()) > 0) {
    await writeSetting(deps, PROSPECTION_SETTINGS.offersAsked.key, { at: now, skipped: "offre déjà là" });
    return { queued: 0 };
  }
  // Marqué AVANT : deux passages simultanés ne posent jamais deux fois la série (askHuman reste idempotent par clé).
  await writeSetting(deps, PROSPECTION_SETTINGS.offersAsked.key, { at: now });
  await writeSetting(deps, PROSPECTION_OFFER_DRAFT_SETTING, {});
  await askHuman(deps, { teamKey: null, kind: "TEXT", key: PROSPECTION_OFFER_KEYS.brand, question: V.offerQuestionBrand[0]!, onAnswer: { action: "prospection-offer-brand", resume: false } });
  await askHuman(deps, { teamKey: null, kind: "TEXT", key: PROSPECTION_OFFER_KEYS.countries, question: V.offerQuestionCountries[0]!, onAnswer: { action: "prospection-offer-countries", resume: false } });
  await askHuman(deps, { teamKey: null, kind: "TEXT", key: PROSPECTION_OFFER_KEYS.deal, question: V.offerQuestionDeal[0]!, onAnswer: { action: "prospection-offer-deal", resume: false } });
  await agentEvent(deps, "prospection.offers.asked", { queued: 3 });
  return { queued: 3 };
}

async function readDraft(deps: AgentsDeps): Promise<Draft> {
  const v = await readSetting(deps, PROSPECTION_OFFER_DRAFT_SETTING);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Draft) : {};
}

/** Crée l'offre (journal, audit) et rend la phrase de Kevin. */
export async function createOffer(deps: AgentsDeps, offer: ParsedOffer & { brand: string }, actor: { userId?: string | null; via: string }, chatId: string | null = null): Promise<{ offerId: string; reply: string }> {
  const row = (await deps.prisma.affiliateOffer.create({
    data: { brand: offer.brand, vertical: offer.vertical, countries: offer.countries, dealTypes: JSON.parse(JSON.stringify(offer.dealTypes)), isActive: true },
  })) as OfferRow;
  await agentAudit(deps, { userId: actor.userId ?? null, action: "prospection.offer.created", entityType: "AffiliateOffer", entityId: row.id, metadata: { via: actor.via, brand: offer.brand } });
  await agentEvent(deps, "prospection.offer.created", { offerId: row.id });
  return { offerId: row.id, reply: pick(V.offerAdded({ brand: offer.brand, countries: countriesText(offer.countries), deal: dealText(offer.dealTypes) }), "prospection.offerAdded", chatId) };
}

/** Désactive l'offre active d'une marque (nom insensible à la casse et aux accents). */
export async function disableOffer(deps: AgentsDeps, brand: string, actor: { userId?: string | null; via: string }, chatId: string | null = null): Promise<string> {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().trim();
  const offers = await activeOffers(deps);
  const hit = offers.filter((o) => norm(o.brand) === norm(brand));
  if (!hit.length) return pick(V.offerUnknown({ brand }), "prospection.offerUnknown", chatId);
  for (const o of hit) {
    await deps.prisma.affiliateOffer.update({ where: { id: o.id }, data: { isActive: false } });
    await agentAudit(deps, { userId: actor.userId ?? null, action: "prospection.offer.disabled", entityType: "AffiliateOffer", entityId: o.id, metadata: { via: actor.via } });
  }
  return pick(V.offerDisabled({ brand: hit[0]!.brand }), "prospection.offerDisabled", chatId);
}

// ------------------------------------------------------------------------------------------------ réponses

/** Pays d'une réponse : noms français, codes ISO en majuscules, ou une simple liste de codes (« fr be ch »). */
export function countriesOfAnswer(value: string): string[] {
  const t = value.trim();
  return countriesOf(/^[a-z]{2}(?:[\s,;/+&]+[a-z]{2})*$/i.test(t) ? t.toUpperCase() : t);
}

registerAnswerAction("prospection-offer-brand", async (deps, { value }) => {
  const brand = value.trim().replace(/^["«“'\s]+|["»”'\s]+$/g, "").slice(0, 60);
  await writeSetting(deps, PROSPECTION_OFFER_DRAFT_SETTING, { ...(await readDraft(deps)), brand: brand || null, vertical: verticalOf(value) });
  return undefined;
});

registerAnswerAction("prospection-offer-countries", async (deps, { value }) => {
  await writeSetting(deps, PROSPECTION_OFFER_DRAFT_SETTING, { ...(await readDraft(deps)), countries: countriesOfAnswer(value) });
  return undefined;
});

registerAnswerAction("prospection-offer-deal", async (deps, { value, actor }) => {
  const draft = await readDraft(deps);
  if (!draft.brand) return V.offerSetupSkipped[0];
  const deal = parseDeal(value);
  const parsed = parseOfferText(`${draft.brand}, ${value}`);
  const dealTypes: ParsedOffer["dealTypes"] =
    deal.dealType === "HYBRID" && deal.cpa !== null && deal.revshare !== null ? { hybrid: { cpa: deal.cpa, revshare: deal.revshare } } : { ...(deal.cpa !== null ? { cpa: deal.cpa } : {}), ...(deal.revshare !== null ? { revshare: deal.revshare } : {}) };
  const r = await createOffer(deps, { brand: draft.brand, countries: draft.countries ?? [], vertical: draft.vertical ?? parsed.vertical, dealTypes }, { userId: actor.userId ?? null, via: actor.via });
  await writeSetting(deps, PROSPECTION_OFFER_DRAFT_SETTING, { ...draft, createdOfferId: r.offerId });
  return r.reply;
});
