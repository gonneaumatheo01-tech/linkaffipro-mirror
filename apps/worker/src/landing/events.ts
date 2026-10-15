import { isLandingEventKind, isValidLandingSlug } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import type { LandingEventData } from "@linkaffipro/queue";
import { logger } from "../logger";

/**
 * Écriture des visites, clics et ouvertures de Telegram des pages d'atterrissage (file `landing-events`, phase 15) :
 * une ligne `LandingEvent` par envoi, append-only, avec l'identifiant fixé par le site (une reprise de la tâche
 * n'écrit jamais deux fois : `createMany` + `skipDuplicates`). Page retrouvée par son identifiant (ou son adresse),
 * source reconnue parmi celles de la page, sinon source par défaut "" et valeur reçue gardée dans `rawSrc`.
 * Jamais d'adresse IP : seulement l'empreinte et le pays calculés par le site.
 */

export type WriteLandingEventResult =
  | { ok: true; written: boolean; landingPageId: string; sourceKey: string }
  | { ok: false; reason: "unknown-page" | "invalid" };

type PageInfo = { id: string; keys: Set<string>; readAt: number; until: number };

/** Page et clés de ses sources, gardées 60 s (une source inconnue relit la page tout de suite). */
const pages = new Map<string, PageInfo | { id: null; until: number }>();
const PAGE_TTL_MS = 60_000;

async function readPage(ref: string): Promise<PageInfo | null> {
  const select = { id: true, sources: { select: { key: true } } } as const;
  let row = /^[A-Za-z0-9_-]{1,64}$/.test(ref)
    ? await prisma.landingPage.findUnique({ where: { id: ref }, select })
    : null;
  if (!row && isValidLandingSlug(ref)) {
    row = await prisma.landingPage.findUnique({ where: { slug: ref }, select });
  }
  if (!row) return null;
  const now = Date.now();
  return {
    id: row.id,
    keys: new Set(row.sources.map((s) => s.key)),
    readAt: now,
    until: now + PAGE_TTL_MS,
  };
}

async function pageFor(ref: string, sourceKey: string): Promise<PageInfo | null> {
  const memo = pages.get(ref);
  const fresh = memo && memo.until > Date.now();
  if (fresh && memo.id === null) return null;
  // Source absente de la mémoire : la page est relue (source ajoutée il y a moins d'une minute), au plus toutes les 5 s.
  if (
    fresh &&
    memo.id !== null &&
    (sourceKey === "" || memo.keys.has(sourceKey) || Date.now() - memo.readAt < 5000)
  )
    return memo;
  const info = await readPage(ref);
  if (pages.size >= 5000) pages.clear();
  pages.set(ref, info ?? { id: null, until: Date.now() + PAGE_TTL_MS / 2 });
  return info;
}

/** Vide la mémoire des pages (tests). */
export function resetLandingPageMemo(): void {
  pages.clear();
}

/** Clé étrangère absente (Prisma P2003) : la page vient d'être supprimée (ses envois partent avec elle). */
function isMissingPageError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2003";
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Heure de réception par le site ; illisible ou dans le futur (plus de 5 min) : maintenant. */
function receivedAt(iso: unknown, now: Date): Date {
  const d = typeof iso === "string" ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime()) || d.getTime() > now.getTime() + 5 * 60_000) return now;
  return d;
}

/** Écrit une visite, un clic ou une ouverture (une seule écriture par envoi). */
export async function writeLandingEvent(
  event: LandingEventData,
  now: Date = new Date(),
): Promise<WriteLandingEventResult> {
  const id = text(event?.id, 64);
  const visitId = text(event?.visitId, 64);
  const ref = text(event?.landingPageId, 64);
  if (!id || !visitId || !ref || !isLandingEventKind(event.type)) {
    logger.warn({ id: event?.id }, "[landing-events] envoi incomplet ignoré");
    return { ok: false, reason: "invalid" };
  }
  const wanted = typeof event.sourceKey === "string" ? event.sourceKey.trim().toLowerCase() : "";
  const page = await pageFor(ref, wanted);
  if (!page) {
    logger.warn({ landingPageId: ref }, "[landing-events] page inconnue : envoi ignoré");
    return { ok: false, reason: "unknown-page" };
  }
  const known = wanted === "" || page.keys.has(wanted);
  const sourceKey = known ? wanted : "";
  const rawSrc = text(event.rawSrc, 64) ?? (known ? null : text(event.sourceKey, 64));
  const country =
    typeof event.country === "string" && /^[A-Z]{2}$/.test(event.country) ? event.country : null;
  let res: { count: number };
  try {
    res = await prisma.landingEvent.createMany({
      data: [
        {
          id,
          landingPageId: page.id,
          sourceKey,
          rawSrc,
          type: event.type,
          visitId,
          os: text(event.os, 16),
          inApp: text(event.inApp, 16),
          method: text(event.method, 32),
          country,
          ipHash: text(event.ipHash, 128),
          isBot: event.isBot === true,
          ttclid: text(event.ttclid, 512),
          fbclid: text(event.fbclid, 512),
          userAgent: text(event.userAgent, 512),
          createdAt: receivedAt(event.createdAt, now),
        },
      ],
      skipDuplicates: true,
    });
  } catch (err) {
    // Page supprimée par un ADMIN alors que des visiteurs l'avaient encore à l'écran (mémoire de 60 s ici, HTML
    // gardé une minute par le navigateur) : l'envoi est ignoré comme une page inconnue, sans échec ni nouvel essai.
    if (!isMissingPageError(err)) throw err;
    pages.delete(ref);
    pages.delete(page.id);
    logger.warn({ landingPageId: page.id }, "[landing-events] page supprimée : envoi ignoré");
    return { ok: false, reason: "unknown-page" };
  }
  return { ok: true, written: res.count === 1, landingPageId: page.id, sourceKey };
}
