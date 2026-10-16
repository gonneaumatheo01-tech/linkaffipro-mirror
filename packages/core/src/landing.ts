import { isBotUserAgent } from "./bots";

/**
 * Pages d'atterrissage Telegram (phase 15, rubrique « Pages ») : règles pures communes au site (page publique, envoi des
 * visites et clics, rubrique Pages), au worker (écriture des visites, liens d'invitation) et aux scripts. Aucune
 * dépendance Node : utilisable aussi dans le navigateur (aperçu en direct). Contrat : `docs/PAGES-ATTERRISSAGE.md`.
 *
 * Le rendu HTML de la page est ailleurs (`landing-render.ts`).
 */

// ─── Adresses ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Adresse publique d'une page : `/j/<slug>` ; 3 à 48 caractères, minuscules, chiffres et tirets, ni au début ni à la
 * fin. Un slug ne commence jamais par « _ » (segments réservés sous `/j/`).
 */
export const LANDING_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const LANDING_SLUG_MAX = 48;

/** Préfixe des pages : `https://go.goolink.eu/j/<slug>`. */
export const LANDING_PATH_PREFIX = "/j/";
/** Envoi des visites, clics et ouvertures par la page (`navigator.sendBeacon`). */
export const LANDING_EVENT_PATH = "/j/_e";

/** Photo du canal servie par le site (`/j/_p/<channelId>.jpg`). */
export function landingPhotoPath(channelId: string): string {
  return `/j/_p/${encodeURIComponent(channelId)}.jpg`;
}

/** Segment réservé sous `/j/` (envoi des visites, photo…) : il commence par « _ » et n'est jamais une page. */
export function isReservedLandingSegment(segment: string): boolean {
  return segment.startsWith("_");
}

export function isValidLandingSlug(slug: unknown): slug is string {
  return typeof slug === "string" && LANDING_SLUG_RE.test(slug);
}

/**
 * Slug proposé à partir du nom de la page : minuscules sans accents, tout le reste devient « - », 48 caractères au plus.
 * Toujours valide (« page » si le nom ne contient ni lettre ni chiffre, complété par « -page » s'il est trop court).
 * L'unicité se règle avec `landingSlugCandidate`.
 */
export function slugifyLanding(name: string): string {
  let s = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  s = s.slice(0, LANDING_SLUG_MAX).replace(/-+$/g, "");
  if (!s) return "page";
  if (s.length < 3) s = `${s}-page`;
  return s;
}

/** n-ième proposition de slug quand `base` est déjà pris : « promo », « promo-2 », « promo-3 »… (toujours valide). */
export function landingSlugCandidate(base: string, attempt: number): string {
  const slug = isValidLandingSlug(base) ? base : slugifyLanding(base);
  if (attempt <= 1) return slug;
  const suffix = `-${Math.floor(attempt)}`;
  return `${slug.slice(0, LANDING_SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/** Adresse complète d'une page et d'une source (« Copier le lien ») ; la source par défaut n'a pas de `?src=`. */
export function landingPublicUrl(baseUrl: string, slug: string, sourceKey: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${LANDING_PATH_PREFIX}${slug}`;
  return sourceKey ? `${url}?src=${encodeURIComponent(sourceKey)}` : url;
}

// ─── Sources ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Clé de la source par défaut (visite sans `?src=` ou avec une source inconnue), créée avec la page. */
export const DEFAULT_LANDING_SOURCE = "";

/** Clé d'une source (« tk01 », « exo1 ») : lettres, chiffres, tirets, soulignés ; 1 à 32 caractères. */
export const LANDING_SOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Clé de source normalisée (sans espaces autour, en minuscules) ou null si elle est vide ou invalide. Sert à la saisie
 * (rubrique Pages) et à la lecture de `?src=` (comparaison sans tenir compte des majuscules).
 */
export function normalizeSourceKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  return LANDING_SOURCE_KEY_RE.test(k) ? k.toLowerCase() : null;
}

/** Ce qu'il faut d'une source pour choisir le lien du bouton (`LandingSource` + URL de son lien d'invitation). */
export type LandingSourceLike = {
  /** Clé enregistrée (en minuscules) ; "" = source par défaut. */
  key: string;
  isActive: boolean;
  /** Lien d'invitation actuel (`https://t.me/+…`), null tant que Telegram ne l'a pas créé. */
  inviteLink: string | null;
};

function usable(s: LandingSourceLike): boolean {
  return s.isActive && !!s.inviteLink;
}

/**
 * Source utilisée pour une visite : la source demandée (`?src=`, sans tenir compte des majuscules) si elle est active
 * et a son lien ; sinon la source par défaut "" (si elle a son lien) ; en dernier recours une autre source active avec
 * lien (le bouton fonctionne toujours, même si le lien par défaut n'a pas encore pu être créé), la première par ordre
 * de clé. Null : aucun lien utilisable (aucune page ne peut être affichée).
 */
export function pickLandingSource<S extends LandingSourceLike>(
  sources: readonly S[],
  src: string | null | undefined,
): S | null {
  const wanted = normalizeSourceKey(src);
  if (wanted) {
    const hit = sources.find((s) => s.key.toLowerCase() === wanted && usable(s));
    if (hit) return hit;
  }
  const byDefault = sources.find((s) => s.key === DEFAULT_LANDING_SOURCE && usable(s));
  if (byDefault) return byDefault;
  const others = sources
    .filter(usable)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return others[0] ?? null;
}

/** Source retenue et `?src=` reçu quand il n'a pas été suivi (diagnostic `LandingEvent.rawSrc`). */
export type LandingSourceResolution<S> = {
  source: S | null;
  /** `?src=` tel que reçu (64 caractères au plus) quand il n'a pas donné sa propre source ; null sinon. */
  rawSrc: string | null;
};

/** `pickLandingSource` + `?src=` non suivi (source inconnue, inactive ou sans lien) gardé pour le diagnostic. */
export function resolveLandingSource<S extends LandingSourceLike>(
  sources: readonly S[],
  src: string | null | undefined,
): LandingSourceResolution<S> {
  const source = pickLandingSource(sources, src);
  const raw = typeof src === "string" ? src.trim().slice(0, 64) : "";
  const followed = !!source && raw !== "" && source.key === normalizeSourceKey(raw);
  return { source, rawSrc: raw && !followed ? raw : null };
}

// ─── Liens d'invitation ──────────────────────────────────────────────────────────────────────────────────────────

/** Longueur maximale du nom d'un lien d'invitation chez Telegram (`createChatInviteLink`, `name`). */
export const INVITE_LINK_NAME_MAX = 32;

/** Coupe une chaîne à `max` unités UTF-16 sans couper un caractère en deux (emoji). */
function cutUtf16(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * Nom du lien d'invitation d'une source : « <page>-<source> » (« <page> » pour la source par défaut), 32 caractères
 * au plus (limite de Telegram) : la source est gardée entière, le nom de la page raccourci. Jamais vide.
 */
export function landingInviteLinkName(pageName: string, sourceKey: string): string {
  const page = (pageName ?? "").replace(/\s+/g, " ").trim() || "page";
  const source = (sourceKey ?? "").trim();
  if (!source) return cutUtf16(page, INVITE_LINK_NAME_MAX).trim() || "page";
  const room = INVITE_LINK_NAME_MAX - source.length - 1;
  if (room < 1) return cutUtf16(source, INVITE_LINK_NAME_MAX);
  const head = cutUtf16(page, room).replace(/[\s-]+$/, "");
  return head ? `${head}-${source}` : cutUtf16(source, INVITE_LINK_NAME_MAX);
}

/**
 * Code d'invitation d'un lien Telegram (« AbC… » de `https://t.me/+AbC…`, `https://t.me/joinchat/AbC…`,
 * `tg://join?invite=AbC…`), ou null si ce n'est pas un lien d'invitation.
 */
export function inviteHashOf(telegramInviteLink: string | null | undefined): string | null {
  if (!telegramInviteLink) return null;
  const s = telegramInviteLink.trim();
  const m =
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)\/?$/i.exec(
      s,
    ) ?? /^tg:\/\/join\?invite=([A-Za-z0-9_-]+)$/i.exec(s);
  return m?.[1] ?? null;
}

/** Façons d'ouvrir le lien d'invitation (le bouton garde toujours `https`, utilisable sans script). */
export type LandingOpenUrls = {
  /** `https://t.me/+<code>` : lien du bouton, et repli. */
  https: string;
  /** `tg://join?invite=<code>` : ouvre directement l'appli Telegram (iPhone). */
  tg: string;
  /** `intent://join?invite=<code>#Intent;scheme=tg;…;S.browser_fallback_url=…;end` (Android, repli sur `https`). */
  intent: string;
};

/** Adresses d'ouverture d'un lien d'invitation (null : ce n'est pas un lien d'invitation). */
export function landingOpenUrls(
  telegramInviteLink: string | null | undefined,
  opts: { androidPackage?: string } = {},
): LandingOpenUrls | null {
  const hash = inviteHashOf(telegramInviteLink);
  if (!hash) return null;
  const https = `https://t.me/+${hash}`;
  const pkg = opts.androidPackage ? `package=${opts.androidPackage};` : "";
  return {
    https,
    tg: `tg://join?invite=${hash}`,
    intent: `intent://join?invite=${hash}#Intent;scheme=tg;${pkg}S.browser_fallback_url=${encodeURIComponent(https)};end`,
  };
}

// ─── Pixels ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Identifiant de pixel TikTok : 20 caractères, majuscules et chiffres, commençant par une lettre (« CD2UC93C77U35BVUO310 »,
 * « D0DQFPJC77U75NH4N3QG » ; relevé sur des codes `ttq.load('…')` réels, octobre 2026).
 */
export const TIKTOK_PIXEL_ID_RE = /^[A-Z][A-Z0-9]{19}$/;
/**
 * Identifiant de pixel Meta (« ID du jeu de données ») : uniquement des chiffres, 15 ou 16 en général (« 129586523576870 »,
 * « 1070571443971391 »), parfois plus pour les plus récents : 14 à 20 acceptés.
 */
export const META_PIXEL_ID_RE = /^[1-9][0-9]{13,19}$/;

export function isValidTikTokPixelId(id: unknown): id is string {
  return typeof id === "string" && TIKTOK_PIXEL_ID_RE.test(id);
}

export function isValidMetaPixelId(id: unknown): id is string {
  return typeof id === "string" && META_PIXEL_ID_RE.test(id);
}

/**
 * Saisie d'un pixel TikTok → identifiant (en majuscules) ou null. Accepte l'identifiant seul, ou le code complet collé
 * par erreur (`ttq.load('…')`, `sdkid=…`). Une saisie vide donne null (pas de pixel).
 */
export function normalizeTikTokPixelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const inCode = /ttq\.load\(\s*["']([A-Za-z0-9]+)["']/.exec(s) ?? /sdkid=([A-Za-z0-9]+)/.exec(s);
  const id = (inCode?.[1] ?? s).toUpperCase();
  return isValidTikTokPixelId(id) ? id : null;
}

/**
 * Saisie d'un pixel Meta → identifiant (chiffres) ou null. Accepte l'identifiant seul (espaces retirés), ou le code
 * complet collé par erreur (`fbq('init', '…')`, `tr?id=…`). Une saisie vide donne null (pas de pixel).
 */
export function normalizeMetaPixelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const inCode = /fbq\(\s*["']init["']\s*,\s*["']?(\d+)["']?/.exec(s) ?? /[?&]id=(\d+)/.exec(s);
  const id = inCode?.[1] ?? s.replace(/\s+/g, "");
  return isValidMetaPixelId(id) ? id : null;
}

// ─── Langues et textes par défaut ────────────────────────────────────────────────────────────────────────────────

/** Langues d'une page : les six langues des textes du bot (`packages/telegram/src/i18n.ts`), français par défaut. */
export const LANDING_LANGS = ["fr", "en", "es", "pt", "de", "it"] as const;
export type LandingLang = (typeof LANDING_LANGS)[number];
export const DEFAULT_LANDING_LANG: LandingLang = "fr";

export function isLandingLang(v: unknown): v is LandingLang {
  return typeof v === "string" && (LANDING_LANGS as readonly string[]).includes(v);
}

/** Langue enregistrée → langue connue (« fr » si elle est inconnue ; « pt-BR » → « pt »). */
export function landingLang(v: unknown): LandingLang {
  if (typeof v !== "string") return DEFAULT_LANDING_LANG;
  const base = v.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isLandingLang(base) ? base : DEFAULT_LANDING_LANG;
}

/** Textes par défaut d'une page dans une langue. */
export type LandingDefaults = {
  /** Texte du bouton quand `LandingPage.buttonText` est vide. */
  buttonText: string;
  /** Exemple de petite ligne sous le bouton (proposé dans le formulaire, jamais affiché d'office). */
  footnoteExample: string;
  /** Bandeau cookies (page avec `cookieBanner`). */
  cookieText: string;
  cookieAccept: string;
  cookieDecline: string;
};

const LANDING_DEFAULTS: Record<LandingLang, LandingDefaults> = {
  fr: {
    buttonText: "Rejoindre le canal →",
    footnoteExample: "Gratuit · 1 clic · via Telegram",
    cookieText: "Nous utilisons des cookies pour mesurer nos publicités.",
    cookieAccept: "Accepter",
    cookieDecline: "Refuser",
  },
  en: {
    buttonText: "Join the channel →",
    footnoteExample: "Free · 1 tap · via Telegram",
    cookieText: "We use cookies to measure our ads.",
    cookieAccept: "Accept",
    cookieDecline: "Decline",
  },
  es: {
    buttonText: "Unirse al canal →",
    footnoteExample: "Gratis · 1 clic · vía Telegram",
    cookieText: "Usamos cookies para medir nuestros anuncios.",
    cookieAccept: "Aceptar",
    cookieDecline: "Rechazar",
  },
  pt: {
    buttonText: "Entrar no canal →",
    footnoteExample: "Grátis · 1 clique · via Telegram",
    cookieText: "Usamos cookies para medir os nossos anúncios.",
    cookieAccept: "Aceitar",
    cookieDecline: "Recusar",
  },
  de: {
    buttonText: "Kanal beitreten →",
    footnoteExample: "Kostenlos · 1 Klick · über Telegram",
    cookieText: "Wir verwenden Cookies, um unsere Werbung zu messen.",
    cookieAccept: "Akzeptieren",
    cookieDecline: "Ablehnen",
  },
  it: {
    buttonText: "Unisciti al canale →",
    footnoteExample: "Gratis · 1 clic · via Telegram",
    cookieText: "Usiamo i cookie per misurare i nostri annunci.",
    cookieAccept: "Accetta",
    cookieDecline: "Rifiuta",
  },
};

/** Textes par défaut d'une langue (français si la langue est inconnue). */
export function landingDefaults(lang: unknown): LandingDefaults {
  return LANDING_DEFAULTS[landingLang(lang)];
}

// ─── Visiteur : système, navigateur intégré, robots ──────────────────────────────────────────────────────────────

/** Système du téléphone (`LandingEvent.os`). */
export type LandingOs = "IOS" | "ANDROID" | "OTHER";
/** Navigateur intégré reconnu (`LandingEvent.inApp`) ; null : navigateur ordinaire (Safari, Chrome…). */
export type LandingInApp = "TIKTOK" | "INSTAGRAM" | "FACEBOOK" | "OTHER";

/** Système d'après l'agent utilisateur (statistiques seulement : la page est la même pour tous). */
export function detectLandingOs(ua: string | null | undefined): LandingOs {
  if (!ua) return "OTHER";
  if (/iPhone|iPad|iPod/i.test(ua)) return "IOS";
  if (/\bAndroid\b/i.test(ua)) return "ANDROID";
  return "OTHER";
}

/**
 * Marqueurs du navigateur intégré de TikTok (iPhone : `musical_ly_…`, Android : `trill_…`, `BytedanceWebview` ;
 * `thirdLandingPageFeInfra` : pages des pubs TikTok sur iPhone, relevé en production le 16 octobre 2026).
 */
export const TIKTOK_INAPP_RE =
  /musical_ly|\btrill_\d|BytedanceWebview|ByteLocale|\bTikTok[ /]\d|thirdLandingPageFeInfra/i;
export const INSTAGRAM_INAPP_RE = /\bInstagram[ /]\d/i;
/** Facebook et Messenger : `[FBAN/FBIOS;…]`, `[FB_IAB/FB4A;FBAV/…]`, `MessengerForiOS` (FBIOS et FB4A sont toujours
 * précédés de `FBAN/` ou `FB_IAB/`). */
export const FACEBOOK_INAPP_RE = /FBAN\/|FBAV\/|FB_IAB\/|MessengerForiOS|MessengerLite/i;
/** Messenger, parmi les navigateurs intégrés de Meta (`MessengerForiOS`, `Orca-Android`). */
export const MESSENGER_INAPP_RE = /MessengerForiOS|MessengerLite|Orca-Android/i;
/**
 * Autres navigateurs intégrés connus (Snapchat, X, LinkedIn, Pinterest, Line, WeChat, appli Google, Telegram, NAVER,
 * Daum, NewsSapphire…).
 */
export const OTHER_INAPP_RE =
  /\bSnapchat\/|Twitter for |\bTwitterAndroid\b|\[LinkedInApp\]|\bPinterest\/|\bLine\/\d|MicroMessenger\/|\bGSA\/\d|\bTelegram-Android\b|NAVER\(inapp|\bDaumApps\/|\bNewsSapphire\//i;
/** Snapchat, parmi les autres navigateurs intégrés. */
export const SNAPCHAT_INAPP_RE = /\bSnapchat\//i;
/**
 * Navigateur intégré de Telegram (Android) : compté comme « autre appli » dans les statistiques, mais jamais d'aide
 * pour en sortir (Telegram ouvre lui-même `tg://` et `https://t.me/+…` ; inapp-debugger : sortie possible).
 */
export const TELEGRAM_INAPP_RE = /\bTelegram-Android\b/i;
/**
 * Vue web Android : `; wv)`, ou `Version/4.0 Chrome/…` (TikTok et d'autres retirent `wv`) sauf dans un vrai
 * navigateur qui garde cette forme (Mi, Huawei, UC… : `…Browser/`, Opera `OPR/`, Edge `EdgA/`).
 */
export const ANDROID_WEBVIEW_RE = /;\s*wv\)|Version\/4\.0 Chrome\//;
export const ANDROID_BROWSER_RE = /[A-Za-z]Browser\/|\bOPR\/|\bEdgA\/|\bFirefox\//;

/**
 * Navigateur intégré d'après l'agent utilisateur ; null pour un navigateur ordinaire. « OTHER » : autre application
 * connue, ou vue web Android (`ANDROID_WEBVIEW_RE`) ou iPhone (sans `Safari/`). Sert aux statistiques et, dans la
 * page, SEULEMENT à afficher l'aide « Ouvrir dans le navigateur » et à placer sa flèche (précision de la règle 7
 * acceptée par le client le 15 octobre) : le HTML et la destination sont les mêmes pour tous.
 */
export function detectInApp(ua: string | null | undefined): LandingInApp | null {
  if (!ua) return null;
  if (TIKTOK_INAPP_RE.test(ua)) return "TIKTOK";
  if (INSTAGRAM_INAPP_RE.test(ua)) return "INSTAGRAM";
  if (FACEBOOK_INAPP_RE.test(ua)) return "FACEBOOK";
  if (OTHER_INAPP_RE.test(ua)) return "OTHER";
  if (/\bAndroid\b/i.test(ua) && ANDROID_WEBVIEW_RE.test(ua) && !ANDROID_BROWSER_RE.test(ua))
    return "OTHER";
  if (/iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//.test(ua))
    return "OTHER";
  return null;
}

/** Signes d'un robot même dans un agent utilisateur d'application (aperçus de liens, robots d'indexation). */
const CRAWLER_HINT_RE =
  /spider|crawler|externalhit|headless|preview|\bbot\b|bot\/|bot;|lighthouse|playwright|puppeteer/i;

/**
 * Robot connu, pour les pages d'atterrissage : la règle commune `isBotUserAgent`, sauf pour les vrais navigateurs
 * intégrés des applications (TikTok, Instagram, Facebook, Snapchat, Pinterest…), que cette règle prend pour des robots à
 * cause du nom de l'application (« tiktok », « bytedance », « snapchat », « pinterest ») : un visiteur venu d'une pub
 * TikTok est une vraie personne. Un robot n'est jamais compté ; la page qu'il reçoit est la même.
 */
export function isLandingBotUserAgent(ua: string | null | undefined): boolean {
  if (!isBotUserAgent(ua)) return false;
  const u = ua ?? "";
  if (!detectInApp(u) || CRAWLER_HINT_RE.test(u)) return true;
  const mobileWebView =
    /^Mozilla\/5\.0 /.test(u) && /AppleWebKit\//.test(u) && detectLandingOs(u) !== "OTHER";
  return !mobileWebView;
}

// ─── Visites, clics, ouvertures ──────────────────────────────────────────────────────────────────────────────────

/**
 * Type d'un événement de page (enum Prisma `LandingEventType`) : visite, clic, Telegram ouvert ; phase 16 : aide
 * « Ouvrir dans le navigateur » affichée (HELP), visite sortie de l'appli et rouverte dans Safari / Chrome (ESCAPED,
 * même `visitId` que la visite d'origine), ouverture automatique de Telegram tentée au chargement (AUTO_OPEN).
 */
export type LandingEventKind = "VIEW" | "CLICK" | "OPENED" | "HELP" | "ESCAPED" | "AUTO_OPEN";
export const LANDING_EVENT_KINDS: readonly LandingEventKind[] = [
  "VIEW",
  "CLICK",
  "OPENED",
  "HELP",
  "ESCAPED",
  "AUTO_OPEN",
];

export function isLandingEventKind(v: unknown): v is LandingEventKind {
  return typeof v === "string" && (LANDING_EVENT_KINDS as readonly string[]).includes(v);
}

/** Identifiant aléatoire d'une visite (créé par la page) : 8 à 64 lettres, chiffres, tirets, soulignés. */
export const LANDING_VISIT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidVisitId(v: unknown): v is string {
  return typeof v === "string" && LANDING_VISIT_ID_RE.test(v);
}

/**
 * Valeurs de `LandingEvent.method` envoyées par la page (la page peut en envoyer d'autres, même forme) :
 * - CLICK / OPENED : `HTTPS` (lien natif `https://t.me/+…`, navigateur ordinaire) ; phase 16, navigateur intégré
 *   (aide affichée), d'après la table `landing-escape.ts` (`ESCAPE_OPEN_METHOD`) : `TG_FRAME` (`tg://join` dans un
 *   cadre caché : TikTok, Snapchat, applis inconnues), `TG_NAV` (applis Meta sur iPhone : la page demande
 *   `tg://join` elle-même pendant l'appui, que l'appli passe à iOS sans quitter la page) ou `INTENT_HELP` (applis Meta
 *   sur Android : la page demande `intent://…;scheme=tg`, sans repli, que l'appli passe à Android) ;
 * - AUTO_OPEN / OPENED qui la suit : `AUTO_TG` (iPhone, `tg://join`) ou `AUTO_INTENT` (Android, `intent://`) ;
 * - ESCAPED : façon dont la sortie a été reconnue : `TGO` (marqueur `tgo=1` + `vid` : appui dans l'appli, même
 *   visite), `VID` (`vid` seul : page rouverte AVANT tout appui, même visite), `TTCLID` ou `FBCLID` (identifiant de
 *   clic pub hors navigateur intégré, sans `vid` : le worker la rattache à la visite de l'appli qui porte le même
 *   identifiant, sur le même système, `LANDING_ESCAPE_MAX_AGE_MS`) ;
 * - HELP : appli dont l'aide a été montrée (`TIKTOK`, `INSTAGRAM`, `FACEBOOK`, `MESSENGER`, `SNAPCHAT`, `OTHER`).
 *
 * Façons d'ouvrir des versions précédentes, plus jamais envoyées (elles ne restent que dans les anciennes périodes ;
 * aucune n'est réutilisée, pour que les chiffres des deux époques ne se mélangent pas) : `TG_SCHEME` et `INTENT`
 * (phase 15 : navigation de la page, avec repli vers t.me après 1,5 à 2 s), `INTENT_FRAME` (`intent://` dans un
 * cadre caché, première version de la phase 16).
 */
export const LANDING_SENT_OPEN_METHODS = [
  "HTTPS",
  "TG_FRAME",
  "TG_NAV",
  "INTENT_HELP",
  "AUTO_TG",
  "AUTO_INTENT",
] as const;
export const LANDING_RETIRED_OPEN_METHODS = ["TG_SCHEME", "INTENT", "INTENT_FRAME"] as const;
export const LANDING_OPEN_METHODS = [
  ...LANDING_SENT_OPEN_METHODS,
  ...LANDING_RETIRED_OPEN_METHODS,
] as const;
export type LandingOpenMethod = (typeof LANDING_OPEN_METHODS)[number];

/** Façon d'ouvrir reçue de la page → `A_Z_0_9` en majuscules (32 caractères au plus), ou null. */
export function normalizeLandingMethod(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,31}$/.test(m) ? m : null;
}

/** Délai après le clic pendant lequel quitter la page compte comme « Telegram s'est ouvert » (OPENED). */
export const LANDING_OPENED_WINDOW_MS = 2000;
/**
 * Dans un navigateur intégré : délai après la TENTATIVE (cadre caché ou `intent://`) pendant lequel quitter la page
 * compte comme « Telegram s'est ouvert ». Court exprès : passer par « ••• → Ouvrir dans le navigateur » prend plus
 * d'une seconde (lire l'aide, deux appuis, la feuille du menu qui monte) et ne doit pas compter comme une ouverture.
 */
export const LANDING_OPENED_INAPP_WINDOW_MS = 800;
/**
 * Durée de validité du repère de sortie posé par la page dans un navigateur intégré (`vid` + `tgt` = minute de la
 * pose, en base 36) : au-delà, une page rouverte avec ce repère est une nouvelle visite, sans ouverture automatique
 * par `tgo` (lien copié par « Copier le lien » et envoyé à d'autres). Même durée pour rattacher, côté worker, une
 * sortie reconnue seulement par `ttclid` / `fbclid` à la visite de l'appli qui porte le même identifiant.
 */
export const LANDING_ESCAPE_MAX_AGE_MS = 30 * 60_000;
/**
 * Hors navigateur intégré, une perte de focus dans ce délai (question « Ouvrir dans « Telegram » ? » de Safari ou de
 * Chrome) allonge la fenêtre d'OPENED jusqu'à cette durée après l'appui ou la tentative automatique. Mesure seulement :
 * aucune minuterie, aucune navigation n'en dépend.
 */
export const LANDING_OPENED_AFTER_PROMPT_MS = 10_000;
/**
 * Identifiant de clic pub qui peut rattacher un envoi d'un navigateur ORDINAIRE de téléphone (Safari, Chrome) à la
 * visite faite juste avant dans le navigateur intégré d'une appli (même page, même `ttclid` / `fbclid`, moins de
 * `LANDING_ESCAPE_MAX_AGE_MS` avant, MÊME système `os`) : page rouverte par « Ouvrir dans le navigateur » sans le
 * repère `vid` (appli qui rouvre l'adresse d'origine, ou sortie avant l'appui). Null : rien à rattacher (navigateur
 * intégré, ordinateur, robot, aucun identifiant). `ttclid` d'abord (TikTok), puis `fbclid` (Meta).
 *
 * Une sortie reste sur le même téléphone : `os` est le système que doit avoir la visite de l'appli (iPhone ↔ iPhone,
 * Android ↔ Android). Sans cela, un lien copié dans TikTok (« Copier le lien » garde `ttclid`) et ouvert par un ami
 * sur un autre système serait fondu dans la visite de l'expéditeur (visite perdue, fausse sortie). Un iPad dont
 * Safari se présente comme un Mac (`OTHER`) n'est jamais rattaché par cette voie (seulement par `vid`), et une vue
 * web d'iPad présentée comme un Mac n'en reçoit aucune : aucun cas réel n'y gagnerait, alors qu'accepter `OTHER`
 * ouvrirait la porte aux appareils mélangés.
 */
export function landingEscapeClickId(e: {
  inApp: string | null | undefined;
  os: string | null | undefined;
  isBot?: boolean | null;
  ttclid?: string | null;
  fbclid?: string | null;
}): { field: "ttclid" | "fbclid"; value: string; os: "IOS" | "ANDROID" } | null {
  if (e.inApp || e.isBot === true || (e.os !== "IOS" && e.os !== "ANDROID")) return null;
  const os = e.os;
  const tt = typeof e.ttclid === "string" ? e.ttclid.trim() : "";
  if (tt) return { field: "ttclid", value: tt, os };
  const fb = typeof e.fbclid === "string" ? e.fbclid.trim() : "";
  return fb ? { field: "fbclid", value: fb, os } : null;
}

/** Objectif (phase 16) : de l'appui à l'aide visible ou au départ du lien vers Telegram. */
export const LANDING_TAP_REACTION_MS = 100;
/** Objectif (phase 16) : de la première réponse du serveur à la tentative d'ouverture automatique. */
export const LANDING_AUTO_OPEN_MAX_MS = 300;

// ─── Chiffres du tableau ─────────────────────────────────────────────────────────────────────────────────────────

/** Ratio (0,153 → 15,3 % à l'affichage) ; null quand le dénominateur vaut 0 (affiché « — »). */
export function landingRatio(numerator: number, denominator: number): number | null {
  const n = Number.isFinite(numerator) && numerator > 0 ? numerator : 0;
  const d = Number.isFinite(denominator) && denominator > 0 ? denominator : 0;
  return d === 0 ? null : n / d;
}

export type LandingCounts = {
  /** Visites humaines (VIEW, `visitId` distincts). */
  visits: number;
  /** Clics humains (CLICK, `visitId` distincts). */
  clicks: number;
  /** Demandes d'adhésion par les liens de la page / source, faites dans la période (« join »). */
  requests: number;
  /** Ces demandes, acceptées depuis. */
  approved: number;
  /** Dépense de la pub reliée sur la période (EUR) ; null : source non reliée à une pub. */
  spend: number | null;
};

export type LandingRates = {
  /** % de clic : clics ÷ visites. */
  clickRate: number | null;
  /** % visite → join : demandes ÷ visites. */
  visitToJoin: number | null;
  /** Coût par join : dépense ÷ demandes (EUR) ; null sans pub reliée ou sans demande. */
  costPerJoin: number | null;
};

/** % de clic, % visite → join et coût par join (null quand le dénominateur vaut 0 ou sans pub reliée). */
export function landingRates(c: LandingCounts): LandingRates {
  const spend = c.spend === null || !Number.isFinite(c.spend) ? null : Math.max(0, c.spend);
  return {
    clickRate: landingRatio(c.clicks, c.visits),
    visitToJoin: landingRatio(c.requests, c.visits),
    costPerJoin: spend === null ? null : c.requests > 0 ? spend / c.requests : null,
  };
}
