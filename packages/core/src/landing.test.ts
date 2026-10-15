import { describe, expect, it } from "vitest";
import { isBotUserAgent } from "./bots";
import {
  DEFAULT_LANDING_SOURCE,
  INVITE_LINK_NAME_MAX,
  LANDING_LANGS,
  detectInApp,
  detectLandingOs,
  inviteHashOf,
  isLandingBotUserAgent,
  isLandingEventKind,
  isLandingLang,
  isReservedLandingSegment,
  isValidLandingSlug,
  isValidMetaPixelId,
  isValidTikTokPixelId,
  isValidVisitId,
  landingDefaults,
  landingInviteLinkName,
  landingLang,
  landingOpenUrls,
  landingPhotoPath,
  landingPublicUrl,
  landingRates,
  landingRatio,
  landingSlugCandidate,
  normalizeLandingMethod,
  normalizeMetaPixelId,
  normalizeSourceKey,
  normalizeTikTokPixelId,
  pickLandingSource,
  resolveLandingSource,
  slugifyLanding,
  type LandingSourceLike,
} from "./landing";

/** Agents utilisateurs réels relevés dans les navigateurs intégrés (2024-2026). */
const UA = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR RevealType/Dialog isDarkMode/0 WKWebView/1 BytedanceWebview/d8a21c6 FalconTag/7D4E5B4C-2C1F-4F7C-9D1B-0B5B8E3A3C11",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 trill_330604 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/33.6.4 ByteLocale/fr ByteFullLocale/fr Region/FR Spark/1.5.0.6-bugfix AppVersion/33.6.4 BytedanceWebview/d8a21c6",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.32.105 (iPhone14,5; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 584287262)",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/564431005;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.3.1;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5;FBRV/567052743]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.193 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/446.0.0.27.352;]",
  messengerIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/431.0.0.40.112;FBBV/528469617;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]",
  snapchatIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.58.0.37 (like Safari/8617.1.17.10.12, panda)",
  pinterestIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 12; M2101K6G Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36",
  iosWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  bytespider:
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  facebookPreview: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  pinterestBot: "Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)",
  telegramPreview: "TelegramBot (like TwitterBot)",
  whatsapp: "WhatsApp/2.23.20.0 A",
  lighthouse:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  headless:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
  curl: "curl/8.4.0",
};

describe("adresse d'une page (slug)", () => {
  it.each(["promo", "abc", "tir-cadre-octobre", "a1b", "x".repeat(48)])("accepte %s", (s) => {
    expect(isValidLandingSlug(s)).toBe(true);
  });

  it.each([
    "ab",
    "x".repeat(49),
    "-promo",
    "promo-",
    "_e",
    "_promo",
    "Promo",
    "pro mo",
    "promo/x",
    "é-promo",
    "",
    null,
    42,
  ])("refuse %s", (s) => {
    expect(isValidLandingSlug(s)).toBe(false);
  });

  it("propose un slug valide à partir du nom", () => {
    expect(slugifyLanding("Tir Cadré — Octobre !")).toBe("tir-cadre-octobre");
    expect(slugifyLanding("  Œuvre  Spéciale ")).toBe("oeuvre-speciale");
    expect(slugifyLanding("A")).toBe("a-page");
    expect(slugifyLanding("🔥🔥")).toBe("page");
    expect(slugifyLanding("")).toBe("page");
    const long = slugifyLanding(`${"a".repeat(47)} b c`);
    expect(long.length).toBeLessThanOrEqual(48);
    expect(isValidLandingSlug(long)).toBe(true);
    for (const n of ["Tir Cadré", "x", "---", "Été 2026 / TikTok", "a".repeat(80)])
      expect(isValidLandingSlug(slugifyLanding(n)), n).toBe(true);
  });

  it("propose un slug libre quand le premier est pris (toujours valide, 48 caractères au plus)", () => {
    expect(landingSlugCandidate("promo", 1)).toBe("promo");
    expect(landingSlugCandidate("promo", 2)).toBe("promo-2");
    expect(landingSlugCandidate("Tir Cadré", 3)).toBe("tir-cadre-3");
    const c = landingSlugCandidate("a".repeat(48), 12);
    expect(c).toBe(`${"a".repeat(45)}-12`);
    expect(isValidLandingSlug(c)).toBe(true);
  });

  it("segments réservés sous /j/ et adresses", () => {
    expect(isReservedLandingSegment("_e")).toBe(true);
    expect(isReservedLandingSegment("_p")).toBe(true);
    expect(isReservedLandingSegment("promo")).toBe(false);
    expect(landingPhotoPath("ch_1")).toBe("/j/_p/ch_1.jpg");
    expect(landingPublicUrl("https://go.goolink.eu/", "promo", "tk01")).toBe(
      "https://go.goolink.eu/j/promo?src=tk01",
    );
    expect(landingPublicUrl("https://go.goolink.eu", "promo", DEFAULT_LANDING_SOURCE)).toBe(
      "https://go.goolink.eu/j/promo",
    );
  });
});

describe("sources", () => {
  it("normalise une clé (minuscules, sans espaces) ou la refuse", () => {
    expect(normalizeSourceKey("tk01")).toBe("tk01");
    expect(normalizeSourceKey(" TK01 ")).toBe("tk01");
    expect(normalizeSourceKey("exo_1-B")).toBe("exo_1-b");
    expect(normalizeSourceKey("a".repeat(32))).toBe("a".repeat(32));
    expect(normalizeSourceKey("a".repeat(33))).toBeNull();
    expect(normalizeSourceKey("")).toBeNull();
    expect(normalizeSourceKey("   ")).toBeNull();
    expect(normalizeSourceKey("tk 01")).toBeNull();
    expect(normalizeSourceKey("tk01<script>")).toBeNull();
    expect(normalizeSourceKey("tké")).toBeNull();
    expect(normalizeSourceKey(null)).toBeNull();
    expect(normalizeSourceKey(["tk01"])).toBeNull();
  });

  const src = (key: string, over: Partial<LandingSourceLike> = {}): LandingSourceLike => ({
    key,
    isActive: true,
    inviteLink: `https://t.me/+${key || "default"}Hash`,
    ...over,
  });
  const sources = [
    src(""),
    src("tk01"),
    src("tk03"),
    src("exo1", { isActive: false }),
    src("tk09", { inviteLink: null }),
  ];

  it("prend la source demandée par ?src= (sans tenir compte des majuscules)", () => {
    expect(pickLandingSource(sources, "tk01")?.key).toBe("tk01");
    expect(pickLandingSource(sources, "TK03")?.key).toBe("tk03");
    expect(pickLandingSource(sources, " tk03 ")?.key).toBe("tk03");
  });

  it("sinon la source par défaut : sans ?src=, source inconnue, inactive, sans lien, ou clé invalide", () => {
    for (const s of [null, undefined, "", "inconnue", "exo1", "tk09", "tk01<", "a".repeat(40)])
      expect(pickLandingSource(sources, s)?.key, String(s)).toBe(DEFAULT_LANDING_SOURCE);
  });

  it("sans lien par défaut, une autre source active avec lien (le bouton marche toujours) ; sinon rien", () => {
    const noDefault = [src("", { inviteLink: null }), src("tk03"), src("tk01")];
    expect(pickLandingSource(noDefault, null)?.key).toBe("tk01");
    expect(pickLandingSource(noDefault, "tk03")?.key).toBe("tk03");
    expect(
      pickLandingSource([src("", { inviteLink: null }), src("tk01", { isActive: false })], "tk01"),
    ).toBeNull();
    expect(pickLandingSource([], "tk01")).toBeNull();
  });

  it("garde ?src= non suivi pour le diagnostic", () => {
    expect(resolveLandingSource(sources, "TK01")).toMatchObject({ rawSrc: null });
    expect(resolveLandingSource(sources, "TK01").source?.key).toBe("tk01");
    expect(resolveLandingSource(sources, null)).toMatchObject({ rawSrc: null });
    expect(resolveLandingSource(sources, "")).toMatchObject({ rawSrc: null });
    const unknown = resolveLandingSource(sources, "tk99");
    expect(unknown.source?.key).toBe("");
    expect(unknown.rawSrc).toBe("tk99");
    expect(resolveLandingSource(sources, "exo1").rawSrc).toBe("exo1");
    expect(resolveLandingSource(sources, "x".repeat(100)).rawSrc).toHaveLength(64);
  });
});

describe("nom des liens d'invitation (32 caractères au plus)", () => {
  it("« <page>-<source> », ou le nom de la page pour la source par défaut", () => {
    expect(landingInviteLinkName("promo", "tk01")).toBe("promo-tk01");
    expect(landingInviteLinkName("Tir Cadré octobre", "")).toBe("Tir Cadré octobre");
    expect(landingInviteLinkName("  Tir   Cadré  ", "exo1")).toBe("Tir Cadré-exo1");
  });

  it("raccourcit le nom de la page et garde la source entière", () => {
    const name = landingInviteLinkName("Page d'atterrissage casino octobre 2026", "tk01");
    expect(name).toBe("Page d'atterrissage casino-tk01");
    expect(name.length).toBeLessThanOrEqual(INVITE_LINK_NAME_MAX);
    expect(name.endsWith("-tk01")).toBe(true);
    expect(landingInviteLinkName("x".repeat(60), "")).toBe("x".repeat(32));
    const longSource = "s".repeat(32);
    expect(landingInviteLinkName("promo", longSource)).toBe(longSource);
    expect(landingInviteLinkName("promo", "s".repeat(30))).toBe(`p-${"s".repeat(30)}`);
  });

  it("ne coupe jamais un emoji en deux et n'est jamais vide", () => {
    const name = landingInviteLinkName(`${"a".repeat(25)}🔥🔥🔥`, "tk01");
    expect(name).toBe(`${"a".repeat(25)}🔥-tk01`);
    expect(name.length).toBe(32);
    expect(landingInviteLinkName(`${"a".repeat(26)}🔥`, "tk01")).toBe(`${"a".repeat(26)}-tk01`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name)).toBe(false);
    expect(landingInviteLinkName("", "")).toBe("page");
    expect(landingInviteLinkName("   ", "tk01")).toBe("page-tk01");
    for (const [p, s] of [
      ["a", "b"],
      ["x".repeat(100), "y".repeat(31)],
      ["🔥".repeat(40), ""],
      ["🔥".repeat(40), "tk01"],
    ] as const) {
      const n = landingInviteLinkName(p, s);
      expect(n.length, `${p}/${s}`).toBeGreaterThan(0);
      expect(n.length, `${p}/${s}`).toBeLessThanOrEqual(32);
    }
  });
});

describe("liens Telegram", () => {
  it("lit le code d'invitation", () => {
    expect(inviteHashOf("https://t.me/+AbC_d-12")).toBe("AbC_d-12");
    expect(inviteHashOf("t.me/+AbC")).toBe("AbC");
    expect(inviteHashOf("https://t.me/joinchat/AbC123")).toBe("AbC123");
    expect(inviteHashOf("https://telegram.me/+XyZ/")).toBe("XyZ");
    expect(inviteHashOf("tg://join?invite=AbC")).toBe("AbC");
    expect(inviteHashOf("https://t.me/moncanal")).toBeNull();
    expect(inviteHashOf("https://evil.example/+AbC")).toBeNull();
    expect(inviteHashOf("https://t.me/+AbC?x=<script>")).toBeNull();
    expect(inviteHashOf(null)).toBeNull();
    expect(inviteHashOf("")).toBeNull();
  });

  it("donne les façons d'ouvrir le même lien (même destination pour tous)", () => {
    const u = landingOpenUrls("https://t.me/+AbC_1");
    expect(u).toEqual({
      https: "https://t.me/+AbC_1",
      tg: "tg://join?invite=AbC_1",
      intent:
        "intent://join?invite=AbC_1#Intent;scheme=tg;S.browser_fallback_url=https%3A%2F%2Ft.me%2F%2BAbC_1;end",
    });
    expect(
      landingOpenUrls("https://t.me/+AbC_1", { androidPackage: "org.telegram.messenger" })?.intent,
    ).toContain("scheme=tg;package=org.telegram.messenger;S.browser_fallback_url=");
    expect(landingOpenUrls("https://t.me/moncanal")).toBeNull();
  });
});

describe("pixels (identifiants réels relevés dans des codes en ligne)", () => {
  it.each([
    "CD2UC93C77U35BVUO310",
    "CQJSH7JC77U08RGLTHOG",
    "D0DQFPJC77U75NH4N3QG",
    "DA9510RC77UC8FLJAU3G",
  ])("pixel TikTok valide : %s", (id) => {
    expect(isValidTikTokPixelId(id)).toBe(true);
    expect(normalizeTikTokPixelId(` ${id.toLowerCase()} `)).toBe(id);
  });

  it.each([
    "",
    "YOUR_TIKTOK_PIXEL_ID",
    "CD2UC93C77U35BVUO31",
    "CD2UC93C77U35BVUO3100",
    "1234567890123456789A",
    "CD2UC93C77U35BVUO31-",
  ])("pixel TikTok refusé : « %s »", (id) => {
    expect(isValidTikTokPixelId(id)).toBe(false);
  });

  it("retrouve l'identifiant TikTok dans le code collé par erreur", () => {
    expect(normalizeTikTokPixelId("ttq.load('CD2UC93C77U35BVUO310'); ttq.page();")).toBe(
      "CD2UC93C77U35BVUO310",
    );
    expect(
      normalizeTikTokPixelId(
        '<script src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=D0DQFPJC77U75NH4N3QG&lib=ttq">',
      ),
    ).toBe("D0DQFPJC77U75NH4N3QG");
    expect(normalizeTikTokPixelId("")).toBeNull();
    expect(normalizeTikTokPixelId("pas un pixel")).toBeNull();
    expect(normalizeTikTokPixelId(undefined)).toBeNull();
  });

  it.each(["129586523576870", "1070571443971391", "9877634818998127", "12345678901234567"])(
    "pixel Meta valide : %s",
    (id) => {
      expect(isValidMetaPixelId(id)).toBe(true);
      expect(normalizeMetaPixelId(id)).toBe(id);
    },
  );

  it.each([
    "",
    "YOUR_FACEBOOK_PIXEL_ID",
    "act_123456789012345",
    "12345",
    "0129586523576870",
    "1295865235768701234567",
    "12958652357687a",
  ])("pixel Meta refusé : « %s »", (id) => {
    expect(isValidMetaPixelId(id)).toBe(false);
  });

  it("retrouve l'identifiant Meta dans le code collé (ou avec des espaces)", () => {
    expect(normalizeMetaPixelId("fbq('init', '1070571443971391'); fbq('track', 'PageView');")).toBe(
      "1070571443971391",
    );
    expect(normalizeMetaPixelId('fbq("init","1320146003572375")')).toBe("1320146003572375");
    expect(
      normalizeMetaPixelId(
        '<img height="1" width="1" src="https://www.facebook.com/tr?id=129586523576870&ev=PageView&noscript=1"/>',
      ),
    ).toBe("129586523576870");
    expect(normalizeMetaPixelId(" 1070 5714 4397 1391 ")).toBe("1070571443971391");
    expect(normalizeMetaPixelId("")).toBeNull();
    expect(normalizeMetaPixelId("act_1234")).toBeNull();
  });
});

describe("langues et textes par défaut", () => {
  it("les six langues du bot, français par défaut", () => {
    expect([...LANDING_LANGS]).toEqual(["fr", "en", "es", "pt", "de", "it"]);
    expect(landingLang("pt-BR")).toBe("pt");
    expect(landingLang("EN")).toBe("en");
    expect(landingLang("zz")).toBe("fr");
    expect(landingLang(null)).toBe("fr");
    expect(isLandingLang("de")).toBe(true);
    expect(isLandingLang("ru")).toBe(false);
  });

  it("bouton, petite ligne d'exemple et bandeau cookies dans chaque langue", () => {
    expect(landingDefaults("fr")).toEqual({
      buttonText: "Rejoindre le canal →",
      footnoteExample: "Gratuit · 1 clic · via Telegram",
      cookieText: "Nous utilisons des cookies pour mesurer nos publicités.",
      cookieAccept: "Accepter",
      cookieDecline: "Refuser",
    });
    expect(landingDefaults("inconnue")).toEqual(landingDefaults("fr"));
    const seen = new Set<string>();
    for (const lang of LANDING_LANGS) {
      const d = landingDefaults(lang);
      for (const [k, v] of Object.entries(d)) {
        expect(v.trim(), `${lang}.${k}`).not.toBe("");
        expect(v.length, `${lang}.${k}`).toBeLessThanOrEqual(80);
      }
      expect(d.buttonText.endsWith("→"), lang).toBe(true);
      expect(d.footnoteExample, lang).toContain("Telegram");
      seen.add(d.buttonText);
    }
    // Une vraie traduction par langue (pas le français recopié).
    expect(seen.size).toBe(LANDING_LANGS.length);
  });
});

describe("visiteur : système et navigateur intégré", () => {
  it.each([
    ["tiktokIos", "IOS", "TIKTOK"],
    ["tiktokAndroid", "ANDROID", "TIKTOK"],
    ["instagramIos", "IOS", "INSTAGRAM"],
    ["instagramAndroid", "ANDROID", "INSTAGRAM"],
    ["facebookIos", "IOS", "FACEBOOK"],
    ["facebookAndroid", "ANDROID", "FACEBOOK"],
    ["messengerIos", "IOS", "FACEBOOK"],
    ["snapchatIos", "IOS", "OTHER"],
    ["pinterestIos", "IOS", "OTHER"],
    ["androidWebView", "ANDROID", "OTHER"],
    ["iosWebView", "IOS", "OTHER"],
    ["safariIos", "IOS", null],
    ["chromeIos", "IOS", null],
    ["chromeAndroid", "ANDROID", null],
    ["samsungAndroid", "ANDROID", null],
    ["desktopChrome", "OTHER", null],
  ] as const)("%s → %s, %s", (name, os, inApp) => {
    expect(detectLandingOs(UA[name])).toBe(os);
    expect(detectInApp(UA[name])).toBe(inApp);
  });

  it("agent utilisateur absent", () => {
    expect(detectLandingOs(null)).toBe("OTHER");
    expect(detectInApp(undefined)).toBeNull();
  });
});

describe("robots sur les pages d'atterrissage", () => {
  it("la règle commune prend le navigateur intégré de TikTok pour un robot (d'où la règle des pages)", () => {
    expect(isBotUserAgent(UA.tiktokIos)).toBe(true);
    expect(isBotUserAgent(UA.tiktokAndroid)).toBe(true);
  });

  it.each([
    "tiktokIos",
    "tiktokAndroid",
    "instagramIos",
    "instagramAndroid",
    "facebookIos",
    "facebookAndroid",
    "messengerIos",
    "snapchatIos",
    "pinterestIos",
    "safariIos",
    "chromeIos",
    "chromeAndroid",
    "samsungAndroid",
    "androidWebView",
    "desktopChrome",
  ] as const)("%s est une vraie personne", (name) => {
    expect(isLandingBotUserAgent(UA[name])).toBe(false);
  });

  it.each([
    "bytespider",
    "facebookPreview",
    "pinterestBot",
    "telegramPreview",
    "whatsapp",
    "lighthouse",
    "headless",
    "curl",
  ] as const)("%s est un robot", (name) => {
    expect(isLandingBotUserAgent(UA[name])).toBe(true);
  });

  it("agent utilisateur vide : robot", () => {
    expect(isLandingBotUserAgent("")).toBe(true);
    expect(isLandingBotUserAgent(null)).toBe(true);
  });

  it("un robot qui se dit TikTok sans être une vue web de téléphone reste un robot", () => {
    expect(isLandingBotUserAgent("TikTok 30.0 rv:300 (iPhone; iOS 17.0; fr_FR) Cronet")).toBe(true);
    expect(isLandingBotUserAgent(`${UA.tiktokAndroid} (compatible; SomeSpider/1.0)`)).toBe(true);
  });
});

describe("événements de page", () => {
  it("types, identifiant de visite et façon d'ouvrir", () => {
    expect(isLandingEventKind("VIEW")).toBe(true);
    expect(isLandingEventKind("OPENED")).toBe(true);
    expect(isLandingEventKind("view")).toBe(false);
    expect(isValidVisitId("k3j4h5g6f7d8s9a0")).toBe(true);
    expect(isValidVisitId("short")).toBe(false);
    expect(isValidVisitId("x".repeat(65))).toBe(false);
    expect(isValidVisitId("abc def ghi")).toBe(false);
    expect(normalizeLandingMethod("tg_scheme")).toBe("TG_SCHEME");
    expect(normalizeLandingMethod(" INTENT ")).toBe("INTENT");
    expect(normalizeLandingMethod("x'); drop")).toBeNull();
    expect(normalizeLandingMethod("A".repeat(33))).toBeNull();
    expect(normalizeLandingMethod(null)).toBeNull();
  });
});

describe("chiffres du tableau", () => {
  it("% de clic, % visite → join, coût par join", () => {
    expect(
      landingRates({ visits: 200, clicks: 120, requests: 50, approved: 40, spend: 25 }),
    ).toEqual({
      clickRate: 0.6,
      visitToJoin: 0.25,
      costPerJoin: 0.5,
    });
  });

  it("dénominateur nul ou source sans pub : null (affiché « — »)", () => {
    expect(landingRates({ visits: 0, clicks: 0, requests: 0, approved: 0, spend: 12 })).toEqual({
      clickRate: null,
      visitToJoin: null,
      costPerJoin: null,
    });
    expect(
      landingRates({ visits: 10, clicks: 3, requests: 2, approved: 1, spend: null }).costPerJoin,
    ).toBeNull();
    expect(landingRates({ visits: 10, clicks: 0, requests: 0, approved: 0, spend: 0 })).toEqual({
      clickRate: 0,
      visitToJoin: 0,
      costPerJoin: null,
    });
    expect(
      landingRates({ visits: 10, clicks: 2, requests: 4, approved: 0, spend: 0 }).costPerJoin,
    ).toBe(0);
    expect(
      landingRates({ visits: 10, clicks: 2, requests: 4, approved: 0, spend: Number.NaN })
        .costPerJoin,
    ).toBeNull();
  });

  it("ratio générique (ouverture de Telegram = ouvertures ÷ clics)", () => {
    expect(landingRatio(3, 4)).toBe(0.75);
    expect(landingRatio(3, 0)).toBeNull();
    expect(landingRatio(-1, 4)).toBe(0);
    expect(landingRatio(Number.NaN, 4)).toBe(0);
  });
});
