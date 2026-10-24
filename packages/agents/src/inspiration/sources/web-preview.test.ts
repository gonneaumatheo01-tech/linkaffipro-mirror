import { describe, expect, it } from "vitest";
import { INSPIRATION_LIMITS } from "../contract";
import { fakeSleep, FIXTURE_CHANNELS, FIXTURE_NOW, fixtureFetch } from "../testing/fixtures";
import {
  createInspirationFetch,
  isInviteLink,
  memoryTmeThrottle,
  normalizeChannelUsername,
  parsePreviewPage,
  parsePreviewViews,
  previewHtmlToText,
  readBodyCapped,
  readWebPreview,
} from "./web-preview";

const opts = () => ({ now: FIXTURE_NOW, sleep: fakeSleep() });

describe("aperçu web t.me/s : 3 canaux enregistrés", () => {
  it("casino : 2 pages (pagination par before), message de service ignoré, médias, boutons, vues « K »", async () => {
    const f = fixtureFetch();
    const sleep = fakeSleep();
    const r = await readWebPreview(f, "@casino_lumiere_exemple", { now: FIXTURE_NOW, sleep });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.urls).toEqual(["https://t.me/s/casino_lumiere_exemple", "https://t.me/s/casino_lumiere_exemple?before=1013"]);
    // Une requête toutes les 3 secondes : une seule attente entre les deux pages.
    expect(sleep.calls).toEqual([INSPIRATION_LIMITS.webDelayMs]);
    expect(r.title).toBe("Casino Lumière 🎰 (exemple)");
    expect(r.username).toBe("casino_lumiere_exemple");
    expect(r.posts).toHaveLength(31);
    expect(r.posts.some((p) => p.externalId === 1000)).toBe(false);
    // Du plus récent au plus ancien, sans doublon.
    const ids = r.posts.map((p) => p.externalId);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(ids.length);
    const byId = new Map(r.posts.map((p) => [p.externalId, p]));
    const first = byId.get(1001)!;
    expect(first).toMatchObject({ mediaKind: "photo", views: 3100, hasButton: true, linkCount: 1 });
    expect(first.text).toBe("🎰 Roulette live ce soir 21h\nOn se retrouve sur la table européenne, mise mini 1 €.\n👉 exemple.invalid/live");
    expect(first.postedAt.toISOString()).toBe("2026-09-23T18:00:00.000Z");
    const kinds = new Set(r.posts.map((p) => p.mediaKind));
    expect([...kinds].sort()).toEqual(["document", "other", "photo", "poll", "text", "video"]);
    expect(byId.get(1005)).toMatchObject({ mediaKind: "poll", text: "Votre jeu préféré ?" });
    expect(byId.get(1010)).toMatchObject({ mediaKind: "photo" }); // album
    expect(byId.get(1014)).toMatchObject({ mediaKind: "document" });
    expect(byId.get(1018)?.views).toBe(12400);
    // Mention « @nom » : pas un lien.
    expect(byId.get(1006)).toMatchObject({ linkCount: 0, hasButton: false });
  });

  it("paris : numéros avec trous, cotes et résultats lus tels quels", async () => {
    const r = await readWebPreview(fixtureFetch(), "https://t.me/s/paris_cadres_exemple", opts());
    expect(r.ok && r.posts.length).toBe(29);
    if (!r.ok) return;
    expect(r.posts.some((p) => p.text?.includes("✅ Cote passée"))).toBe(true);
    expect(r.posts.every((p) => p.views !== null && p.views > 1000)).toBe(true);
  });

  it("rencontres : arrêt à 90 jours (4 anciens posts de la 2e page non lus)", async () => {
    const r = await readWebPreview(fixtureFetch(), "t.me/rencontres_douces_exemple", opts());
    expect(r.ok && r.posts.length).toBe(26);
    if (!r.ok) return;
    const oldest = Math.min(...r.posts.map((p) => p.postedAt.getTime()));
    expect(FIXTURE_NOW.getTime() - oldest).toBeLessThan(90 * 86_400_000);
    expect(r.posts.some((p) => p.externalId < 200)).toBe(false);
  });

  it("relecture : s'arrête au dernier post connu, 50 au plus", async () => {
    const f = fixtureFetch();
    const r = await readWebPreview(f, FIXTURE_CHANNELS.casino, { ...opts(), sinceId: 1027 });
    expect(r.ok && r.posts.map((p) => p.externalId)).toEqual([1032, 1031, 1030, 1029, 1028]);
    expect(f.urls).toHaveLength(1);
    const few = await readWebPreview(fixtureFetch(), FIXTURE_CHANNELS.casino, { ...opts(), maxPosts: 7 });
    expect(few.ok && few.posts).toHaveLength(7);
  });
});

/** Pages fabriquées sur le modèle des fixtures (un très gros canal) : 20 posts par page. */
function bigChannelFetch(total: number, perDayGap = 0.2) {
  const urls: string[] = [];
  const wrap = (id: number) => {
    const at = new Date(FIXTURE_NOW.getTime() - (total - id + 1) * perDayGap * 86_400_000).toISOString();
    return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="gros_canal/${id}"><div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text js-message_text" dir="auto">Post ${id}</div><div class="tgme_widget_message_footer"><span class="tgme_widget_message_views">2.5K</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="#"><time datetime="${at}" class="time">x</time></a></span></div></div></div></div>`;
  };
  const f = async (url: string) => {
    urls.push(url);
    const before = Number(url.match(/before=(\d+)/)?.[1] ?? total + 1);
    const ids = Array.from({ length: 20 }, (_, i) => before - 20 + i).filter((x) => x >= 1);
    const more = ids[0]! > 1 ? `<a href="/s/gros_canal?before=${ids[0]}" class="tme_messages_more js-messages_more" data-before="${ids[0]}"></a>` : "";
    return { status: 200, body: `<html><body><div class="tgme_channel_info"><div class="tgme_channel_info_header_title"><span>Gros</span></div></div><section class="tgme_channel_history">${more}${ids.map(wrap).join("")}</section></body></html>` };
  };
  return Object.assign(f, { urls });
}

describe("aperçu web : limites", () => {
  it("s'arrête à 200 posts (10 pages), une attente de 3 s entre deux requêtes", async () => {
    const f = bigChannelFetch(1000, 0.1);
    const sleep = fakeSleep();
    const r = await readWebPreview(f, "gros_canal", { now: FIXTURE_NOW, sleep });
    expect(r.ok && r.posts.length).toBe(200);
    expect(f.urls).toHaveLength(10);
    expect(sleep.calls).toEqual(Array(9).fill(3000));
    expect(r.ok && r.posts[0]!.views).toBe(2500);
  });
  it("s'arrête à 90 jours même sous 200 posts", async () => {
    const r = await readWebPreview(bigChannelFetch(1000, 1), "gros_canal", opts());
    expect(r.ok && r.posts.length).toBe(90);
  });
});

describe("aperçu web : canal indisponible", () => {
  it("canal privé (page t.me/<nom> sans aperçu) → private", async () => {
    const r = await readWebPreview(fixtureFetch(), FIXTURE_CHANNELS.private, opts());
    expect(r).toMatchObject({ ok: false, reason: "private" });
    expect(!r.ok && r.message).toContain("@canal_prive_exemple");
  });
  it("restreint par Telegram → restricted ; aperçu sans posts → restricted", async () => {
    expect(await readWebPreview(fixtureFetch(), FIXTURE_CHANNELS.restricted, opts())).toMatchObject({ ok: false, reason: "restricted" });
    expect(await readWebPreview(fixtureFetch(), FIXTURE_CHANNELS.empty, opts())).toMatchObject({ ok: false, reason: "restricted" });
  });
  it("redirection vers t.me/<nom> → private ; 404 → not_found ; panne → error ; nom invalide → not_found", async () => {
    expect(await readWebPreview(async () => ({ status: 302, body: "" }), "redirige_exemple", opts())).toMatchObject({ ok: false, reason: "private" });
    expect(await readWebPreview(fixtureFetch(), "inconnu_exemple", opts())).toMatchObject({ ok: false, reason: "not_found" });
    expect(await readWebPreview(async () => ({ status: 503, body: "" }), "panne_exemple", opts())).toMatchObject({ ok: false, reason: "error" });
    expect(
      await readWebPreview(
        async () => {
          throw new Error("réseau coupé");
        },
        "panne_exemple",
        opts(),
      ),
    ).toMatchObject({ ok: false, reason: "error" });
    expect(await readWebPreview(fixtureFetch(), "t.me/+AbCdEf123", opts())).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("aperçu web : règles pures", () => {
  it("vues", () => {
    expect(parsePreviewViews("1.2K")).toBe(1200);
    expect(parsePreviewViews("15K")).toBe(15000);
    expect(parsePreviewViews("1.5M")).toBe(1_500_000);
    expect(parsePreviewViews("987")).toBe(987);
    expect(parsePreviewViews("—")).toBeNull();
  });
  it("noms et liens d'invitation", () => {
    expect(normalizeChannelUsername("@Casino_Exemple")).toBe("Casino_Exemple");
    expect(normalizeChannelUsername("https://t.me/s/casino_exemple?before=3")).toBe("casino_exemple");
    expect(normalizeChannelUsername("t.me/casino_exemple/123")).toBe("casino_exemple");
    expect(normalizeChannelUsername("https://t.me/+AbCd")).toBeNull();
    expect(normalizeChannelUsername("abc")).toBeNull();
    expect(isInviteLink("https://t.me/+AbCdEf_12")).toBe(true);
    expect(isInviteLink("t.me/joinchat/AbCd")).toBe(true);
    expect(isInviteLink("t.me/casino_exemple")).toBe(false);
  });
  it("HTML → texte et page sans posts", () => {
    expect(previewHtmlToText("a<br/>b &amp; c&#39;d <b>gras</b> &#x1F525;")).toBe("a\nb & c'd gras 🔥");
    expect(parsePreviewPage("<html></html>", "x")).toMatchObject({ isPreview: false, posts: [] });
  });
});

describe("aperçu web : rythme partagé et taille lue", () => {
  it("une requête toutes les 3 s d'une lecture à l'autre : attente du reste seulement", async () => {
    let clock = 1_000_000;
    const calls: number[] = [];
    const sleep = async (ms: number) => {
      calls.push(ms);
      clock += ms;
    };
    const throttle = memoryTmeThrottle();
    const o = { now: FIXTURE_NOW, sleep, throttle, clock: () => clock };
    const f1 = fixtureFetch();
    await readWebPreview(f1, FIXTURE_CHANNELS.casino, o);
    // Première lecture : rien avant la première page, 3 s pleines entre ses deux pages.
    expect(calls).toEqual([3_000]);
    clock += 1_200; // 1,2 s après sa dernière requête, une autre lecture commence : attente du reste.
    calls.length = 0;
    await readWebPreview(fixtureFetch(), FIXTURE_CHANNELS.casino, o);
    expect(calls).toEqual([1_800, 3_000]);
    clock += 10_000; // Assez attendu : aucune attente avant la première page.
    calls.length = 0;
    await readWebPreview(fixtureFetch(), FIXTURE_CHANNELS.casino, o);
    expect(calls).toEqual([3_000]);
  });

  it("corps lu en flux et coupé à la taille maximale, sans tout charger", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(1000));
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 1000) c.close();
        else c.enqueue(chunk);
      },
    });
    const text = await readBodyCapped({ body, text: async () => "" } as unknown as Response, 2_500);
    expect(text.length).toBe(2_500);
    expect(pulled).toBeLessThan(10);
    const fetchImpl = (async () => new Response("<html>ok</html>", { status: 200 })) as typeof fetch;
    expect(await createInspirationFetch(fetchImpl)("https://t.me/s/exemple")).toEqual({ status: 200, body: "<html>ok</html>" });
    const redirect = (async () => new Response(null, { status: 302 })) as typeof fetch;
    expect(await createInspirationFetch(redirect)("https://t.me/s/exemple")).toEqual({ status: 302, body: "" });
  });
});
