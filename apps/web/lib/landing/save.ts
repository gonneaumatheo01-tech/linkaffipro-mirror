import { audit, prisma } from "@linkaffipro/db";
import { publishLandingInvalidate } from "@linkaffipro/queue";
import { syncLandingAdLinksWithDb } from "@linkaffipro/telegram";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import {
  pageContentChanged,
  planSourceChanges,
  validateLandingForm,
  type CleanLandingPage,
  type LandingFormErrors,
} from "./form";
import { revokeLandingSourceLinks, syncLandingPageLinks } from "./links";
import { existingAdIds, freeLandingSlug, otherPageNames, slugTaken } from "./queries";

/**
 * Enregistrement et suppression d'une page d'atterrissage (rubrique « Pages », phase 15) : appelés par les actions
 * serveur (`app/(admin)/pages/actions.ts`) et par les tests d'intégration. Tout est relu et validé ici (le navigateur
 * n'envoie qu'un brouillon) :
 * 1. validation (`validateLandingForm`), canal d'une page existante jamais changé (ses liens Telegram y sont créés),
 *    adresse libre (proposée d'après le nom si elle est vide) ;
 * 2. page et sources écrites en une transaction (version + 1 si un texte ou un réglage affiché change ; source
 *    retirée : jamais supprimée, ses chiffres restent ; remise en service sous le même nom) ;
 * 3. journal de l'équipe (`landing.page_created` / `landing.page_updated` / `landing.page_deleted`) ;
 * 4. HTML en mémoire invalidé (`landing:invalidate`, publication qui ne lève jamais) ;
 * 5. liens Telegram des sources (`syncLandingPageLinks` du moteur : liens des sources retirées révoqués, liens
 *    manquants créés par le bot de l'univers du canal, pub reliée → recalcul complet des statistiques, titre et photo
 *    relus si besoin). Un refus de Telegram ne bloque pas l'enregistrement : il est gardé sur la source, le worker
 *    réessaie tout seul.
 */

export type SaveLandingResult =
  | { ok: true; pageId: string; created: boolean; message: string; dryRun?: boolean }
  | { ok: false; error: string; errors?: LandingFormErrors };

/** Message de retour après l'enregistrement : « Page enregistrée. 3 liens Telegram créés. » */
export function savedMessage(created: boolean, linksMessage: string | null): string {
  return [created ? "Page créée." : "Page enregistrée.", linksMessage].filter(Boolean).join(" ");
}

function auditPage(v: CleanLandingPage & { slug: string }) {
  return {
    slug: v.slug,
    name: v.name,
    channelId: v.channelId,
    language: v.language,
    isActive: v.isActive,
    showPhoto: v.showPhoto,
    cookieBanner: v.cookieBanner,
    tiktokPixel: !!v.tiktokPixelId,
    metaPixel: !!v.metaPixelId,
    sources: v.sources.map((s) => s.key),
  };
}

/**
 * Options des cœurs partagés avec Kevin (phase 34) : `via` part dans le journal ; `dryRun` valide tout et rend le
 * résumé sans rien écrire (ni page, ni lien Telegram).
 */
export type LandingOpOptions = { via?: "WEB" | "TELEGRAM"; dryRun?: boolean };

function viaOf(opts: LandingOpOptions): { via?: "WEB" | "TELEGRAM" } {
  return opts.via ? { via: opts.via } : {};
}

/** Crée ou modifie une page depuis le brouillon du formulaire (voir l'en-tête). */
export async function saveLandingPage(
  raw: unknown,
  userId: string | null,
  opts: LandingOpOptions = {},
): Promise<SaveLandingResult> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pageId = typeof r.pageId === "string" && r.pageId ? r.pageId : null;
  const existing = pageId
    ? await prisma.landingPage.findUnique({
        where: { id: pageId },
        include: { sources: { select: { id: true, key: true, adId: true, isActive: true } } },
      })
    : null;
  if (pageId && !existing)
    return { ok: false, error: "Cette page n'existe plus : revenez à la liste des pages." };

  // Le canal d'une page existante ne change jamais : ses liens d'invitation appartiennent à ce canal.
  const channelId = existing
    ? existing.channelId
    : typeof r.channelId === "string"
      ? r.channelId
      : "";
  const channel = channelId
    ? await prisma.channel.findUnique({
        where: { id: channelId },
        select: { id: true, title: true, isActive: true, isMediaLibrary: true },
      })
    : null;
  const channelOk = !!channel && (!!existing || (channel.isActive && !channel.isMediaLibrary));
  const sourceAdIds = Array.isArray(r.sources)
    ? r.sources
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).adId : null))
        .filter((id): id is string => typeof id === "string" && !!id)
    : [];
  const v = validateLandingForm(
    { ...r, channelId },
    {
      channelIds: new Set(channelOk ? [channelId] : []),
      adIds: await existingAdIds(sourceAdIds),
      channelTitle: channel?.title ?? "",
      // Nom vidé : une page existante garde le sien ; une nouvelle prend le nom proposé (sans doublon).
      existingName: existing?.name ?? null,
      takenNames: existing ? [] : await otherPageNames(null),
    },
  );
  if (!v.ok) return { ok: false, error: v.message, errors: v.errors };
  const value = v.value;

  let slug: string;
  if (value.slug) {
    if (await slugTaken(value.slug, existing?.id))
      return {
        ok: false,
        error: "Cette adresse est déjà celle d'une autre page : choisissez-en une autre.",
        errors: {
          slug: "Cette adresse est déjà celle d'une autre page : choisissez-en une autre.",
        },
      };
    slug = value.slug;
  } else slug = existing ? existing.slug : await freeLandingSlug(value.name, null);

  if (opts.dryRun)
    return {
      ok: true,
      dryRun: true,
      pageId: existing?.id ?? "",
      created: !existing,
      message: `${existing ? "Page modifiée" : "Nouvelle page"} « ${value.name} » (/j/${slug}) sur « ${channel?.title ?? "ce canal"} » : « ${value.headline} »${value.buttonText ? `, bouton « ${value.buttonText} »` : ""}, ${value.sources.length} source${value.sources.length > 1 ? "s" : ""}${value.isActive ? "" : ", en pause"}.`,
    };

  const fields = {
    name: value.name,
    slug,
    language: value.language,
    headline: value.headline,
    subtext: value.subtext,
    buttonText: value.buttonText,
    footnote: value.footnote,
    showPhoto: value.showPhoto,
    cookieBanner: value.cookieBanner,
    tiktokPixelId: value.tiktokPixelId,
    metaPixelId: value.metaPixelId,
    isActive: value.isActive,
  };

  let id: string;
  let plan: ReturnType<typeof planSourceChanges> | null = null;
  try {
    if (!existing) {
      const page = await prisma.landingPage.create({
        data: {
          ...fields,
          channelId,
          createdById: userId,
          sources: { create: value.sources.map((s) => ({ key: s.key, adId: s.adId })) },
        },
        select: { id: true },
      });
      id = page.id;
    } else {
      id = existing.id;
      plan = planSourceChanges(existing.sources, value.sources);
      const changed = pageContentChanged(existing, { ...value, slug });
      const p = plan;
      await prisma.$transaction(async (tx) => {
        await tx.landingPage.update({
          where: { id: existing.id },
          data: { ...fields, ...(changed ? { version: { increment: 1 } } : {}) },
        });
        for (const s of p.create)
          await tx.landingSource.create({
            data: { landingPageId: existing.id, key: s.key, adId: s.adId },
          });
        for (const s of p.reactivate)
          await tx.landingSource.update({
            where: { id: s.id },
            data: { isActive: true, adId: s.adId, linkError: null },
          });
        for (const s of p.updateAd)
          await tx.landingSource.update({ where: { id: s.id }, data: { adId: s.adId } });
        if (p.deactivate.length)
          await tx.landingSource.updateMany({
            where: { id: { in: p.deactivate.map((s) => s.id) } },
            data: { isActive: false },
          });
      });
    }
  } catch (err) {
    // Deux enregistrements en même temps sur la même adresse : l'unicité de la base tranche.
    if ((err as { code?: string } | null)?.code === "P2002")
      return {
        ok: false,
        error: "Cette adresse est déjà celle d'une autre page : choisissez-en une autre.",
        errors: {
          slug: "Cette adresse est déjà celle d'une autre page : choisissez-en une autre.",
        },
      };
    throw err;
  }

  await audit({
    userId,
    action: existing ? "landing.page_updated" : "landing.page_created",
    entityType: "LandingPage",
    entityId: id,
    metadata: {
      ...auditPage({ ...value, slug }),
      ...(plan
        ? {
            sourcesAdded: [...plan.create, ...plan.reactivate].map((s) => s.key),
            sourcesRemoved: plan.deactivate.map((s) => s.key),
            adsChanged: plan.adsChanged,
          }
        : {}),
      ...viaOf(opts),
    },
  });
  await publishLandingInvalidate({ pageId: id });

  let linksMessage: string | null = null;
  try {
    linksMessage = (await syncLandingPageLinks(id, { userId })).message;
  } catch (err) {
    console.error("[pages] liens Telegram non synchronisés", id, err);
    linksMessage =
      "Les liens Telegram seront créés dans quelques minutes (nouvel essai automatique).";
  }
  return {
    ok: true,
    pageId: id,
    created: !existing,
    message: savedMessage(!existing, linksMessage),
  };
}

/** « Réessayer » : crée tout de suite les liens qui manquent encore (refus précédent de Telegram). */
export async function retryLandingLinks(
  pageId: string,
  userId: string | null,
  opts: LandingOpOptions = {},
): Promise<{ ok: boolean; message: string }> {
  if (opts.dryRun) {
    const page = await prisma.landingPage.findUnique({ where: { id: pageId }, select: { name: true } });
    return page
      ? { ok: true, message: `Nouvel essai des liens Telegram de la page « ${page.name} ».` }
      : { ok: false, message: "Cette page n'existe plus." };
  }
  const r = await syncLandingPageLinks(pageId, { userId });
  if (!r.found) return { ok: false, message: "Cette page n'existe plus." };
  const waiting = r.sources.filter((s) => s.status === "error" || s.status === "pending");
  if (waiting.length === 0)
    return { ok: true, message: r.message ?? "Tous les liens Telegram sont prêts." };
  return {
    ok: false,
    message:
      r.message ??
      "Des liens Telegram attendent encore : nouvel essai automatique dans quelques minutes.",
  };
}

/**
 * Supprime une page (administrateurs : contrôlé par l'action) : liens de ses sources révoqués chez Telegram AVANT la
 * suppression (le worker reprend ceux que Telegram n'a pas pu révoquer), page supprimée avec ses sources et ses
 * visites, journal de l'équipe, HTML en mémoire invalidé (la page n'est plus servie), statistiques des pubs reliées
 * recalculées si besoin. Les demandes déjà arrivées par ses liens restent (provenance « page supprimée »).
 */
export async function deleteLandingPage(
  pageId: string,
  userId: string | null,
  opts: LandingOpOptions = {},
): Promise<{ ok: boolean; message: string; impact?: string }> {
  const page = await prisma.landingPage.findUnique({
    where: { id: pageId },
    select: { id: true, name: true, slug: true, channelId: true },
  });
  if (!page) return { ok: false, message: "Cette page n'existe plus." };
  if (opts.dryRun) {
    const [sources, visits] = await Promise.all([
      prisma.landingSource.count({ where: { landingPageId: pageId, isActive: true } }),
      prisma.landingEvent.count({ where: { landingPageId: pageId } }),
    ]);
    return {
      ok: true,
      message: `Supprimer la page « ${page.name} » (/j/${page.slug}).`,
      impact: `${sources} lien${sources > 1 ? "s" : ""} Telegram révoqué${sources > 1 ? "s" : ""}, ${visits} visite${visits > 1 ? "s" : ""} effacée${visits > 1 ? "s" : ""} ; les demandes déjà arrivées restent.`,
    };
  }
  const revoked = await revokeLandingSourceLinks({ pageId, userId }).catch((err: unknown) => {
    console.error("[pages] liens non révoqués avant la suppression", pageId, err);
    return null;
  });
  await prisma.landingPage.delete({ where: { id: pageId } });
  await audit({
    userId,
    action: "landing.page_deleted",
    entityType: "LandingPage",
    entityId: pageId,
    metadata: { name: page.name, slug: page.slug, channelId: page.channelId, revoked, ...viaOf(opts) },
  });
  await publishLandingInvalidate({ pageId });
  try {
    const ads = await syncLandingAdLinksWithDb();
    if (ads.recomputeNeeded) await refreshCampaignStats();
  } catch (err) {
    console.error("[pages] recalcul des statistiques non demandé", pageId, err);
  }
  return { ok: true, message: `Page « ${page.name} » supprimée : ses liens ne fonctionnent plus.` };
}
