import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLandingSource, type LandingSourceLike } from "./landing";
import {
  LANDING_SCRIPT,
  LANDING_STYLE,
  LANDING_TEXT_LIMITS,
  escapeLandingHtml,
  landingButtonHref,
  landingText,
  renderLandingDocument,
  renderLandingHtml,
  type LandingRenderInput,
} from "./landing-render";

const BASE: LandingRenderInput = {
  pageId: "clpage00001",
  lang: "fr",
  channelTitle: "Casino VIP 🎰",
  headline: "Les meilleurs bonus du jour",
  subtext: "Rejoins 12 000 membres",
  footnote: "Gratuit · 1 clic · via Telegram",
  inviteLink: "https://t.me/+AbCdEf123_-x",
  sourceKey: "tk01",
};

function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function head(html: string): string {
  return /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
}

describe("page d'atterrissage : rendu", () => {
  it("garde l'ordre demandé : titre du canal, accroche, sous-texte, bouton, petite ligne", () => {
    const html = renderLandingHtml(BASE);
    const order = [
      'class="n">Casino VIP 🎰<',
      "<h1>Les meilleurs bonus du jour</h1>",
      'class="s">Rejoins 12 000 membres<',
      '<a id="b" href="https://t.me/+AbCdEf123_-x">',
      'class="f">Gratuit · 1 clic · via Telegram<',
    ].map((needle) => html.indexOf(needle));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.startsWith('<!doctype html><html lang="fr">')).toBe(true);
    expect(html).toContain("<title>Casino VIP 🎰</title>");
  });

  it("n'a qu'un lien (le bouton), ni pied de page, ni menu, ni pop-up", () => {
    const html = renderLandingHtml({ ...BASE, tiktokPixelId: "CD2UC93C77U35BVUO310" });
    expect(html.match(/<a\s/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(footer|nav|header|dialog|iframe|form|input)\b/);
    expect(html).not.toMatch(/window\.open|alert\(|confirm\(/);
  });

  it("le bouton est un vrai lien https://t.me/+… utilisable sans script", () => {
    expect(landingButtonHref("https://t.me/+AbC_1")).toBe("https://t.me/+AbC_1");
    expect(landingButtonHref("https://t.me/joinchat/AbC_1")).toBe("https://t.me/+AbC_1");
    expect(landingButtonHref("tg://join?invite=AbC_1")).toBe("https://t.me/+AbC_1");
    expect(landingButtonHref("javascript:alert(1)")).toBe("https://t.me/");
    expect(landingButtonHref(null)).toBe("https://t.me/");
    const noScript = renderLandingHtml({ ...BASE, preview: true });
    expect(noScript).toContain('<a id="b" href="https://t.me/+AbCdEf123_-x">');
  });

  it("texte du bouton modifiable, sinon celui de la langue ; langue inconnue = français", () => {
    expect(renderLandingHtml(BASE)).toContain("<span>Rejoindre le canal →</span>");
    expect(renderLandingHtml({ ...BASE, buttonText: "Entrer  maintenant " })).toContain(
      "<span>Entrer maintenant</span>",
    );
    const en = renderLandingHtml({ ...BASE, lang: "en" });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain("<span>Join the channel →</span>");
    expect(renderLandingHtml({ ...BASE, lang: "pt-BR" })).toContain('<html lang="pt">');
    expect(renderLandingHtml({ ...BASE, lang: "xx" })).toContain('<html lang="fr">');
  });

  it("sous-texte et petite ligne facultatifs : absents s'ils sont vides", () => {
    const html = renderLandingHtml({ ...BASE, subtext: "  ", footnote: null });
    expect(html).not.toContain('class="s"');
    expect(html).not.toContain('class="f"');
  });

  it("photo désactivée par défaut ; affichée avec des dimensions fixes ; jamais une adresse extérieure", () => {
    expect(renderLandingHtml(BASE)).not.toContain("<img");
    const withPhoto = renderLandingHtml({ ...BASE, photoUrl: "/j/_p/ch1.jpg?v=abc" });
    expect(withPhoto).toContain(
      '<img class="i" src="/j/_p/ch1.jpg?v=abc" width="88" height="88" alt="" decoding="async">',
    );
    expect(renderLandingHtml({ ...BASE, photoUrl: "https://evil.example/x.jpg" })).not.toContain(
      "<img",
    );
    expect(renderLandingHtml({ ...BASE, photoUrl: "//evil.example/x.jpg" })).not.toContain("<img");
    // Image en ligne : seulement dans l'aperçu (la vraie page sert la photo depuis le site).
    const inline = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    expect(renderLandingHtml({ ...BASE, photoUrl: inline })).not.toContain("<img");
    expect(renderLandingHtml({ ...BASE, preview: true, photoUrl: inline })).toContain(
      `src="${inline}"`,
    );
    expect(
      renderLandingHtml({
        ...BASE,
        preview: true,
        photoUrl: 'data:image/svg+xml;base64,PHN2Zz4="',
      }),
    ).not.toContain("<img");
  });

  it("échappe strictement tous les textes", () => {
    const html = renderLandingHtml({
      ...BASE,
      channelTitle: "</title><script>alert(1)</script>",
      headline: `<img src=x onerror="alert(1)">`,
      subtext: 'Tom & Jerry\'s "club"',
      buttonText: "<b>Go</b>",
      footnote: "a<b",
      pageId: 'x" onload="alert(1)',
      sourceKey: '"><script>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onload="alert');
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Tom &amp; Jerry&#39;s &quot;club&quot;");
    expect(html).toContain("<span>&lt;b&gt;Go&lt;/b&gt;</span>");
    expect(html).toContain('data-p="x&quot; onload=&quot;alert(1)"');
    expect(html).toContain('data-s="&quot;&gt;&lt;script&gt;"');
    // Une seule balise <script> : celle de la page.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(escapeLandingHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("coupe les textes trop longs sans couper un emoji et retire les caractères de contrôle", () => {
    expect(landingText("a\u0000b\nc d", 10)).toBe("a b c d");
    expect(landingText("🎰".repeat(5), 3)).toBe("🎰🎰🎰");
    const long = renderLandingHtml({ ...BASE, headline: "x".repeat(500) });
    expect(long).toContain(`<h1>${"x".repeat(LANDING_TEXT_LIMITS.headline)}</h1>`);
  });

  it("pèse moins de 15 Ko avec les textes les plus longs autorisés (sans pixels)", () => {
    // Pire cas : emojis de 4 octets partout, puis « & » (5 octets une fois échappé) partout.
    for (const ch of ["🎰", "&"]) {
      const html = renderLandingHtml({
        ...BASE,
        channelTitle: ch.repeat(LANDING_TEXT_LIMITS.channelTitle),
        headline: ch.repeat(LANDING_TEXT_LIMITS.headline),
        subtext: ch.repeat(LANDING_TEXT_LIMITS.subtext),
        buttonText: ch.repeat(LANDING_TEXT_LIMITS.buttonText),
        footnote: ch.repeat(LANDING_TEXT_LIMITS.footnote),
        photoUrl: "/j/_p/cm1234567890abcdefghijkl.jpg?v=0123456789abcdef",
        pageId: "c".repeat(30),
        sourceKey: "s".repeat(32),
      });
      expect(bytes(html)).toBeLessThan(15 * 1024);
    }
    // Avec les deux pixels et le bandeau cookies : toujours sous 15 Ko (les pixels eux-mêmes sont chargés après).
    const withPixels = renderLandingHtml({
      ...BASE,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      metaPixelId: "1070571443971391",
      cookieBanner: true,
    });
    expect(bytes(withPixels)).toBeLessThan(15 * 1024);
  });

  it("un seul écran sans défilement : hauteur de l'écran, zone des textes qui se partage le reste, lignes limitées", () => {
    const rule = (sel: string) =>
      new RegExp(`(?:^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`).exec(
        LANDING_STYLE,
      )?.[1] ?? "";
    // La page fait exactement la hauteur de l'écran visible et ne défile jamais.
    expect(rule("html,body")).toContain("height:100%");
    expect(rule("body")).toContain("overflow:hidden");
    expect(rule("main")).toMatch(/height:100vh;height:100dvh/);
    expect(rule("main")).not.toContain("min-height:100");
    // Seule la zone des textes rétrécit ; bouton, petite ligne et bandeau gardent leur place.
    expect(rule(".t")).toMatch(/flex:1 1 auto;min-height:0;overflow:hidden/);
    for (const sel of [".c", ".k", ".n", "h1", ".s"]) expect(rule(sel)).toContain("flex:none");
    // Centrage « sûr » : si la place manque, la fin des textes est coupée, jamais le titre du canal.
    expect(rule(".t>:first-child")).toBe("margin-top:auto");
    expect(rule(".t>:last-child")).toBe("margin-bottom:auto");
    expect(rule(".t")).not.toContain("justify-content:center");
    // Lignes maximales : titre du canal 2, accroche 4, sous-texte 3, bouton 2, petite ligne 2.
    expect(rule(".n")).toContain("-webkit-line-clamp:2");
    expect(rule("h1")).toContain("-webkit-line-clamp:4");
    expect(rule(".s")).toContain("-webkit-line-clamp:3");
    expect(rule("#b span")).toContain("-webkit-line-clamp:2");
    expect(rule(".f")).toContain("-webkit-line-clamp:2");
    // Tailles qui suivent aussi la hauteur de l'écran (petit téléphone dans une appli : 375 × 548).
    expect(rule("h1")).toContain("font-size:clamp(20px,min(7.4vw,4.4vh),34px)");
    expect(rule(".i")).toContain("height:min(88px,12vh)");
  });

  it("aucun script ni ressource extérieure dans le <head> : seulement charset, viewport, titre et CSS en ligne", () => {
    const h = head(
      renderLandingHtml({
        ...BASE,
        tiktokPixelId: "CD2UC93C77U35BVUO310",
        metaPixelId: "1070571443971391",
        photoUrl: "/j/_p/ch1.jpg",
      }),
    );
    expect(h).not.toMatch(/<script|<link|<iframe|<img|src=|href=|@import|url\(|https?:/i);
    expect(h).toContain(`<style>${LANDING_STYLE}</style>`);
    // Polices du système seulement.
    expect(LANDING_STYLE).toContain("-apple-system");
    expect(LANDING_STYLE).not.toMatch(/@font-face|url\(/);
    // Le script est à la fin du <body>, en ligne : il ne bloque pas l'affichage.
    const html = renderLandingHtml(BASE);
    expect(html.indexOf("<script>")).toBeGreaterThan(html.indexOf('<a id="b"'));
    expect(html.endsWith("</script></body></html>")).toBe(true);
  });

  it("donne les mêmes octets quel que soit le visiteur (aucune lecture de l'heure, du hasard, du navigateur)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
      const random = vi.spyOn(Math, "random").mockReturnValue(0.1);
      const a = renderLandingHtml({ ...BASE, tiktokPixelId: "CD2UC93C77U35BVUO310" });
      vi.setSystemTime(new Date("2027-01-01T23:59:59Z"));
      random.mockReturnValue(0.9);
      const b = renderLandingHtml({ ...BASE, tiktokPixelId: "CD2UC93C77U35BVUO310" });
      expect(b).toBe(a);
      expect(random).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
    // Le script est le même pour toutes les pages (une seule empreinte CSP) : il lit ses réglages dans data-*.
    const other = renderLandingDocument({ ...BASE, pageId: "autre", sourceKey: "" });
    expect(other.script).toBe(LANDING_SCRIPT);
    expect(renderLandingDocument(BASE).script).toBe(LANDING_SCRIPT);
  });

  it("choisit le lien selon ?src= : source demandée, sinon lien par défaut, mêmes octets qu'une visite sans src", () => {
    const sources: LandingSourceLike[] = [
      { key: "", isActive: true, inviteLink: "https://t.me/+Default000" },
      { key: "tk01", isActive: true, inviteLink: "https://t.me/+Tk01xxxx" },
      { key: "tk03", isActive: true, inviteLink: "https://t.me/+Tk03xxxx" },
      { key: "exo1", isActive: false, inviteLink: "https://t.me/+Exo1xxxx" },
    ];
    const page = (src: string | null) => {
      const { source } = resolveLandingSource(sources, src);
      return renderLandingHtml({
        ...BASE,
        inviteLink: source!.inviteLink!,
        sourceKey: source!.key,
      });
    };
    expect(page("tk01")).toContain('href="https://t.me/+Tk01xxxx"');
    expect(page("TK03")).toContain('href="https://t.me/+Tk03xxxx"');
    expect(page("tk01")).toContain('data-s="tk01"');
    // Source inconnue ou retirée : le lien par défaut, exactement la page sans ?src=.
    expect(page("inconnue")).toBe(page(null));
    expect(page("exo1")).toBe(page(null));
    expect(page(null)).toContain('href="https://t.me/+Default000"');
    expect(page(null)).toContain('data-s=""');
  });

  it("pixels seulement avec un identifiant valide ; bandeau cookies seulement s'il y a un pixel", () => {
    const none = renderLandingDocument({ ...BASE, tiktokPixelId: "abc", metaPixelId: "12" });
    expect(none.pixels).toEqual({ tiktok: false, meta: false });
    expect(none.html).not.toMatch(/data-tt|data-fb/);
    const both = renderLandingDocument({
      ...BASE,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      metaPixelId: "1070571443971391",
    });
    expect(both.pixels).toEqual({ tiktok: true, meta: true });
    expect(both.html).toContain('data-tt="CD2UC93C77U35BVUO310" data-fb="1070571443971391"');
    expect(renderLandingHtml({ ...BASE, cookieBanner: true })).not.toContain('id="k"');
    const banner = renderLandingHtml({
      ...BASE,
      cookieBanner: true,
      metaPixelId: "1070571443971391",
    });
    expect(banner).toContain('<div class="k" id="k" role="region" aria-label="Cookies">');
    expect(banner).toContain('<button type="button" id="ka">Accepter</button>');
    // Accord éclairé : les partenaires qui poseront des cookies sont nommés.
    expect(banner).toContain(
      "<p>Nous utilisons des cookies pour mesurer nos publicités (Meta).</p>",
    );
    expect(
      renderLandingHtml({
        ...BASE,
        lang: "en",
        cookieBanner: true,
        tiktokPixelId: "CD2UC93C77U35BVUO310",
        metaPixelId: "1070571443971391",
      }),
    ).toContain("<p>We use cookies to measure our ads (TikTok, Meta).</p>");
    // Le bandeau est dans le flux, après le bouton : il ne le cache jamais.
    expect(banner.indexOf('id="k"')).toBeGreaterThan(banner.indexOf('<a id="b"'));
    expect(LANDING_STYLE).not.toMatch(/\.k\{[^}]*position:fixed/);
  });

  it("aperçu : même rendu, sans script, sans envoi ni pixel", () => {
    const doc = renderLandingDocument({
      ...BASE,
      preview: true,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      cookieBanner: true,
    });
    expect(doc.script).toBeNull();
    expect(doc.html).not.toContain("<script");
    expect(doc.html).not.toMatch(/data-p=|data-tt=/);
    expect(doc.html).toContain('id="k"');
    expect(doc.html).toContain('<a id="b" href="https://t.me/+AbCdEf123_-x">');
  });
});

// ─── Script de la page, exécuté dans un navigateur simulé ────────────────────────────────────────────────────────

const UA = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 trill_330604 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/33.6.4 ByteLocale/fr BytedanceWebview/d8a21c6",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.32.105 (iPhone14,5; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 584287262)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.193 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/446.0.0.27.352;]",
  snapchatIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.58.0.37 (like Safari/8617.1.17.10.12, panda)",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 12; M2101K6G Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;

const HREF = "https://t.me/+AbCdEf123_-x";
const TG = "tg://join?invite=AbCdEf123_-x";
const INTENT =
  "intent://join?invite=AbCdEf123_-x#Intent;scheme=tg;S.browser_fallback_url=https%3A%2F%2Ft.me%2F%2BAbCdEf123_-x;end";

type Listener = (ev?: unknown) => void;
type Beacon = {
  url: string;
  body: { p: string; s: string; v: string; t: string; m: string | null; q: string };
};

/**
 * Navigateur minimal (document, fenêtre, bouton, stockage, sendBeacon) : exécute `LANDING_SCRIPT` tel quel avec les
 * minuteries simulées de vitest.
 */
function browser(opts: {
  ua: string;
  random?: number;
  dataset?: Record<string, string>;
  banner?: boolean;
  stored?: Record<string, string>;
  session?: Record<string, string>;
  hidden?: boolean;
  readyState?: string;
  search?: string;
}) {
  const winL: Record<string, Listener[]> = {};
  const docL: Record<string, Listener[]> = {};
  const btnL: Record<string, Listener[]> = {};
  const beacons: Beacon[] = [];
  const scripts: Array<{ src?: string; async?: boolean }> = [];
  const nav: string[] = [];
  const session = new Map(Object.entries(opts.session ?? {}));
  const local = new Map(Object.entries(opts.stored ?? {}));
  const on = (map: Record<string, Listener[]>) => (type: string, fn: Listener) => {
    (map[type] ??= []).push(fn);
  };
  const button = { href: HREF, className: "", addEventListener: on(btnL) };
  const makeBtn = () => ({ onclick: null as null | (() => void) });
  const accept = makeBtn();
  const decline = makeBtn();
  const banner = opts.banner
    ? { parentNode: { removeChild: () => (bannerState.removed = true) } }
    : null;
  const bannerState = { removed: false };
  const doc = {
    body: { dataset: { p: "page1", s: "tk01", ...(opts.dataset ?? {}) } },
    visibilityState: opts.hidden ? "hidden" : "visible",
    readyState: opts.readyState ?? "complete",
    prerendering: false,
    head: { appendChild: (el: { src?: string }) => scripts.push(el) },
    createElement: () => ({}),
    getElementById: (id: string) =>
      id === "b"
        ? button
        : id === "k"
          ? banner
          : id === "ka"
            ? accept
            : id === "kr"
              ? decline
              : null,
    addEventListener: on(docL),
  };
  const location = {
    search: opts.search ?? "?src=tk01&ttclid=TT1",
    get href() {
      return "https://go.goolink.eu/j/promo";
    },
    set href(v: string) {
      nav.push(v);
    },
  };
  const win: Record<string, unknown> = {
    crypto: globalThis.crypto,
    addEventListener: on(winL),
    requestAnimationFrame: (f: () => void) => setTimeout(f, 16),
  };
  const navigator = {
    userAgent: opts.ua,
    maxTouchPoints: 5,
    sendBeacon: (url: string, body: string) => {
      beacons.push({ url, body: JSON.parse(body) });
      return true;
    },
  };
  const storage = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  });
  const math = Object.create(Math, { random: { value: () => opts.random ?? 0.1 } });
  const run = new Function(
    "window",
    "document",
    "navigator",
    "location",
    "sessionStorage",
    "localStorage",
    "Math",
    "fetch",
    LANDING_SCRIPT,
  );
  run(win, doc, navigator, location, storage(session), storage(local), math, () => {
    throw new Error("fetch ne doit pas servir : sendBeacon a répondu");
  });
  const fire = (map: Record<string, Listener[]>, type: string, ev?: unknown) =>
    (map[type] ?? []).forEach((f) => f(ev));
  return {
    beacons,
    nav,
    scripts,
    button,
    session,
    local,
    bannerState,
    win,
    accept,
    decline,
    types: () => beacons.map((b) => `${b.body.t}${b.body.m ? `:${b.body.m}` : ""}`),
    click: () => fire(btnL, "click"),
    load: () => fire(winL, "load"),
    hide: () => {
      doc.visibilityState = "hidden";
      fire(docL, "visibilitychange");
    },
    show: () => {
      doc.visibilityState = "visible";
      fire(docL, "visibilitychange");
    },
    pagehide: (persisted = false) => fire(winL, "pagehide", { persisted }),
    pageshow: (persisted = false) => fire(winL, "pageshow", { persisted }),
    blur: () => fire(winL, "blur"),
    focus: () => fire(winL, "focus"),
  };
}

describe("page d'atterrissage : script (navigateur simulé)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("envoie la visite après l'affichage, avec un identifiant de visite et le ?src= reçu", () => {
    const b = browser({ ua: UA.safariIos });
    expect(b.beacons).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(b.types()).toEqual(["VIEW"]);
    const body = b.beacons[0]!.body;
    expect(b.beacons[0]!.url).toBe("/j/_e");
    expect(body).toMatchObject({
      p: "page1",
      s: "tk01",
      t: "VIEW",
      m: null,
      q: "?src=tk01&ttclid=TT1",
    });
    expect(body.v).toMatch(/^[0-9a-f]{24}$/);
    expect(b.session.get("lj:page1:tk01")).toBe(body.v);
  });

  it("garde l'identifiant de visite de l'onglet (rechargement : même visite)", () => {
    const b = browser({ ua: UA.safariIos, session: { "lj:page1:tk01": "visit_abcdef12" } });
    vi.advanceTimersByTime(20);
    expect(b.beacons[0]!.body.v).toBe("visit_abcdef12");
  });

  it("une page préchargée invisible n'envoie la visite qu'une fois affichée", () => {
    const b = browser({ ua: UA.tiktokIos, hidden: true });
    vi.advanceTimersByTime(1000);
    expect(b.beacons).toHaveLength(0);
    b.show();
    expect(b.types()).toEqual(["VIEW"]);
    b.hide();
    b.show();
    expect(b.types()).toEqual(["VIEW"]);
  });

  it("Safari iPhone : lien https natif (lien universel), sans repli ni attente", () => {
    const b = browser({ ua: UA.safariIos });
    vi.advanceTimersByTime(20);
    b.click();
    expect(b.button.href).toBe(HREF);
    expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
    vi.advanceTimersByTime(5000);
    expect(b.nav).toEqual([]);
  });

  it("Chrome Android et ordinateur : lien https natif", () => {
    for (const ua of [UA.chromeAndroid, UA.desktopChrome]) {
      const b = browser({ ua });
      b.click();
      expect(b.button.href).toBe(HREF);
      expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
    }
  });

  it("clic avant l'affichage : la visite part d'abord, puis le clic", () => {
    const b = browser({ ua: UA.safariIos });
    b.click();
    expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
    vi.advanceTimersByTime(20);
    expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
  });

  it("Instagram iPhone : tg://join?invite=, puis repli https après 2 s si la page est toujours visible", () => {
    const b = browser({ ua: UA.instagramIos });
    b.click();
    // La nouvelle adresse est posée dans le gestionnaire : la navigation native part aussitôt.
    expect(b.button.href).toBe(TG);
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME"]);
    vi.advanceTimersByTime(1999);
    expect(b.nav).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(b.nav).toEqual([HREF]);
    // Notre propre repli n'est pas « Telegram ouvert ».
    b.hide();
    b.pagehide();
    vi.advanceTimersByTime(10);
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME"]);
    // Le lien reprend son adresse https (appui long, copie).
    vi.advanceTimersByTime(600);
    expect(b.button.href).toBe(HREF);
  });

  it("Telegram s'ouvre (page en arrière-plan en moins de 2 s) : OPENED, et pas de repli", () => {
    const b = browser({ ua: UA.instagramIos });
    b.click();
    vi.advanceTimersByTime(400);
    b.hide();
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME", "OPENED:TG_SCHEME"]);
    vi.advanceTimersByTime(5000);
    expect(b.nav).toEqual([]);
    b.show();
    b.hide();
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME", "OPENED:TG_SCHEME"]);
  });

  it("page quittée plus de 2 s après le clic : pas d'OPENED, et pas de repli au retour", () => {
    const b = browser({ ua: UA.instagramIos });
    b.blur(); // pas de clic : rien n'est reporté
    b.click();
    b.blur(); // boîte de dialogue « Ouvrir dans Telegram ? » : le repli est reporté, pas annulé
    vi.advanceTimersByTime(2500);
    expect(b.nav).toEqual([]);
    b.hide(); // « Ouvrir » touché après 2 s : l'appli s'ouvre
    vi.advanceTimersByTime(10);
    b.show();
    b.focus();
    vi.advanceTimersByTime(5000);
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME"]);
    expect(b.nav).toEqual([]);
  });

  it("boîte de dialogue fermée sans ouvrir l'appli (perte puis retour du focus) : le repli part au retour", () => {
    // Telegram absent : « Impossible d'ouvrir » ou « Annuler » ; la page n'est jamais passée en arrière-plan.
    const b = browser({ ua: UA.instagramIos });
    b.click();
    vi.advanceTimersByTime(300);
    b.blur();
    vi.advanceTimersByTime(4000);
    expect(b.nav).toEqual([]);
    b.focus();
    expect(b.nav).toEqual([HREF]);
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME"]);
    // Retour bien plus tard (plus de 10 s après le clic) : rien ne part tout seul.
    const late = browser({ ua: UA.instagramIos });
    late.click();
    late.blur();
    vi.advanceTimersByTime(12_000);
    late.focus();
    expect(late.nav).toEqual([]);
    // Android (Chrome demande « Continuer vers Telegram ? ») : même règle.
    const a = browser({ ua: UA.instagramAndroid });
    a.click();
    a.blur();
    vi.advanceTimersByTime(3000);
    expect(a.nav).toEqual([]);
    a.focus();
    expect(a.nav).toEqual([HREF]);
  });

  it("2e appui de la même visite : le lien https après une tentative par l'appli, même après rechargement", () => {
    // Même page : tg://, puis https, puis de nouveau tg://.
    const b = browser({ ua: UA.instagramIos });
    b.click();
    expect(b.button.href).toBe(TG);
    b.click();
    expect(b.button.href).toBe(HREF);
    b.click();
    expect(b.button.href).toBe(TG);
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME", "CLICK:HTTPS", "CLICK:TG_SCHEME"]);
    expect(b.session.get("lj:page1:tk01:m")).toBe("TG_SCHEME");
    // Page rechargée (retour après une page d'erreur de la vue web) : la façon essayée est gardée pour l'onglet.
    const again = browser({ ua: UA.tiktokAndroid, session: { "lj:page1:tk01:m": "TG_SCHEME" } });
    again.click();
    expect(again.button.href).toBe(HREF);
    expect(again.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
    const intent = browser({ ua: UA.facebookAndroid, session: { "lj:page1:tk01:m": "INTENT" } });
    intent.click();
    expect(intent.button.href).toBe(HREF);
    // Navigateurs sans autre façon (Safari, vue web Android inconnue) : toujours https.
    const safari = browser({ ua: UA.safariIos, session: { "lj:page1:tk01:m": "HTTPS" } });
    safari.click();
    expect(safari.button.href).toBe(HREF);
  });

  it("TikTok iPhone : tirage entre tg:// (repli 2 s) et le lien https direct, puis alternance", () => {
    const a = browser({ ua: UA.tiktokIos, random: 0.1 });
    a.click();
    expect(a.button.href).toBe(TG);
    vi.advanceTimersByTime(2600);
    expect(a.nav).toEqual([HREF]);
    a.click();
    expect(a.button.href).toBe(HREF);
    expect(a.types()).toEqual(["VIEW", "CLICK:TG_SCHEME", "CLICK:HTTPS"]);

    const b = browser({ ua: UA.tiktokIos, random: 0.9 });
    b.click();
    expect(b.button.href).toBe(HREF);
    vi.advanceTimersByTime(3000);
    expect(b.nav).toEqual([]);
    b.click();
    expect(b.button.href).toBe(TG);
  });

  it("lien https dans une appli : une navigation vers t.me (page déchargée) n'est pas « Telegram ouvert »", () => {
    const b = browser({ ua: UA.tiktokIos, random: 0.9 });
    b.click();
    vi.advanceTimersByTime(300);
    // Déchargement : les moteurs (WebKit, Chromium) envoient pagehide AVANT le passage en arrière-plan.
    b.pagehide();
    b.hide();
    vi.advanceTimersByTime(10);
    expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
    // Lien universel : l'appli s'ouvre, la page reste chargée en arrière-plan.
    const c = browser({ ua: UA.tiktokIos, random: 0.9 });
    c.click();
    vi.advanceTimersByTime(300);
    c.hide();
    vi.advanceTimersByTime(1);
    expect(c.types()).toEqual(["VIEW", "CLICK:HTTPS", "OPENED:HTTPS"]);
  });

  it("tg:// puis page déchargée (page d'erreur ou blanche de la vue web, retour, fermeture) : pas d'OPENED", () => {
    // TikTok Android, tirage tg:// : la vue web remplace la page par une page d'erreur 80 ms après le clic.
    for (const order of ["pagehide-first", "hidden-first"] as const) {
      const b = browser({ ua: UA.tiktokAndroid, random: 0.1 });
      b.click();
      expect(b.button.href).toBe(TG);
      vi.advanceTimersByTime(80);
      if (order === "pagehide-first") {
        b.pagehide();
        b.hide();
      } else {
        b.hide();
        b.pagehide();
      }
      vi.advanceTimersByTime(3000);
      expect(b.types()).toEqual(["VIEW", "CLICK:TG_SCHEME"]);
    }
    // iPhone : même règle quand la page est remplacée (pagehide d'abord).
    const i = browser({ ua: UA.instagramIos });
    i.click();
    vi.advanceTimersByTime(80);
    i.pagehide();
    i.hide();
    vi.advanceTimersByTime(3000);
    expect(i.types()).toEqual(["VIEW", "CLICK:TG_SCHEME"]);
    // Page gardée par le navigateur (retour arrière) puis rendue : un nouvel appui compte normalement.
    i.pageshow(true);
    i.show();
    i.click();
    vi.advanceTimersByTime(200);
    i.hide();
    expect(i.types()).toEqual(["VIEW", "CLICK:TG_SCHEME", "CLICK:HTTPS", "OPENED:HTTPS"]);
    // tg:// sur Android et l'appli s'ouvre (page gardée en arrière-plan) : OPENED.
    const ok = browser({ ua: UA.tiktokAndroid, random: 0.1 });
    ok.click();
    vi.advanceTimersByTime(200);
    ok.hide();
    vi.advanceTimersByTime(1);
    expect(ok.types()).toEqual(["VIEW", "CLICK:TG_SCHEME", "OPENED:TG_SCHEME"]);
    expect(ok.nav).toEqual([]);
  });

  it("TikTok Android : tirage entre le lien https direct et tg:// (repli 1,5 s), puis alternance", () => {
    const a = browser({ ua: UA.tiktokAndroid, random: 0.1 });
    a.click();
    expect(a.button.href).toBe(TG);
    vi.advanceTimersByTime(1499);
    expect(a.nav).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(a.nav).toEqual([HREF]);
    a.click();
    expect(a.button.href).toBe(HREF);

    const b = browser({ ua: UA.tiktokAndroid, random: 0.9 });
    b.click();
    expect(b.button.href).toBe(HREF);
    vi.advanceTimersByTime(3000);
    expect(b.nav).toEqual([]);
    b.click();
    expect(b.button.href).toBe(TG);
    // intent:// n'est jamais tiré dans TikTok (« not dependable » selon le tableau inapp-debugger).
    for (const random of [0.1, 0.9]) {
      const c = browser({ ua: UA.tiktokAndroid, random });
      c.click();
      c.click();
      expect(c.types().filter((t) => t.includes("INTENT"))).toEqual([]);
    }
  });

  it("Instagram et Facebook Android : intent:// (repli 1,5 s) ; autres vues web Android : lien https ; Snapchat iPhone : tg://", () => {
    for (const ua of [UA.instagramAndroid, UA.facebookAndroid]) {
      for (const random of [0.1, 0.9]) {
        const c = browser({ ua, random });
        c.click();
        expect(c.button.href).toBe(INTENT);
        vi.advanceTimersByTime(1500);
        expect(c.nav).toEqual([HREF]);
      }
    }
    for (const random of [0.1, 0.9]) {
      const a = browser({ ua: UA.androidWebView, random });
      a.click();
      expect(a.button.href).toBe(HREF);
      vi.advanceTimersByTime(5000);
      expect(a.nav).toEqual([]);
    }
    const b = browser({ ua: UA.snapchatIos });
    b.click();
    expect(b.button.href).toBe(TG);
  });

  it("intent:// : OPENED si l'appli s'ouvre, rien si la page navigue vers le lien de repli", () => {
    const a = browser({ ua: UA.instagramAndroid });
    a.click();
    vi.advanceTimersByTime(200);
    a.hide();
    expect(a.types()).toEqual(["VIEW", "CLICK:INTENT"]); // Android : envoi à la fin de la tâche
    vi.advanceTimersByTime(1);
    expect(a.types()).toEqual(["VIEW", "CLICK:INTENT", "OPENED:INTENT"]);
    const b = browser({ ua: UA.instagramAndroid });
    b.click();
    vi.advanceTimersByTime(200);
    b.pagehide();
    b.hide();
    vi.advanceTimersByTime(2000);
    expect(b.types()).toEqual(["VIEW", "CLICK:INTENT"]);
    expect(b.nav).toEqual([]);
  });

  it("sans pixel : aucun script extérieur chargé", () => {
    const b = browser({ ua: UA.safariIos });
    b.load();
    vi.advanceTimersByTime(5000);
    b.click();
    expect(b.scripts).toEqual([]);
    expect(b.win.ttq).toBeUndefined();
    expect(b.win.fbq).toBeUndefined();
  });

  it("pixels chargés après load puis au repos ; PageView à l'affichage, ClickButton et Contact au clic", () => {
    const b = browser({
      ua: UA.tiktokIos,
      readyState: "loading",
      dataset: { tt: "CD2UC93C77U35BVUO310", fb: "1070571443971391" },
    });
    vi.advanceTimersByTime(1000);
    expect(b.scripts).toEqual([]); // pas avant load
    b.load();
    expect(b.scripts).toEqual([]); // pas pendant load : au repos
    vi.advanceTimersByTime(5);
    expect(b.scripts.map((s) => s.src)).toEqual([
      "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=CD2UC93C77U35BVUO310&lib=ttq",
      "https://connect.facebook.net/en_US/fbevents.js",
    ]);
    expect(b.scripts.every((s) => s.async)).toBe(true);
    const ttq = b.win.ttq as unknown[];
    const fbq = b.win.fbq as { queue: unknown[][] };
    expect(ttq.map((c) => (c as unknown[])[0])).toEqual(["page"]);
    expect(fbq.queue.map((c) => [...c])).toEqual([
      ["init", "1070571443971391"],
      ["track", "PageView"],
    ]);
    b.click();
    expect(ttq.map((c) => (c as unknown[]).join(":"))).toEqual(["page", "track:ClickButton"]);
    expect(fbq.queue.map((c) => [...c].join(":")).at(-1)).toBe("track:Contact");
  });

  it("clic avant le chargement des pixels : ils démarrent au clic, l'événement n'est pas perdu", () => {
    const b = browser({
      ua: UA.instagramIos,
      readyState: "loading",
      dataset: { tt: "CD2UC93C77U35BVUO310" },
    });
    b.click();
    const ttq = b.win.ttq as unknown[];
    expect(ttq.map((c) => (c as unknown[]).join(":"))).toEqual(["page", "track:ClickButton"]);
    expect(b.scripts).toHaveLength(1);
  });

  it("bandeau cookies : aucun pixel avant « Accepter » ; « Refuser » n'en charge jamais ; le choix est gardé", () => {
    const now = new Date("2026-10-15T10:00:00Z").getTime();
    const tt = { tt: "CD2UC93C77U35BVUO310" };
    const a = browser({ ua: UA.tiktokIos, banner: true, dataset: tt });
    vi.advanceTimersByTime(5000);
    a.click();
    expect(a.scripts).toEqual([]);
    expect(a.win.ttq).toBeUndefined();
    a.accept.onclick!();
    expect(a.bannerState.removed).toBe(true);
    // Choix gardé par partenaire, daté.
    expect(JSON.parse(a.local.get("lj:ck")!)).toEqual({ v: 1, tt: [1, now + 5000] });
    vi.advanceTimersByTime(5);
    expect(a.scripts).toHaveLength(1);

    const r = browser({ ua: UA.tiktokIos, banner: true, dataset: tt });
    const declinedAt = Date.now();
    r.decline.onclick!();
    vi.advanceTimersByTime(5000);
    r.click();
    expect(r.scripts).toEqual([]);
    expect(JSON.parse(r.local.get("lj:ck")!)).toEqual({ v: 1, tt: [0, declinedAt] });

    const accepted = JSON.stringify({ v: 1, tt: [1, now - 1000] });
    const back = browser({
      ua: UA.tiktokIos,
      banner: true,
      dataset: tt,
      stored: { "lj:ck": accepted },
    });
    expect(back.bannerState.removed).toBe(true);
    vi.advanceTimersByTime(5);
    expect(back.scripts).toHaveLength(1);
    const refused = browser({
      ua: UA.tiktokIos,
      banner: true,
      dataset: tt,
      stored: { "lj:ck": JSON.stringify({ v: 1, tt: [0, now - 1000] }) },
    });
    expect(refused.bannerState.removed).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(refused.scripts).toEqual([]);
  });

  it("bandeau cookies : un accord ne vaut que pour les partenaires acceptés, et 6 mois au plus", () => {
    const now = new Date("2026-10-15T10:00:00Z").getTime();
    const both = { tt: "CD2UC93C77U35BVUO310", fb: "1070571443971391" };
    // Accord donné sur une page qui n'avait que TikTok : une page avec Meta redemande, et rien ne part avant.
    const onlyTt = JSON.stringify({ v: 1, tt: [1, now - 1000] });
    const meta = browser({
      ua: UA.instagramIos,
      banner: true,
      dataset: { fb: both.fb },
      stored: { "lj:ck": onlyTt },
    });
    expect(meta.bannerState.removed).toBe(false);
    vi.advanceTimersByTime(5000);
    meta.click();
    expect(meta.scripts).toEqual([]);
    expect(meta.win.fbq).toBeUndefined();
    meta.accept.onclick!();
    expect(JSON.parse(meta.local.get("lj:ck")!)).toEqual({
      v: 1,
      tt: [1, now - 1000],
      fb: [1, now + 5000],
    });
    // Page avec les deux, TikTok accepté et Meta refusé : seul TikTok se charge, sans bandeau.
    const mixed = browser({
      ua: UA.instagramIos,
      banner: true,
      dataset: both,
      stored: { "lj:ck": JSON.stringify({ v: 1, tt: [1, now - 1000], fb: [0, now - 1000] }) },
    });
    expect(mixed.bannerState.removed).toBe(true);
    vi.advanceTimersByTime(5);
    expect(mixed.scripts.map((x) => x.src)).toEqual([
      "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=CD2UC93C77U35BVUO310&lib=ttq",
    ]);
    mixed.click();
    expect(mixed.win.fbq).toBeUndefined();
    // Choix de plus de 6 mois, ou ancien format sans date : le bandeau revient.
    const old = now - 183 * 24 * 3600 * 1000;
    for (const stored of [JSON.stringify({ v: 1, tt: [1, old] }), "1", "{oops"]) {
      const again = browser({
        ua: UA.tiktokIos,
        banner: true,
        dataset: { tt: both.tt },
        stored: { "lj:ck": stored },
      });
      expect(again.bannerState.removed).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(again.scripts).toEqual([]);
    }
  });

  it("repli fetch keepalive quand sendBeacon refuse", () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const winL: Record<string, Listener[]> = {};
    const run = new Function(
      "window",
      "document",
      "navigator",
      "location",
      "sessionStorage",
      "localStorage",
      "Math",
      "fetch",
      LANDING_SCRIPT,
    );
    run(
      {
        addEventListener: (t: string, f: Listener) => (winL[t] ??= []).push(f),
        crypto: globalThis.crypto,
      },
      {
        body: { dataset: { p: "page1", s: "" } },
        visibilityState: "visible",
        readyState: "complete",
        getElementById: (id: string) =>
          id === "b" ? { href: HREF, addEventListener: () => undefined } : null,
        addEventListener: () => undefined,
      },
      { userAgent: UA.safariIos, sendBeacon: () => false },
      { search: "" },
      { getItem: () => null, setItem: () => undefined },
      { getItem: () => null, setItem: () => undefined },
      Math,
      (url: string, init: RequestInit) => calls.push({ url, init }),
    );
    vi.advanceTimersByTime(20);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/j/_e");
    expect(calls[0]!.init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ t: "VIEW", s: "" });
  });
});
