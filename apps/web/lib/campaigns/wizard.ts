/**
 * Assistant « Nouvelle campagne » en 4 étapes : règles pures (sans base de données).
 * Une campagne = nom + univers + offres Link Affi + canaux Telegram + pubs (une par lien d'entrée).
 */
import { isVertical, type Vertical } from "@linkaffipro/core";

export const WIZARD_STEPS = [
  { key: "general", title: "Nom et univers", help: "Donnez un nom clair à la campagne et choisissez l'univers ; dates et budget sont facultatifs." },
  { key: "offers", title: "Offres", help: "Choisissez la ou les campagnes Link Affi à promouvoir, ou collez un lien linkaffi.me/go/… ." },
  { key: "channels", title: "Canaux", help: "Cochez les canaux Telegram alimentés par cette campagne : le premier coché reçoit les liens d'entrée." },
  { key: "ads", title: "Pubs", help: "Indiquez la plateforme et le nombre de pubs : un lien d'entrée (goolink + invitation) est créé pour chacune." },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export const AD_PLATFORMS = ["TIKTOK", "META", "OTHER"] as const;
export type WizardAdPlatform = (typeof AD_PLATFORMS)[number];

export const MIN_ADS = 1;
export const MAX_ADS = 20;

/** Ce que l'assistant envoie au serveur (champ caché JSON). */
export type WizardPayload = {
  name: string;
  vertical: Vertical | null;
  startAt: string | null;
  endAt: string | null;
  budgetDaily: number | null;
  affiliateCampaignIds: string[];
  channelIds: string[];
  adPlatform: WizardAdPlatform | null;
  connectionId: string | null;
  adCount: number;
  notes: string | null;
};

export type WizardError = { step: WizardStepKey; message: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function list(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))] : [];
}

/**
 * Lit et vérifie le contenu de l'assistant. Retourne la charge nettoyée ou la première erreur (avec l'étape à corriger).
 * Règles : nom obligatoire (120 max), dates au format AAAA-MM-JJ et cohérentes, budget positif, 1 à 20 pubs,
 * la plateforme est obligatoire dès qu'il y a au moins une pub, les canaux sont obligatoires s'il y a des pubs
 * (le lien d'invitation a besoin d'un canal).
 */
export function parseWizardPayload(raw: unknown): { ok: true; data: WizardPayload } | { ok: false; error: WizardError } {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = str(v.name);
  if (!name) return { ok: false, error: { step: "general", message: "Le nom de la campagne est obligatoire." } };
  if (name.length > 120) return { ok: false, error: { step: "general", message: "Le nom ne peut pas dépasser 120 caractères." } };
  const verticalRaw = str(v.vertical);
  const vertical = isVertical(verticalRaw) ? verticalRaw : null;
  const startAt = str(v.startAt) || null;
  const endAt = str(v.endAt) || null;
  if (startAt && !DAY.test(startAt)) return { ok: false, error: { step: "general", message: "La date de début n'est pas valide." } };
  if (endAt && !DAY.test(endAt)) return { ok: false, error: { step: "general", message: "La date de fin n'est pas valide." } };
  if (startAt && endAt && endAt < startAt) return { ok: false, error: { step: "general", message: "La date de fin doit être après la date de début." } };
  let budgetDaily: number | null = null;
  const budgetRaw = v.budgetDaily;
  if (budgetRaw !== null && budgetRaw !== undefined && String(budgetRaw).trim() !== "") {
    const n = Number(String(budgetRaw).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: { step: "general", message: "Le budget par jour doit être un nombre positif (ex. 50)." } };
    budgetDaily = n;
  }
  const affiliateCampaignIds = list(v.affiliateCampaignIds);
  const channelIds = list(v.channelIds);
  const adCountRaw = v.adCount === undefined || v.adCount === null || v.adCount === "" ? 0 : Number(v.adCount);
  if (!Number.isInteger(adCountRaw) || adCountRaw < 0 || adCountRaw > MAX_ADS)
    return { ok: false, error: { step: "ads", message: `Le nombre de pubs doit être compris entre 0 et ${MAX_ADS}.` } };
  const platformRaw = str(v.adPlatform);
  const adPlatform = (AD_PLATFORMS as readonly string[]).includes(platformRaw) ? (platformRaw as WizardAdPlatform) : null;
  if (adCountRaw > 0 && !adPlatform) return { ok: false, error: { step: "ads", message: "Choisissez la plateforme des pubs (TikTok, Meta ou autre)." } };
  if (adCountRaw > 0 && channelIds.length === 0)
    return { ok: false, error: { step: "channels", message: "Cochez au moins un canal : chaque pub reçoit un lien d'invitation vers le premier canal coché." } };
  const connectionId = str(v.connectionId) || null;
  const notes = str(v.notes) || null;
  if (notes && notes.length > 2000) return { ok: false, error: { step: "general", message: "Les notes ne peuvent pas dépasser 2000 caractères." } };
  return {
    ok: true,
    data: { name, vertical, startAt, endAt, budgetDaily, affiliateCampaignIds, channelIds, adPlatform, connectionId, adCount: adCountRaw, notes },
  };
}

/**
 * Clé d'une campagne Link Affi à partir de ce que l'utilisateur colle : un lien `https://linkaffi.me/go/<clé>`
 * (avec ou sans paramètres, n'importe quel domaine) ou la clé seule (lettres et chiffres, 4 à 32 caractères).
 * Retourne null si rien d'exploitable.
 */
export function parseLinkAffiReference(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = /\/go\/([A-Za-z0-9_-]{4,32})(?:[/?#]|$)/.exec(s);
  if (m) return m[1]!;
  if (/^[A-Za-z0-9_-]{4,32}$/.test(s) && !/^https?:/i.test(s)) return s;
  return null;
}

export type OfferCandidate = { id: string; name: string; programName: string; campaignKey: string | null; externalId: string; trackingUrlTemplate: string; vertical?: string | null };

/** Retrouve la campagne Link Affi synchronisée qui porte cette clé (clé, identifiant externe ou présente dans l'URL d'offre). */
export function findOfferByKey<T extends OfferCandidate>(key: string, candidates: T[]): T | null {
  const k = key.toLowerCase();
  return (
    candidates.find((c) => c.campaignKey?.toLowerCase() === k) ??
    candidates.find((c) => c.externalId.toLowerCase() === k) ??
    candidates.find((c) => c.trackingUrlTemplate.toLowerCase().includes(`/go/${k}`)) ??
    null
  );
}

export const UNKNOWN_KEY_MESSAGE = "Cette clé n'est pas encore synchronisée : vérifiez-la ou attendez 2 minutes (la synchronisation Link Affi tourne toutes les 2 minutes).";

/** Recherche libre dans les offres : nom, clé, programme (casino), sans tenir compte des accents ni de la casse. */
export function searchOffers<T extends OfferCandidate>(query: string, candidates: T[]): T[] {
  const q = fold(query);
  if (!q) return candidates;
  const words = q.split(/\s+/).filter(Boolean);
  return candidates.filter((c) => {
    const hay = fold(`${c.name} ${c.programName} ${c.campaignKey ?? ""} ${c.externalId}`);
    return words.every((w) => hay.includes(w));
  });
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export type PlannedAd = { adName: string; linkName: string };

/**
 * Découpage des pubs à créer : « Pub 1 », « Pub 2 »… dans un groupe « Groupe 1 », chaque pub ayant son lien d'entrée
 * nommé « <campagne> — Pub N ». Les noms de lien sont coupés à 64 caractères (nom Telegram limité à 32 par ailleurs).
 */
export function planAds(campaignName: string, count: number): PlannedAd[] {
  const n = Math.max(0, Math.min(MAX_ADS, Math.floor(count)));
  const base = campaignName.trim().slice(0, 50);
  return Array.from({ length: n }, (_, i) => {
    const adName = `Pub ${i + 1}`;
    return { adName, linkName: `${base} — ${adName}`.slice(0, 64) };
  });
}

export const DEFAULT_AD_SET_NAME = "Groupe 1";

/** Étape à afficher à l'ouverture de l'assistant quand une erreur serveur renvoie vers une étape précise. */
export function stepIndex(key: string | undefined | null): number {
  const i = WIZARD_STEPS.findIndex((s) => s.key === key);
  return i === -1 ? 0 : i;
}
