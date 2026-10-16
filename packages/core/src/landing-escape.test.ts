import { describe, expect, it } from "vitest";
import {
  LANDING_LANGS,
  LANDING_OPEN_METHODS,
  LANDING_RETIRED_OPEN_METHODS,
  LANDING_SENT_OPEN_METHODS,
} from "./landing";
import {
  ESCAPE_APPS,
  ESCAPE_OPEN_CODE,
  ESCAPE_OPEN_METHOD,
  ESCAPE_SYSTEMS,
  LANDING_ESCAPE_TABLE,
  LANDING_ESCAPE_TEXTS,
  detectEscapeApp,
  escapeAppKey,
  escapeHelpData,
  escapeHelpSentence,
  escapeSpotFor,
} from "./landing-escape";

/** Agents utilisateurs réels relevés en production (docs/tiktok-captures/agents-utilisateurs-reels.md). */
const REAL = {
  tiktokIos26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 musical_ly_47.1.0 BytedanceWebview/d8a21c6",
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/605.1 musical_ly_46.0.2 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR isDarkMode/0 WKWebView/1 RevealType/Dialog",
  tiktokIosAds:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148thirdLandingPageFeInfra",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S928U Build/UP1A.231005.007; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.164 Mobile Safari/537.36 musical_ly_2024600020 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/46.0.2 ByteLocale/en ByteFullLocale/en Region/be AppId/1233 Spark/1.7.2 AppVersion/46.0.2 PIA/2.5.3 BytedanceWebview/d8a21c6",
  tiktokAndroidWv:
    "Mozilla/5.0 (Linux; Android 15; SM-A057F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.107 Mobile Safari/537.36 musical_ly_2024701040 AppName/musical_ly ByteLocale/en-GB",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 10; M2003J15SC Build/QP1A.190711.020; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.117 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/516.0.0.73.90;]",
  snapchatIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/605.1 Snapchat/13.42.0.47 (like Safari/8614.4.6.0.6, panda)",
  naverIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1 NAVER(inapp; search; 2000; 12.13.2)",
  daumAndroid:
    "Mozilla/5.0 (Linux; Android 13; M2012K11G Build/TKQ1.220829.002; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.5938.60 Mobile Safari/537.36 DaumApps/8.2.1 DaumDevice/mobile",
  newsSapphire:
    "Mozilla/5.0 (Linux; Android 13; SM-A127F Build/TP1A.220624.014; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/132.0.6834.80 Mobile Safari/537.36 NewsSapphire/32.1.430710004",
  newsSapphireNoVersion:
    "Mozilla/5.0 (Linux; Android 10; ONEPLUS A7010; ) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.40 Mobile Safari/E7FBAF NewsSapphire/32.0.430627001",
  safariIos26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1",
  safariIos13:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  claudeDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.37337.1 Chrome/152.0.7977.130 Safari/537.36",
};

describe("table des positions et libellés (appli × système)", () => {
  it("chaque appli a une entrée pour l'iPhone et pour Android, complète et plausible", () => {
    expect(Object.keys(LANDING_ESCAPE_TABLE).sort()).toEqual([...ESCAPE_APPS].sort());
    for (const app of ESCAPE_APPS) {
      for (const system of ESCAPE_SYSTEMS) {
        const s = LANDING_ESCAPE_TABLE[app][system];
        const where = `${app} ${system}`;
        expect(["top-right", "top-left", "bottom-right", "bottom-left"], where).toContain(s.corner);
        // Pointe dans la largeur d'un petit téléphone, près du bord (bouton du menu de l'appli).
        expect(s.x, where).toBeGreaterThanOrEqual(8);
        expect(s.x, where).toBeLessThanOrEqual(120);
        expect(s.y, where).toBeGreaterThanOrEqual(0);
        expect(s.y, where).toBeLessThanOrEqual(120);
        expect(["•••", "⋮"], where).toContain(s.sign);
        expect(["TG", "NAV", "INTENT"], where).toContain(s.open);
        for (const lang of LANDING_LANGS) {
          expect(s.label[lang].trim().length, `${where} ${lang}`).toBeGreaterThan(3);
          expect(s.label[lang]).not.toMatch(/[<>"&]/);
        }
        // Une entrée non vérifiée sur une capture le dit ; une entrée confirmée cite la capture du client.
        if (!s.confirmed) expect(s.source, where).toMatch(/confirmer|repli/);
        else {
          expect(s.sources[0], where).toMatch(/^docs\/tiktok-captures\//);
          expect(s.confidence.position, where).toBe("haute");
        }
        // Sources et niveau de confiance toujours donnés.
        expect(s.sources.length, where).toBeGreaterThan(0);
        expect(["haute", "moyenne", "basse"], where).toContain(s.confidence.position);
        expect(["haute", "moyenne", "basse"], where).toContain(s.confidence.label);
        // « haute » seulement pour ce qu'une capture du client a montré.
        if (s.confidence.position === "haute" || s.confidence.label === "haute")
          expect(s.confirmed, where).toBe(true);
      }
    }
    // Demande d'adresse par la page (`NAV` sur iPhone, `intent://` sur Android) seulement pour les applis dont la
    // recherche dit qu'elles la passent au téléphone (applis Meta : inapp-debugger, « Browser scheme » ✅ sur iPhone,
    // intent:// sur Android ; eiab) : ailleurs, la vue web pourrait afficher une page d'erreur à la place de l'aide.
    // TikTok : ❌ sur iPhone, « not dependable » sur Android (inapp-debugger) : cadre caché tg:// seulement, comme
    // Snapchat et les applis inconnues. intent:// jamais sur iPhone (inconnu d'iOS), `NAV` jamais sur Android.
    const meta = ["INSTAGRAM", "FACEBOOK", "MESSENGER"];
    for (const app of ESCAPE_APPS) {
      expect(LANDING_ESCAPE_TABLE[app].IOS.open, app).toBe(meta.includes(app) ? "NAV" : "TG");
      expect(LANDING_ESCAPE_TABLE[app].ANDROID.open, app).toBe(
        meta.includes(app) ? "INTENT" : "TG",
      );
    }
    for (const app of ["INSTAGRAM", "FACEBOOK", "MESSENGER"] as const)
      for (const system of ESCAPE_SYSTEMS)
        expect(LANDING_ESCAPE_TABLE[app][system].sources, `${app} ${system}`).toContain(
          "https://github.com/shalanah/inapp-debugger",
        );
  });

  it("chaque façon d'ouvrir de la table a son propre code, envoyé avec le clic, jamais celui d'une ancienne version", () => {
    const opens = ["TG", "NAV", "INTENT"] as const;
    expect(Object.keys(ESCAPE_OPEN_METHOD).sort()).toEqual([...opens].sort());
    expect(Object.keys(ESCAPE_OPEN_CODE).sort()).toEqual([...opens].sort());
    // Un code par façon (les chiffres de la rubrique Pages les séparent), lettre courte unique dans la page.
    expect(new Set(Object.values(ESCAPE_OPEN_METHOD)).size).toBe(opens.length);
    expect(new Set(Object.values(ESCAPE_OPEN_CODE)).size).toBe(opens.length);
    for (const o of opens) {
      expect(LANDING_SENT_OPEN_METHODS, o).toContain(ESCAPE_OPEN_METHOD[o]);
      expect(LANDING_OPEN_METHODS, o).toContain(ESCAPE_OPEN_METHOD[o]);
      // `INTENT` (phase 15, avec repli vers t.me) et `TG_SCHEME` / `INTENT_FRAME` : plus jamais envoyés, pour que
      // les anciennes périodes ne se mélangent pas aux nouvelles.
      expect(LANDING_RETIRED_OPEN_METHODS, o).not.toContain(ESCAPE_OPEN_METHOD[o]);
      expect(ESCAPE_OPEN_CODE[o], o).toMatch(/^[A-Z]$/);
    }
    expect(ESCAPE_OPEN_METHOD).toEqual({ TG: "TG_FRAME", NAV: "TG_NAV", INTENT: "INTENT_HELP" });
  });

  it("TikTok iPhone d'après la capture du client : « ••• » en haut à droite, 26 px du bord, « Ouvrir dans le navigateur »", () => {
    const s = LANDING_ESCAPE_TABLE.TIKTOK.IOS;
    expect(s).toMatchObject({
      corner: "top-right",
      x: 26,
      y: 0,
      sign: "•••",
      open: "TG",
      confirmed: true,
    });
    expect(s.label.fr).toBe("Ouvrir dans le navigateur");
    expect(s.source).toContain("docs/tiktok-captures/iphone-tiktok-menu-ouvert.png");
    // TikTok Android : l'intent:// n'y est pas fiable (inapp-debugger), tg:// seulement.
    expect(LANDING_ESCAPE_TABLE.TIKTOK.ANDROID.open).toBe("TG");
  });

  it("valeurs retenues d'après la recherche (16 octobre 2026), à confirmer sur de vrais téléphones", () => {
    // TikTok Android : même barre du haut que l'iPhone (code de l'appli, guides), même libellé.
    expect(LANDING_ESCAPE_TABLE.TIKTOK.ANDROID).toMatchObject({
      corner: "top-right",
      x: 26,
      y: 0,
      sign: "•••",
      confirmed: false,
    });
    expect(LANDING_ESCAPE_TABLE.TIKTOK.ANDROID.label).toEqual(
      LANDING_ESCAPE_TABLE.TIKTOK.IOS.label,
    );
    // Facebook et Messenger iPhone : « ••• » en bas à droite, « Ouvrir dans le navigateur du système ».
    for (const app of ["FACEBOOK", "MESSENGER"] as const) {
      expect(LANDING_ESCAPE_TABLE[app].IOS).toMatchObject({ corner: "bottom-right", sign: "•••" });
      expect(LANDING_ESCAPE_TABLE[app].IOS.label.fr).toBe("Ouvrir dans le navigateur du système");
    }
    // Instagram iPhone : en haut à droite, « Open in external browser ».
    expect(LANDING_ESCAPE_TABLE.INSTAGRAM.IOS).toMatchObject({ corner: "top-right", sign: "•••" });
    // Applis Meta sur iPhone : tg:// demandé par la page pendant l'appui (vrai geste), comme en phase 15.
    for (const app of ["INSTAGRAM", "FACEBOOK", "MESSENGER"] as const)
      expect(LANDING_ESCAPE_TABLE[app].IOS.open, app).toBe("NAV");
    expect(LANDING_ESCAPE_TABLE.INSTAGRAM.IOS.label.en).toBe("Open in external browser");
    // Applis Meta sur Android : « ⋮ » en haut à droite, nom du navigateur par défaut ; intent:// y fonctionne.
    for (const app of ["INSTAGRAM", "FACEBOOK", "MESSENGER"] as const) {
      expect(LANDING_ESCAPE_TABLE[app].ANDROID).toMatchObject({
        corner: "top-right",
        sign: "⋮",
        open: "INTENT",
      });
      expect(LANDING_ESCAPE_TABLE[app].ANDROID.label.fr).toBe("Ouvrir dans Chrome");
    }
    // Seul TikTok iPhone est confirmé.
    const confirmed = ESCAPE_APPS.flatMap((app) =>
      ESCAPE_SYSTEMS.filter((s) => LANDING_ESCAPE_TABLE[app][s].confirmed).map(
        (s) => `${app} ${s}`,
      ),
    );
    expect(confirmed).toEqual(["TIKTOK IOS"]);
  });

  it("repli sûr pour une appli inconnue", () => {
    expect(escapeSpotFor("WECHAT", "IOS")).toBe(LANDING_ESCAPE_TABLE.OTHER.IOS);
    expect(escapeSpotFor(null, "ANDROID")).toBe(LANDING_ESCAPE_TABLE.OTHER.ANDROID);
    expect(escapeSpotFor("TIKTOK", "IOS")).toBe(LANDING_ESCAPE_TABLE.TIKTOK.IOS);
    expect(escapeSpotFor("OTHER", "ANDROID").sign).toBe("⋮");
  });
});

describe("reconnaissance de l'appli (agents réels)", () => {
  it.each([
    ["tiktokIos26", "TIKTOK"],
    ["tiktokIos", "TIKTOK"],
    ["tiktokIosAds", "TIKTOK"],
    ["tiktokAndroid", "TIKTOK"],
    ["tiktokAndroidWv", "TIKTOK"],
    ["facebookAndroid", "FACEBOOK"],
    ["snapchatIos", "SNAPCHAT"],
    ["naverIos", "OTHER"],
    ["daumAndroid", "OTHER"],
    ["newsSapphire", "OTHER"],
    ["newsSapphireNoVersion", "OTHER"],
    ["safariIos26", null],
    ["safariIos13", null],
    ["chromeWindows", null],
    ["claudeDesktop", null],
  ] as const)("%s → %s", (name, app) => {
    expect(detectEscapeApp(REAL[name])).toBe(app);
  });

  it("Messenger à part de Facebook (menus différents)", () => {
    expect(
      detectEscapeApp(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/431.0.0.40.112;FBBV/528469617]",
      ),
    ).toBe("MESSENGER");
    expect(
      detectEscapeApp(
        "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.193 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/440.0.0.31.105;]",
      ),
    ).toBe("MESSENGER");
    expect(detectEscapeApp(null)).toBeNull();
  });

  it("navigateur intégré de Telegram : jamais d'aide (Telegram ouvre lui-même le lien)", () => {
    const telegram =
      "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.3 (Samsung SM-A546B; Android 14; SDK 34; AVERAGE)";
    expect(detectEscapeApp(telegram)).toBeNull();
  });
});

describe("textes de l'aide", () => {
  it("dans les six langues, avec les repères du signe, du libellé et de l'endroit", () => {
    for (const lang of LANDING_LANGS) {
      const t = LANDING_ESCAPE_TEXTS[lang];
      expect(t.title, lang).toContain("{s}");
      expect(t.then, lang).toContain("{l}");
      expect(t.steps, lang).toHaveLength(3);
      expect(t.steps[0], lang).toMatch(/\{s\}.*\{w\}|\{w\}.*\{s\}/);
      expect(t.steps[1], lang).toContain("{l}");
      expect(t.retry.length).toBeGreaterThan(2);
      expect(t.close.length).toBeGreaterThan(2);
      for (const w of Object.values(t.where)) expect(w.length).toBeGreaterThan(3);
    }
  });

  it("français : « Appuie sur ••• puis « Ouvrir dans le navigateur » », guillemets avec espaces insécables", () => {
    const fr = escapeHelpSentence("TIKTOK", "IOS", "fr");
    expect(fr.title).toBe("Appuie sur •••");
    expect(fr.then).toBe("puis « Ouvrir dans le navigateur »");
    expect(fr.steps).toEqual([
      "Appuie sur ••• en haut à droite",
      "Choisis « Ouvrir dans le navigateur »",
      "Accepte d'ouvrir Telegram et rejoins le canal",
    ]);
    for (const x of [...Object.values(LANDING_ESCAPE_TEXTS.fr.where), LANDING_ESCAPE_TEXTS.fr.then])
      expect(x).not.toMatch(/« | »/); // jamais une espace ordinaire dans les guillemets
    expect(escapeHelpSentence("INSTAGRAM", "ANDROID", "en").title).toBe("Tap ⋮");
    expect(escapeHelpSentence("TIKTOK", "IOS", "de").steps[0]).toBe("Tippe oben rechts auf •••");
  });
});

describe("données copiées dans la page", () => {
  it("clés courtes uniques, table complète et lisible par le script", () => {
    const keys = ESCAPE_APPS.map(escapeAppKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(escapeAppKey("OTHER")).toBe("O");
    for (const lang of LANDING_LANGS) {
      const d = JSON.parse(escapeHelpData(lang)) as {
        w: Record<string, string>;
        s: string[];
        l: string[];
        a: Record<string, [string, string]>;
      };
      expect(Object.keys(d.a).sort()).toEqual([...keys].sort());
      for (const app of ESCAPE_APPS) {
        ESCAPE_SYSTEMS.forEach((system, i) => {
          const [corner, x, y, sign, label, open] = d.a[escapeAppKey(app)]![i]!.split(" ");
          const spot = LANDING_ESCAPE_TABLE[app][system];
          expect(Number(x)).toBe(spot.x);
          expect(Number(y)).toBe(spot.y);
          expect(d.s[Number(sign)]).toBe(spot.sign);
          expect(d.l[Number(label)]).toBe(spot.label[lang]);
          expect(open).toBe(ESCAPE_OPEN_CODE[spot.open]);
          expect(d.w[corner!]).toBe(LANDING_ESCAPE_TEXTS[lang].where[spot.corner]);
        });
      }
    }
    // Seuls les coins utilisés par la table sont copiés (poids de la page).
    const code = { "top-right": "tr", "top-left": "tl", "bottom-right": "br", "bottom-left": "bl" };
    const used = new Set(
      ESCAPE_APPS.flatMap((app) =>
        ESCAPE_SYSTEMS.map((s) => code[LANDING_ESCAPE_TABLE[app][s].corner]),
      ),
    );
    expect(Object.keys(JSON.parse(escapeHelpData("fr")).w).sort()).toEqual([...used].sort());
  });
});
