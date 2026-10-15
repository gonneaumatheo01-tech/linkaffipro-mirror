import { describe, expect, it } from "vitest";
import { LandingCache, type LandingPageRecord, type LandingStore } from "./cache";

function page(over: Partial<LandingPageRecord> = {}): LandingPageRecord {
  return {
    id: "p1",
    slug: "promo",
    version: 1,
    channelId: "ch1",
    channelTitle: "Casino VIP",
    language: "fr",
    headline: "Les meilleurs bonus",
    subtext: null,
    buttonText: null,
    footnote: null,
    showPhoto: false,
    cookieBanner: false,
    tiktokPixelId: null,
    metaPixelId: null,
    isActive: true,
    sources: [
      { key: "", isActive: true, inviteLink: "https://t.me/+Default0" },
      { key: "tk01", isActive: true, inviteLink: "https://t.me/+Tk01xxx" },
    ],
    ...over,
  };
}

/** Base simulée : pages modifiables, appels comptés, lectures retardables. */
function fakeStore(initial: LandingPageRecord[]) {
  const db = new Map(initial.map((p) => [p.id, p]));
  const photos = new Map<string, Uint8Array>();
  const calls = { loadActive: 0, loadBySlug: 0, pageExists: 0, loadPhotos: 0 };
  let gate: Promise<void> | null = null;
  const store: LandingStore = {
    async loadActive() {
      calls.loadActive++;
      const snapshot = [...db.values()].filter((p) => p.isActive).map((p) => structuredClone(p));
      if (gate) await gate;
      return snapshot;
    },
    async loadBySlug(slug) {
      calls.loadBySlug++;
      const hit = [...db.values()].find((p) => p.slug === slug);
      const snapshot = hit ? structuredClone(hit) : null;
      if (gate) await gate;
      return snapshot;
    },
    async pageExists(id) {
      calls.pageExists++;
      return db.has(id);
    },
    async loadPhotos(ids) {
      calls.loadPhotos++;
      return ids.flatMap((id) =>
        photos.has(id) ? [{ channelId: id, bytes: photos.get(id)! }] : [],
      );
    },
  };
  return {
    store,
    calls,
    db,
    photos,
    /** Les lectures suivantes attendent `release()`. */
    hold() {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pages d'atterrissage : HTML en mémoire", () => {
  it("un seul chargement de toutes les pages actives, puis aucune lecture en base pour une page connue", async () => {
    const f = fakeStore([page(), page({ id: "p2", slug: "autre", channelId: "ch2" })]);
    const cache = new LandingCache({ store: f.store });
    const a = await cache.lookup("promo", null);
    const b = await cache.lookup("autre", "tk01");
    for (let i = 0; i < 50; i++) await cache.lookup("promo", i % 2 ? "tk01" : null);
    expect(a.kind).toBe("page");
    expect(b.kind).toBe("page");
    expect(f.calls).toEqual({ loadActive: 1, loadBySlug: 0, pageExists: 0, loadPhotos: 0 });
  });

  it("rend le HTML une fois par page, version et source ; une source inconnue sert le lien par défaut (mêmes octets)", async () => {
    const cache = new LandingCache({ store: fakeStore([page()]).store });
    const def = await cache.lookup("promo", null);
    const tk = await cache.lookup("promo", "TK01");
    const unknown = await cache.lookup("promo", "exo9");
    await cache.lookup("promo", "tk01");
    expect(cache.counters.renders).toBe(2);
    if (def.kind !== "page" || tk.kind !== "page" || unknown.kind !== "page")
      throw new Error("page");
    expect(tk.page.body.toString()).toContain('href="https://t.me/+Tk01xxx"');
    expect(def.page.body.toString()).toContain('href="https://t.me/+Default0"');
    expect(unknown.page).toBe(def.page);
    expect(def.page.etag).not.toBe(tk.page.etag);
    expect(def.page.csp).toContain("script-src 'sha256-");
  });

  it("adresse inconnue : une lecture, puis mémoire négative de 30 s", async () => {
    const f = fakeStore([page()]);
    const c = clock();
    const cache = new LandingCache({ store: f.store, now: c.now });
    expect((await cache.lookup("inconnue", null)).kind).toBe("missing");
    expect((await cache.lookup("inconnue", null)).kind).toBe("missing");
    expect(f.calls.loadBySlug).toBe(1);
    c.advance(31_000);
    expect((await cache.lookup("inconnue", null)).kind).toBe("missing");
    expect(f.calls.loadBySlug).toBe(2);
    // Adresse invalide (« _e », majuscules) : aucune lecture.
    expect((await cache.lookup("_e", null)).kind).toBe("missing");
    expect((await cache.lookup("PROMO", null)).kind).toBe("missing");
    expect(f.calls.loadBySlug).toBe(2);
  });

  it("une page créée après un premier « introuvable » apparaît dès son enregistrement (mémoire négative vidée)", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    expect((await cache.lookup("nouvelle", null)).kind).toBe("missing");
    f.db.set("p9", page({ id: "p9", slug: "nouvelle" }));
    cache.invalidate({ pageId: "p9" });
    expect((await cache.lookup("nouvelle", null)).kind).toBe("page");
  });

  it("invalidation d'une page : relue (nouvelle version) sans recharger les autres", async () => {
    const f = fakeStore([page(), page({ id: "p2", slug: "autre", channelId: "ch2" })]);
    const cache = new LandingCache({ store: f.store });
    await cache.lookup("promo", null);
    await cache.lookup("autre", null);
    f.db.set("p1", page({ version: 2, headline: "Nouvelle accroche" }));
    cache.invalidate({ pageId: "p1" });
    const again = await cache.lookup("promo", null);
    if (again.kind !== "page") throw new Error("page");
    expect(again.page.version).toBe(2);
    expect(again.page.body.toString()).toContain("<h1>Nouvelle accroche</h1>");
    await cache.lookup("autre", null);
    expect(f.calls).toMatchObject({ loadActive: 1, loadBySlug: 1 });
    // Changement d'adresse : l'ancienne disparaît, la nouvelle répond.
    f.db.set("p1", page({ version: 3, slug: "promo-2" }));
    cache.invalidate({ pageId: "p1" });
    expect((await cache.lookup("promo", null)).kind).toBe("missing");
    expect((await cache.lookup("promo-2", null)).kind).toBe("page");
  });

  it("titre du canal changé (invalidation par canal) : toutes ses pages relues avec le vrai titre", async () => {
    const f = fakeStore([
      page(),
      page({ id: "p2", slug: "autre" }),
      page({ id: "p3", slug: "x3", channelId: "ch2" }),
    ]);
    const cache = new LandingCache({ store: f.store });
    await cache.lookup("promo", null);
    f.db.set("p1", page({ channelTitle: "Casino VIP 2" }));
    f.db.set("p2", page({ id: "p2", slug: "autre", channelTitle: "Casino VIP 2" }));
    cache.invalidate({ channelId: "ch1" });
    expect(cache.size().pages).toBe(1);
    const a = await cache.lookup("promo", null);
    const b = await cache.lookup("autre", null);
    if (a.kind !== "page" || b.kind !== "page") throw new Error("page");
    expect(a.page.body.toString()).toContain('class="n">Casino VIP 2<');
    expect(b.page.body.toString()).toContain("<title>Casino VIP 2</title>");
  });

  it("« tout » : relecture de fond, l'ancien contenu reste servi d'ici là, puis le nouveau", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    await cache.lookup("promo", null);
    f.db.set("p1", page({ version: 2, headline: "V2" }));
    const release = f.hold();
    cache.invalidate({ all: true });
    const during = await cache.lookup("promo", null);
    if (during.kind !== "page") throw new Error("page");
    expect(during.page.version).toBe(1);
    release();
    await flush();
    await flush();
    const after = await cache.lookup("promo", null);
    if (after.kind !== "page") throw new Error("page");
    expect(after.page.version).toBe(2);
    expect(f.calls.loadActive).toBe(2);
  });

  it("invalidation pendant le premier chargement : le résultat douteux est relu", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    const release = f.hold();
    const pending = cache.lookup("promo", null);
    await flush();
    f.db.set("p1", page({ version: 2 }));
    cache.invalidate({ pageId: "p1" });
    release();
    const res = await pending;
    if (res.kind !== "page") throw new Error("page");
    expect(res.page.version).toBe(2);
    expect(f.calls.loadActive).toBe(2);
  });

  it("démarrage : le « tout » de l'abonnement confirmé pendant la première lecture ne fait pas attendre le visiteur", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    const release = f.hold();
    const pending = cache.lookup("promo", null);
    await flush();
    cache.invalidate({ all: true }); // subscribeLandingInvalidate → deliver({ all: true })
    release();
    const res = await pending;
    expect(res.kind).toBe("page");
    // Une seule lecture complète attendue par le visiteur…
    expect(f.calls.loadActive).toBe(1);
    // … puis une relecture de fond (une modification publiée avant l'abonnement n'est jamais perdue).
    f.db.set("p1", page({ version: 2 }));
    const hold = f.hold();
    const next = await cache.lookup("promo", null);
    if (next.kind !== "page") throw new Error("page");
    expect(next.page.version).toBe(1);
    expect(f.calls.loadActive).toBe(2);
    hold();
    await flush();
    await flush();
    const after = await cache.lookup("promo", null);
    if (after.kind !== "page") throw new Error("page");
    expect(after.page.version).toBe(2);
  });

  it("« tout » avant tout chargement : rien à relire, aucune lecture en plus", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    cache.invalidate({ all: true });
    expect(f.calls.loadActive).toBe(0);
    expect((await cache.lookup("promo", null)).kind).toBe("page");
    await flush();
    expect(f.calls.loadActive).toBe(1);
  });

  it("préchargement au démarrage : le premier visiteur est servi sans lecture ; base injoignable : ne lève pas", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    expect(await cache.preload()).toBe(true);
    expect(f.calls.loadActive).toBe(1);
    expect((await cache.lookup("promo", "tk01")).kind).toBe("page");
    expect(await cache.preload()).toBe(true);
    expect(f.calls.loadActive).toBe(1);
    const down = new LandingCache({
      store: {
        ...f.store,
        loadActive: async () => {
          throw new Error("base injoignable");
        },
      },
    });
    expect(await down.preload()).toBe(false);
  });

  it("invalidation pendant la lecture d'une adresse : servie une fois, jamais gardée", async () => {
    const f = fakeStore([]);
    const cache = new LandingCache({ store: f.store });
    await cache.lookup("autre", null); // chargement initial (vide)
    f.db.set("p1", page());
    const release = f.hold();
    const pending = cache.lookup("promo", null);
    await flush();
    f.db.set("p1", page({ version: 2 }));
    cache.invalidate({ pageId: "p1" });
    release();
    const first = await pending;
    if (first.kind !== "page") throw new Error("page");
    expect(first.page.version).toBe(1);
    const second = await cache.lookup("promo", null);
    if (second.kind !== "page") throw new Error("page");
    expect(second.page.version).toBe(2);
  });

  it("visites simultanées d'une adresse hors mémoire : une seule lecture", async () => {
    const f = fakeStore([]);
    const cache = new LandingCache({ store: f.store });
    await cache.lookup("x0x", null);
    f.db.set("p1", page());
    const all = await Promise.all(Array.from({ length: 20 }, () => cache.lookup("promo", null)));
    expect(all.every((r) => r.kind === "page")).toBe(true);
    expect(f.calls.loadBySlug).toBe(2);
  });

  it("filet de 5 minutes : relecture de fond sans faire attendre le visiteur", async () => {
    const f = fakeStore([page()]);
    const c = clock();
    const cache = new LandingCache({ store: f.store, now: c.now });
    await cache.lookup("promo", null);
    c.advance(5 * 60_000);
    f.db.set("p1", page({ version: 2 }));
    const release = f.hold();
    const res = await cache.lookup("promo", null); // répond avec l'existant, sans attendre la base
    if (res.kind !== "page") throw new Error("page");
    expect(res.page.version).toBe(1);
    release();
    await flush();
    await flush();
    const next = await cache.lookup("promo", null);
    if (next.kind !== "page") throw new Error("page");
    expect(next.page.version).toBe(2);
  });

  it("page désactivée ou sans lien utilisable", async () => {
    const f = fakeStore([
      page(),
      page({ id: "p2", slug: "eteinte", isActive: false }),
      page({
        id: "p3",
        slug: "sans-lien",
        sources: [{ key: "", isActive: true, inviteLink: null }],
      }),
    ]);
    const cache = new LandingCache({ store: f.store });
    expect((await cache.lookup("eteinte", null)).kind).toBe("missing");
    expect(await cache.lookup("sans-lien", null)).toEqual({ kind: "unavailable", pageId: "p3" });
  });

  it("base injoignable : « indisponible », jamais « introuvable » gardé", async () => {
    const f = fakeStore([page()]);
    const cache = new LandingCache({ store: f.store });
    await cache.lookup("promo", null);
    f.store.loadBySlug = async () => {
      throw new Error("base coupée");
    };
    expect(await cache.lookup("autre", null)).toEqual({ kind: "unavailable", pageId: null });
    expect(cache.size().negative).toBe(0);
    // La page déjà en mémoire continue d'être servie.
    expect((await cache.lookup("promo", null)).kind).toBe("page");
  });

  it("photo seulement pour un canal dont une page l'affiche, adresse versionnée dans le HTML", async () => {
    const f = fakeStore([
      page({ showPhoto: true }),
      page({ id: "p2", slug: "autre", channelId: "ch2" }),
    ]);
    f.photos.set("ch1", new Uint8Array([0xff, 0xd8, 1, 2, 3]));
    f.photos.set("ch2", new Uint8Array([0xff, 0xd8, 9]));
    const cache = new LandingCache({ store: f.store });
    const res = await cache.lookup("promo", null);
    if (res.kind !== "page") throw new Error("page");
    const photo = await cache.photo("ch1");
    expect(photo?.bytes).toEqual(Buffer.from([0xff, 0xd8, 1, 2, 3]));
    expect(res.page.body.toString()).toContain(`src="/j/_p/ch1.jpg?v=${photo!.v}"`);
    expect(await cache.photo("ch2")).toBeNull();
    expect(f.calls.loadPhotos).toBe(1);
    // Photo changée chez Telegram : invalidation du canal, nouvelle version.
    f.photos.set("ch1", new Uint8Array([0xff, 0xd8, 7]));
    cache.invalidate({ channelId: "ch1" });
    const again = await cache.lookup("promo", null);
    if (again.kind !== "page") throw new Error("page");
    const v2 = (await cache.photo("ch1"))!.v;
    expect(v2).not.toBe(photo!.v);
    expect(again.page.body.toString()).toContain(`?v=${v2}"`);
  });

  it("existence d'une page pour les envois : mémoire d'abord, puis une lecture mémorisée et limitée", async () => {
    const f = fakeStore([page(), page({ id: "p2", slug: "eteinte", isActive: false })]);
    const cache = new LandingCache({ store: f.store, maxExistenceChecksPerMinute: 3 });
    expect(await cache.knowsPage("p1")).toBe(true);
    expect(f.calls.pageExists).toBe(0);
    expect(await cache.knowsPage("p2")).toBe(true); // désactivée mais existante
    expect(await cache.knowsPage("p2")).toBe(true);
    expect(f.calls.pageExists).toBe(1);
    expect(await cache.knowsPage("zz1")).toBe(false);
    expect(await cache.knowsPage("zz2")).toBe(false);
    expect(await cache.knowsPage("zz3")).toBe(false); // limite atteinte : refus sans lecture
    expect(f.calls.pageExists).toBe(3);
    expect(await cache.knowsPage("bad id!")).toBe(false);
  });

  it("existence hors mémoire gardée 1 min seulement (une page supprimée cesse vite d'être acceptée)", async () => {
    const c = clock();
    const f = fakeStore([page(), page({ id: "p2", slug: "eteinte", isActive: false })]);
    const cache = new LandingCache({ store: f.store, now: c.now });
    expect(await cache.knowsPage("p2")).toBe(true);
    f.db.delete("p2");
    c.advance(30_000);
    expect(await cache.knowsPage("p2")).toBe(true);
    c.advance(31_000);
    expect(await cache.knowsPage("p2")).toBe(false);
    // Invalidation de la page (suppression publiée) : oubliée tout de suite.
    f.db.set("p3", page({ id: "p3", slug: "autre", isActive: false }));
    expect(await cache.knowsPage("p3")).toBe(true);
    f.db.delete("p3");
    cache.invalidate({ pageId: "p3" });
    expect(await cache.knowsPage("p3")).toBe(false);
  });
});
