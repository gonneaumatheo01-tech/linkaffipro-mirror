import { prisma } from "@linkaffipro/db";
import {
  TELEGRAM_CAMPAIGNS_SETTING_KEY,
  TELEGRAM_FIGURE_FIELDS,
  TELEGRAM_SYNC_INTERVAL_MS,
  parseTelegramCampaignsState,
  type TelegramCampaignEntry,
  type TelegramFigureField,
} from "@linkaffipro/linkaffi";

/**
 * Lecture prudente, pour le site, du `Setting` « linkaffi.telegramCampaigns » écrit toutes les 10 minutes par la synchro
 * Link Affi du service d'arrière-plan (phase 13, D6 ; forme et règles dans packages/linkaffi/src/sync/telegram.ts) :
 * - chiffres de Link Affi par campagne Telegram d'affilié (`null` = inconnu, affiché « — ») : clics pour la vue
 *   interne des affiliés ;
 * - écarts entre nos chiffres et les siens, pour Réglages → Connexions.
 * Une valeur absente ou d'une forme inattendue donne un état « pas encore comparé », jamais une erreur.
 */

/** Mot du client de chaque chiffre comparé (docs/REFONTE-UX.md, « Vocabulaire »). */
export const TELEGRAM_FIGURE_LABELS: Record<TelegramFigureField | "clicks", string> = {
  members: "Membres",
  registrations: "Inscriptions",
  ftds: "Premiers dépôts",
  clicks: "Clics",
};

/** Terme technique au survol (`Term`), quand il existe. */
export const TELEGRAM_FIGURE_TERMS: Partial<Record<TelegramFigureField, string>> = { ftds: "FTD" };

/**
 * Au-delà, la comparaison est « en retard » (le service d'arrière-plan la refait toutes les 10 minutes) : trois
 * passages manqués.
 */
export const TELEGRAM_STALE_AFTER_MS = 3 * TELEGRAM_SYNC_INTERVAL_MS + 5 * 60_000;

export type TelegramDivergenceRow = {
  id: string;
  campaignKey: string;
  /** Nom à afficher : nom de la campagne, sinon sa clé. */
  campaignLabel: string;
  affiliateName: string | null;
  /** Campagne que nous ne connaissons pas (aucun lien d'invitation chez nous). */
  unknownHere: boolean;
  field: TelegramFigureField;
  label: string;
  term: string | null;
  ours: number;
  theirs: number;
  /** Chez nous − chez Link Affi. */
  gap: number;
};

export type TelegramComparisonStatus =
  /** Jamais relu (synchro Link Affi pas encore passée, ou clés de lecture absentes). */
  | "never"
  /** Link Affi ne donne pas encore ses chiffres Telegram. */
  | "unavailable"
  /** Dernier essai en échec (les chiffres de la dernière lecture réussie restent montrés). */
  | "error"
  | "divergent"
  | "ok";

export type TelegramCampaignsView = {
  status: TelegramComparisonStatus;
  syncedAt: Date | null;
  checkedAt: Date | null;
  /** Dernier essai trop ancien : service d'arrière-plan arrêté ? */
  stale: boolean;
  error: string | null;
  available: boolean;
  campaignCount: number;
  /** Campagnes dont Link Affi donne au moins un chiffre comparable. */
  comparedCount: number;
  /** Chiffres que Link Affi ne donne pas encore (en minuscules, pour une phrase), quand il en donne d'autres. */
  missing: string[];
  divergences: TelegramDivergenceRow[];
  campaigns: Record<string, TelegramCampaignEntry>;
};

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

/**
 * Vue du `Setting` (valeur brute) à l'instant `now`. `ourCampaignKeys` : clés de nos liens d'affiliés (LINKAFFI) en
 * base, qui font foi pour « inconnue ici » ; sans elles, le repère écrit par la synchro.
 */
export function telegramCampaignsView(
  value: unknown,
  now: Date = new Date(),
  ourCampaignKeys?: ReadonlySet<string>,
): TelegramCampaignsView {
  const state = parseTelegramCampaignsState(value);
  if (!state)
    return {
      status: "never",
      syncedAt: null,
      checkedAt: null,
      stale: false,
      error: null,
      available: false,
      campaignCount: 0,
      comparedCount: 0,
      missing: [],
      divergences: [],
      campaigns: {},
    };
  const checkedAt = toDate(state.checkedAt);
  const campaigns = state.campaigns;
  const divergences: TelegramDivergenceRow[] = state.divergences.map((d, i) => {
    const c = campaigns[d.campaignKey];
    return {
      id: `${d.campaignKey}:${d.field}:${i}`,
      campaignKey: d.campaignKey,
      campaignLabel: c?.name ?? d.campaignKey,
      affiliateName: c?.affiliateName ?? null,
      unknownHere: ourCampaignKeys ? !ourCampaignKeys.has(d.campaignKey) : c ? !c.platform : true,
      field: d.field,
      label: TELEGRAM_FIGURE_LABELS[d.field],
      term: TELEGRAM_FIGURE_TERMS[d.field] ?? null,
      ours: d.ours,
      theirs: d.theirs,
      gap: d.ours - d.theirs,
    };
  });
  const s = state.sources;
  const missing: string[] = [];
  if (state.available) {
    if (!s.members) missing.push("membres");
    if (!s.registrations) missing.push("inscriptions et premiers dépôts");
    if (!s.clicks) missing.push("clics");
  }
  const comparedCount = Object.values(campaigns).filter((c) =>
    TELEGRAM_FIGURE_FIELDS.some((f) => c[f] !== null),
  ).length;
  const status: TelegramComparisonStatus = state.error
    ? "error"
    : !state.available
      ? "unavailable"
      : divergences.length > 0
        ? "divergent"
        : "ok";
  return {
    status,
    syncedAt: toDate(state.syncedAt),
    checkedAt,
    stale: checkedAt ? now.getTime() - checkedAt.getTime() > TELEGRAM_STALE_AFTER_MS : false,
    error: state.error,
    available: state.available,
    campaignCount: Object.keys(campaigns).length,
    comparedCount,
    missing,
    divergences,
    campaigns,
  };
}

/** Clés des campagnes Telegram d'affiliés dont nous avons un lien d'invitation (actif ou non). */
async function loadOurCampaignKeys(): Promise<Set<string>> {
  const links = await prisma.inviteLink.findMany({
    where: { kind: "LINKAFFI", linkaffiCampaignKey: { not: null } },
    select: { linkaffiCampaignKey: true },
    distinct: ["linkaffiCampaignKey"],
  });
  return new Set(links.map((l) => l.linkaffiCampaignKey).filter((k): k is string => !!k));
}

/**
 * Lit le `Setting` et nos liens d'affiliés, et rend la vue (jamais d'erreur : une base illisible remonte comme pour
 * toute page).
 */
export async function loadTelegramCampaignsView(
  now: Date = new Date(),
): Promise<TelegramCampaignsView> {
  const [row, ourKeys] = await Promise.all([
    prisma.setting.findUnique({
      where: { key: TELEGRAM_CAMPAIGNS_SETTING_KEY },
      select: { value: true },
    }),
    loadOurCampaignKeys(),
  ]);
  return telegramCampaignsView(row?.value, now, ourKeys);
}

/** Clics d'une campagne Telegram d'affilié comptés par Link Affi ; null = inconnu (affiché « — »). */
export function telegramCampaignClicks(
  view: Pick<TelegramCampaignsView, "campaigns">,
  campaignKey: string,
): number | null {
  return view.campaigns[campaignKey]?.clicks ?? null;
}

/**
 * Clics comptés par Link Affi, par clé de campagne Telegram (vue interne « Affiliés Link Affi ») : une clé absente de
 * la table vaut « inconnu ».
 */
export async function loadLinkaffiTelegramClicks(): Promise<Map<string, number | null>> {
  const view = await loadTelegramCampaignsView();
  return new Map(Object.entries(view.campaigns).map(([key, c]) => [key, c.clicks]));
}
