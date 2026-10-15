import { createHash } from "node:crypto";
import {
  isValidLandingSlug,
  landingPhotoPath,
  renderLandingDocument,
  resolveLandingSource,
  type LandingSourceLike,
} from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  subscribeLandingInvalidate,
  type LandingInvalidateMessage,
  type LandingInvalidateSubscription,
} from "@linkaffipro/queue";
import { etagOf, landingCsp } from "./headers";

/**
 * HTML des pages d'atterrissage gardé en mémoire par le service web (phase 15, décision D2) : AUCUNE requête à la base
 * pour afficher une page connue.
 *
 * - Au premier besoin, un seul chargement lit toutes les pages actives (avec leurs sources, leurs liens et le titre du
 *   canal) et les photos des canaux qui en affichent une ; le HTML est rendu une fois par (page, version, source).
 * - Invalidation par Redis (`landing:invalidate`, abonnement une fois par processus) : une page (`pageId`), toutes les
 *   pages d'un canal (`channelId` : titre ou photo changés) ou tout (`all`, aussi à chaque (re)connexion à Redis).
 *   La page invalidée est retirée tout de suite (relue au besoin) ; « tout » relit l'ensemble en arrière-plan. Un
 *   « tout » reçu avant le premier chargement complet (abonnement confirmé au démarrage) ne fait jamais attendre le
 *   premier visiteur : le chargement en cours est servi, puis relu en arrière-plan.
 * - Préchargement au démarrage du serveur (`instrumentation.ts` → `preloadLandingCache`) : le premier visiteur après un
 *   déploiement est servi depuis la mémoire.
 * - Filet si Redis est coupé : l'ensemble est relu en arrière-plan toutes les 5 minutes, sans faire attendre le
 *   visiteur.
 * - Adresse inconnue : une lecture en base, puis mémoire négative courte (30 s, vidée à chaque enregistrement).
 */

export type LandingSourceRecord = LandingSourceLike;

export type LandingPageRecord = {
  id: string;
  slug: string;
  version: number;
  channelId: string;
  channelTitle: string;
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
  sources: LandingSourceRecord[];
};

export type LandingPhotoRecord = { channelId: string; bytes: Uint8Array };

/** Accès aux données (base réelle par défaut, simulé dans les tests unitaires). */
export type LandingStore = {
  loadActive(): Promise<LandingPageRecord[]>;
  loadBySlug(slug: string): Promise<LandingPageRecord | null>;
  pageExists(pageId: string): Promise<boolean>;
  loadPhotos(channelIds: string[]): Promise<LandingPhotoRecord[]>;
};

/** Page prête à envoyer : corps, ETag, CSP. */
export type RenderedLanding = {
  pageId: string;
  slug: string;
  version: number;
  sourceKey: string;
  body: Buffer;
  etag: string;
  csp: string;
};

export type LandingPhoto = { bytes: Buffer; v: string; etag: string };

export type LandingLookup =
  | { kind: "page"; page: RenderedLanding }
  /** Adresse inconnue ou page désactivée. */
  | { kind: "missing" }
  /** Page connue sans lien d'invitation utilisable pour le moment, ou base injoignable (`pageId` null). */
  | { kind: "unavailable"; pageId: string | null };

type Entry = {
  page: LandingPageRecord;
  photo: LandingPhoto | null;
  rendered: Map<string, RenderedLanding>;
};

export type LandingCacheOptions = {
  store: LandingStore;
  now?: () => number;
  /** Relecture de fond de l'ensemble (filet si une invalidation est perdue), 5 min par défaut. */
  refreshMs?: number;
  /** Mémoire négative d'une adresse inconnue, 30 s par défaut. */
  negativeMs?: number;
  /** Nombre maximal d'adresses inconnues gardées (au-delà, la liste repart de zéro). */
  maxNegative?: number;
  /** Vérifications « cette page existe-t-elle ? » permises par minute (envois de visites d'une page hors mémoire). */
  maxExistenceChecksPerMinute?: number;
};

function photoOf(bytes: Uint8Array): LandingPhoto {
  const buf = Buffer.from(bytes);
  const v = createHash("sha256").update(buf).digest("base64url").slice(0, 12);
  return { bytes: buf, v, etag: `"lp-${v}"` };
}

export class LandingCache {
  private readonly store: LandingStore;
  private readonly now: () => number;
  private readonly refreshMs: number;
  private readonly negativeMs: number;
  private readonly maxNegative: number;
  private readonly maxChecks: number;

  private bySlug = new Map<string, Entry>();
  private byId = new Map<string, Entry>();
  private photos = new Map<string, LandingPhoto>();
  /** 0 : jamais chargé ; sinon heure du dernier chargement complet réussi. */
  private loadedAt = 0;
  private stale = false;
  /** « Tout » reçu pendant le premier chargement : relecture de fond dès qu'il est installé. */
  private staleAfterFirstLoad = false;
  private loading: Promise<void> | null = null;
  private generation = 0;
  private negative = new Map<string, number>();
  private slugLoads = new Map<string, Promise<Entry | null | "error">>();
  private existence = new Map<string, { exists: boolean; until: number }>();
  private checks = { windowStart: 0, count: 0 };
  /** Compteurs de diagnostic (tests, mesures). */
  readonly counters = { fullLoads: 0, slugLoads: 0, renders: 0, existenceChecks: 0 };

  constructor(opts: LandingCacheOptions) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.refreshMs = opts.refreshMs ?? 5 * 60_000;
    this.negativeMs = opts.negativeMs ?? 30_000;
    this.maxNegative = opts.maxNegative ?? 5000;
    this.maxChecks = opts.maxExistenceChecksPerMinute ?? 120;
  }

  // ─── Lecture ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Page à afficher pour une adresse et un `?src=` (source inconnue : lien par défaut, mêmes octets). */
  async lookup(slug: string, src: string | null): Promise<LandingLookup> {
    if (!isValidLandingSlug(slug)) return { kind: "missing" };
    await this.ready();
    let entry = this.bySlug.get(slug) ?? null;
    if (!entry) {
      const until = this.negative.get(slug);
      if (until !== undefined && until > this.now()) return { kind: "missing" };
      const one = await this.loadOne(slug);
      if (one === "error") return { kind: "unavailable", pageId: null };
      if (!one) return { kind: "missing" };
      entry = one;
    }
    return this.renderFor(entry, src);
  }

  /** Photo d'un canal dont une page active l'affiche (null sinon). */
  async photo(channelId: string): Promise<LandingPhoto | null> {
    await this.ready();
    return this.photos.get(channelId) ?? null;
  }

  /**
   * La page existe-t-elle (envoi d'une visite ou d'un clic) ? Page en mémoire : oui, sans requête. Sinon une lecture
   * en base, mémorisée 1 min (une page supprimée cesse vite d'être acceptée ; la mémoire est aussi vidée à chaque
   * invalidation), dans la limite de `maxExistenceChecksPerMinute` (au-delà, non : un envoi trafiqué en masse ne
   * remplit ni la base ni la file).
   */
  async knowsPage(pageId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) return false;
    await this.ready();
    if (this.byId.has(pageId)) return true;
    const now = this.now();
    const memo = this.existence.get(pageId);
    if (memo && memo.until > now) return memo.exists;
    if (now - this.checks.windowStart >= 60_000) this.checks = { windowStart: now, count: 0 };
    if (this.checks.count >= this.maxChecks) return false;
    this.checks.count++;
    this.counters.existenceChecks++;
    let exists = false;
    try {
      exists = await this.store.pageExists(pageId);
    } catch {
      return false;
    }
    if (this.existence.size >= 10_000) this.existence.clear();
    this.existence.set(pageId, { exists, until: now + 60_000 });
    return exists;
  }

  // ─── Invalidation ────────────────────────────────────────────────────────────────────────────────────────────

  /** Message `landing:invalidate` reçu (ou appel direct après un enregistrement dans ce processus). */
  invalidate(msg: LandingInvalidateMessage): void {
    this.negative.clear();
    this.existence.clear();
    if (msg.all) {
      if (this.loadedAt === 0) {
        // Rien en mémoire : le prochain chargement lira tout. Chargement en cours (démarrage : l'abonnement est
        // confirmé pendant la première lecture) : son résultat est servi tel quel, puis relu en arrière-plan ;
        // jamais de seconde lecture complète qui ferait attendre le premier visiteur.
        if (this.loading) {
          this.staleAfterFirstLoad = true;
          return;
        }
        // Pages lues une à une après un premier chargement en échec (base revenue entre-temps) : retirées.
        this.generation++;
        this.drop(() => true);
        this.photos.clear();
        return;
      }
      // Tout relire en arrière-plan ; d'ici là, le contenu actuel reste servi (quelques millisecondes).
      this.generation++;
      this.stale = true;
      void this.refresh();
      return;
    }
    this.generation++;
    if (msg.pageId) this.drop((e) => e.page.id === msg.pageId);
    if (msg.channelId) {
      this.drop((e) => e.page.channelId === msg.channelId);
      this.photos.delete(msg.channelId);
    }
  }

  /**
   * Préchargement (démarrage du serveur) : lit toutes les pages actives si rien n'est encore en mémoire. Ne lève
   * jamais ; base injoignable : rien en mémoire, le premier visiteur relancera la lecture.
   */
  async preload(): Promise<boolean> {
    if (this.loadedAt === 0) await this.refresh().catch(() => undefined);
    return this.loadedAt > 0;
  }

  /** Taille actuelle (tests et diagnostic). */
  size(): { pages: number; rendered: number; photos: number; negative: number } {
    let rendered = 0;
    for (const e of this.byId.values()) rendered += e.rendered.size;
    return {
      pages: this.byId.size,
      rendered,
      photos: this.photos.size,
      negative: this.negative.size,
    };
  }

  // ─── Interne ─────────────────────────────────────────────────────────────────────────────────────────────────

  private drop(match: (e: Entry) => boolean): void {
    for (const e of [...this.byId.values()]) {
      if (!match(e)) continue;
      this.byId.delete(e.page.id);
      if (this.bySlug.get(e.page.slug) === e) this.bySlug.delete(e.page.slug);
    }
  }

  /** Premier chargement attendu ; ensuite, relecture de fond si l'ensemble est ancien ou marqué à relire. */
  private async ready(): Promise<void> {
    if (this.loadedAt === 0) {
      await this.refresh();
      return;
    }
    if (this.stale || this.now() - this.loadedAt >= this.refreshMs) void this.refresh();
  }

  private refresh(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadAll().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async loadAll(): Promise<void> {
    // Une invalidation pendant la lecture rend le résultat douteux : on relit (3 essais), puis on garde le dernier
    // résultat en le marquant « à relire ».
    for (let attempt = 1; attempt <= 3; attempt++) {
      const gen = this.generation;
      let records: LandingPageRecord[];
      let photoRecords: LandingPhotoRecord[];
      try {
        this.counters.fullLoads++;
        records = await this.store.loadActive();
        const withPhoto = [...new Set(records.filter((r) => r.showPhoto).map((r) => r.channelId))];
        photoRecords = withPhoto.length ? await this.store.loadPhotos(withPhoto) : [];
      } catch (err) {
        console.error("[landing] pages non chargées", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Rien en mémoire : on réessaiera à la prochaine visite ; sinon on garde l'existant.
        return;
      }
      if (gen !== this.generation && attempt < 3) continue;
      this.install(records, photoRecords);
      const first = this.loadedAt === 0;
      this.loadedAt = this.now();
      this.stale = gen !== this.generation || (first && this.staleAfterFirstLoad);
      this.staleAfterFirstLoad = false;
      return;
    }
  }

  private install(records: LandingPageRecord[], photoRecords: LandingPhotoRecord[]): void {
    const photos = new Map<string, LandingPhoto>();
    for (const p of photoRecords) if (p.bytes?.length) photos.set(p.channelId, photoOf(p.bytes));
    const bySlug = new Map<string, Entry>();
    const byId = new Map<string, Entry>();
    for (const page of records) {
      if (!page.isActive) continue;
      // Une page dont rien n'a changé garde son HTML déjà rendu.
      const prev = this.byId.get(page.id);
      const photo = page.showPhoto ? (photos.get(page.channelId) ?? null) : null;
      const same =
        prev &&
        prev.page.version === page.version &&
        prev.page.channelTitle === page.channelTitle &&
        prev.photo?.v === photo?.v &&
        JSON.stringify(prev.page.sources) === JSON.stringify(page.sources);
      const entry: Entry = same ? { ...prev, page } : { page, photo, rendered: new Map() };
      bySlug.set(page.slug, entry);
      byId.set(page.id, entry);
    }
    this.bySlug = bySlug;
    this.byId = byId;
    this.photos = photos;
  }

  /** Une adresse absente de la mémoire : une lecture (partagée entre visites simultanées), puis mémoire. */
  private loadOne(slug: string): Promise<Entry | null | "error"> {
    let p = this.slugLoads.get(slug);
    if (!p) {
      p = this.readOne(slug).finally(() => this.slugLoads.delete(slug));
      this.slugLoads.set(slug, p);
    }
    return p;
  }

  private async readOne(slug: string): Promise<Entry | null | "error"> {
    const gen = this.generation;
    this.counters.slugLoads++;
    let page: LandingPageRecord | null;
    let photo: LandingPhoto | null = null;
    try {
      page = await this.store.loadBySlug(slug);
      if (page?.isActive && page.showPhoto) {
        const [rec] = await this.store.loadPhotos([page.channelId]);
        if (rec?.bytes?.length) photo = photoOf(rec.bytes);
      }
    } catch (err) {
      console.error("[landing] page non lue", {
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
      return "error";
    }
    if (!page || !page.isActive) {
      if (this.negative.size >= this.maxNegative) this.negative.clear();
      if (gen === this.generation) this.negative.set(slug, this.now() + this.negativeMs);
      return null;
    }
    const entry: Entry = { page, photo, rendered: new Map() };
    // Gardée seulement si rien n'a été invalidé pendant la lecture (sinon servie une fois, relue la prochaine fois).
    if (gen === this.generation) {
      const old = this.byId.get(page.id);
      if (old && this.bySlug.get(old.page.slug) === old) this.bySlug.delete(old.page.slug);
      this.bySlug.set(page.slug, entry);
      this.byId.set(page.id, entry);
      if (photo) this.photos.set(page.channelId, photo);
    }
    return entry;
  }

  private renderFor(entry: Entry, src: string | null): LandingLookup {
    const { source } = resolveLandingSource(entry.page.sources, src);
    if (!source?.inviteLink) return { kind: "unavailable", pageId: entry.page.id };
    const hit = entry.rendered.get(source.key);
    if (hit) return { kind: "page", page: hit };
    const p = entry.page;
    this.counters.renders++;
    const doc = renderLandingDocument({
      pageId: p.id,
      lang: p.language,
      channelTitle: p.channelTitle,
      headline: p.headline,
      subtext: p.subtext,
      buttonText: p.buttonText,
      footnote: p.footnote,
      photoUrl: entry.photo ? `${landingPhotoPath(p.channelId)}?v=${entry.photo.v}` : null,
      inviteLink: source.inviteLink,
      sourceKey: source.key,
      tiktokPixelId: p.tiktokPixelId,
      metaPixelId: p.metaPixelId,
      cookieBanner: p.cookieBanner,
    });
    const body = Buffer.from(doc.html, "utf8");
    const rendered: RenderedLanding = {
      pageId: p.id,
      slug: p.slug,
      version: p.version,
      sourceKey: source.key,
      body,
      etag: etagOf(body),
      csp: landingCsp({ pixels: doc.pixels.tiktok || doc.pixels.meta, script: !!doc.script }),
    };
    entry.rendered.set(source.key, rendered);
    return { kind: "page", page: rendered };
  }
}

// ─── Base réelle ─────────────────────────────────────────────────────────────────────────────────────────────────

const PAGE_SELECT = {
  id: true,
  slug: true,
  version: true,
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
  channel: { select: { title: true } },
  sources: {
    select: {
      key: true,
      isActive: true,
      inviteLink: { select: { telegramInviteLink: true, isActive: true } },
    },
  },
} as const;

type PageRow = {
  id: string;
  slug: string;
  version: number;
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
  channel: { title: string };
  sources: Array<{
    key: string;
    isActive: boolean;
    inviteLink: { telegramInviteLink: string; isActive: boolean } | null;
  }>;
};

export function toPageRecord(row: PageRow): LandingPageRecord {
  return {
    id: row.id,
    slug: row.slug,
    version: row.version,
    channelId: row.channelId,
    channelTitle: row.channel.title,
    language: row.language,
    headline: row.headline,
    subtext: row.subtext,
    buttonText: row.buttonText,
    footnote: row.footnote,
    showPhoto: row.showPhoto,
    cookieBanner: row.cookieBanner,
    tiktokPixelId: row.tiktokPixelId,
    metaPixelId: row.metaPixelId,
    isActive: row.isActive,
    sources: row.sources
      .map((s) => ({
        key: s.key,
        isActive: s.isActive,
        // Un lien révoqué n'est jamais mis sur le bouton.
        inviteLink: s.inviteLink?.isActive ? s.inviteLink.telegramInviteLink : null,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

/** Lecture en base (Prisma). */
export function prismaLandingStore(): LandingStore {
  return {
    async loadActive() {
      const rows = await prisma.landingPage.findMany({
        where: { isActive: true },
        select: PAGE_SELECT,
      });
      return rows.map(toPageRecord);
    },
    async loadBySlug(slug) {
      const row = await prisma.landingPage.findUnique({ where: { slug }, select: PAGE_SELECT });
      return row ? toPageRecord(row) : null;
    },
    async pageExists(pageId) {
      const row = await prisma.landingPage.findUnique({
        where: { id: pageId },
        select: { id: true },
      });
      return !!row;
    },
    async loadPhotos(channelIds) {
      const rows = await prisma.channel.findMany({
        where: { id: { in: channelIds }, photoSmall: { not: null } },
        select: { id: true, photoSmall: true },
      });
      return rows.flatMap((r) => (r.photoSmall ? [{ channelId: r.id, bytes: r.photoSmall }] : []));
    },
  };
}

// ─── Instance du processus ───────────────────────────────────────────────────────────────────────────────────────

type Holder = { cache: LandingCache; subscription: LandingInvalidateSubscription | null };

declare global {
  var __lapLandingCache: Holder | undefined;
}

/**
 * Mémoire des pages de ce processus (gardée dans `globalThis` : le rechargement à chaud du développement réexécute les
 * modules), abonnée une seule fois aux invalidations Redis. `LANDING_CACHE_SUBSCRIBE=0` : pas d'abonnement
 * (relecture de fond seulement).
 */
export function landingCache(): LandingCache {
  let holder = globalThis.__lapLandingCache;
  if (!holder) {
    const cache = new LandingCache({ store: prismaLandingStore() });
    holder = { cache, subscription: null };
    globalThis.__lapLandingCache = holder;
    if (process.env.LANDING_CACHE_SUBSCRIBE !== "0") {
      holder.subscription = subscribeLandingInvalidate((msg) => cache.invalidate(msg));
    }
  }
  return holder.cache;
}

/**
 * Démarrage du serveur (`instrumentation.ts`) : crée la mémoire du processus, l'abonne aux invalidations Redis et
 * charge toutes les pages actives, pour que le premier visiteur après un déploiement soit servi depuis la mémoire.
 * Ne lève jamais et n'attend jamais Redis : base ou Redis injoignables, le serveur démarre quand même (la lecture
 * se fera à la première visite, l'abonnement se reconnecte tout seul).
 */
export async function preloadLandingCache(): Promise<boolean> {
  try {
    return await landingCache().preload();
  } catch (err) {
    console.error("[landing] préchargement des pages impossible", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Tests : remplace la mémoire du processus (sans abonnement Redis) ; null la retire. */
export function setLandingCacheForTests(cache: LandingCache | null): void {
  void globalThis.__lapLandingCache?.subscription?.close();
  globalThis.__lapLandingCache = cache ? { cache, subscription: null } : undefined;
}
