import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LANDING_ESCAPE_MAX_AGE_MS,
  LANDING_EVENT_KINDS,
  LANDING_LANGS,
  LANDING_OPENED_AFTER_PROMPT_MS,
  LANDING_OPENED_INAPP_WINDOW_MS,
  LANDING_OPENED_WINDOW_MS,
  LANDING_SENT_OPEN_METHODS,
  resolveLandingSource,
  type LandingSourceLike,
} from "./landing";
import {
  ESCAPE_APPS,
  ESCAPE_OPEN_METHOD,
  ESCAPE_SYSTEMS,
  detectEscapeApp,
  escapeHelpData,
  escapeSpotFor,
  type EscapeSystem,
} from "./landing-escape";
import * as renderModule from "./landing-render";
import {
  LANDING_HEAD_SCRIPT,
  LANDING_PIXEL_SCRIPT,
  LANDING_SCRIPT,
  LANDING_STYLE,
  LANDING_TEXT_LIMITS,
  escapeLandingHtml,
  escapeLandingText,
  landingButtonHref,
  landingText,
  renderEscapeHelpHtml,
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
    expect(html.startsWith('<!doctype html><html lang="fr" data-k="AbCdEf123_-x">')).toBe(true);
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
    expect(en).toContain('<html lang="en" ');
    expect(en).toContain("<span>Join the channel →</span>");
    expect(renderLandingHtml({ ...BASE, lang: "pt-BR" })).toContain('<html lang="pt" ');
    expect(renderLandingHtml({ ...BASE, lang: "xx" })).toContain('<html lang="fr" ');
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
    // Textes entre balises : « < » toujours échappé ; « & » seulement là où il pourrait commencer une référence ;
    // guillemets et apostrophes tels quels (sans danger hors d'un attribut, et 4 octets de moins chacun).
    expect(html).toContain("<title>&lt;/title>&lt;script>alert(1)&lt;/script></title>");
    expect(html).toContain('Tom & Jerry\'s "club"');
    expect(html).toContain("<span>&lt;b>Go&lt;/b></span>");
    expect(escapeLandingText("a&b &amp; &#39; &x; R&D & < > \" '")).toBe(
      "a&amp;b &amp;amp; &amp;#39; &amp;x; R&amp;D & &lt; > \" '",
    );
    expect(html).toContain('data-p="x&quot; onload=&quot;alert(1)"');
    expect(html).toContain('data-s="&quot;&gt;&lt;script&gt;"');
    // Deux balises <script> seulement : celle du début du <head> et celle de la page (aucune injectée).
    expect(html.match(/<script>/g)).toHaveLength(2);
    expect(escapeLandingHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("coupe les textes trop longs sans couper un emoji et retire les caractères de contrôle", () => {
    expect(landingText("a\u0000b\nc d", 10)).toBe("a b c d");
    expect(landingText("🎰".repeat(5), 3)).toBe("🎰🎰🎰");
    const long = renderLandingHtml({ ...BASE, headline: "x".repeat(500) });
    expect(long).toContain(`<h1>${"x".repeat(LANDING_TEXT_LIMITS.headline)}</h1>`);
  });

  it("pèse moins de 15 Ko avec les textes les plus longs autorisés, l'aide comprise (hors script des pixels), dans chaque langue", () => {
    // Pire cas : emojis de 4 octets partout, puis « < » (4 octets une fois échappé), puis les caractères que l'ancien
    // échappement allongeait (« & » devant une lettre, guillemets, apostrophe) ; sans pixel, puis avec les deux pixels
    // ET le bandeau cookies (le script des pixels, chargé à part, n'est pas compté : « hors pixels »).
    let worst = 0;
    for (const lang of LANDING_LANGS) {
      for (const ch of ["🎰", "<", "&a", '"', "'"]) {
        for (const pixels of [false, true]) {
          const doc = renderLandingDocument({
            ...BASE,
            lang,
            channelTitle: ch.repeat(LANDING_TEXT_LIMITS.channelTitle),
            headline: ch.repeat(LANDING_TEXT_LIMITS.headline),
            subtext: ch.repeat(LANDING_TEXT_LIMITS.subtext),
            buttonText: ch.repeat(LANDING_TEXT_LIMITS.buttonText),
            footnote: ch.repeat(LANDING_TEXT_LIMITS.footnote),
            photoUrl: "/j/_p/cm1234567890abcdefghijkl.jpg?v=0123456789abcdef",
            pageId: "c".repeat(30),
            sourceKey: "s".repeat(32),
            ...(pixels
              ? {
                  tiktokPixelId: "CD2UC93C77U35BVUO310",
                  metaPixelId: "10705714439713910000",
                  cookieBanner: true,
                }
              : {}),
          });
          expect(doc.html).toContain('id="h"');
          expect(!!doc.pixelScript).toBe(pixels);
          if (pixels) expect(doc.html).toContain('id="k"');
          const size =
            bytes(doc.html) - (doc.pixelScript ? bytes(`<script>${doc.pixelScript}</script>`) : 0);
          worst = Math.max(worst, size);
          expect(size, `${lang} ${ch} ${pixels ? "pixels + bandeau" : "sans pixel"}`).toBeLessThan(
            15 * 1024,
          );
        }
      }
    }
    // Marge gardée pour les prochaines retouches de l'aide.
    expect(worst).toBeLessThan(15 * 1024 - 200);
    // Avec les deux pixels et le bandeau cookies : toujours sous 15 Ko (les pixels eux-mêmes sont chargés après).
    const withPixels = renderLandingHtml({
      ...BASE,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      metaPixelId: "1070571443971391",
      cookieBanner: true,
    });
    expect(bytes(withPixels)).toBeLessThan(15 * 1024);
    // Page ordinaire sans pixel : bien en dessous (le script des pixels n'y est pas).
    expect(bytes(renderLandingHtml(BASE))).toBeLessThan(12 * 1024);
  });

  it("aide : flèche fixe à l'écran (l'aide peut défiler) ; « ⋮ » tourné sans élargir la phrase", () => {
    const rule = (sel: string) =>
      new RegExp(`(?:^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`).exec(
        LANDING_STYLE,
      )?.[1] ?? "";
    // L'aide défile dans un écran bas (paysage) : la flèche, elle, reste sur le bouton du menu de l'appli.
    expect(rule(".h")).toContain("overflow:auto");
    expect(rule(".ha")).toMatch(/^position:fixed;/);
    // « ••• » tourné : boîte étroite (la place d'un point), les trois points centrés débordent des deux côtés.
    expect(rule(".hv")).toBe(
      "display:inline-flex;justify-content:center;width:.4em;transform:rotate(90deg)",
    );
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

  it("<head> : seulement charset, le petit script d'ouverture (avant le CSS), viewport, titre et CSS en ligne", () => {
    const html = renderLandingHtml({
      ...BASE,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      metaPixelId: "1070571443971391",
      photoUrl: "/j/_p/ch1.jpg",
    });
    const h = head(html);
    // Tout début du <head> : charset puis le script d'ouverture, avant le CSS (exécuté avant le reste de la page).
    expect(h.startsWith(`<meta charset="utf-8"><script>${LANDING_HEAD_SCRIPT}</script>`)).toBe(
      true,
    );
    expect(h.indexOf("<script>")).toBeLessThan(h.indexOf("<style>"));
    expect(h.match(/<script/g)).toHaveLength(1);
    const rest = h.replace(`<script>${LANDING_HEAD_SCRIPT}</script>`, "");
    expect(rest).not.toMatch(/<script|<link|<iframe|<img|src=|href=|@import|url\(|https?:/i);
    expect(h).toContain(`<style>${LANDING_STYLE}</style>`);
    // Le script du <head> ne charge rien et n'écrit rien dans la page.
    expect(LANDING_HEAD_SCRIPT).not.toMatch(
      /createElement|appendChild|document\.write|https?:\/\//,
    );
    // Polices du système seulement.
    expect(LANDING_STYLE).toContain("-apple-system");
    expect(LANDING_STYLE).not.toMatch(/@font-face|url\(/);
    // Le script de la page est à la fin du <body>, en ligne : il ne bloque pas l'affichage ; puis celui des pixels.
    const plain = renderLandingHtml(BASE);
    expect(plain.indexOf(`<script>${LANDING_SCRIPT}`)).toBeGreaterThan(plain.indexOf('<a id="b"'));
    expect(plain.endsWith(`<script>${LANDING_SCRIPT}</script></body></html>`)).toBe(true);
    expect(html.endsWith(`<script>${LANDING_PIXEL_SCRIPT}</script></body></html>`)).toBe(true);
    // Code d'invitation pour l'ouverture automatique, écrit par le serveur avant le script.
    expect(plain.startsWith('<!doctype html><html lang="fr" data-k="AbCdEf123_-x"><head>')).toBe(
      true,
    );
  });

  it("rend l'aide « Ouvrir dans le navigateur » cachée, dans la langue de la page, avec la table complète", () => {
    const html = renderLandingHtml(BASE);
    expect(html).toContain(
      '<div id="h" class="h" role="dialog" aria-modal="true" aria-labelledby="ht" tabindex="-1" hidden data-t=\'',
    );
    // Avant le script de la page (qui la lit), après le contenu.
    expect(html.indexOf('id="h"')).toBeGreaterThan(html.indexOf("</main>"));
    expect(html.indexOf('id="h"')).toBeLessThan(html.indexOf(`<script>${LANDING_SCRIPT}`));
    expect(html).toContain('<p id="ht" class="hb">Appuie sur <b class="hs"></b></p>');
    expect(html).toContain('<p class="hp">puis «\u00a0<b class="hl"></b>\u00a0»</p>');
    expect(html).toContain(
      '<ol class="hn"><li>Appuie sur <b class="hs"></b> <span class="hw"></span></li><li>Choisis «\u00a0<b class="hl"></b>\u00a0»</li><li>Accepte d\'ouvrir Telegram et rejoins le canal</li></ol>',
    );
    expect(html).toContain('<button type="button" id="hr">Réessayer</button>');
    expect(html).toContain('<button type="button" id="hx">Fermer</button>');
    expect(html).toContain('<svg id="ha" class="ha"');
    // Table de la langue de la page, lisible telle quelle par le script.
    const raw = /data-t='([^']*)'/.exec(html)![1]!.replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    expect(JSON.parse(raw)).toEqual(JSON.parse(escapeHelpData("fr")));
    // Dans chaque langue : les textes de la langue.
    expect(renderLandingHtml({ ...BASE, lang: "en" })).toContain(
      '<p id="ht" class="hb">Tap <b class="hs"></b></p>',
    );
    expect(renderEscapeHelpHtml("de")).toContain("Erneut versuchen");
    // Cachée par défaut, et par la feuille de style même si une règle la mettait en flex.
    expect(LANDING_STYLE).toContain(".h[hidden]{display:none}");
    expect(LANDING_STYLE).toContain("#ffd43b");
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
    // Les scripts sont les mêmes pour toutes les pages (une empreinte CSP chacun) : réglages lus dans data-*.
    const other = renderLandingDocument({ ...BASE, pageId: "autre", sourceKey: "", lang: "it" });
    expect(other.script).toBe(LANDING_SCRIPT);
    expect(other.headScript).toBe(LANDING_HEAD_SCRIPT);
    expect(renderLandingDocument(BASE).script).toBe(LANDING_SCRIPT);
    expect(renderLandingDocument(BASE).headScript).toBe(LANDING_HEAD_SCRIPT);
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
    expect(none.pixelScript).toBeNull();
    expect(none.html).not.toContain(LANDING_PIXEL_SCRIPT);
    const both = renderLandingDocument({
      ...BASE,
      tiktokPixelId: "CD2UC93C77U35BVUO310",
      metaPixelId: "1070571443971391",
    });
    expect(both.pixels).toEqual({ tiktok: true, meta: true });
    expect(both.pixelScript).toBe(LANDING_PIXEL_SCRIPT);
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
    expect(doc.headScript).toBeNull();
    expect(doc.pixelScript).toBeNull();
    expect(doc.html).not.toContain("<script");
    expect(doc.html).not.toMatch(/data-p=|data-tt=|data-k=/);
    // L'aide n'a de sens qu'avec le script : absente de l'aperçu.
    expect(doc.html).not.toContain('id="h"');
    expect(doc.html).toContain('id="k"');
    expect(doc.html).toContain('<a id="b" href="https://t.me/+AbCdEf123_-x">');
  });
});

// ─── Scripts de la page, exécutés dans un navigateur simulé ──────────────────────────────────────────────────────

/** Agents utilisateurs : relevés en production (docs/tiktok-captures/agents-utilisateurs-reels.md) et classiques. */
const UA = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 musical_ly_47.1.0 BytedanceWebview/d8a21c6",
  tiktokIosOld:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1 musical_ly_46.5.4 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR isDarkMode/0 WKWebView/1 RevealType/Dialog",
  tiktokIosAds:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148thirdLandingPageFeInfra",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S921U Build/UP1A.231005.007; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 musical_ly_2024600020 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/46.0.2 ByteLocale/fr ByteFullLocale/fr Region/FR AppId/1233 Spark/1.7.2 AppVersion/46.0.2 PIA/2.5.3 BytedanceWebview/d8a21c6",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.32.105 (iPhone14,5; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 584287262)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/564431005;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.3.1;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5;FBRV/567052743]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 10; M2003J15SC Build/QP1A.190711.020; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.117 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/516.0.0.73.90;]",
  messengerIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/431.0.0.40.112;FBBV/528469617;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]",
  messengerAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.193 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/440.0.0.31.105;]",
  snapchatIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/605.1 Snapchat/13.42.0.47 (like Safari/8614.4.6.0.6, panda)",
  snapchatAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Snapchat/13.05.0.45 (Pixel 8; Android 14#11228111#34; gzip; )",
  naverIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1 NAVER(inapp; search; 2000; 12.13.2)",
  daumAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S921U Build/UP1A.231005.007; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.5938.60 Mobile Safari/537.36 DaumApps/8.1.2 DaumDevice/mobile",
  newsSapphire:
    "Mozilla/5.0 (Linux; Android 10; ONEPLUS A7010; ) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.40 Mobile Safari/E7FBAF NewsSapphire/32.0.430627001",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 12; M2101K6G Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36",
  telegramAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.3 (Samsung SM-A546B; Android 14; SDK 34; AVERAGE)",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  miuiAndroid:
    "Mozilla/5.0 (Linux; U; Android 12; fr-fr; Redmi Note 11 Build/SKQ1.211103.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.7.10-gn",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
} as const;

const HREF = "https://t.me/+AbCdEf123_-x";
const CODE = "AbCdEf123_-x";
/** Adresse ordinaire d'une page (sans identifiant de clic pub : ce serait un marqueur hors navigateur intégré). */
const PAGE_URL = "https://go.goolink.eu/j/promo?src=tk01&utm_source=tt";
/** Adresse d'une pub TikTok (`ttclid`), telle qu'ouverte dans le navigateur de TikTok. */
const AD_URL = "https://go.goolink.eu/j/promo?src=tk01&ttclid=E.C.P.TT1";

type Listener = (ev?: unknown) => void;
type Beacon = {
  url: string;
  body: { p: string; s: string; v: string; t: string; m: string | null; q: string };
};
type FakeEl = {
  id: string;
  tag?: string;
  src?: string;
  textContent?: string;
  style: Record<string, string>;
  parentNode?: { removeChild: (el: FakeEl) => void } | null;
  className?: string;
  attrs?: Record<string, string>;
  setAttribute?: (n: string, v: string) => void;
};

/** Élément de l'aide rempli par le script (texte, classe, attributs). */
function slot(className?: string): FakeEl {
  const el: FakeEl = { id: "", style: {}, className, attrs: {} };
  el.setAttribute = (n, v) => (el.attrs![n] = v);
  return el;
}

/** Repère `tgt` (minute de la pose, base 36) tel que la page l'écrit, `minutesAgo` minutes avant l'heure simulée. */
function tgt(minutesAgo = 0): string {
  return (Math.floor(Date.now() / 6e4) - minutesAgo).toString(36);
}

/** Minuteries posées par les scripts (délai demandé), pour vérifier qu'aucune n'atteint 1 s. */
const timers: number[] = [];

/**
 * Navigateur minimal (document, fenêtre, bouton, aide, adresse, historique, stockage, sendBeacon) : exécute
 * `LANDING_HEAD_SCRIPT`, `LANDING_SCRIPT` (et `LANDING_PIXEL_SCRIPT` si la page a un pixel) tels quels, dans l'ordre
 * de la page, avec les minuteries simulées de vitest.
 */
function browser(opts: {
  ua: string;
  url?: string;
  random?: number;
  dataset?: Record<string, string>;
  banner?: boolean;
  stored?: Record<string, string>;
  /** Stockage de l'onglet (partagé entre deux chargements du même onglet si on passe la même Map). */
  session?: Map<string, string> | Record<string, string>;
  /** sessionStorage indisponible (lève). */
  noStorage?: boolean;
  /** `history.replaceState` refusé (lève). */
  noHistory?: boolean;
  hidden?: boolean;
  readyState?: string;
  /** Code d'invitation de `<html data-k>` (null : absent). */
  dataK?: string | null;
  lang?: string;
  maxTouchPoints?: number;
}) {
  const winL: Record<string, Listener[]> = {};
  const docL: Record<string, Listener[]> = {};
  const btnL: Record<string, Listener[]> = {};
  const beacons: Beacon[] = [];
  const scripts: Array<{ src?: string; async?: boolean }> = [];
  const nav: string[] = [];
  /** Aide visible au moment de chaque demande d'adresse (`location.href = …`). */
  const navHelp: boolean[] = [];
  const marks: string[] = [];
  const frames: FakeEl[] = [];
  const replaced: string[] = [];
  const session =
    opts.session instanceof Map ? opts.session : new Map(Object.entries(opts.session ?? {}));
  const local = new Map(Object.entries(opts.stored ?? {}));
  const on = (map: Record<string, Listener[]>) => (type: string, fn: Listener) => {
    (map[type] ??= []).push(fn);
  };
  const focus = { el: "" };
  const button = {
    href: HREF,
    className: "",
    addEventListener: on(btnL),
    focus: () => (focus.el = "b"),
  };
  const classes: Record<string, FakeEl[]> = {
    hs: [slot("hs"), slot("hs")],
    hl: [slot(), slot()],
    hw: [slot()],
  };
  const help = {
    hidden: true,
    getAttribute: (n: string) => (n === "data-t" ? escapeHelpData(opts.lang ?? "fr") : null),
    getElementsByClassName: (c: string) => classes[c] ?? [],
    focus: () => (focus.el = "h"),
  };
  const arrow = {
    style: { top: "", right: "", bottom: "", left: "" } as Record<string, string>,
    cls: "ha",
    setAttribute: (n: string, v: string) => {
      if (n === "class") arrow.cls = v;
    },
  };
  const retry = { onclick: null as null | (() => void) };
  const close = { onclick: null as null | (() => void) };
  const accept = { onclick: null as null | (() => void) };
  const decline = { onclick: null as null | (() => void) };
  const bannerState = { removed: false };
  const banner = opts.banner
    ? { parentNode: { removeChild: () => (bannerState.removed = true) } }
    : null;
  const body = {
    dataset: { p: "page1", s: "tk01", ...(opts.dataset ?? {}) } as Record<string, string>,
    appendChild: (el: FakeEl) => {
      el.parentNode = { removeChild: (x) => frames.splice(frames.indexOf(x), 1) };
      frames.push(el);
    },
  };
  const ids: Record<string, unknown> = {
    b: button,
    h: help,
    ha: arrow,
    hr: retry,
    hx: close,
    k: banner,
    ka: accept,
    kr: decline,
  };
  const doc = {
    body,
    documentElement: {
      getAttribute: (n: string) =>
        n === "data-k" ? (opts.dataK === undefined ? CODE : opts.dataK) : null,
    },
    visibilityState: opts.hidden ? "hidden" : "visible",
    readyState: opts.readyState ?? "complete",
    prerendering: false,
    head: { appendChild: (el: { src?: string }) => scripts.push(el) },
    createElement: (tag: string) => ({ tag, style: {} }) as FakeEl,
    getElementById: (id: string) => ids[id] ?? null,
    addEventListener: on(docL),
  };
  const url = new URL(opts.url ?? PAGE_URL);
  const location = {
    get search() {
      return url.search;
    },
    get pathname() {
      return url.pathname;
    },
    get hash() {
      return url.hash;
    },
    get origin() {
      return url.origin;
    },
    get href() {
      return url.href;
    },
    set href(v: string) {
      nav.push(v);
      navHelp.push(!help.hidden);
    },
  };
  const history = {
    state: null,
    replaceState: (_s: unknown, _t: string, next: string) => {
      if (opts.noHistory) throw new Error("SecurityError");
      const u = new URL(next, url.href);
      url.pathname = u.pathname;
      url.search = u.search;
      url.hash = u.hash;
      replaced.push(u.pathname + u.search + u.hash);
    },
  };
  const win: Record<string, unknown> = {
    crypto: globalThis.crypto,
    addEventListener: on(winL),
    requestAnimationFrame: (f: () => void) => setTimeout(f, 16),
  };
  const navigator = {
    userAgent: opts.ua,
    maxTouchPoints: opts.maxTouchPoints ?? 5,
    sendBeacon: (u: string, b: string) => {
      beacons.push({ url: u, body: JSON.parse(b) });
      return true;
    },
  };
  const storage = (m: Map<string, string>, broken = false) => ({
    getItem: (k: string) => {
      if (broken) throw new Error("SecurityError");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("SecurityError");
      m.set(k, v);
    },
  });
  const performance = { mark: (n: string) => marks.push(n) };
  const math = Object.create(Math, { random: { value: () => opts.random ?? 0.1 } });
  const fakeSetTimeout = (f: () => void, ms?: number) => {
    timers.push(ms ?? 0);
    return setTimeout(f, ms);
  };
  const args = [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "sessionStorage",
    "localStorage",
    "performance",
    "Math",
    "fetch",
    "setTimeout",
  ];
  const values = [
    win,
    doc,
    navigator,
    location,
    history,
    storage(session, opts.noStorage),
    storage(local),
    performance,
    math,
    () => {
      throw new Error("fetch ne doit pas servir : sendBeacon a répondu");
    },
    fakeSetTimeout,
  ];
  new Function(...args, LANDING_HEAD_SCRIPT)(...values);
  new Function(...args, LANDING_SCRIPT)(...values);
  if (body.dataset.tt || body.dataset.fb) new Function(...args, LANDING_PIXEL_SCRIPT)(...values);
  const fire = (map: Record<string, Listener[]>, type: string, ev?: unknown) =>
    (map[type] ?? []).forEach((f) => f(ev));
  /** Fin de la lecture du HTML. */
  const domReady = () => {
    doc.readyState = "interactive";
    fire(docL, "DOMContentLoaded");
  };
  const click = () => {
    const ev = { defaultPrevented: false, preventDefault: () => (ev.defaultPrevented = true) };
    fire(btnL, "click", ev);
    return ev;
  };
  return {
    beacons,
    nav,
    navHelp,
    marks,
    frames,
    replaced,
    scripts,
    button,
    help,
    arrow,
    classes,
    retry,
    close,
    focus,
    session,
    local,
    bannerState,
    win,
    accept,
    decline,
    url,
    types: () => beacons.map((b) => `${b.body.t}${b.body.m ? `:${b.body.m}` : ""}`),
    click,
    domReady,
    load: () => fire(winL, "load"),
    hide: () => {
      doc.visibilityState = "hidden";
      fire(docL, "visibilitychange");
    },
    show: () => {
      doc.visibilityState = "visible";
      fire(docL, "visibilitychange");
    },
    key: (key: string) => fire(docL, "keydown", { key }),
    pagehide: (persisted = false) => fire(winL, "pagehide", { persisted }),
    pageshow: (persisted = false) => fire(winL, "pageshow", { persisted }),
    blur: () => fire(winL, "blur"),
  };
}

describe("page d'atterrissage : scripts (navigateur simulé)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    timers.length = 0;
  });
  afterEach(() => {
    // Aucune minuterie d'au moins 1 s, dans aucun scénario (plus de repli vers t.me : exigence « aucun délai »).
    expect(Math.max(0, ...timers)).toBeLessThan(1000);
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
      q: "?src=tk01&utm_source=tt",
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

  it("navigateur ordinaire : le lien natif part tout de suite, sans preventDefault ni envoi dans le gestionnaire", () => {
    for (const ua of [
      UA.safariIos,
      UA.chromeIos,
      UA.chromeAndroid,
      UA.samsungAndroid,
      UA.miuiAndroid,
      UA.desktopChrome,
    ]) {
      const b = browser({ ua });
      const ev = b.click();
      // Rien ne retient le lien : la navigation native vers https://t.me/+… part dès la fin du gestionnaire.
      expect(ev.defaultPrevented, ua).toBe(false);
      expect(b.button.href).toBe(HREF);
      expect(b.button.className).toBe("p"); // état « appuyé » visible tout de suite
      expect(b.help.hidden).toBe(true);
      expect(b.frames).toEqual([]);
      expect(b.replaced).toEqual([]);
      // Envois APRÈS : rien n'est parti pendant l'appui.
      expect(b.beacons).toHaveLength(0);
      vi.advanceTimersByTime(20);
      expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
      vi.advanceTimersByTime(60_000);
      expect(b.nav).toEqual([]);
    }
  });

  it("navigateur ordinaire : envois partis avant que la page soit quittée (Telegram ouvert ou page t.me)", () => {
    // Lien universel : Telegram s'ouvre, la page passe en arrière-plan avant l'image suivante.
    const a = browser({ ua: UA.safariIos });
    a.click();
    a.hide();
    expect(a.types()).toEqual(["VIEW", "CLICK:HTTPS", "OPENED:HTTPS"]);
    // Telegram absent : la page part vers t.me (pagehide d'abord) : le clic part, pas d'OPENED.
    const b = browser({ ua: UA.chromeAndroid });
    b.click();
    b.pagehide();
    b.hide();
    vi.advanceTimersByTime(50);
    expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
  });

  it("navigateur intégré : preventDefault, marqueur dans l'adresse, aide tout de suite, cadre caché tg://, rien vers t.me", () => {
    const b = browser({ ua: UA.tiktokIos, url: AD_URL });
    vi.advanceTimersByTime(20);
    const v = b.beacons[0]!.body.v;
    // Dès l'affichage : repère de la visite (sans tgo : aucun appui encore), autres paramètres gardés.
    expect(b.replaced).toEqual([`/j/promo?src=tk01&ttclid=E.C.P.TT1&vid=${v}&tgt=${tgt()}`]);
    vi.advanceTimersByTime(60_000);
    const ev = b.click();
    expect(ev.defaultPrevented).toBe(true);
    // Aide affichée dans le gestionnaire même (image suivante), état « appuyé ».
    expect(b.help.hidden).toBe(false);
    expect(b.marks).toEqual(["lj:help"]);
    expect(b.button.className).toBe("p");
    // Adresse marquée (tgo=1, visite, minute de l'appui), autres paramètres gardés tels quels et dans l'ordre.
    expect(b.replaced[1]).toBe(`/j/promo?src=tk01&ttclid=E.C.P.TT1&tgo=1&vid=${v}&tgt=${tgt()}`);
    // Rien d'autre pendant l'appui : la tentative et les envois attendent que l'aide soit dessinée.
    expect(b.frames).toEqual([]);
    expect(b.types()).toEqual(["VIEW"]);
    vi.advanceTimersByTime(20);
    // Focus sur l'aide une fois dessinée (le donner pendant l'appui forçait sa mise en page avant l'image suivante).
    expect(b.focus.el).toBe("h");
    // Tentative discrète : cadre caché, la page reste ; le lien du bouton ne change pas.
    expect(b.frames.map((f) => [f.tag, f.src, f.style.display])).toEqual([
      ["iframe", `tg://join?invite=${CODE}`, "none"],
    ]);
    expect(b.button.href).toBe(HREF);
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_FRAME", "HELP:TIKTOK"]);
    // Plus jamais de repli vers la page t.me, même longtemps après, ni de nouvelle tentative toute seule.
    vi.advanceTimersByTime(120_000);
    expect(b.nav).toEqual([]);
    expect(b.frames).toHaveLength(1);
    expect(b.help.hidden).toBe(false);
  });

  it("l'aide revient à chaque appui ; « Réessayer » relance la tentative ; « Fermer » et Échap la cachent", () => {
    const b = browser({ ua: UA.snapchatIos });
    b.click();
    vi.advanceTimersByTime(20);
    b.close.onclick!();
    expect(b.help.hidden).toBe(true);
    expect(b.button.className).toBe("");
    expect(b.focus.el).toBe("b");
    b.click();
    expect(b.help.hidden).toBe(false);
    b.retry.onclick!();
    // Un seul cadre à la fois : l'ancien est retiré, un nouveau tente d'ouvrir.
    expect(b.frames).toHaveLength(1);
    expect(b.help.hidden).toBe(false);
    b.key("Escape");
    expect(b.help.hidden).toBe(true);
    b.key("Escape");
    b.click();
    vi.advanceTimersByTime(20);
    // Un CLICK par appui (les chiffres comptent les visites), HELP une fois par chargement.
    expect(b.types()).toEqual([
      "VIEW",
      "CLICK:TG_FRAME",
      "HELP:SNAPCHAT",
      "CLICK:TG_FRAME",
      "CLICK:TG_FRAME",
    ]);
    expect(b.nav).toEqual([]);
    expect(
      b.replaced
        .slice(1)
        .every((u) => u.endsWith(`&tgo=1&vid=${b.beacons[0]!.body.v}&tgt=${tgt()}`)),
    ).toBe(true);
  });

  it("Android dans Instagram, Facebook, Messenger : l'aide d'abord, puis intent://…;scheme=tg demandé par la page (l'appli l'intercepte) ; TikTok, Snapchat : cadre caché tg://", () => {
    for (const ua of [UA.instagramAndroid, UA.facebookAndroid, UA.messengerAndroid]) {
      const b = browser({ ua });
      const ev = b.click();
      expect(ev.defaultPrevented, ua).toBe(true);
      expect(b.help.hidden).toBe(false);
      // Rien pendant l'appui : l'aide est dessinée d'abord (l'activation par l'appui dure 5 s dans Chromium).
      expect(b.nav).toEqual([]);
      vi.advanceTimersByTime(20);
      // La sortie connue de ces applis (inapp-debugger, eiab) : une vraie demande de la page, pas un cadre caché.
      expect(b.nav, ua).toEqual([`intent://join?invite=${CODE}#Intent;scheme=tg;end`]);
      expect(b.frames).toEqual([]);
      // Code propre à cette façon (aide affichée, sans repli) : jamais confondu avec `INTENT` de la phase 15.
      expect(b.types().slice(1)).toEqual([
        "CLICK:INTENT_HELP",
        `HELP:${ua === UA.messengerAndroid ? "MESSENGER" : ua === UA.instagramAndroid ? "INSTAGRAM" : "FACEBOOK"}`,
      ]);
      // « Réessayer » : une nouvelle demande, avec le geste de cet appui.
      b.retry.onclick!();
      expect(b.nav).toHaveLength(2);
      // Jamais vers la page t.me, ni toute seule plus tard.
      vi.advanceTimersByTime(120_000);
      expect(b.nav.every((u) => u === `intent://join?invite=${CODE}#Intent;scheme=tg;end`)).toBe(
        true,
      );
      expect(b.button.href).toBe(HREF);
    }
    for (const ua of [UA.tiktokAndroid, UA.snapchatAndroid, UA.daumAndroid]) {
      const b = browser({ ua });
      b.click();
      vi.advanceTimersByTime(20);
      expect(b.frames[0]!.src, ua).toBe(`tg://join?invite=${CODE}`);
      expect(b.nav).toEqual([]);
    }
    // Page quittée (ou passée en arrière-plan) avant l'image suivante : la personne est partie, aucune tentative ;
    // les envois partent quand même.
    const quick = browser({ ua: UA.instagramAndroid });
    quick.click();
    quick.pagehide();
    expect(quick.nav).toEqual([]);
    expect(quick.frames).toEqual([]);
    expect(quick.types()).toEqual(["VIEW", "CLICK:INTENT_HELP", "HELP:INSTAGRAM"]);
    const away = browser({ ua: UA.tiktokAndroid });
    away.click();
    away.hide();
    expect(away.frames).toEqual([]);
  });

  it("iPhone dans Instagram, Facebook, Messenger : l'aide d'abord, puis tg:// demandé par la page pendant l'appui même (vrai geste, comme en phase 15)", () => {
    const apps = [
      [UA.instagramIos, "INSTAGRAM"],
      [UA.facebookIos, "FACEBOOK"],
      [UA.messengerIos, "MESSENGER"],
    ] as const;
    for (const [ua, app] of apps) {
      const b = browser({ ua });
      vi.advanceTimersByTime(20);
      const ev = b.click();
      expect(ev.defaultPrevented, app).toBe(true);
      // Dans le gestionnaire de l'appui (la vue web de Meta ignore une demande sans vrai appui), l'aide déjà
      // affichée : la page demande tg://join elle-même ; l'appli la passe à iOS, la page reste.
      expect(b.help.hidden, app).toBe(false);
      expect(b.marks).toEqual(["lj:help"]);
      expect(b.nav, app).toEqual([`tg://join?invite=${CODE}`]);
      expect(b.navHelp, app).toEqual([true]);
      expect(b.frames, app).toEqual([]);
      // Envois après l'affichage, avec le code de cette façon d'ouvrir.
      expect(b.types()).toEqual(["VIEW"]);
      vi.advanceTimersByTime(20);
      expect(b.types(), app).toEqual(["VIEW", "CLICK:TG_NAV", `HELP:${app}`]);
      // « Réessayer » : une nouvelle demande, avec le geste de cet appui ; jamais la page t.me, ni plus tard.
      b.retry.onclick!();
      vi.advanceTimersByTime(120_000);
      expect(b.nav).toEqual([`tg://join?invite=${CODE}`, `tg://join?invite=${CODE}`]);
      expect(b.frames).toEqual([]);
      expect(b.button.href).toBe(HREF);
      expect(b.help.hidden).toBe(false);
    }
    // Telegram s'ouvre (page en arrière-plan juste après) : OPENED avec la même façon d'ouvrir.
    const opened = browser({ ua: UA.instagramIos });
    opened.click();
    vi.advanceTimersByTime(300);
    opened.hide();
    expect(opened.types()).toEqual(["VIEW", "CLICK:TG_NAV", "HELP:INSTAGRAM", "OPENED:TG_NAV"]);
    // TikTok et Snapchat sur iPhone, applis inconnues : toujours le cadre caché, aucune demande d'adresse.
    for (const ua of [UA.tiktokIos, UA.snapchatIos, UA.naverIos]) {
      const b = browser({ ua });
      b.click();
      vi.advanceTimersByTime(20);
      expect(b.nav, ua).toEqual([]);
      expect(
        b.frames.map((f) => f.src),
        ua,
      ).toEqual([`tg://join?invite=${CODE}`]);
    }
  });

  it("chaque façon d'ouvrir envoyée par la page est connue et suit la table ; jamais une façon d'une ancienne version", () => {
    const sent = new Set<string>();
    const methodsOf = (types: string[]) =>
      types
        .filter((t) => /^(CLICK|OPENED|AUTO_OPEN):/.test(t))
        .map((t) => t.slice(t.indexOf(":") + 1));
    const cases: Array<[string, (typeof ESCAPE_APPS)[number] | null, EscapeSystem]> = [
      [UA.tiktokIos, "TIKTOK", "IOS"],
      [UA.tiktokAndroid, "TIKTOK", "ANDROID"],
      [UA.instagramIos, "INSTAGRAM", "IOS"],
      [UA.instagramAndroid, "INSTAGRAM", "ANDROID"],
      [UA.facebookIos, "FACEBOOK", "IOS"],
      [UA.facebookAndroid, "FACEBOOK", "ANDROID"],
      [UA.messengerIos, "MESSENGER", "IOS"],
      [UA.messengerAndroid, "MESSENGER", "ANDROID"],
      [UA.snapchatIos, "SNAPCHAT", "IOS"],
      [UA.snapchatAndroid, "SNAPCHAT", "ANDROID"],
      [UA.naverIos, "OTHER", "IOS"],
      [UA.daumAndroid, "OTHER", "ANDROID"],
      [UA.safariIos, null, "IOS"],
      [UA.chromeAndroid, null, "ANDROID"],
      [UA.desktopChrome, null, "ANDROID"],
    ];
    for (const [ua, app, system] of cases) {
      const b = browser({ ua });
      b.click();
      vi.advanceTimersByTime(100);
      b.hide();
      vi.advanceTimersByTime(10);
      const methods = methodsOf(b.types());
      const want = app ? ESCAPE_OPEN_METHOD[escapeSpotFor(app, system).open] : "HTTPS";
      expect(methods, ua).toEqual([want, want]);
      methods.forEach((m) => sent.add(m));
    }
    // Ouverture automatique dans Safari puis Chrome (marqueur).
    for (const ua of [UA.safariIos, UA.chromeAndroid]) {
      const b = browser({
        ua,
        url: `${AD_URL}&tgo=1&vid=visit_tiktok_0077&tgt=${tgt()}`,
        readyState: "loading",
      });
      b.domReady();
      vi.advanceTimersByTime(20);
      b.hide();
      vi.advanceTimersByTime(10);
      methodsOf(b.types()).forEach((m) => sent.add(m));
    }
    expect([...sent].sort()).toEqual([...LANDING_SENT_OPEN_METHODS].sort());
    // Aucune autre façon écrite dans les scripts de la page (code mort ou ancienne façon oubliée), types
    // d'événements mis à part.
    const written = new Set(
      [
        ...`${LANDING_HEAD_SCRIPT}${LANDING_SCRIPT}`.matchAll(
          /"((?:TG_|INTENT|AUTO_)[A-Z_]*|HTTPS)"/g,
        ),
      ]
        .map((m) => m[1]!)
        .filter((m) => !(LANDING_EVENT_KINDS as readonly string[]).includes(m)),
    );
    expect(written.size).toBeGreaterThanOrEqual(5);
    for (const m of written) expect(LANDING_SENT_OPEN_METHODS as readonly string[], m).toContain(m);
  });

  it("iPhone : cadre posé par une minuterie de 0 ms lancée pendant l'appui (WebKit y transmet le geste) ; Android : après l'image suivante", () => {
    const ios = browser({ ua: UA.tiktokIos });
    ios.click();
    // Rien dans le gestionnaire lui-même : l'aide d'abord.
    expect(ios.frames).toEqual([]);
    expect(ios.help.hidden).toBe(false);
    vi.advanceTimersByTime(0);
    expect(ios.frames.map((f) => f.src)).toEqual([`tg://join?invite=${CODE}`]);
    const android = browser({ ua: UA.tiktokAndroid });
    android.click();
    vi.advanceTimersByTime(0);
    expect(android.frames).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(android.frames.map((f) => f.src)).toEqual([`tg://join?invite=${CODE}`]);
  });

  it("aide : signe, libellé exact et endroit du menu de l'appli, flèche placée d'après la table (chaque appli × système)", () => {
    const cases: Array<[string, (typeof ESCAPE_APPS)[number], EscapeSystem]> = [
      [UA.tiktokIos, "TIKTOK", "IOS"],
      [UA.tiktokIosAds, "TIKTOK", "IOS"],
      [UA.tiktokAndroid, "TIKTOK", "ANDROID"],
      [UA.instagramIos, "INSTAGRAM", "IOS"],
      [UA.instagramAndroid, "INSTAGRAM", "ANDROID"],
      [UA.facebookIos, "FACEBOOK", "IOS"],
      [UA.facebookAndroid, "FACEBOOK", "ANDROID"],
      [UA.messengerIos, "MESSENGER", "IOS"],
      [UA.messengerAndroid, "MESSENGER", "ANDROID"],
      [UA.snapchatIos, "SNAPCHAT", "IOS"],
      [UA.snapchatAndroid, "SNAPCHAT", "ANDROID"],
      [UA.naverIos, "OTHER", "IOS"],
      [UA.daumAndroid, "OTHER", "ANDROID"],
    ];
    for (const lang of ["fr", "en"]) {
      for (const [ua, app, system] of cases) {
        const b = browser({ ua, lang });
        const spot = escapeSpotFor(app, system);
        const where = {
          fr: { "top-right": "en haut à droite", "bottom-right": "en bas à droite" },
          en: { "top-right": "at the top right", "bottom-right": "at the bottom right" },
        }[lang]![spot.corner as "top-right"];
        // « ⋮ » est dessiné avec « ••• » tourné d'un quart de tour (aucune police de secours à chercher), et lu
        // « ⋮ » par les lecteurs d'écran.
        const vertical = spot.sign === "⋮";
        const drawn = vertical ? "•••" : spot.sign;
        const cls = vertical ? "hs hv" : "hs";
        const attrs = vertical ? { role: "img", "aria-label": "⋮" } : {};
        expect(
          b.classes.hs!.map((x) => [x.textContent, x.className, x.attrs]),
          `${app} ${system}`,
        ).toEqual([
          [drawn, cls, attrs],
          [drawn, cls, attrs],
        ]);
        expect(b.classes.hl!.map((x) => x.textContent)).toEqual([
          spot.label[lang as "fr"],
          spot.label[lang as "fr"],
        ]);
        expect(b.classes.hw![0]!.textContent).toBe(where);
        const top = spot.corner.startsWith("top");
        const right = spot.corner.endsWith("right");
        expect(b.arrow.style[top ? "top" : "bottom"]).toBe(
          `calc(env(safe-area-inset-${top ? "top" : "bottom"},0px) + ${spot.y}px)`,
        );
        expect(b.arrow.style[top ? "bottom" : "top"]).toBe("auto");
        expect(b.arrow.style[right ? "right" : "left"]).toBe(
          `calc(env(safe-area-inset-${right ? "right" : "left"},0px) + ${spot.x - 24}px)`,
        );
        expect(b.arrow.cls).toBe(top ? "ha" : "ha hd");
      }
    }
    // TikTok iPhone (capture du client) : coin haut-droit, pointe au bord haut de la page, 26 px du bord droit.
    const tt = browser({ ua: UA.tiktokIos });
    expect(tt.arrow.style.top).toBe("calc(env(safe-area-inset-top,0px) + 0px)");
    expect(tt.arrow.style.right).toBe("calc(env(safe-area-inset-right,0px) + 2px)");
    expect(tt.classes.hs![0]!.textContent).toBe("•••");
    expect(tt.classes.hl![0]!.textContent).toBe("Ouvrir dans le navigateur");
  });

  it("la reconnaissance de l'appli dans la page suit exactement detectEscapeApp (agents réels)", () => {
    for (const ua of Object.values(UA)) {
      const b = browser({ ua });
      const seen = (b.win.ljE as { a: string }).a;
      expect(seen, ua).toBe(detectEscapeApp(ua) ?? "");
    }
    // Navigateurs ordinaires, et navigateur intégré de Telegram (Telegram ouvre lui-même le lien) : jamais d'aide.
    for (const ua of [
      UA.telegramAndroid,
      UA.safariIos,
      UA.chromeIos,
      UA.chromeAndroid,
      UA.samsungAndroid,
      UA.miuiAndroid,
      UA.desktopChrome,
    ])
      expect(detectEscapeApp(ua), ua).toBeNull();
  });

  it("Telegram s'ouvre depuis l'appli (page en arrière-plan juste après la tentative) : OPENED ; sortie par le menu : rien", () => {
    const b = browser({ ua: UA.tiktokIos });
    b.click();
    vi.advanceTimersByTime(300);
    b.hide();
    expect(b.types()).toEqual(["VIEW", "CLICK:TG_FRAME", "HELP:TIKTOK", "OPENED:TG_FRAME"]);
    // « ••• → Ouvrir dans le navigateur » fait vite (1,2 s après l'appui, ou 900 ms après la tentative) : la page passe
    // en arrière-plan parce que Safari ou Chrome prend la main, pas Telegram : aucun OPENED (Android comme iPhone).
    for (const [ua, after] of [
      [UA.tiktokAndroid, 1200],
      [UA.tiktokIos, 1200],
      [UA.instagramAndroid, LANDING_OPENED_INAPP_WINDOW_MS + 100],
    ] as const) {
      const fast = browser({ ua });
      fast.click();
      vi.advanceTimersByTime(after);
      fast.hide();
      vi.advanceTimersByTime(10);
      expect(
        fast.types().filter((t) => t.startsWith("OPENED")),
        ua,
      ).toEqual([]);
    }
    // « Réessayer » 5 s plus tard, Telegram s'ouvre : OPENED, compté depuis cette tentative.
    const again = browser({ ua: UA.tiktokIos });
    again.click();
    vi.advanceTimersByTime(5000);
    again.retry.onclick!();
    vi.advanceTimersByTime(200);
    again.hide();
    expect(again.types().at(-1)).toBe("OPENED:TG_FRAME");
    // Page cachée avant même la tentative : rien.
    const before = browser({ ua: UA.tiktokIos });
    before.click();
    before.hide();
    vi.advanceTimersByTime(10);
    expect(before.types().filter((t) => t.startsWith("OPENED"))).toEqual([]);
    // Dans l'appli, une perte de focus (menu de l'appli) n'allonge pas la fenêtre.
    const c = browser({ ua: UA.tiktokIos });
    c.click();
    c.blur();
    vi.advanceTimersByTime(LANDING_OPENED_WINDOW_MS + 500);
    c.hide();
    expect(c.types()).toEqual(["VIEW", "CLICK:TG_FRAME", "HELP:TIKTOK"]);
    // Android : envoi à la fin de la tâche, annulé si la page se décharge.
    const a = browser({ ua: UA.tiktokAndroid });
    a.click();
    vi.advanceTimersByTime(100);
    a.hide();
    a.pagehide();
    vi.advanceTimersByTime(10);
    expect(a.types()).toEqual(["VIEW", "CLICK:TG_FRAME", "HELP:TIKTOK"]);
  });

  it("navigateur ordinaire : la question « Ouvrir dans Telegram ? » (perte de focus) porte la fenêtre d'OPENED à 10 s", () => {
    const b = browser({ ua: UA.safariIos });
    b.click();
    vi.advanceTimersByTime(500);
    b.blur();
    vi.advanceTimersByTime(4000);
    b.hide();
    expect(b.types()).toEqual(["VIEW", "CLICK:HTTPS", "OPENED:HTTPS"]);
    const late = browser({ ua: UA.safariIos });
    late.click();
    late.blur();
    vi.advanceTimersByTime(LANDING_OPENED_AFTER_PROMPT_MS + 1);
    late.hide();
    expect(late.types()).toEqual(["VIEW", "CLICK:HTTPS"]);
  });

  it("aucune minuterie de repli : plus de LANDING_FALLBACK_MS, aucune navigation par le script de la page", () => {
    expect(renderModule).not.toHaveProperty("LANDING_FALLBACK_MS");
    expect(renderModule).not.toHaveProperty("LANDING_FALLBACK_AFTER_DIALOG_MS");
    for (const script of [LANDING_SCRIPT, LANDING_HEAD_SCRIPT, LANDING_PIXEL_SCRIPT]) {
      expect(script).not.toMatch(/FALLBACK|fallback\(/);
      // Aucune minuterie écrite avec un délai d'au moins 1 s.
      for (const m of script.matchAll(/setTimeout\(([^()]|\([^()]*\))*?,\s*(\d+)\s*\)/g))
        expect(Number(m[2])).toBeLessThan(1000);
      expect(script).not.toMatch(/setInterval/);
    }
    // Le script de la page ne va jamais vers une page : sa seule demande d'adresse vise l'appli Telegram, `tg://join`
    // (applis Meta sur iPhone) ou `intent://…;scheme=tg` (applis Meta sur Android), que l'appli passe au téléphone ;
    // seule la tentative automatique du <head> en fait une autre.
    expect(LANDING_SCRIPT).not.toMatch(/location\.(replace|assign)|window\.open|\.href\s*=\s*H\b/);
    expect(LANDING_SCRIPT).toContain('var j="://join?invite="+K;');
    expect(LANDING_SCRIPT.match(/\w*\.href\s*=[^;]*/g)).toEqual([
      'L.href=O=="TG_NAV"?"tg"+j:"intent"+j+"#Intent',
    ]);
    expect(LANDING_HEAD_SCRIPT.match(/\.href\s*=/g)).toHaveLength(1);
    // Navigateurs intégrés : 2 minutes après l'appui, toujours aucune navigation (applis Meta sur Android : la seule
    // demande intent:// de chaque appui).
    for (const ua of [
      UA.tiktokIos,
      UA.tiktokAndroid,
      UA.instagramIos,
      UA.facebookAndroid,
      UA.snapchatIos,
    ]) {
      const b = browser({ ua });
      b.click();
      b.click();
      vi.advanceTimersByTime(120_000);
      b.blur();
      vi.advanceTimersByTime(60_000);
      expect(b.nav, ua).toEqual(
        ua === UA.facebookAndroid
          ? Array(2).fill(`intent://join?invite=${CODE}#Intent;scheme=tg;end`)
          : ua === UA.instagramIos
            ? Array(2).fill(`tg://join?invite=${CODE}`)
            : [],
      );
      expect(b.button.href).toBe(HREF);
    }
  });

  it("navigateur intégré de Telegram : lien natif tout de suite (Telegram l'ouvre lui-même), jamais d'aide", () => {
    const b = browser({ ua: UA.telegramAndroid });
    expect(b.click().defaultPrevented).toBe(false);
    expect(b.help.hidden).toBe(true);
    expect(b.replaced).toEqual([]);
    // Jamais d'ouverture automatique non plus (appli reconnue dans les statistiques).
    const marked = browser({
      ua: UA.telegramAndroid,
      url: "https://go.goolink.eu/j/promo?src=tk01&tgo=1&vid=visit_tiktok_0042",
    });
    expect(marked.nav).toEqual([]);
  });

  it("aide impossible à lire (sans l'aide dans la page) : lien natif, comme un navigateur ordinaire", () => {
    const b = browser({ ua: UA.tiktokIos });
    // Simule une page sans aide : la reconnaissance reste, l'aide absente.
    const noHelp = browser({ ua: UA.tiktokIos, dataset: {} });
    expect(noHelp.help.hidden).toBe(true);
    expect(b.click().defaultPrevented).toBe(true);
  });

  // ── Ouverture automatique (script du <head>) ──

  it("Safari iPhone avec le marqueur : tentative tg:// au chargement, une seule fois, marqueur retiré avant", () => {
    const session = new Map<string, string>();
    const url = `${AD_URL}&tgo=1&vid=visit_tiktok_0001&tgt=${tgt(2)}`;
    const b = browser({ ua: UA.safariIos, url, session });
    expect(b.nav).toEqual([`tg://join?invite=${CODE}`]);
    expect(b.marks).toEqual(["lj:auto"]);
    // Marqueur retiré AVANT la tentative ; src, ttclid gardés ; « tgd=1 » : Telegram déjà tenté depuis cette adresse.
    expect(b.replaced).toEqual(["/j/promo?src=tk01&ttclid=E.C.P.TT1&tgd=1"]);
    expect(b.url.search).toBe("?src=tk01&ttclid=E.C.P.TT1&tgd=1");
    expect(session.get("lj:ao:visit_tiktok_0001")).toBe("1");
    // Même visite que dans l'appli : pas de 2e VIEW, ESCAPED puis AUTO_OPEN.
    vi.advanceTimersByTime(20);
    expect(b.types()).toEqual(["ESCAPED:TGO", "AUTO_OPEN:AUTO_TG"]);
    expect(new Set(b.beacons.map((x) => x.body.v))).toEqual(new Set(["visit_tiktok_0001"]));
    // Telegram s'ouvre après la question d'iOS (perte de focus, puis arrière-plan 3 s plus tard) : OPENED.
    b.blur();
    vi.advanceTimersByTime(3000);
    b.hide();
    expect(b.types()).toEqual(["ESCAPED:TGO", "AUTO_OPEN:AUTO_TG", "OPENED:AUTO_TG"]);

    // Rechargement de l'onglet : adresse sans marqueur, aucune tentative, aucun envoi de visite en double.
    const again = browser({ ua: UA.safariIos, url: b.url.href, session });
    expect(again.nav).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(again.types()).toEqual([]);
    // Même adresse marquée rouverte dans le même onglet : la trace de l'onglet empêche toute boucle.
    const loop = browser({ ua: UA.safariIos, url, session });
    expect(loop.nav).toEqual([]);
    expect(loop.replaced).toEqual(["/j/promo?src=tk01&ttclid=E.C.P.TT1&tgd=1"]);
    // Onglet restauré SANS sa mémoire (appli tuée pendant que Telegram est ouvert), ou adresse recopiée dans un
    // nouvel onglet : « tgd=1 » suffit, ni nouvelle tentative ni nouvelle sortie comptée.
    const restored = browser({ ua: UA.safariIos, url: b.url.href });
    expect(restored.nav).toEqual([]);
    expect(restored.replaced).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(restored.types()).toEqual(["VIEW"]);
  });

  it("tentative dès la fin de la lecture du HTML (page entière), marqueur retiré tout de suite", () => {
    const b = browser({
      ua: UA.safariIos,
      url: `${AD_URL}&tgo=1&vid=visit_tiktok_0009&tgt=${tgt()}`,
      readyState: "loading",
    });
    // Script du <head> : marqueur retiré aussitôt, tentative quand le HTML est lu.
    expect(b.url.search).toBe("?src=tk01&ttclid=E.C.P.TT1&tgd=1");
    expect(b.nav).toEqual([]);
    expect(b.marks).toEqual([]);
    b.domReady();
    expect(b.nav).toEqual([`tg://join?invite=${CODE}`]);
    expect(b.marks).toEqual(["lj:auto"]);
  });

  it("Chrome Android avec le marqueur : intent://…;scheme=tg, sans package ni repli (recherche Chromium)", () => {
    const session = new Map<string, string>();
    const url = `https://go.goolink.eu/j/promo?src=tk01&tgo=1&vid=visit_tiktok_0002&ttclid=T+1&tgt=${tgt()}`;
    const b = browser({ ua: UA.chromeAndroid, url, session });
    // Sans `package=` (version du site telegram.org, Telegram X ; jamais le Play Store tout seul) ni
    // `S.browser_fallback_url` (Chrome rechargerait la page au lieu de son bandeau « Continuer vers Telegram »).
    expect(b.nav).toEqual([`intent://join?invite=${CODE}#Intent;scheme=tg;end`]);
    expect(b.nav[0]).not.toMatch(/package=|browser_fallback_url/);
    // Marqueur retiré avant la tentative, le reste de l'adresse tel quel (« + » compris).
    expect(b.replaced).toEqual(["/j/promo?src=tk01&ttclid=T+1&tgd=1"]);
    vi.advanceTimersByTime(20);
    expect(b.types()).toEqual(["ESCAPED:TGO", "AUTO_OPEN:AUTO_INTENT"]);
    // Rechargement de l'onglet (adresse sans marqueur, ttclid gardé) : aucune nouvelle tentative, même sans la
    // mémoire de l'onglet.
    const back = "https://go.goolink.eu/j/promo?src=tk01&ttclid=T+1&tgd=1";
    expect(browser({ ua: UA.chromeAndroid, url: back, session }).nav).toEqual([]);
    expect(browser({ ua: UA.chromeAndroid, url: back }).nav).toEqual([]);
    // Samsung Internet : navigateur ordinaire aussi.
    const samsung = browser({
      ua: UA.samsungAndroid,
      url: `https://go.goolink.eu/j/promo?src=tk01&tgo=1&vid=visit_tiktok_0012&tgt=${tgt()}`,
    });
    expect(samsung.nav).toHaveLength(1);
  });

  it("aucune ouverture automatique sans marqueur, dans un navigateur intégré, sur ordinateur ou sans code", () => {
    const marked = `${AD_URL}&tgo=1&vid=visit_tiktok_0003&tgt=${tgt()}`;
    // Sans marqueur.
    expect(
      browser({ ua: UA.safariIos, url: "https://go.goolink.eu/j/promo?src=tk01" }).nav,
    ).toEqual([]);
    // tgo différent de 1 ou vid invalide sans tgo.
    expect(
      browser({
        ua: UA.safariIos,
        url: `https://go.goolink.eu/j/promo?tgo=0&vid=visit_tiktok_0003&tgt=${tgt()}`,
      }).nav,
    ).toEqual([]);
    // tgo=1 sans repère de visite valable : pas un marqueur.
    expect(
      browser({ ua: UA.safariIos, url: `https://go.goolink.eu/j/promo?tgo=1&tgt=${tgt()}` }).nav,
    ).toEqual([]);
    // Dans un navigateur intégré (TikTok qui recharge sa page marquée, Instagram…) : jamais.
    for (const ua of [
      UA.tiktokIos,
      UA.tiktokAndroid,
      UA.instagramIos,
      UA.facebookAndroid,
      UA.daumAndroid,
    ]) {
      const b = browser({ ua, url: marked });
      expect(b.nav, ua).toEqual([]);
      expect(b.marks).toEqual([]);
      // La page de l'appli pose SON repère (nouvelle visite, sans tgo : aucun appui dans cet onglet), jamais celui
      // de l'adresse reçue (lien partagé dans l'appli).
      expect(b.replaced, ua).toHaveLength(1);
      expect(b.replaced[0]).not.toMatch(/visit_tiktok_0003|tgo=/);
      vi.advanceTimersByTime(20);
      expect(b.types()).toEqual(["VIEW"]);
    }
    // Ordinateur : jamais.
    expect(browser({ ua: UA.desktopChrome, url: marked, maxTouchPoints: 0 }).nav).toEqual([]);
    // Page sans code d'invitation lisible.
    expect(browser({ ua: UA.safariIos, url: marked, dataK: null }).nav).toEqual([]);
  });

  it("à défaut de tgo : ttclid ou fbclid hors navigateur intégré, une seule fois pour l'adresse ; jamais sans adresse modifiable ni stockage", () => {
    const session = new Map<string, string>();
    const url = "https://go.goolink.eu/j/promo?src=tk01&fbclid=FB.1";
    const b = browser({ ua: UA.safariIos, url, session });
    expect(b.nav).toEqual([`tg://join?invite=${CODE}`]);
    // L'identifiant de clic pub reste dans l'adresse (pixels) ; « tgd=1 » note la tentative.
    expect(b.replaced).toEqual(["/j/promo?src=tk01&fbclid=FB.1&tgd=1"]);
    vi.advanceTimersByTime(20);
    // Sans vid : VIEW (le worker la rattache à la visite de l'appli au même fbclid), puis la sortie reconnue.
    expect(b.types()).toEqual(["VIEW", "ESCAPED:FBCLID", "AUTO_OPEN:AUTO_TG"]);
    expect(browser({ ua: UA.safariIos, url, session }).nav).toEqual([]);
    // Nouvel onglet sur l'adresse laissée après la tentative (onglet restauré sans sa mémoire, adresse recopiée) :
    // ni nouvelle tentative, ni nouvelle sortie.
    const copy = browser({ ua: UA.safariIos, url: b.url.href });
    expect(copy.nav).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(copy.types()).toEqual(["VIEW"]);
    // Stockage de l'onglet indisponible : l'adresse marquée « tgd=1 » suffit à empêcher toute boucle.
    const noStore = browser({ ua: UA.safariIos, url, noStorage: true });
    expect(noStore.nav).toHaveLength(1);
    expect(noStore.url.search).toBe("?src=tk01&fbclid=FB.1&tgd=1");
    // Ni stockage ni adresse modifiable : aucune tentative (rien n'empêcherait de recommencer au rechargement).
    expect(browser({ ua: UA.safariIos, url, noStorage: true, noHistory: true }).nav).toEqual([]);
    // Avec tgo, sans stockage : le marqueur retiré de l'adresse suffit.
    const tgo = browser({
      ua: UA.safariIos,
      url: `${url}&tgo=1&vid=visit_tiktok_0004&tgt=${tgt()}`,
      noStorage: true,
    });
    expect(tgo.nav).toHaveLength(1);
    expect(tgo.url.search).toBe("?src=tk01&fbclid=FB.1&tgd=1");
  });

  it("repère daté : au-delà de 30 min (lien copié et envoyé à d'autres), nouvelle visite sans ouverture par tgo", () => {
    const old = LANDING_ESCAPE_MAX_AGE_MS / 60_000 + 1;
    // Sans identifiant de clic pub : aucune tentative, nouvelle visite, repère retiré de l'adresse.
    const late = browser({
      ua: UA.safariIos,
      url: `https://go.goolink.eu/j/promo?src=tk01&tgo=1&vid=visit_sender_0001&tgt=${tgt(old)}`,
    });
    expect(late.nav).toEqual([]);
    expect(late.url.search).toBe("?src=tk01");
    vi.advanceTimersByTime(20);
    expect(late.types()).toEqual(["VIEW"]);
    expect(late.beacons[0]!.body.v).not.toBe("visit_sender_0001");
    // Avec ttclid : sortie reconnue par ttclid seulement (nouvelle visite), comme sans repère.
    const lateAd = browser({
      ua: UA.chromeAndroid,
      url: `${AD_URL}&tgo=1&vid=visit_sender_0002&tgt=${tgt(old)}`,
    });
    expect(lateAd.nav).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(lateAd.types()).toEqual(["VIEW", "ESCAPED:TTCLID", "AUTO_OPEN:AUTO_INTENT"]);
    expect(new Set(lateAd.beacons.map((x) => x.body.v)).has("visit_sender_0002")).toBe(false);
    // Repère sans date, ou daté dans le futur : ignoré aussi.
    for (const mark of ["", `&tgt=${tgt(-10)}`]) {
      const x = browser({
        ua: UA.safariIos,
        url: `https://go.goolink.eu/j/promo?src=tk01&tgo=1&vid=visit_sender_0003${mark}`,
      });
      expect(x.nav).toEqual([]);
    }
    // Dans les 30 min : même visite.
    const fresh = browser({
      ua: UA.safariIos,
      url: `https://go.goolink.eu/j/promo?src=tk01&tgo=1&vid=visit_sender_0004&tgt=${tgt(old - 2)}`,
    });
    expect(fresh.nav).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(fresh.types()).toEqual(["ESCAPED:TGO", "AUTO_OPEN:AUTO_TG"]);
  });

  it("rouverte dans Safari ou Chrome AVANT tout appui (repère vid sans tgo) : même visite, sortie VID, pixel du clic au premier appui", () => {
    // Dans l'appli : la page pose le repère dès l'affichage.
    const app = browser({ ua: UA.tiktokIos, url: AD_URL, dataset: { tt: "CD2UC93C77U35BVUO310" } });
    vi.advanceTimersByTime(20);
    const v = app.beacons[0]!.body.v;
    expect(app.url.search).toBe(`?src=tk01&ttclid=E.C.P.TT1&vid=${v}&tgt=${tgt()}`);
    // « ••• → Ouvrir dans le navigateur » sans avoir appuyé : Safari reçoit cette adresse.
    const safari = browser({
      ua: UA.safariIos,
      url: app.url.href,
      dataset: { tt: "CD2UC93C77U35BVUO310" },
    });
    // ttclid présent : tentative automatique (sinon, rien) ; repère retiré.
    expect(safari.nav).toEqual([`tg://join?invite=${CODE}`]);
    expect(safari.url.search).toBe("?src=tk01&ttclid=E.C.P.TT1&tgd=1");
    vi.advanceTimersByTime(20);
    // Même visite : pas de 2e VIEW.
    expect(safari.types()).toEqual(["ESCAPED:VID", "AUTO_OPEN:AUTO_TG"]);
    expect(new Set(safari.beacons.map((x) => x.body.v))).toEqual(new Set([v]));
    // Aucun appui dans l'appli : le premier appui dans Safari déclenche le pixel du clic, une fois.
    safari.click();
    vi.advanceTimersByTime(20);
    safari.click();
    vi.advanceTimersByTime(20);
    const track = (safari.win.ttq as unknown[][]).filter((c) => c[0] === "track");
    expect(track.map((c) => c[1])).toEqual(["ClickButton"]);
    // Sans identifiant de clic pub : sortie comptée, aucune tentative.
    const plain = browser({
      ua: UA.chromeAndroid,
      url: `https://go.goolink.eu/j/promo?src=tk01&vid=${v}&tgt=${tgt()}`,
    });
    expect(plain.nav).toEqual([]);
    expect(plain.marks).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(plain.types()).toEqual(["ESCAPED:VID"]);
    expect(plain.url.search).toBe("?src=tk01");
    // Rechargé dans l'appli après un appui : le repère garde tgo (l'appui a eu lieu, pixel du clic déjà parti).
    const tapped = browser({ ua: UA.tiktokIos, url: AD_URL });
    tapped.click();
    vi.advanceTimersByTime(20);
    const reload = browser({ ua: UA.tiktokIos, url: AD_URL, session: tapped.session });
    expect(reload.url.search).toMatch(/&tgo=1&vid=[0-9a-f]{24}&tgt=/);
  });

  // ── Pixels ──

  it("sans pixel : aucun script extérieur, aucun pixel", () => {
    const b = browser({ ua: UA.safariIos });
    b.load();
    vi.advanceTimersByTime(5000);
    b.click();
    vi.advanceTimersByTime(20);
    expect(b.scripts).toEqual([]);
    expect(b.win.ttq).toBeUndefined();
    expect(b.win.fbq).toBeUndefined();
    expect(b.win.ljC).toBeUndefined();
  });

  it("pixels chargés après load puis au repos ; PageView à l'affichage ; ClickButton et Contact UNE fois par visite", () => {
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
    // Pixel du clic APRÈS l'aide (image suivante), jamais dans le gestionnaire.
    expect(ttq).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(ttq.map((c) => (c as unknown[]).join(":"))).toEqual(["page", "track:ClickButton"]);
    expect(fbq.queue.map((c) => [...c].join(":")).at(-1)).toBe("track:Contact");
    // 2e appui de la même visite : pas de 2e ClickButton / Contact.
    b.click();
    vi.advanceTimersByTime(20);
    expect(ttq).toHaveLength(2);
    expect(fbq.queue.filter((c) => c[1] === "Contact")).toHaveLength(1);
    // Rechargement dans l'appli (même visite) : toujours pas.
    const again = browser({
      ua: UA.tiktokIos,
      session: b.session,
      dataset: { tt: "CD2UC93C77U35BVUO310" },
    });
    again.click();
    vi.advanceTimersByTime(20);
    expect((again.win.ttq as unknown[]).map((c) => (c as unknown[])[0])).not.toContain("track");
  });

  it("réouverture dans Safari après la sortie de l'appli : jamais de 2e ClickButton / Contact pour la même visite", () => {
    const b = browser({
      ua: UA.safariIos,
      url: `${AD_URL}&tgo=1&vid=visit_tiktok_0005&tgt=${tgt()}`,
      dataset: { tt: "CD2UC93C77U35BVUO310", fb: "1070571443971391" },
    });
    vi.advanceTimersByTime(20);
    b.click();
    vi.advanceTimersByTime(20);
    const ttq = b.win.ttq as unknown[];
    const fbq = b.win.fbq as { queue: unknown[][] };
    expect(ttq.map((c) => (c as unknown[])[0])).toEqual(["page"]);
    expect(fbq.queue.map((c) => c[1])).toEqual(["1070571443971391", "PageView"]);
    expect(b.types()).toEqual(["ESCAPED:TGO", "AUTO_OPEN:AUTO_TG", "CLICK:HTTPS"]);
  });

  it("sortie reconnue seulement par ttclid / fbclid (adresse d'origine rouverte) : aucun 2e ClickButton / Contact", () => {
    // Dans TikTok : appui, 1er ClickButton et 1er Contact.
    const px = { tt: "CD2UC93C77U35BVUO310", fb: "1070571443971391" };
    const app = browser({ ua: UA.tiktokIos, url: AD_URL, dataset: px });
    vi.advanceTimersByTime(20);
    app.click();
    vi.advanceTimersByTime(20);
    expect((app.win.ttq as unknown[][]).filter((c) => c[0] === "track")).toHaveLength(1);
    // L'appli rouvre l'adresse d'origine (sans le repère) dans Safari, puis Chrome : ni ClickButton ni Contact.
    for (const [ua, url] of [
      [UA.safariIos, AD_URL],
      [UA.chromeAndroid, "https://go.goolink.eu/j/promo?src=tk01&fbclid=FB.9"],
    ] as const) {
      const b = browser({ ua, url, dataset: px });
      vi.advanceTimersByTime(20);
      b.click();
      vi.advanceTimersByTime(20);
      b.click();
      vi.advanceTimersByTime(20);
      expect(
        (b.win.ttq as unknown[][]).filter((c) => c[0] === "track"),
        ua,
      ).toEqual([]);
      expect((b.win.fbq as { queue: unknown[][] }).queue.filter((c) => c[1] === "Contact")).toEqual(
        [],
      );
      // PageView, lui, part (pixels chargés malgré la tentative automatique).
      expect((b.win.ttq as unknown[][]).map((c) => c[0])).toEqual(["page"]);
    }
  });

  it("pixels chargés après une tentative automatique, sans attendre load (que la navigation vers Telegram empêche)", () => {
    const b = browser({
      ua: UA.safariIos,
      url: `${AD_URL}&tgo=1&vid=visit_tiktok_0006&tgt=${tgt()}`,
      readyState: "loading",
      dataset: { tt: "CD2UC93C77U35BVUO310", fb: "1070571443971391" },
    });
    b.domReady();
    expect(b.nav).toEqual([`tg://join?invite=${CODE}`]);
    // Jamais de load : les pixels se chargent quand même, au repos, avec PageView.
    vi.advanceTimersByTime(5);
    expect(b.scripts.map((x) => x.src)).toEqual([
      "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=CD2UC93C77U35BVUO310&lib=ttq",
      "https://connect.facebook.net/en_US/fbevents.js",
    ]);
    expect((b.win.ttq as unknown[][]).map((c) => c[0])).toEqual(["page"]);
    expect((b.win.fbq as { queue: unknown[][] }).queue.map((c) => c[1])).toEqual([
      "1070571443971391",
      "PageView",
    ]);
    // L'appui ensuite (rien ne s'est ouvert) : aucun 2e ClickButton / Contact pour cette visite.
    b.click();
    vi.advanceTimersByTime(20);
    expect((b.win.ttq as unknown[][]).filter((c) => c[0] === "track")).toEqual([]);
    // Sans tentative (page ordinaire qui charge) : toujours après load.
    const normal = browser({
      ua: UA.safariIos,
      readyState: "loading",
      dataset: { tt: "CD2UC93C77U35BVUO310" },
    });
    vi.advanceTimersByTime(1000);
    expect(normal.scripts).toEqual([]);
  });

  it("clic avant le chargement des pixels : ils démarrent avec le clic, l'événement n'est pas perdu", () => {
    const b = browser({
      ua: UA.instagramIos,
      readyState: "loading",
      dataset: { tt: "CD2UC93C77U35BVUO310" },
    });
    b.click();
    vi.advanceTimersByTime(20);
    const ttq = b.win.ttq as unknown[];
    expect(ttq.map((c) => (c as unknown[]).join(":"))).toEqual(["page", "track:ClickButton"]);
    expect(b.scripts).toHaveLength(1);
  });

  it("bandeau cookies : aucun pixel avant « Accepter » ; « Refuser » n'en charge jamais ; le choix est gardé", () => {
    const now = new Date("2026-10-16T10:00:00Z").getTime();
    const tt = { tt: "CD2UC93C77U35BVUO310" };
    const a = browser({ ua: UA.tiktokIos, banner: true, dataset: tt });
    vi.advanceTimersByTime(5000);
    a.click();
    vi.advanceTimersByTime(20);
    expect(a.scripts).toEqual([]);
    expect(a.win.ttq).toBeUndefined();
    a.accept.onclick!();
    expect(a.bannerState.removed).toBe(true);
    // Choix gardé par partenaire, daté.
    expect(JSON.parse(a.local.get("lj:ck")!)).toEqual({ v: 1, tt: [1, now + 5020] });
    vi.advanceTimersByTime(5);
    expect(a.scripts).toHaveLength(1);

    const r = browser({ ua: UA.tiktokIos, banner: true, dataset: tt });
    const declinedAt = Date.now();
    r.decline.onclick!();
    vi.advanceTimersByTime(5000);
    r.click();
    vi.advanceTimersByTime(20);
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
    const now = new Date("2026-10-16T10:00:00Z").getTime();
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
    vi.advanceTimersByTime(20);
    expect(meta.scripts).toEqual([]);
    expect(meta.win.fbq).toBeUndefined();
    meta.accept.onclick!();
    expect(JSON.parse(meta.local.get("lj:ck")!)).toEqual({
      v: 1,
      tt: [1, now - 1000],
      fb: [1, now + 5020],
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
    vi.advanceTimersByTime(20);
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
    const win: Record<string, unknown> = {
      addEventListener: (t: string, f: Listener) => (winL[t] ??= []).push(f),
      crypto: globalThis.crypto,
    };
    const doc = {
      body: { dataset: { p: "page1", s: "" } },
      documentElement: { getAttribute: () => null },
      visibilityState: "visible",
      readyState: "complete",
      getElementById: (id: string) =>
        id === "b" ? { href: HREF, addEventListener: () => undefined } : null,
      addEventListener: () => undefined,
    };
    const args = [
      "window",
      "document",
      "navigator",
      "location",
      "sessionStorage",
      "localStorage",
      "Math",
      "fetch",
    ];
    const values = [
      win,
      doc,
      { userAgent: UA.safariIos, sendBeacon: () => false },
      { search: "", pathname: "/j/x", hash: "" },
      { getItem: () => null, setItem: () => undefined },
      { getItem: () => null, setItem: () => undefined },
      Math,
      (url: string, init: RequestInit) => calls.push({ url, init }),
    ];
    new Function(...args, LANDING_HEAD_SCRIPT)(...values);
    new Function(...args, LANDING_SCRIPT)(...values);
    vi.advanceTimersByTime(20);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/j/_e");
    expect(calls[0]!.init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ t: "VIEW", s: "" });
  });

  it("chaque appli × système de la table est reconnue par au moins un agent utilisateur réel ou de référence", () => {
    const seen = new Set<string>();
    for (const ua of Object.values(UA)) {
      const app = detectEscapeApp(ua);
      if (!app) continue;
      seen.add(`${app}:${/iPhone|iPad|iPod/.test(ua) ? "IOS" : "ANDROID"}`);
    }
    for (const app of ESCAPE_APPS)
      for (const system of ESCAPE_SYSTEMS) expect(seen).toContain(`${app}:${system}`);
  });
});
