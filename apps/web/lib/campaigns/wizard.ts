/**
 * Assistant « Nouvelle campagne » en 4 étapes : règles pures (sans base de données).
 * Une campagne = nom + univers + offres Link Affi + canaux Telegram + pubs (une par lien d'entrée).
 */
import { isVertical, type Vertical } from "@linkaffipro/core";

export const WIZARD_STEPS = [
  {
    key: "general",
    title: "Nom et univers",
    help: "Donnez un nom clair et choisissez l'univers. Budget et dates sont facultatifs.",
  },
  {
    key: "offers",
    title: "Offres",
    help: "Choisissez les offres Link Affi à promouvoir, ou collez un lien linkaffi.me/go/….",
  },
  {
    key: "channels",
    title: "Canaux",
    help: "Cochez les canaux Telegram où arriveront les membres de cette campagne.",
  },
  {
    key: "ads",
    title: "Pubs",
    help: "Choisissez la plateforme et le nombre de pubs : chaque pub reçoit son lien d'entrée.",
  },
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
  /** Canal qui reçoit les liens d'invitation des pubs (un des canaux cochés), null sans pub. */
  entryChannelId: string | null;
  adPlatform: WizardAdPlatform | null;
  connectionId: string | null;
  /** Campagne pub déjà importée de ce compte (coquille de la synchro) à reprendre dans la nouvelle campagne. */
  importedCampaignId: string | null;
  adCount: number;
  notes: string | null;
  /** Jeton d'idempotence (UUID créé à l'ouverture de l'assistant) : un double clic ne crée pas deux campagnes. */
  requestId: string | null;
};

export type WizardError = { step: WizardStepKey; message: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function list(v: unknown): string[] {
  return Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === "string" && x.trim() !== "")
            .map((x) => x.trim()),
        ),
      ]
    : [];
}

/**
 * Lit et vérifie le contenu de l'assistant. Retourne la charge nettoyée ou la première erreur (avec l'étape à corriger).
 * Règles : nom obligatoire (120 max), dates au format AAAA-MM-JJ et cohérentes, budget positif, 0 à 20 pubs,
 * la plateforme est obligatoire dès qu'il y a au moins une pub, les canaux sont obligatoires s'il y a des pubs
 * (le lien d'invitation a besoin d'un canal) et le canal d'entrée doit être l'un des canaux cochés.
 */
export function parseWizardPayload(
  raw: unknown,
): { ok: true; data: WizardPayload } | { ok: false; error: WizardError } {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = str(v.name);
  if (!name)
    return {
      ok: false,
      error: { step: "general", message: "Le nom de la campagne est obligatoire." },
    };
  if (name.length > 120)
    return {
      ok: false,
      error: { step: "general", message: "Le nom ne peut pas dépasser 120 caractères." },
    };
  const verticalRaw = str(v.vertical);
  const vertical = isVertical(verticalRaw) ? verticalRaw : null;
  const startAt = str(v.startAt) || null;
  const endAt = str(v.endAt) || null;
  if (startAt && !DAY.test(startAt))
    return { ok: false, error: { step: "general", message: "La date de début n'est pas valide." } };
  if (endAt && !DAY.test(endAt))
    return { ok: false, error: { step: "general", message: "La date de fin n'est pas valide." } };
  if (startAt && endAt && endAt < startAt)
    return {
      ok: false,
      error: { step: "general", message: "La date de fin doit être après la date de début." },
    };
  let budgetDaily: number | null = null;
  const budgetRaw = v.budgetDaily;
  if (budgetRaw !== null && budgetRaw !== undefined && String(budgetRaw).trim() !== "") {
    const n = Number(String(budgetRaw).replace(",", "."));
    if (!Number.isFinite(n) || n < 0)
      return {
        ok: false,
        error: {
          step: "general",
          message: "Le budget par jour doit être un nombre positif (ex. 50).",
        },
      };
    budgetDaily = n;
  }
  const affiliateCampaignIds = list(v.affiliateCampaignIds);
  const channelIds = list(v.channelIds);
  const adCountRaw =
    v.adCount === undefined || v.adCount === null || v.adCount === "" ? 0 : Number(v.adCount);
  if (!Number.isInteger(adCountRaw) || adCountRaw < 0 || adCountRaw > MAX_ADS)
    return {
      ok: false,
      error: { step: "ads", message: `Le nombre de pubs doit être compris entre 0 et ${MAX_ADS}.` },
    };
  const platformRaw = str(v.adPlatform);
  const adPlatform = (AD_PLATFORMS as readonly string[]).includes(platformRaw)
    ? (platformRaw as WizardAdPlatform)
    : null;
  if (adCountRaw > 0 && !adPlatform)
    return {
      ok: false,
      error: { step: "ads", message: "Choisissez la plateforme des pubs (TikTok, Meta ou autre)." },
    };
  if (adCountRaw > 0 && channelIds.length === 0)
    return {
      ok: false,
      error: {
        step: "channels",
        message:
          "Cochez au moins un canal : chaque pub reçoit un lien d'invitation vers le canal d'entrée choisi à l'étape 4.",
      },
    };
  let entryChannelId: string | null = null;
  if (adCountRaw > 0) {
    const asked = v.entryChannelId === undefined ? undefined : str(v.entryChannelId);
    entryChannelId =
      asked === undefined && channelIds.length === 1 ? channelIds[0]! : asked || null;
    if (!entryChannelId)
      return {
        ok: false,
        error: {
          step: "ads",
          message:
            "Choisissez le canal d'entrée des pubs : celui que les liens des pubs font rejoindre.",
        },
      };
    if (!channelIds.includes(entryChannelId))
      return {
        ok: false,
        error: {
          step: "ads",
          message: "Le canal d'entrée des pubs doit être un des canaux cochés à l'étape 3.",
        },
      };
  }
  const connectionId = str(v.connectionId) || null;
  const importedCampaignId = connectionId ? str(v.importedCampaignId) || null : null;
  const notes = str(v.notes) || null;
  if (notes && notes.length > 2000)
    return {
      ok: false,
      error: { step: "general", message: "Les notes ne peuvent pas dépasser 2000 caractères." },
    };
  const requestIdRaw = str(v.requestId);
  const requestId = REQUEST_ID.test(requestIdRaw) ? requestIdRaw.toLowerCase() : null;
  return {
    ok: true,
    data: {
      name,
      vertical,
      startAt,
      endAt,
      budgetDaily,
      affiliateCampaignIds,
      channelIds,
      entryChannelId,
      adPlatform,
      connectionId,
      importedCampaignId,
      adCount: adCountRaw,
      notes,
      requestId,
    },
  };
}

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vrai pour un jeton d'idempotence bien formé (UUID). */
export function isRequestId(v: unknown): v is string {
  return typeof v === "string" && REQUEST_ID.test(v);
}

/** Nombre de pubs réellement demandé : 0 tant qu'aucune plateforme n'est choisie (« aucune pub pour l'instant »). */
export function effectiveAdCount(adPlatform: string | null | undefined, adCount: number): number {
  return adPlatform ? Math.max(0, Math.min(MAX_ADS, Math.floor(adCount) || 0)) : 0;
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

export type OfferCandidate = {
  id: string;
  name: string;
  programName: string;
  campaignKey: string | null;
  externalId: string;
  trackingUrlTemplate: string;
  vertical?: string | null;
};

/**
 * Retrouve la campagne Link Affi synchronisée qui porte exactement cette clé : clé, identifiant externe, ou clé entière
 * dans l'URL d'offre (`/go/<clé>` suivi de la fin, de « / », « ? » ou « # »). Une clé tronquée (« 47eb ») ne
 * correspond jamais à « 47eb8mwc ».
 */
export function findOfferByKey<T extends OfferCandidate>(key: string, candidates: T[]): T | null {
  const k = key.trim().toLowerCase();
  if (!k) return null;
  const inUrl = new RegExp(`/go/${escapeRegExp(k)}(?:[/?#]|$)`, "i");
  return (
    candidates.find((c) => c.campaignKey?.toLowerCase() === k) ??
    candidates.find((c) => c.externalId.toLowerCase() === k) ??
    candidates.find((c) => inUrl.test(c.trackingUrlTemplate)) ??
    null
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Affilié Link Affi d'une campagne synchronisée (`raw.affiliate_id`), null si inconnu. */
export function affiliateIdOf(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).affiliate_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Marque les offres « à nous » : celles qui portent déjà nos clics (`ourOfferIds`), et toutes celles du même affilié
 * (`ourAffiliateIds`, déduits de ces offres).
 */
export function markOurOffers<T extends { id: string; affiliateId: string | null }>(
  offers: T[],
  ourOfferIds: ReadonlySet<string>,
  ourAffiliateIds: ReadonlySet<string>,
): Array<T & { ours: boolean }> {
  return offers.map((o) => ({
    ...o,
    ours: ourOfferIds.has(o.id) || (!!o.affiliateId && ourAffiliateIds.has(o.affiliateId)),
  }));
}

/** Affilié d'une offre, en clair : « à vous », « autre affilié (1a2b3c4d) » ou « affilié inconnu ». */
export function offerAffiliateLabel(o: { ours: boolean; affiliateId: string | null }): string {
  if (o.ours) return "à vous";
  return o.affiliateId ? `autre affilié (${o.affiliateId.slice(0, 8)})` : "affilié inconnu";
}

/**
 * Offres proposées : par défaut seulement les nôtres ; toutes si l'utilisateur coche « afficher les autres
 * affiliés », ou tant qu'aucune offre n'est encore reconnue comme nôtre (aucun clic avec sub-ID pour l'instant).
 */
export function visibleOffers<T extends { ours: boolean }>(offers: T[], showOthers: boolean): T[] {
  if (showOthers || !offers.some((o) => o.ours)) return offers;
  return offers.filter((o) => o.ours);
}

export const UNKNOWN_KEY_MESSAGE =
  "Cette clé n'est pas encore synchronisée : vérifiez-la ou attendez 2 minutes (la synchronisation Link Affi tourne toutes les 2 minutes).";

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
