import { landingSlugCandidate, slugifyLanding } from "@linkaffipro/core";
import { prisma, type Vertical } from "@linkaffipro/db";
import { resolvePeriod, type Period } from "@/lib/periods";
import { missingLandingException } from "./form";
import { loadLandingSourceLinks, type LandingSourceLinkView } from "./links";
import { loadLandingTables, type LandingPageTable } from "./stats";

/**
 * Lectures en base de la rubrique « Pages » (phase 15) : liste des pages avec leurs chiffres des 7 derniers jours,
 * fiche d'une page (formulaire, liens des sources), choix du canal et de la pub reliée, noms des pages pour les
 * exceptions de règles et la provenance (« la page « Promo » »).
 */

/** Un canal proposé pour une page (vrai titre Telegram, jamais saisi). */
export type LandingChannelChoice = {
  id: string;
  title: string;
  vertical: Vertical | null;
  isTest: boolean;
  /** Une petite photo du canal est connue (affichée dans l'aperçu si la page la montre). */
  hasPhoto: boolean;
};

/** Canaux proposés : nos canaux actifs (hors bibliothèque de médias), par titre ; `keepId` reste proposé. */
export async function loadLandingChannelChoices(
  keepId?: string | null,
): Promise<LandingChannelChoice[]> {
  const rows = await prisma.channel.findMany({
    where: {
      OR: [{ isActive: true, isMediaLibrary: false }, ...(keepId ? [{ id: keepId }] : [])],
    },
    select: { id: true, title: true, vertical: true, isTest: true, photoFileUniqueId: true },
  });
  return rows
    .map((c) => ({
      id: c.id,
      title: c.title,
      vertical: c.vertical,
      isTest: c.isTest,
      hasPhoto: !!c.photoFileUniqueId,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

/** Une pub de nos campagnes, pour « Relier à une pub » (facultatif). */
export type LandingAdChoice = {
  id: string;
  label: string;
  /** Sources actives des pages déjà reliées à cette pub (« déjà reliée »). */
  usedBy: Array<{ pageId: string; pageName: string; key: string }>;
};
export type LandingAdGroup = {
  campaignId: string;
  label: string;
  /** Canaux et univers de la campagne : ses pubs sont proposées d'abord pour une page de ce canal (`orderAdGroups`). */
  channelIds: string[];
  vertical: Vertical | null;
  ads: LandingAdChoice[];
};

/**
 * Pubs de nos campagnes, groupées par campagne (campagnes en cours d'abord, puis par nom) ; le nom du groupe de pubs
 * est ajouté quand une campagne en a plusieurs. Le formulaire met d'abord les campagnes du canal de la page.
 */
export async function loadLandingAdChoices(): Promise<LandingAdGroup[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { adSets: { some: { ads: { some: {} } } } },
    select: {
      id: true,
      name: true,
      status: true,
      vertical: true,
      channelIds: true,
      adSets: {
        orderBy: { name: "asc" },
        select: {
          name: true,
          ads: {
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              landingSources: {
                where: { isActive: true },
                select: { key: true, landingPage: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
  const rank = (s: string) => (s === "ACTIVE" ? 0 : s === "DRAFT" || s === "PAUSED" ? 1 : 2);
  return campaigns
    .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, "fr"))
    .map((c) => {
      const several = c.adSets.filter((s) => s.ads.length > 0).length > 1;
      return {
        campaignId: c.id,
        label: c.name,
        channelIds: Array.isArray(c.channelIds)
          ? c.channelIds.filter((x): x is string => typeof x === "string")
          : [],
        vertical: c.vertical,
        ads: c.adSets.flatMap((s) =>
          s.ads.map((a) => ({
            id: a.id,
            label: several ? `${s.name} · ${a.name}` : a.name,
            usedBy: a.landingSources.map((u) => ({
              pageId: u.landingPage.id,
              pageName: u.landingPage.name,
              key: u.key,
            })),
          })),
        ),
      };
    });
}

/**
 * Canaux (parmi `channelIds`) qui ont une exception « pub » active sans exception pour les pages
 * (`missingLandingException`) : une personne venue de la page n'y aurait pas la règle de la pub.
 */
export async function channelsMissingLandingException(
  channelIds: readonly string[],
  pageId: string | null,
): Promise<string[]> {
  const ids = [...new Set(channelIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rules = await prisma.approvalRule.findMany({
    where: { channelId: { in: ids }, scope: "SOURCE_KIND", isActive: true },
    select: { channelId: true, scope: true, sourceKind: true, landingPageId: true, isActive: true },
  });
  return ids.filter((id) =>
    missingLandingException(
      rules.filter((r) => r.channelId === id),
      pageId,
    ),
  );
}

/** Toutes les pubs connues (contrôle de l'action serveur). */
export async function existingAdIds(ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await prisma.ad.findMany({ where: { id: { in: unique } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Première adresse libre à partir d'une base (« promo », « promo-2 »…), hors la page `excludeId`. */
export async function freeLandingSlug(base: string, excludeId?: string | null): Promise<string> {
  const root = slugifyLanding(base);
  for (let attempt = 1; attempt < 200; attempt++) {
    const slug = landingSlugCandidate(root, attempt);
    const taken = await prisma.landingPage.findFirst({
      where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (!taken) return slug;
  }
  return landingSlugCandidate(root, Date.now() % 100_000);
}

/** L'adresse est-elle déjà celle d'une autre page ? */
export async function slugTaken(slug: string, excludeId?: string | null): Promise<boolean> {
  const row = await prisma.landingPage.findFirst({
    where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  return !!row;
}

/** Noms des autres pages (nom proposé sans doublon). */
export async function otherPageNames(excludeId?: string | null): Promise<string[]> {
  const rows = await prisma.landingPage.findMany({
    where: excludeId ? { NOT: { id: excludeId } } : {},
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/** Une ligne de la liste des pages. */
export type LandingListRow = {
  id: string;
  name: string;
  slug: string;
  headline: string;
  isActive: boolean;
  channel: { id: string; title: string; vertical: Vertical | null };
  /** Le lien principal est prêt (la page s'affiche) ; sinon le premier refus de Telegram, s'il y en a un. */
  linkReady: boolean;
  linkError: string | null;
  /** Sources actives (lien principal compris). */
  sourceCount: number;
  table: LandingPageTable | null;
};

/** Période de la liste : les 7 derniers jours (jours de Paris). */
export function listPeriod(now: Date = new Date()): Period {
  return resolvePeriod({ range: "7d" }, now);
}

/** Liste des pages (les plus récemment modifiées d'abord) avec leurs chiffres des 7 derniers jours. */
export async function loadLandingList(now: Date = new Date()): Promise<{
  rows: LandingListRow[];
  period: Period;
}> {
  const period = listPeriod(now);
  const pages = await prisma.landingPage.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      headline: true,
      isActive: true,
      channel: { select: { id: true, title: true, vertical: true } },
      sources: {
        where: { isActive: true },
        select: {
          key: true,
          linkError: true,
          inviteLink: { select: { isActive: true } },
        },
      },
    },
  });
  const tables = await loadLandingTables(
    pages.map((p) => p.id),
    period,
  );
  return {
    period,
    rows: pages.map((p) => {
      const main = p.sources.find((s) => s.key === "");
      const ready = p.sources.some((s) => s.inviteLink?.isActive === true);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        headline: p.headline,
        isActive: p.isActive,
        channel: p.channel,
        linkReady: main?.inviteLink?.isActive === true || (!main && ready),
        linkError: p.sources.find((s) => s.linkError)?.linkError ?? null,
        sourceCount: p.sources.length,
        table: tables.get(p.id) ?? null,
      };
    }),
  };
}

/** Une page complète pour sa fiche (formulaire et liens des sources). */
export type LandingPageDetail = {
  id: string;
  slug: string;
  name: string;
  channelId: string;
  language: string;
  headline: string;
  subtext: string | null;
  buttonText: string | null;
  footnote: string | null;
  showPhoto: boolean;
  cookieBanner: boolean;
  tiktokPixelId: string | null;
  metaPixelId: string | null;
  isActive: boolean;
  version: number;
  updatedAt: Date;
  channel: {
    id: string;
    title: string;
    vertical: Vertical | null;
    isActive: boolean;
    hasPhoto: boolean;
  };
  sources: Array<{ id: string; key: string; adId: string | null; isActive: boolean }>;
  links: LandingSourceLinkView[];
};

/** Fiche d'une page, ou null si elle n'existe pas (ou plus). */
export async function loadLandingPage(id: string): Promise<LandingPageDetail | null> {
  const page = await prisma.landingPage.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      channelId: true,
      language: true,
      headline: true,
      subtext: true,
      buttonText: true,
      footnote: true,
      showPhoto: true,
      cookieBanner: true,
      tiktokPixelId: true,
      metaPixelId: true,
      isActive: true,
      version: true,
      updatedAt: true,
      channel: {
        select: {
          id: true,
          title: true,
          vertical: true,
          isActive: true,
          photoFileUniqueId: true,
        },
      },
      sources: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, key: true, adId: true, isActive: true },
      },
    },
  });
  if (!page) return null;
  const { photoFileUniqueId, ...channel } = page.channel;
  return {
    ...page,
    channel: { ...channel, hasPhoto: !!photoFileUniqueId },
    links: await loadLandingSourceLinks(page.id),
  };
}

/** Noms des pages par identifiant (pages supprimées absentes : « page supprimée » à l'affichage). */
export async function landingPageNames(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const rows = await prisma.landingPage.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** Une page d'atterrissage proposée dans les exceptions de règles d'un canal. */
export type ChannelLandingPage = { id: string; name: string; isActive: boolean };

/**
 * Pages d'atterrissage d'un canal (exceptions « la page <nom> », simulateur), et celles que visent déjà des exceptions
 * (`extraIds`, même si elles sont sur un autre canal ou en pause), par nom.
 */
export async function loadChannelLandingPages(
  channelId: string,
  extraIds: readonly string[] = [],
): Promise<ChannelLandingPage[]> {
  const extra = [...new Set(extraIds.filter(Boolean))];
  const rows = await prisma.landingPage.findMany({
    where: { OR: [{ channelId }, ...(extra.length ? [{ id: { in: extra } }] : [])] },
    select: { id: true, name: true, isActive: true },
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
