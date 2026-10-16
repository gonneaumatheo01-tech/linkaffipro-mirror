import {
  MESSENGER_INAPP_RE,
  SNAPCHAT_INAPP_RE,
  TELEGRAM_INAPP_RE,
  detectInApp,
  landingLang,
  type LandingLang,
  type LandingOpenMethod,
} from "./landing";

/**
 * Sortir du navigateur intégré d'une appli (phase 16, pages d'atterrissage) : dans TikTok, Instagram, Facebook,
 * Messenger, Snapchat…, ni `tg://` ni `https://t.me/+…` n'ouvrent Telegram de façon fiable. À l'appui sur le bouton, la
 * page affiche une aide plein écran « Appuie sur ••• puis « Ouvrir dans le navigateur » » avec une flèche pointée sur
 * le bouton du menu de l'appli ; une fois la page rouverte dans Safari ou Chrome, Telegram s'ouvre tout seul.
 *
 * Ce fichier tient la SEULE table des positions et des libellés (appli × système) : elle est copiée dans chaque page
 * pour la langue de la page (`escapeHelpData`) ; le script de la page ne la lit que dans un navigateur intégré.
 * Pour corriger une position ou un libellé : modifier `LANDING_ESCAPE_TABLE` (les tests vérifient que chaque appli a
 * ses deux systèmes, ses six langues et une position plausible). Aucune dépendance Node (aperçu en direct).
 *
 * Contrat de position : la flèche est verticale ; sa POINTE est à `x` px du bord gauche ou droit de la page (centre du
 * bouton du menu) et à `y` px du bord haut ou bas de la page, zone de sécurité de l'écran comprise
 * (`env(safe-area-inset-*)`, nulle dans une vue web placée sous la barre de l'appli). `y = 0` : pointe sur le bord de
 * la page, car le bouton du menu est dans la barre de l'appli, hors de la page, juste au-dessus (coin haut) ou
 * au-dessous (coin bas) : la flèche ne le cache jamais.
 */

/** Appli dont la table connaît le menu ; `OTHER` : appli inconnue (repli sûr, toujours présent). */
export const ESCAPE_APPS = [
  "TIKTOK",
  "INSTAGRAM",
  "FACEBOOK",
  "MESSENGER",
  "SNAPCHAT",
  "OTHER",
] as const;
export type EscapeApp = (typeof ESCAPE_APPS)[number];

/** Système (iPad compté comme iPhone ; tout autre système prend la ligne Android). */
export const ESCAPE_SYSTEMS = ["IOS", "ANDROID"] as const;
export type EscapeSystem = (typeof ESCAPE_SYSTEMS)[number];

export type EscapeCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left";
/** Signe du bouton du menu de l'appli, tel qu'affiché par l'appli. */
export type EscapeMenuSign = "•••" | "⋮";
/**
 * Tentative d'ouverture de Telegram faite à l'appui, l'aide déjà affichée, sans jamais aller vers la page t.me :
 * - `TG` : `tg://join?invite=…` dans un cadre caché (la page ne peut pas être remplacée) : TikTok, Snapchat, applis
 *   inconnues ;
 * - `NAV` (iPhone, applis Meta seulement) : la page demande elle-même `tg://join?invite=…`, dans le gestionnaire de
 *   l'appui (vrai geste : la vue web de Meta ignore une demande sans vrai appui, eiab), juste après l'affichage de
 *   l'aide ; l'appli passe l'adresse à iOS (Telegram s'ouvre, la page reste), comme en phase 15. inapp-debugger
 *   (iPhone, mars 2026) : « Browser scheme » ✅ pour Instagram, Facebook et Messenger (❌ pour TikTok) ; un cadre
 *   caché n'y a jamais été vérifié ;
 * - `INTENT` (Android, applis Meta seulement) : la page demande `intent://join?invite=…#Intent;scheme=tg;end` (sans
 *   repli) ; l'appli intercepte cette adresse et la passe à Android (Telegram s'ouvre, la page reste).
 * `NAV` et `INTENT` seulement là où la recherche dit que l'appli passe l'adresse au téléphone : sinon la vue web
 * pourrait afficher une page d'erreur à la place de l'aide. À vérifier sur de vrais téléphones.
 */
export type EscapeOpen = "TG" | "NAV" | "INTENT";

/**
 * Code de chaque façon d'ouvrir dans les envois de la page (CLICK, OPENED) : un code par façon, jamais celui d'une
 * version précédente (`INTENT` = phase 15, avec repli vers t.me : `LANDING_RETIRED_OPEN_METHODS`), pour que la rubrique
 * Pages ne mélange pas les époques.
 */
export const ESCAPE_OPEN_METHOD: Record<EscapeOpen, LandingOpenMethod> = {
  TG: "TG_FRAME",
  NAV: "TG_NAV",
  INTENT: "INTENT_HELP",
};

/** Lettre de chaque façon d'ouvrir dans la table copiée dans la page (`escapeHelpData`, lue par le script). */
export const ESCAPE_OPEN_CODE: Record<EscapeOpen, string> = { TG: "T", NAV: "N", INTENT: "I" };
/** Niveau de confiance d'une valeur de la table (« haute » : vue sur une capture du client). */
export type EscapeConfidence = "haute" | "moyenne" | "basse";

export type EscapeSpot = {
  corner: EscapeCorner;
  /** Px CSS entre le bord gauche (coins « left ») ou droit (« right ») de la page et la pointe de la flèche. */
  x: number;
  /** Px CSS entre le bord haut (coins « top ») ou bas (« bottom ») de la page et la pointe de la flèche. */
  y: number;
  sign: EscapeMenuSign;
  /** Libellé exact de la ligne du menu qui ouvre le navigateur du téléphone, par langue de la page. */
  label: Record<LandingLang, string>;
  open: EscapeOpen;
  /** D'où vient l'entrée, en une phrase ; « à confirmer » tant qu'aucune capture ne l'a vérifiée. */
  source: string;
  /** Adresses ou fichiers des sources (captures du client d'abord). */
  sources: readonly string[];
  /** Confiance : position et signe du bouton ; libellé en français (les autres langues : au mieux « moyenne »). */
  confidence: { position: EscapeConfidence; label: EscapeConfidence };
  /** Vérifiée sur une capture du client (`docs/tiktok-captures/`). */
  confirmed: boolean;
};

// ─── Libellés des menus (recherche du 16 octobre 2026) ───────────────────────────────────────────────────────────

/**
 * « Ouvrir dans le navigateur » : TikTok (français : capture du client ; anglais : chaîne `open_in_browser` du code
 * Android 47.4.3 ; TikTok télécharge ses autres traductions, non vérifiées) ; repli des applis inconnues.
 */
const OPEN_IN_BROWSER: Record<LandingLang, string> = {
  fr: "Ouvrir dans le navigateur",
  en: "Open in browser",
  es: "Abrir en el navegador",
  pt: "Abrir no navegador",
  de: "Im Browser öffnen",
  it: "Apri nel browser",
};

/** Instagram iPhone (« Open in external browser », guides et escape-in-app-browser ; traductions non vérifiées). */
const OPEN_IN_EXTERNAL_BROWSER: Record<LandingLang, string> = {
  fr: "Ouvrir dans le navigateur externe",
  en: "Open in external browser",
  es: "Abrir en un navegador externo",
  pt: "Abrir no navegador externo",
  de: "In externem Browser öffnen",
  it: "Apri nel browser esterno",
};

/** Facebook et Messenger iPhone (« Ouvrir dans le navigateur du système », source française d'octobre 2025). */
const OPEN_IN_SYSTEM_BROWSER: Record<LandingLang, string> = {
  fr: "Ouvrir dans le navigateur du système",
  en: "Open in system browser",
  es: "Abrir en el navegador del sistema",
  pt: "Abrir no navegador do sistema",
  de: "Im Systembrowser öffnen",
  it: "Apri nel browser di sistema",
};

/**
 * Applis Meta sur Android (Instagram, Facebook, Messenger) : la ligne porte le nom du navigateur par défaut du
 * téléphone, Chrome le plus souvent (« Open in Chrome »).
 */
const OPEN_IN_CHROME: Record<LandingLang, string> = {
  fr: "Ouvrir dans Chrome",
  en: "Open in Chrome",
  es: "Abrir en Chrome",
  pt: "Abrir no Chrome",
  de: "In Chrome öffnen",
  it: "Apri in Chrome",
};

const CAPTURE_TIKTOK_IPHONE = "docs/tiktok-captures/iphone-tiktok-menu-ouvert.png";
const SRC = {
  tiktokHelp:
    "https://ads.tiktok.com/resources/help/article/about-clear-cookies-and-cache-in-tiktoks-in-app-browser",
  tiktokApk: "APK TikTok Android 47.4.3 (com.zhiliaoapp.musically), analysé le 16/10/2026",
  inappDebugger: "https://github.com/shalanah/inapp-debugger",
  bouncy:
    "https://help.bouncy.ai/en/articles/13794112-tiktok-funnel-template-break-out-of-in-app-browser",
  linkboo: "https://link.boo/guides/escape-tiktok-browser",
  eiab: "https://github.com/anaclumos/eiab",
  onlineTechTips: "https://www.online-tech-tips.com/?p=98200",
  guidingTech: "https://www.guidingtech.com/how-to-fix-instagram-links-not-working/",
  charronFacebook:
    "https://francoischarron.com/reseaux-sociaux/facebook/comment-desactiver-le-navigateur-interne-de-facebook/8mEhaE5ZzB/",
  charronMessenger:
    "https://francoischarron.com/reseaux-sociaux/facebook/comment-desactiver-le-navigateur-interne-de-facebook-messenger/xgQx1LwnFY/",
  makeUseOf:
    "https://www.makeuseof.com/tag/turn-off-facebooks-app-browser-facebook-productivity-tips/",
  eiabCode: "https://github.com/anaclumos/eiab/blob/master/packages/eiab/src/index.ts",
} as const;

type SpotOptions = {
  corner: EscapeCorner;
  x: number;
  sign: EscapeMenuSign;
  label: Record<LandingLang, string>;
  open: EscapeOpen;
  source: string;
  sources: readonly string[];
  position: EscapeConfidence;
  labelConfidence: EscapeConfidence;
  confirmed?: boolean;
};

function spot(o: SpotOptions): EscapeSpot {
  return {
    corner: o.corner,
    x: o.x,
    // Le bouton du menu est toujours dans la barre de l'appli, hors de la page : pointe sur le bord de la page.
    y: 0,
    sign: o.sign,
    label: o.label,
    open: o.open,
    source: o.source,
    sources: o.sources,
    confidence: { position: o.position, label: o.labelConfidence },
    confirmed: o.confirmed === true,
  };
}

/**
 * LA table des positions et libellés (appli × système). Pour corriger une valeur après une capture d'un vrai
 * téléphone : changer l'entrée, passer `confirmed` à `true`, citer la capture dans `source` et `sources`.
 *
 * - TikTok iPhone (capture du client, `docs/tiktok-captures/iphone-tiktok-menu-ouvert.png`, iPhone 393 × 852 pt,
 *   mesurée au pixel) : barre noire de TikTok de 59 à 103 pt sous la barre d'état, « ••• » centré à 26 pt du bord
 *   droit et 81 pt du haut de l'écran, soit 22 pt AU-DESSUS du haut de la page ; menu en feuille sombre en bas,
 *   2e ligne « Ouvrir dans le navigateur ».
 * - TikTok Android : même barre du haut, « ••• » en haut à droite (code de l'appli : barre du haut et feuille
 *   « plus » ; guides de 2026) ; l'aide de TikTok parle du « bas de l'écran » et une barre du bas existe en option :
 *   à confirmer par une capture Android.
 * - Applis Meta : Instagram iPhone en haut à droite ; Facebook et Messenger iPhone en bas à droite (barre d'outils
 *   de l'appli, source française d'octobre 2025 ; d'autres sources disent en haut) ; Android : « ⋮ » en haut à droite.
 *   Sur iPhone, Telegram est tenté par la page elle-même pendant l'appui (`NAV`, `tg://join`, comme en phase 15 :
 *   « Browser scheme » ✅ dans inapp-debugger), jamais par une sortie vers Safari : `x-safari-https://` bloque la vue
 *   web de Facebook à partir de la version 555 et `instagram://extbrowser` demande un vrai appui, sans garantie (code
 *   et notes d'eiab, 2026) ; à essayer sur un vrai téléphone avant de l'ajouter.
 * - Snapchat : menu non documenté (sur Android, Snapchat ouvre un onglet Chrome : non reconnu, lien natif).
 */
export const LANDING_ESCAPE_TABLE: Record<EscapeApp, Record<EscapeSystem, EscapeSpot>> = {
  TIKTOK: {
    IOS: spot({
      corner: "top-right",
      x: 26,
      sign: "•••",
      label: OPEN_IN_BROWSER,
      // Aucune sortie automatique dans TikTok iPhone (inapp-debugger, mars 2026) : tg:// discret, sans quitter la page.
      open: "TG",
      source: `capture du client (iPhone, 16 octobre 2026) : ${CAPTURE_TIKTOK_IPHONE}`,
      sources: [CAPTURE_TIKTOK_IPHONE, SRC.tiktokHelp, SRC.inappDebugger],
      position: "haute",
      labelConfidence: "haute",
      confirmed: true,
    }),
    ANDROID: spot({
      corner: "top-right",
      x: 26,
      sign: "•••",
      label: OPEN_IN_BROWSER,
      // intent:// « not dependable » dans TikTok Android (inapp-debugger, novembre 2024) : tg:// seulement.
      open: "TG",
      source:
        "à confirmer : code de l'appli Android (barre du haut) et guides de 2026 ; l'aide TikTok dit « en bas de l'écran »",
      sources: [SRC.tiktokApk, SRC.tiktokHelp, SRC.bouncy, SRC.linkboo, SRC.inappDebugger],
      position: "basse",
      labelConfidence: "moyenne",
    }),
  },
  INSTAGRAM: {
    IOS: spot({
      corner: "top-right",
      x: 24,
      sign: "•••",
      label: OPEN_IN_EXTERNAL_BROWSER,
      // « Browser scheme » ✅ dans Instagram iPhone (inapp-debugger, mars 2026) : tg:// demandé par la page à l'appui.
      open: "NAV",
      source: "à confirmer : guides (« ••• » en haut à droite, « Open in external browser »)",
      sources: [SRC.eiab, SRC.onlineTechTips, SRC.inappDebugger, SRC.eiabCode],
      position: "moyenne",
      labelConfidence: "basse",
    }),
    ANDROID: spot({
      corner: "top-right",
      x: 24,
      sign: "⋮",
      label: OPEN_IN_CHROME,
      // Sortie par intent:// qui marche dans Instagram, Facebook et Messenger Android (inapp-debugger, novembre 2024 ;
      // eiab : « the proven, reliable escape for Instagram and the other Meta apps ») : demandée par la page elle-même
      // (l'appli l'intercepte), comme en phase 15 ; un cadre caché n'a jamais été vérifié dans ces applis.
      open: "INTENT",
      source: "à confirmer : guides (« ⋮ » en haut à droite, « Open in Chrome »)",
      sources: [SRC.guidingTech, SRC.onlineTechTips, SRC.inappDebugger, SRC.eiabCode],
      position: "moyenne",
      labelConfidence: "basse",
    }),
  },
  FACEBOOK: {
    IOS: spot({
      corner: "bottom-right",
      x: 28,
      sign: "•••",
      label: OPEN_IN_SYSTEM_BROWSER,
      // « Browser scheme » ✅ dans Facebook iPhone (inapp-debugger, mars 2026) ; jamais sans vrai appui (eiab).
      open: "NAV",
      source:
        "à confirmer : « ••• » en bas à droite et « Ouvrir dans le navigateur du système » (source française d'octobre 2025 ; d'autres sources disent en haut)",
      sources: [SRC.charronFacebook, SRC.makeUseOf, SRC.eiab, SRC.inappDebugger, SRC.eiabCode],
      position: "basse",
      labelConfidence: "moyenne",
    }),
    ANDROID: spot({
      corner: "top-right",
      x: 24,
      sign: "⋮",
      label: OPEN_IN_CHROME,
      open: "INTENT",
      source: "à confirmer : « ⋮ » en haut à droite (guides) ; libellé comme Instagram Android",
      sources: [SRC.makeUseOf, SRC.inappDebugger, SRC.eiabCode],
      position: "moyenne",
      labelConfidence: "basse",
    }),
  },
  MESSENGER: {
    IOS: spot({
      corner: "bottom-right",
      x: 28,
      sign: "•••",
      label: OPEN_IN_SYSTEM_BROWSER,
      // « Browser scheme » ✅ dans Messenger iPhone (inapp-debugger, mars 2026).
      open: "NAV",
      source:
        "à confirmer : navigateur commun des applis Meta, comme Facebook iPhone (en bas à droite en 2022)",
      sources: [SRC.charronMessenger, SRC.charronFacebook, SRC.inappDebugger],
      position: "basse",
      labelConfidence: "basse",
    }),
    ANDROID: spot({
      corner: "top-right",
      x: 24,
      sign: "⋮",
      label: OPEN_IN_CHROME,
      open: "INTENT",
      source: "à confirmer : supposé comme Facebook Android",
      sources: [SRC.inappDebugger],
      position: "basse",
      labelConfidence: "basse",
    }),
  },
  SNAPCHAT: {
    IOS: spot({
      corner: "top-right",
      x: 24,
      sign: "•••",
      label: OPEN_IN_BROWSER,
      open: "TG",
      source: "à confirmer : menu de Snapchat non documenté, repli en haut à droite",
      sources: [SRC.inappDebugger],
      position: "basse",
      labelConfidence: "basse",
    }),
    ANDROID: spot({
      corner: "top-right",
      x: 24,
      sign: "⋮",
      label: OPEN_IN_BROWSER,
      open: "TG",
      source:
        "à confirmer : Snapchat Android ouvre d'habitude un onglet Chrome (non reconnu, lien natif) ; repli en haut à droite",
      sources: [SRC.inappDebugger],
      position: "basse",
      labelConfidence: "basse",
    }),
  },
  // Appli inconnue (NAVER, Daum, LinkedIn…) : la plupart des navigateurs intégrés ont leur menu en haut à droite.
  OTHER: {
    IOS: spot({
      corner: "top-right",
      x: 24,
      sign: "•••",
      label: OPEN_IN_BROWSER,
      open: "TG",
      source: "repli (appli inconnue) : menu le plus courant, en haut à droite",
      sources: [SRC.inappDebugger],
      position: "basse",
      labelConfidence: "basse",
    }),
    ANDROID: spot({
      corner: "top-right",
      x: 24,
      sign: "⋮",
      label: OPEN_IN_BROWSER,
      open: "TG",
      source: "repli (appli inconnue) : menu le plus courant, en haut à droite",
      sources: [SRC.inappDebugger],
      position: "basse",
      labelConfidence: "basse",
    }),
  },
};

/** Entrée de la table pour une appli et un système (repli sûr : `OTHER`). */
export function escapeSpotFor(app: string | null | undefined, system: EscapeSystem): EscapeSpot {
  const row = (LANDING_ESCAPE_TABLE as Record<string, Record<EscapeSystem, EscapeSpot>>)[app ?? ""];
  return (row ?? LANDING_ESCAPE_TABLE.OTHER)[system];
}

/**
 * Appli de l'aide d'après l'agent utilisateur ; null : navigateur ordinaire (aucune aide). Même règle que
 * `detectInApp` (statistiques), avec Messenger et Snapchat à part (menus différents), et SANS le navigateur intégré
 * de Telegram (`TELEGRAM_INAPP_RE`) : Telegram y ouvre lui-même le lien `https://t.me/+…`, l'aide gênerait. Le script
 * de la page applique exactement cette règle (`LANDING_HEAD_SCRIPT`, mêmes expressions) : un test le vérifie sur des
 * agents réels.
 */
export function detectEscapeApp(ua: string | null | undefined): EscapeApp | null {
  const app = detectInApp(ua);
  if (!app || !ua) return null;
  if (TELEGRAM_INAPP_RE.test(ua)) return null;
  if (app === "FACEBOOK") return MESSENGER_INAPP_RE.test(ua) ? "MESSENGER" : "FACEBOOK";
  if (app === "OTHER") return SNAPCHAT_INAPP_RE.test(ua) ? "SNAPCHAT" : "OTHER";
  return app;
}

// ─── Textes de l'aide ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Textes de l'aide dans une langue : `{s}` = signe du menu, `{l}` = libellé exact du menu, `{w}` = où est le bouton
 * (« en haut à droite »). Guillemets de la langue, espaces insécables en français.
 */
export type EscapeTexts = {
  /** Très gros titre : « Appuie sur {s} ». */
  title: string;
  /** Sous le titre : « puis « {l} » ». */
  then: string;
  /** Trois étapes numérotées. */
  steps: readonly [string, string, string];
  where: Record<EscapeCorner, string>;
  /** Petit lien : relance la tentative d'ouverture de Telegram. */
  retry: string;
  /** Petit lien : ferme l'aide (elle revient à l'appui suivant). */
  close: string;
};

const NB = " ";

export const LANDING_ESCAPE_TEXTS: Record<LandingLang, EscapeTexts> = {
  fr: {
    title: "Appuie sur {s}",
    then: `puis «${NB}{l}${NB}»`,
    steps: [
      "Appuie sur {s} {w}",
      `Choisis «${NB}{l}${NB}»`,
      "Accepte d'ouvrir Telegram et rejoins le canal",
    ],
    where: {
      "top-right": "en haut à droite",
      "top-left": "en haut à gauche",
      "bottom-right": "en bas à droite",
      "bottom-left": "en bas à gauche",
    },
    retry: "Réessayer",
    close: "Fermer",
  },
  en: {
    title: "Tap {s}",
    then: "then “{l}”",
    steps: ["Tap {s} {w}", "Choose “{l}”", "Allow Telegram to open and join the channel"],
    where: {
      "top-right": "at the top right",
      "top-left": "at the top left",
      "bottom-right": "at the bottom right",
      "bottom-left": "at the bottom left",
    },
    retry: "Try again",
    close: "Close",
  },
  es: {
    title: "Toca {s}",
    then: "y luego «{l}»",
    steps: ["Toca {s} {w}", "Elige «{l}»", "Acepta abrir Telegram y únete al canal"],
    where: {
      "top-right": "arriba a la derecha",
      "top-left": "arriba a la izquierda",
      "bottom-right": "abajo a la derecha",
      "bottom-left": "abajo a la izquierda",
    },
    retry: "Reintentar",
    close: "Cerrar",
  },
  pt: {
    title: "Toque em {s}",
    then: "depois em «{l}»",
    steps: ["Toque em {s} {w}", "Escolha «{l}»", "Aceite abrir o Telegram e entre no canal"],
    where: {
      "top-right": "no canto superior direito",
      "top-left": "no canto superior esquerdo",
      "bottom-right": "no canto inferior direito",
      "bottom-left": "no canto inferior esquerdo",
    },
    retry: "Tentar de novo",
    close: "Fechar",
  },
  de: {
    title: "Tippe auf {s}",
    then: "dann auf „{l}“",
    steps: [
      "Tippe {w} auf {s}",
      "Wähle „{l}“",
      "Erlaube das Öffnen von Telegram und tritt dem Kanal bei",
    ],
    where: {
      "top-right": "oben rechts",
      "top-left": "oben links",
      "bottom-right": "unten rechts",
      "bottom-left": "unten links",
    },
    retry: "Erneut versuchen",
    close: "Schließen",
  },
  it: {
    title: "Tocca {s}",
    then: "poi «{l}»",
    steps: [
      "Tocca {s} {w}",
      "Scegli «{l}»",
      "Consenti l'apertura di Telegram e unisciti al canale",
    ],
    where: {
      "top-right": "in alto a destra",
      "top-left": "in alto a sinistra",
      "bottom-right": "in basso a destra",
      "bottom-left": "in basso a sinistra",
    },
    retry: "Riprova",
    close: "Chiudi",
  },
};

export function escapeTexts(lang: unknown): EscapeTexts {
  return LANDING_ESCAPE_TEXTS[landingLang(lang)];
}

/** Phrase complète de l'aide pour une appli, un système et une langue (tests, guide, captures). */
export function escapeHelpSentence(
  app: string | null | undefined,
  system: EscapeSystem,
  lang: unknown,
): { title: string; then: string; steps: string[] } {
  const t = escapeTexts(lang);
  const s = escapeSpotFor(app, system);
  const label = s.label[landingLang(lang)];
  const fill = (x: string) =>
    x.replace("{s}", s.sign).replace("{l}", label).replace("{w}", t.where[s.corner]);
  return { title: fill(t.title), then: fill(t.then), steps: t.steps.map(fill) };
}

// ─── Données copiées dans la page ────────────────────────────────────────────────────────────────────────────────

const CORNER_CODE: Record<EscapeCorner, string> = {
  "top-right": "tr",
  "top-left": "tl",
  "bottom-right": "br",
  "bottom-left": "bl",
};

/** Clé courte d'une appli dans les données de la page : sa première lettre (unique, test). */
export function escapeAppKey(app: EscapeApp): string {
  return app[0]!;
}

/**
 * Table de la langue de la page, telle que lue par le script (`JSON.parse` de l'attribut `data-t` de l'aide), en
 * format court pour le poids de la page :
 * `{"w":{"tr":"en haut à droite"},"s":["•••","⋮"],"l":["Ouvrir dans le navigateur",…],"a":{"T":["tr 26 0 0 0 T","tr 24 0 0 0 T"],…}}`
 * — `w` : où est le bouton, pour les coins utilisés ; `s` : signes ; `l` : libellés ; `a` : par appli (première
 * lettre, `O` = appli inconnue), [iPhone, Android] = « coin x y n°signe n°libellé ouverture » (`ESCAPE_OPEN_CODE` :
 * `T` cadre caché tg://, `N` tg:// demandé par la page, `I` intent://).
 */
export function escapeHelpData(lang: unknown): string {
  const l = landingLang(lang);
  const t = LANDING_ESCAPE_TEXTS[l];
  const w: Record<string, string> = {};
  const signs: string[] = [];
  const labels: string[] = [];
  const index = (list: string[], v: string) => {
    if (!list.includes(v)) list.push(v);
    return list.indexOf(v);
  };
  const a: Record<string, string[]> = {};
  for (const app of ESCAPE_APPS) {
    a[escapeAppKey(app)] = ESCAPE_SYSTEMS.map((system) => {
      const s = LANDING_ESCAPE_TABLE[app][system];
      const corner = CORNER_CODE[s.corner];
      w[corner] = t.where[s.corner];
      return [
        corner,
        s.x,
        s.y,
        index(signs, s.sign),
        index(labels, s.label[l]),
        ESCAPE_OPEN_CODE[s.open],
      ].join(" ");
    });
  }
  return JSON.stringify({ w, s: signs, l: labels, a });
}
