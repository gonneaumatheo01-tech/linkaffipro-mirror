import {
  ANDROID_BROWSER_RE,
  ANDROID_WEBVIEW_RE,
  FACEBOOK_INAPP_RE,
  INSTAGRAM_INAPP_RE,
  LANDING_ESCAPE_MAX_AGE_MS,
  LANDING_EVENT_PATH,
  LANDING_OPENED_AFTER_PROMPT_MS,
  LANDING_OPENED_INAPP_WINDOW_MS,
  LANDING_OPENED_WINDOW_MS,
  MESSENGER_INAPP_RE,
  OTHER_INAPP_RE,
  SNAPCHAT_INAPP_RE,
  TELEGRAM_INAPP_RE,
  TIKTOK_INAPP_RE,
  inviteHashOf,
  isValidMetaPixelId,
  isValidTikTokPixelId,
  landingDefaults,
  landingLang,
} from "./landing";
import { escapeHelpData, escapeTexts } from "./landing-escape";

/**
 * Rendu HTML d'une page d'atterrissage (phase 15, rubrique « Pages ») : un écran de téléphone sans défilement, dans
 * l'ordre vrai titre du canal, accroche, sous-texte facultatif, gros bouton Telegram dans la zone du pouce, petite ligne
 * facultative. CSS et scripts en ligne, polices du système, aucun framework, aucune ressource externe.
 *
 * Fonction PURE : la sortie ne dépend que de la page, de sa source et du titre du canal, jamais du visiteur (règle 7 du
 * client : les mêmes octets pour un robot et pour une personne). Aucune dépendance Node : utilisable aussi pour
 * l'aperçu en direct de la rubrique Pages. Contrat : `docs/PAGES-ATTERRISSAGE.md`.
 *
 * Le bouton est un vrai lien `https://t.me/+…` (utilisable sans script). Phase 16 (sortir de TikTok), AUCUN délai :
 * - navigateur ordinaire (Safari, Chrome, bureau) : le lien natif part tout de suite, sans script devant ;
 * - navigateur intégré (TikTok, Instagram, Facebook, Messenger, Snapchat, autres vues web) : dès l'affichage, l'adresse
 *   porte le repère de la visite (`vid`, `tgt`) ; l'appui affiche aussitôt l'aide plein écran « Appuie sur ••• puis
 *   « Ouvrir dans le navigateur » » (table `landing-escape.ts`, copiée dans la page pour sa langue), marque l'adresse
 *   (`tgo=1`) et tente d'ouvrir Telegram d'après la table (cadre caché `tg://` ; dans les applis Meta, qui passent
 *   l'adresse au téléphone, `tg://` sur iPhone ou `intent://` sur Android demandé par la page), sans jamais quitter la
 *   page ni sauter vers la page t.me ;
 * - rouverte dans Safari ou Chrome avec le marqueur : un petit script au tout début du `<head>` tente d'ouvrir
 *   Telegram dès le chargement, une seule fois, après avoir retiré le marqueur de l'adresse (`tgd=1` à la place).
 * La détection du navigateur ne sert qu'à afficher l'aide et placer sa flèche (précision de la règle 7 acceptée par le
 * client le 15 octobre) : le HTML et la destination sont les mêmes pour tous. Visites, clics et pixels partent après.
 */

/** Longueurs maximales des textes (en caractères) : la page tient sur un écran et pèse moins de 15 Ko. */
export const LANDING_TEXT_LIMITS = {
  /** Titre d'un canal chez Telegram : 128 caractères au plus. */
  channelTitle: 128,
  headline: 120,
  subtext: 200,
  buttonText: 40,
  footnote: 80,
} as const;

/** Taille d'affichage de la photo du canal (px, carrée, ronde). */
export const LANDING_PHOTO_SIZE = 88;

export type LandingRenderInput = {
  /** Identifiant de la page (envoyé avec les visites et les clics). */
  pageId: string;
  /** Langue de la page (`LandingPage.language`), « fr » par défaut. */
  lang?: string | null;
  /** Vrai titre du canal chez Telegram (jamais saisi). */
  channelTitle: string;
  headline: string;
  subtext?: string | null;
  /** Texte du bouton ; vide : texte par défaut de la langue (« Rejoindre le canal → »). */
  buttonText?: string | null;
  /** Petite ligne sous le bouton, facultative. */
  footnote?: string | null;
  /**
   * Adresse de la photo du canal (même origine, `/j/_p/<canal>.jpg?v=…`), seulement si la page l'affiche et qu'elle
   * existe. En aperçu, une image en ligne `data:image/jpeg;base64,…` est aussi acceptée.
   */
  photoUrl?: string | null;
  /** Lien d'invitation de la source (`https://t.me/+…`). */
  inviteLink: string;
  /** Source retenue ("" = source par défaut). */
  sourceKey: string;
  tiktokPixelId?: string | null;
  metaPixelId?: string | null;
  /** Bandeau cookies (pixels seulement après accord). */
  cookieBanner?: boolean;
  /** Adresse d'envoi des visites et clics (par défaut `/j/_e`, même origine). */
  eventUrl?: string;
  /** Aperçu (rubrique Pages) : aucun script, aucun envoi, aucun pixel. */
  preview?: boolean;
};

export type LandingDocument = {
  html: string;
  /** Contenu exact de la balise `<style>` (empreinte pour la CSP). */
  style: string;
  /** Contenu exact de la balise `<script>` de fin de page (empreinte pour la CSP), null en aperçu. */
  script: string | null;
  /** Contenu exact de la balise `<script>` du début du `<head>` (empreinte pour la CSP), null en aperçu. */
  headScript: string | null;
  /** Script des pixels (empreinte pour la CSP), seulement si la page a un pixel (jamais en aperçu). */
  pixelScript: string | null;
  /** Pixels présents dans la page (CSP élargie pour eux). */
  pixels: { tiktok: boolean; meta: boolean };
};

// ─── Textes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Échappement HTML strict (texte et valeurs d'attribut entre guillemets doubles). */
export function escapeLandingHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Échappement d'un TEXTE entre balises (contenu de `<title>`, `<p>`, `<h1>`, `<span>`…), plus court pour le poids de
 * la page (phase 16 : une accroche pleine de guillemets ou d'apostrophes dépassait 15 Ko) : `<` toujours, `&`
 * seulement devant une lettre, un chiffre ou « # » (là seulement il pourrait commencer une référence de caractère,
 * règles de lecture HTML5) ; guillemets, apostrophes et `>` sans danger hors d'un attribut, laissés tels quels. Les
 * valeurs d'attribut gardent `escapeLandingHtml`.
 */
export function escapeLandingText(s: string): string {
  return s.replace(/&(?=[A-Za-z0-9#])/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * Texte affiché : caractères de contrôle retirés, espaces regroupés, coupé à `max` caractères sans couper un emoji ;
 * chaîne vide si rien ne reste.
 */
export function landingText(raw: string | null | undefined, max: number): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ");
  const s = flat.trim();
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (n >= max) break;
    out += ch;
    n++;
  }
  return out.trim();
}

/** Lien du bouton : toujours `https://t.me/+<code>` ; un lien illisible donne `https://t.me/` (aperçu sans lien). */
export function landingButtonHref(inviteLink: string | null | undefined): string {
  const hash = inviteHashOf(inviteLink);
  return hash ? `https://t.me/+${hash}` : "https://t.me/";
}

// ─── CSS (identique pour toutes les pages) ───────────────────────────────────────────────────────────────────────

/**
 * Bleu du bouton : #2481CC, le bleu des boutons de telegram.org (texte blanc lisible : contraste 4,1:1, au-delà du
 * 3:1 exigé pour un texte gras de cette taille).
 *
 * Un seul écran, jamais de défilement, même avec les textes les plus longs permis, la photo et le bandeau cookies
 * dans un petit téléphone (navigateur intégré d'un iPhone SE : 375 × 548) : la page fait exactement la hauteur de
 * l'écran (`100dvh`, repli `100vh`), le bouton, sa petite ligne et le bandeau gardent leur place, seule la zone des
 * textes se partage le reste (`min-height:0`) ; chaque texte a un nombre de lignes maximal (titre du canal 2,
 * accroche 4, sous-texte 3, bouton 2, petite ligne 2) et les tailles suivent aussi la hauteur de l'écran. Centrage
 * « sûr » par marges automatiques : si la place manque, c'est la fin des textes qui est coupée, jamais le titre.
 */
export const LANDING_STYLE = [
  "*{box-sizing:border-box;margin:0}",
  "html,body{height:100%}",
  "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
  'body{overflow:hidden;background:#fff;color:#0f1419;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}',
  "main{display:flex;flex-direction:column;height:100vh;height:100dvh;max-width:480px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 20px max(12px,env(safe-area-inset-bottom));overflow:hidden}",
  ".t{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:clamp(6px,1.6vh,12px);padding:clamp(4px,1.4vh,12px) 0;text-align:center}",
  ".t>:first-child{margin-top:auto}",
  ".t>:last-child{margin-bottom:auto}",
  `.i{display:block;flex:none;width:min(${LANDING_PHOTO_SIZE}px,12vh);height:min(${LANDING_PHOTO_SIZE}px,12vh);margin:0 auto;border-radius:50%;object-fit:cover;background:#e7eef4}`,
  ".n,h1,.s,.f,#b span{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}",
  ".n{flex:none;-webkit-line-clamp:2;font-size:clamp(14px,2.6vh,17px);font-weight:600;line-height:1.3;color:#536471}",
  "h1{flex:none;-webkit-line-clamp:4;font-size:clamp(20px,min(7.4vw,4.4vh),34px);line-height:1.15;font-weight:800;letter-spacing:-.01em}",
  ".s{flex:none;-webkit-line-clamp:3;font-size:clamp(14px,2.6vh,17px);line-height:1.4;color:#3d4a55}",
  ".c{flex:none;padding:clamp(4px,1vh,8px) 0 max(8px,4vh)}",
  "#b{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:clamp(48px,8vh,58px);padding:clamp(9px,1.8vh,14px) 18px;border-radius:14px;background:#2481cc;color:#fff;font-size:clamp(17px,2.9vh,19px);font-weight:700;line-height:1.2;text-align:center;text-decoration:none;box-shadow:0 6px 18px rgba(36,129,204,.35);-webkit-tap-highlight-color:transparent;touch-action:manipulation}",
  "#b span{-webkit-line-clamp:2}",
  "#b:active,#b.p{background:#1d6fb0;transform:scale(.98)}",
  "#b:focus-visible{outline:3px solid #0f1419;outline-offset:3px}",
  "#b svg{flex:none;width:24px;height:24px}",
  ".f{-webkit-line-clamp:2;margin-top:clamp(6px,1.4vh,12px);font-size:14px;line-height:1.35;text-align:center;color:#536471}",
  ".k{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 -20px calc(-1*max(12px,env(safe-area-inset-bottom)));padding:8px 20px max(8px,env(safe-area-inset-bottom));border-top:1px solid #e3e9ee;background:#f6f8fa;font-size:13px;line-height:1.35;color:#3d4a55}",
  ".k p{flex:1 1 100%}",
  // Refuser aussi simple qu'accepter (recommandation de la CNIL) : deux boutons identiques, côte à côte.
  ".k button{flex:1;font:inherit;font-weight:600;padding:7px 12px;border:1px solid #9fb0bd;border-radius:999px;background:#fff;color:#0f1419;cursor:pointer}",
  // Aide « Ouvrir dans le navigateur » (phase 16) : plein écran sombre, texte énorme, flèche jaune animée qui pointe
  // sur le bouton du menu de l'appli (hors de la page, juste derrière le bord) ; cachée tant que le script ne l'ouvre
  // pas. Centrage « sûr » (marges automatiques) : dans un petit écran, l'aide défile au lieu d'être coupée en haut.
  ".h{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9;display:grid;padding:92px 24px;padding-top:calc(92px + env(safe-area-inset-top,0px));background:#0f1419;color:#fff;overflow:auto;outline:0}",
  ".h[hidden]{display:none}",
  ".hc{margin:auto 0}",
  ".hb{font-size:clamp(32px,min(12vw,7.4vh),54px);font-weight:800;line-height:1.1}",
  ".hs{color:#ffd43b}",
  // « ⋮ » (Android) dessiné avec « ••• » tourné : même signe, sans la recherche d'une police de secours (100 à 400 ms
  // de mise en page dans Chromium pour U+22EE). Boîte étroite (la place d'un point dans la phrase, quelle que soit la
  // police) dont les trois points débordent également des deux côtés (centrage d'une boîte flexible) : le dessin
  // tourne autour du milieu de la boîte, donc reste centré ; lu « ⋮ » par les lecteurs d'écran (`role="img"`,
  // `aria-label` posés par le script).
  ".hv{display:inline-flex;justify-content:center;width:.4em;transform:rotate(90deg)}",
  ".hp{margin:8px 0 6px;font-size:clamp(20px,min(6.4vw,4.2vh),28px);font-weight:700;line-height:1.2}",
  ".hn{padding:0;list-style:none;counter-reset:n}",
  ".hn li{counter-increment:n;position:relative;min-height:30px;margin-top:12px;padding:4px 0 0 42px;font-size:17px;line-height:1.35}",
  ".hn li:before{content:counter(n);position:absolute;top:0;left:0;width:30px;height:30px;border-radius:50%;background:#ffd43b;color:#0f1419;font-weight:800;line-height:30px;text-align:center}",
  ".hk button{font:inherit;color:#c9d3db;background:none;border:0;padding:12px 20px 4px 0;text-decoration:underline}",
  // Flèche de 48 × 80 px (pointe au milieu du haut) : elle tient avec son rebond dans la marge de 92 px de l'aide.
  // Fixe à l'écran : quand l'aide défile (téléphone en paysage, petit écran), elle reste pointée sur le menu.
  ".ha{position:fixed;top:0;right:2px;width:48px;height:80px;animation:lj .9s infinite}",
  ".hd{transform:rotate(180deg);animation-name:lk}",
  "@keyframes lj{50%{transform:translateY(12px)}}",
  "@keyframes lk{50%{transform:rotate(180deg) translateY(12px)}}",
  "@media (prefers-reduced-motion:reduce){.ha{animation:none}}",
].join("");

// ─── Scripts (identiques pour toutes les pages) ──────────────────────────────────────────────────────────────────

/** Durée de validité d'un choix sur les cookies (6 mois, recommandation de la CNIL) : au-delà, le bandeau revient. */
export const LANDING_CONSENT_MAX_AGE_MS = 182 * 24 * 3600 * 1000;

/**
 * Script écrit sur plusieurs lignes dans ce fichier (lisible), envoyé sur une seule (poids de la page) : chaque ligne
 * y finit par `;`, `,`, `{` ou `}`, jamais par une fin d'instruction implicite (test).
 */
function oneLine(js: string): string {
  return js.replace(/\n/g, "");
}

/** Expression régulière telle qu'écrite dans un script (`/…/i`). */
function reLiteral(re: RegExp): string {
  return `/${re.source}/${re.flags}`;
}

/**
 * Appli du navigateur intégré, en JavaScript de navigateur (variables `u` = agent utilisateur, `t` = navigateur
 * intégré de Telegram) : exactement la règle de `detectEscapeApp` (mêmes expressions, test commun) ; "" pour un
 * navigateur ordinaire et pour Telegram (il y ouvre lui-même le lien, sans aide ni ouverture automatique).
 */
const DETECT_APP_JS =
  `t?"":${reLiteral(TIKTOK_INAPP_RE)}.test(u)?"TIKTOK":${reLiteral(INSTAGRAM_INAPP_RE)}.test(u)?"INSTAGRAM":` +
  `${reLiteral(FACEBOOK_INAPP_RE)}.test(u)?(${reLiteral(MESSENGER_INAPP_RE)}.test(u)?"MESSENGER":"FACEBOOK"):` +
  `${reLiteral(OTHER_INAPP_RE)}.test(u)?(${reLiteral(SNAPCHAT_INAPP_RE)}.test(u)?"SNAPCHAT":"OTHER"):` +
  `/\\bAndroid\\b/i.test(u)&&${reLiteral(ANDROID_WEBVIEW_RE)}.test(u)&&!${reLiteral(ANDROID_BROWSER_RE)}.test(u)` +
  `||/iPhone|iPad|iPod/i.test(u)&&/AppleWebKit/i.test(u)&&!/Safari\\//.test(u)?"OTHER":""`;

/**
 * Script du tout début du `<head>` (avant le CSS), exécuté au chargement, jamais après `load` :
 * - reconnaît le navigateur (`window.ljE` = `{a: appli ou "", i: iPhone, o: Android}`, lu ensuite par le script de la
 *   page) ; dans un navigateur intégré (ou celui de Telegram), rien d'autre ;
 * - repère de sortie posé par la page dans l'appli : `vid` (visite) et `tgt` (minute de la pose, base 36), plus
 *   `tgo=1` après un appui. Valable `LANDING_ESCAPE_MAX_AGE_MS` (30 min) : au-delà (lien copié par « Copier le lien »
 *   et ouvert par quelqu'un d'autre), `vid` et `tgo` sont ignorés (nouvelle visite, pas d'ouverture par `tgo`) ;
 *   `vid` valable : même visite (sortie `TGO` après un appui, `VID` avant tout appui) ;
 * - ouverture automatique (point 4 du client) : SI l'adresse porte le marqueur (`tgo=1` valable, ou à défaut
 *   `ttclid` / `fbclid` sans `tgd=1`) ET que le navigateur n'est pas un navigateur intégré ET que le téléphone est un
 *   iPhone ou un Android : retire `tgo`, `vid` et `tgt` de l'adresse et y ajoute `tgd=1` (« Telegram déjà tenté
 *   depuis cette adresse ») par `history.replaceState` AVANT la tentative : un rechargement, un onglet restauré sans
 *   sa mémoire, une adresse recopiée ne recommencent jamais ; garde aussi une trace dans l'onglet (`sessionStorage`
 *   `lj:ao:<vid>` ou `lj:ao:<chemin>`) ; sans adresse modifiable ni stockage, aucune tentative (jamais de boucle).
 *   Puis tente d'ouvrir Telegram dès que le HTML est lu (`DOMContentLoaded`, quelques millisecondes : la page reste
 *   entière même si le navigateur arrête son chargement) : iPhone `tg://join?invite=<code>` (Safari et Chrome iPhone
 *   demandent « Ouvrir dans « Telegram » ? » ; un cadre caché, sans geste, est refusé par Chrome iPhone), Android
 *   `intent://join?invite=<code>#Intent;scheme=tg;end`. Rien ne s'ouvre : la page normale reste, un appui sur le
 *   bouton suffit. Code d'invitation lu dans `<html data-k>` (écrit par le serveur). La sortie et la tentative sont
 *   notées pour le script de la page (`window.ljE.e` = `{v: visite, k: TGO | VID | TTCLID | FBCLID, m: façon
 *   d'ouvrir ou ""}`, envois ESCAPED et AUTO_OPEN) et par la marque de performance `lj:auto` (au moment de la
 *   tentative).
 *
 * Chrome Android (code Chromium `components/external_intents` : `ExternalNavigationHandler`, `RedirectHandler`) : une
 * navigation sans geste pendant le chargement fait partie de la chaîne de navigation de la page. Page ouverte par une
 * autre appli (« Ouvrir dans le navigateur » de TikTok : intention entrante) : Telegram s'ouvre sans question, dans
 * les 15 s. Adresse tapée ou collée, rechargement : Chrome demande d'abord (bandeau « Continuer vers Telegram »). Ni
 * `package=` ni `S.browser_fallback_url` : avec un repli, Chrome recharge la page au lieu de son bandeau (adresse
 * collée) ou quand Telegram manque ; avec `package=org.telegram.messenger`, les autres versions de Telegram (version
 * du site telegram.org, Telegram X) ne s'ouvriraient pas et, sans repli, Chrome ouvrirait le Play Store tout seul.
 * Sans appli capable d'ouvrir `tg:`, Chrome ne fait rien : la page reste.
 */
export const LANDING_HEAD_SCRIPT =
  oneLine(`(function(){var w=window,d=document,n=navigator,u=n.userAgent||"",l=location,s=l.search,
i=/iPhone|iPad|iPod/.test(u)||/Macintosh/.test(u)&&n.maxTouchPoints>1,o=!i&&/Android/.test(u),
t=${reLiteral(TELEGRAM_INAPP_RE)}.test(u),a=${DETECT_APP_JS},
E=w.ljE={a:a,i:i,o:o},K=d.documentElement.getAttribute("data-k"),
v=(/[?&]vid=([\\w-]{8,64})(?=&|$)/.exec(s)||[])[1]||"",z=(/[?&]tgt=([0-9a-z]{1,9})(?=&|$)/.exec(s)||[])[1],
y=z?Date.now()/6e4-parseInt(z,36):1e9,g=/[?&]tgo=1(?=&|$)/.test(s),D=/[?&]tgd=1(?=&|$)/.test(s),
c=D?"":/[?&]ttclid=/.test(s)?"TTCLID":/[?&]fbclid=/.test(s)?"FBCLID":"",m,q,r,k;
if(a||t)return;
if(!(y>-5&&y<=${LANDING_ESCAPE_MAX_AGE_MS / 60_000}))v="";g=g&&!!v;
m=K&&(i||o)&&(g||c)?i?"AUTO_TG":"AUTO_INTENT":"";
q=s.slice(1).split("&").filter(function(x){return x&&!/^(tgo|vid|tgt)=/.test(x)});
if(m&&!D)q.push("tgd=1");q=q.join("&");r=q===s.slice(1);
if(!r)try{history.replaceState(history.state,"",l.pathname+(q?"?"+q:"")+l.hash);r=1}catch(e){}
if(!K||!(i||o)||!v&&!m)return;
k="lj:ao:"+(v||l.pathname);
try{var S=sessionStorage;if(S.getItem(k))return;S.setItem(k,"1")}catch(e){if(!r)return}
E.e={v:v,k:g?"TGO":v?"VID":c,m:m};if(!m)return;
function go(){try{performance.mark("lj:auto")}catch(e){}
l.href=i?"tg://join?invite="+K:"intent://join?invite="+K+"#Intent;scheme=tg;end"}
if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",go);else go()})();`);

/**
 * Script de fin de page (même texte pour toutes les pages : une seule empreinte CSP). Réglages lus dans les attributs
 * `data-*` du `<body>` : `p` page, `s` source, `e` adresse d'envoi ; navigateur dans `window.ljE` (script du `<head>`).
 *
 * - Visite : `visitId` aléatoire (gardé pour l'onglet), VIEW envoyé après le premier affichage visible
 *   (`sendBeacon`, repli `fetch` keepalive), jamais pour une page préchargée invisible. Dans un navigateur intégré,
 *   dès l'affichage, l'adresse reçoit le repère de la visite (`vid=<visite>&tgt=<minute>`, `tgo=1` en plus si la
 *   visite a déjà appuyé) : une page rouverte dans Safari ou Chrome, même avant tout appui, reste la même visite.
 *   Page rouverte hors de l'appli avec `vid` : même visite (`visitId` = `vid`), ESCAPED au lieu d'un 2e VIEW (aux
 *   rechargements de l'onglet non plus), puis AUTO_OPEN avec la façon d'ouvrir s'il y a eu une tentative.
 * - Appui, AUCUNE attente : l'état « appuyé » est posé tout de suite, puis
 *   - navigateur ordinaire : rien d'autre, le lien natif `https://t.me/+…` part aussitôt (ni `preventDefault`, ni
 *     calcul) ;
 *   - navigateur intégré : `preventDefault` (aucune navigation vers t.me, jamais), marqueur dans l'adresse
 *     (`tgo=1&vid=<visite>&tgt=<minute>`, autres paramètres gardés tels quels), aide plein écran affichée (marque
 *     `lj:help`), puis focus sur l'aide (une fois dessinée) et tentative d'ouverture d'après la table, l'aide déjà
 *     là, avec le code de la façon d'ouvrir (`ESCAPE_OPEN_METHOD`) : `tg://join` dans un cadre caché (`TG_FRAME`) ;
 *     applis Meta, qui passent l'adresse au téléphone (la page reste) : sur iPhone `tg://join` demandé par la page
 *     (`TG_NAV`), DANS le gestionnaire même, juste après l'aide (la vue web de Meta ignore une demande sans vrai
 *     appui ; coût mesuré dans WebKit : 2 à 4 ms), sur Android `intent://…;scheme=tg` sans repli (`INTENT_HELP`).
 *     Android : tentative une fois l'aide dessinée (dans le gestionnaire, un cadre retardait l'aide de 130 à 175 ms
 *     dans Chromium ; l'activation par l'appui y dure 5 s). iPhone, cadre caché : créé par une minuterie de 0 ms posée
 *     dans le gestionnaire (WebKit transmet le geste de l'appui à une telle minuterie, pas à une image suivante :
 *     l'appli voit un appui ; coût mesuré : 5 à 8 ms de plus avant l'aide). Jamais de tentative si la page est déjà
 *     cachée ou quittée. L'aide revient à chaque appui ; « Réessayer » relance la tentative (avec son propre geste),
 *     « Fermer » (ou Échap) la cache.
 *   Les envois (CLICK avec la façon d'ouvrir, HELP une fois par chargement) et le pixel du clic (`window.ljC`, script
 *   des pixels) partent APRÈS l'affichage (image suivante), ou tout de suite si la page passe en arrière-plan ou se
 *   décharge avant.
 * - Pixel du clic : jamais deux fois pour une visite. Page rouverte hors de l'appli après un appui (`TGO`) ou reconnue
 *   seulement par `ttclid` / `fbclid` (l'appui a pu avoir lieu dans l'appli) : pixel du clic bloqué pour l'onglet ;
 *   rouverte avant tout appui (`VID`) : l'appui dans Safari ou Chrome le déclenche.
 * - OPENED : la page passe en arrière-plan sans être déchargée (`pagehide` avant : page remplacée, rien), moins de 2 s
 *   après l'appui ou la tentative automatique dans un navigateur ordinaire (une perte de focus dans ces 2 s, question
 *   « Ouvrir dans Telegram ? », porte la fenêtre à 10 s), moins de 800 ms après la tentative dans un navigateur
 *   intégré (une sortie par le menu de l'appli prend plus longtemps et ne compte pas). Sur iPhone l'envoi est
 *   immédiat ; ailleurs il attend la fin de la tâche et s'annule si la page se décharge. Aucune minuterie ne
 *   déclenche de navigation.
 */
export const LANDING_SCRIPT = oneLine(`(function(){
var w=window,d=document,n=navigator,L=location,B=d.body.dataset,G=function(x){return d.getElementById(x)},b=G("b"),X=w.ljE||{},P=X.e;
if(!b||!B.p)return;
var H=b.href,K=(/\\/\\+([\\w-]+)$/.exec(H)||[])[1],E=B.e||"/j/_e",ios=!!X.i,h=G("h"),A=h&&X.a||"",
V,ss="lj:"+B.p+":"+B.s,O="TG_FRAME",Q=[],lq=0,fr,at=0,m=null,done=0,gone=0,bl=0,ac=0,hs=0,seen=0;
function sg(k){try{return sessionStorage.getItem(k)}catch(e){return null}}
function sp(k,v){try{sessionStorage.setItem(k,v)}catch(e){}}
function rid(){var a=new Uint8Array(12),s="",i;try{w.crypto.getRandomValues(a)}catch(e){for(i=0;i<12;i++)a[i]=Math.random()*256}for(i=0;i<12;i++)s+=(a[i]+256).toString(16).slice(1);return s}
V=sg(ss);
if(P){if(P.v){V=P.v;sp(ss,V);sp(ss+":e","1")}if(P.k!="VID")sp(ss+":c","1")}
if(!V||!/^[\\w-]{8,64}$/.test(V)){V=rid();sp(ss,V)}
function send(t,m){var p=JSON.stringify({p:B.p,s:B.s,v:V,t:t,m:m||null,q:L.search.slice(0,1500)});
try{if(n.sendBeacon&&n.sendBeacon(E,p))return}catch(e){}
try{fetch(E,{method:"POST",body:p,keepalive:true,credentials:"omit"})}catch(e){}}
function flush(){lq=0;var f;while((f=Q.shift()))f()}
function later(f){Q.push(f);if(!lq){lq=1;(w.requestAnimationFrame||setTimeout)(function(){setTimeout(flush,0)})}}
function hd(){return d.visibilityState=="hidden"}
function view(f){if(seen||!f&&(hd()||d.prerendering))return;seen=1;if(!sg(ss+":e"))send("VIEW")}
function fill(c,t,v){var l=h.getElementsByClassName(c),i;for(i=0;i<l.length;i++){l[i].textContent=t;if(v){l[i].className+=" hv";l[i].setAttribute("role","img");l[i].setAttribute("aria-label","\\u22ee")}}}
function mk(t){try{var q=L.search.slice(1).split("&").filter(function(x){return x&&!/^(tgo|vid|tgt|tgd)=/.test(x)});if(t)q.push("tgo=1");q.push("vid="+V,"tgt="+(Date.now()/6e4|0).toString(36));history.replaceState(history.state,"","?"+q.join("&")+L.hash)}catch(e){}}
if(A)try{var T=JSON.parse(h.getAttribute("data-t")),e=(T.a[A[0]]||T.a.O)[ios?0:1].split(" "),c=e[0],up=c[0]=="t",rt=c[1]=="r",ar=G("ha"),st=ar.style;
var sn=T.s[e[3]],vt=sn=="\\u22ee";fill("hs",vt?"\\u2022\\u2022\\u2022":sn,vt);fill("hl",T.l[e[4]]);fill("hw",T.w[c]);O=e[5]=="I"?"INTENT_HELP":e[5]=="N"?"TG_NAV":O;
st.top=st.bottom=st.left=st.right="auto";
function ca(k,v){st[k]="calc(env(safe-area-inset-"+k+",0px) + "+v+"px)"}ca(up?"top":"bottom",e[2]);ca(rt?"right":"left",e[1]-24);
if(!up)ar.setAttribute("class","ha hd");
G("hr").onclick=att;G("hx").onclick=shut;mk(sg(ss+":t"))}catch(x){A=""}
function att(){if(!K||gone||hd())return;at=Date.now();done=0;var j="://join?invite="+K;
if(O!="TG_FRAME"){L.href=O=="TG_NAV"?"tg"+j:"intent"+j+"#Intent;scheme=tg;end";return}
if(fr&&fr.parentNode)fr.parentNode.removeChild(fr);fr=d.createElement("iframe");fr.style.display="none";fr.src="tg"+j;d.body.appendChild(fr)}
function shut(){h.hidden=true;b.className="";try{b.focus()}catch(e){}}
function foc(){try{h.focus()}catch(e){}}
if(P){if(P.m){at=Date.now();m=P.m;ac=1}later(function(){view(1);send("ESCAPED",P.k);if(P.m)send("AUTO_OPEN",P.m)})}
function hid(){var a0=at;flush();if(!a0||gone||done||Date.now()-a0>(A?${LANDING_OPENED_INAPP_WINDOW_MS}:bl?${LANDING_OPENED_AFTER_PROMPT_MS}:${LANDING_OPENED_WINDOW_MS}))return;done=1;var mm=m;
if(ios)send("OPENED",mm);else setTimeout(function(){if(!gone)send("OPENED",mm)},0)}
b.addEventListener("click",function(ev){b.className="p";done=gone=bl=0;
if(A){ev.preventDefault();mk(1);sp(ss+":t","1");h.hidden=false;try{performance.mark("lj:help")}catch(e){}later(foc);at=ac=0;O=="TG_NAV"?att():ios?setTimeout(att,0):later(att);m=O}else{at=Date.now();ac=1;m="HTTPS"}
var mm=m,hh=A&&!hs;if(hh)hs=1;
later(function(){view(1);send("CLICK",mm);if(hh)send("HELP",A);if(w.ljC)w.ljC()})});
w.addEventListener("blur",function(){if(ac&&at&&Date.now()-at<${LANDING_OPENED_WINDOW_MS})bl=1});
d.addEventListener("keydown",function(e){if(e.key=="Escape"&&A&&!h.hidden)shut()});
d.addEventListener("visibilitychange",function(){if(hd())hid();else{view();if(!A||h.hidden)b.className=""}});
d.addEventListener("prerenderingchange",function(){view()});
w.addEventListener("pagehide",function(){gone=1;flush()});
w.addEventListener("pageshow",function(e){if(e&&e.persisted){gone=0;b.className=""}});
(w.requestAnimationFrame||setTimeout)(function(){setTimeout(function(){view()},0)});
})();`);

/**
 * Script des pixels (pages avec un pixel TikTok ou Meta seulement : une page sans pixel ne le contient pas). Même texte
 * pour toutes ces pages (une seule empreinte CSP). Pixels (TikTok `ClickButton`, Meta `Contact` au clic, `PageView` à
 * l'affichage) chargés après `load` puis `requestIdleCallback` ; après une tentative d'ouverture automatique (script du
 * `<head>`), sans attendre `load`, que la navigation vers Telegram empêche (WebKit et Chromium). Pixel du clic :
 * `window.ljC`, appelé par le script de la page après l'affichage, UNE seule fois par visite (`sessionStorage`
 * `lj:<page>:<source>:c`, posé aussi quand la visite revient d'une appli dans Safari ou Chrome après un appui ou sans
 * repère : jamais de 2e ClickButton / Contact pour la même visite). Avec le
 * bandeau cookies, chaque partenaire n'est chargé qu'après « Accepter » ; le choix est gardé sur l'appareil par
 * partenaire et daté (`lj:ck` = `{"v":1,"tt":[1,<ms>],"fb":[0,<ms>]}`) : le bandeau revient pour un partenaire jamais
 * demandé ou après 6 mois.
 */
export const LANDING_PIXEL_SCRIPT = oneLine(`(function(){
var w=window,d=document,B=d.body.dataset,tp=!!B.tt,fp=!!B.fb,okT=tp,okF=fp,pt=0,pf=0,pc=0,k=d.getElementById("k"),CK="lj:ck",C="lj:"+B.p+":"+B.s+":c";
if(!B.p||!tp&&!fp)return;
function pixels(){var t,f,s;
if(okT&&!pt){pt=1;w.TiktokAnalyticsObject="ttq";t=w.ttq=w.ttq||[];t.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
t.setAndDefer=function(o,e){o[e]=function(){o.push([e].concat([].slice.call(arguments,0)))}};for(var i=0;i<t.methods.length;i++)t.setAndDefer(t,t.methods[i]);
t.instance=function(o){for(var e=t._i[o]||[],j=0;j<t.methods.length;j++)t.setAndDefer(e,t.methods[j]);return e};
t.load=function(e,o){var r="https://analytics.tiktok.com/i18n/pixel/events.js";t._i=t._i||{};t._i[e]=[];t._i[e]._u=r;t._t=t._t||{};t._t[e]=+new Date;t._o=t._o||{};t._o[e]=o||{};s=d.createElement("script");s.async=true;s.src=r+"?sdkid="+e+"&lib=ttq";d.head.appendChild(s)};
t.load(B.tt);t.page()}
if(okF&&!pf){pf=1;if(!w.fbq){f=w.fbq=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};if(!w._fbq)w._fbq=f;f.push=f;f.loaded=true;f.version="2.0";f.queue=[];
s=d.createElement("script");s.async=true;s.src="https://connect.facebook.net/en_US/fbevents.js";d.head.appendChild(s);f("init",B.fb);f("track","PageView")}}}
function idle(){(w.requestIdleCallback||function(f){setTimeout(f,1)})(pixels,{timeout:3000})}
w.ljC=function(){if(pc||!(okT||okF))return;try{if(sessionStorage.getItem(C))return;sessionStorage.setItem(C,"1")}catch(e){}pc=1;pixels();
try{if(okT&&w.ttq)w.ttq.track("ClickButton")}catch(e){}try{if(okF&&w.fbq)w.fbq("track","Contact")}catch(e){}};
function rc(){try{var c=JSON.parse(localStorage.getItem(CK));if(c&&c.v===1)return c}catch(e){}return{v:1}}
function has(c,x){var a=c[x];return!!a&&(a[0]===0||a[0]===1)&&a[1]>Date.now()-${LANDING_CONSENT_MAX_AGE_MS}}
if(k){var c=rc();
if((!tp||has(c,"tt"))&&(!fp||has(c,"fb"))){k.parentNode.removeChild(k);okT=tp&&c.tt[0]===1;okF=fp&&c.fb[0]===1}
else{okT=okF=false;var ch=function(v){var c2=rc(),t=Date.now();if(tp)c2.tt=[v,t];if(fp)c2.fb=[v,t];try{localStorage.setItem(CK,JSON.stringify(c2))}catch(e){}if(k.parentNode)k.parentNode.removeChild(k);if(v){okT=tp;okF=fp;idle()}};
d.getElementById("ka").onclick=function(){ch(1)};d.getElementById("kr").onclick=function(){ch(0)}}}
if(d.readyState==="complete"||(w.ljE||{}).e&&w.ljE.e.m)idle();else w.addEventListener("load",idle);
})();`);

// ─── Rendu ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Avion en papier (dessin simple, sans logo déposé), décoratif. */
const PLANE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2.2 10.9 20.6 3.4c.9-.4 1.7.3 1.4 1.3l-3.2 15c-.2 1-1 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1-1 .2-1.5z"/></svg>';

/** Grosse flèche jaune de l'aide (pointe en haut, au milieu ; tournée pour un coin du bas). */
const ARROW_SVG =
  '<svg id="ha" class="ha" viewBox="0 0 48 80" aria-hidden="true"><path fill="#ffd43b" d="M24 0 47 28H34v52H14V28H1z"/></svg>';

function attr(name: string, value: string | null | undefined): string {
  return value ? ` ${name}="${escapeLandingHtml(value)}"` : "";
}

/** Valeur d'attribut entre apostrophes (JSON de la table : guillemets doubles gardés tels quels). */
function singleQuotedAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

/**
 * Aide « Ouvrir dans le navigateur » de la langue de la page (même HTML pour tous, cachée) : le script remplit le
 * signe du menu (`hs`), le libellé exact (`hl`) et l'endroit (`hw`) d'après la table `data-t`, puis place la flèche.
 */
export function renderEscapeHelpHtml(lang: unknown): string {
  const t = escapeTexts(lang);
  const fill = (x: string) =>
    escapeLandingText(x)
      .replace("{s}", '<b class="hs"></b>')
      .replace("{l}", '<b class="hl"></b>')
      .replace("{w}", '<span class="hw"></span>');
  return (
    `<div id="h" class="h" role="dialog" aria-modal="true" aria-labelledby="ht" tabindex="-1" hidden data-t='${singleQuotedAttr(escapeHelpData(lang))}'>` +
    ARROW_SVG +
    `<div class="hc"><p id="ht" class="hb">${fill(t.title)}</p><p class="hp">${fill(t.then)}</p>` +
    `<ol class="hn">${t.steps.map((x) => `<li>${fill(x)}</li>`).join("")}</ol>` +
    `<p class="hk"><button type="button" id="hr">${escapeLandingText(t.retry)}</button><button type="button" id="hx">${escapeLandingText(t.close)}</button></p></div></div>`
  );
}

/** Page complète et ses morceaux en ligne (empreintes CSP). Même entrée → mêmes octets. */
export function renderLandingDocument(input: LandingRenderInput): LandingDocument {
  const lang = landingLang(input.lang);
  const defaults = landingDefaults(lang);
  const title = landingText(input.channelTitle, LANDING_TEXT_LIMITS.channelTitle) || "Telegram";
  const headline = landingText(input.headline, LANDING_TEXT_LIMITS.headline);
  const subtext = landingText(input.subtext, LANDING_TEXT_LIMITS.subtext);
  const button =
    landingText(input.buttonText, LANDING_TEXT_LIMITS.buttonText) || defaults.buttonText;
  const footnote = landingText(input.footnote, LANDING_TEXT_LIMITS.footnote);
  const href = landingButtonHref(input.inviteLink);
  const inviteHash = inviteHashOf(href);
  const preview = input.preview === true;
  // Photo servie par le site (même origine), jamais une adresse extérieure ; l'aperçu accepte aussi une image en
  // ligne (`data:image/…`, photo pas encore servie par une page active).
  const photoUrl = typeof input.photoUrl === "string" ? input.photoUrl : "";
  const photo =
    /^\/[^/\\]/.test(photoUrl) ||
    (preview && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photoUrl))
      ? photoUrl
      : null;
  const hasTiktok = isValidTikTokPixelId(input.tiktokPixelId);
  const hasMeta = isValidMetaPixelId(input.metaPixelId);
  const tiktok = !preview && hasTiktok;
  const meta = !preview && hasMeta;
  const eventUrl =
    typeof input.eventUrl === "string" && /^\/[^/\\]/.test(input.eventUrl)
      ? input.eventUrl
      : LANDING_EVENT_PATH;
  // Sans pixel, la page ne pose aucun cookie : pas de bandeau (l'aperçu le montre tel quel, sans script).
  const banner = input.cookieBanner === true && (hasTiktok || hasMeta);

  const body: string[] = [];
  body.push('<main><div class="t">');
  if (photo) {
    body.push(
      `<img class="i" src="${escapeLandingHtml(photo)}" width="${LANDING_PHOTO_SIZE}" height="${LANDING_PHOTO_SIZE}" alt="" decoding="async">`,
    );
  }
  body.push(`<p class="n">${escapeLandingText(title)}</p>`);
  if (headline) body.push(`<h1>${escapeLandingText(headline)}</h1>`);
  if (subtext) body.push(`<p class="s">${escapeLandingText(subtext)}</p>`);
  body.push("</div>");
  body.push(
    `<div class="c"><a id="b" href="${escapeLandingHtml(href)}">${PLANE_SVG}<span>${escapeLandingText(button)}</span></a>`,
  );
  if (footnote) body.push(`<p class="f">${escapeLandingText(footnote)}</p>`);
  body.push("</div>");
  if (banner) {
    // Accord éclairé : les partenaires qui poseront des cookies sont nommés (« … publicités (TikTok, Meta). »).
    const partners = [hasTiktok ? "TikTok" : null, hasMeta ? "Meta" : null].filter(Boolean);
    const cookieText = `${defaults.cookieText.replace(/[.\s]+$/, "")} (${partners.join(", ")}).`;
    body.push(
      `<div class="k" id="k" role="region" aria-label="Cookies"><p>${escapeLandingText(cookieText)}</p><button type="button" id="kr">${escapeLandingText(defaults.cookieDecline)}</button><button type="button" id="ka">${escapeLandingText(defaults.cookieAccept)}</button></div>`,
    );
  }
  body.push("</main>");
  const script = preview ? null : LANDING_SCRIPT;
  const headScript = preview ? null : LANDING_HEAD_SCRIPT;
  const pixelScript = tiktok || meta ? LANDING_PIXEL_SCRIPT : null;
  // L'aide (cachée) n'a de sens qu'avec le script : absente de l'aperçu.
  if (script) body.push(renderEscapeHelpHtml(lang), `<script>${script}</script>`);
  if (pixelScript) body.push(`<script>${pixelScript}</script>`);

  const bodyAttrs = preview
    ? ""
    : `${attr("data-p", input.pageId)} data-s="${escapeLandingHtml(input.sourceKey ?? "")}"${
        eventUrl !== LANDING_EVENT_PATH ? attr("data-e", eventUrl) : ""
      }${tiktok ? attr("data-tt", input.tiktokPixelId) : ""}${meta ? attr("data-fb", input.metaPixelId) : ""}`;

  const html =
    `<!doctype html><html lang="${lang}"${headScript ? attr("data-k", inviteHash) : ""}><head><meta charset="utf-8">` +
    (headScript ? `<script>${headScript}</script>` : "") +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="color-scheme" content="light"><meta name="format-detection" content="telephone=no">' +
    `<title>${escapeLandingText(title)}</title><style>${LANDING_STYLE}</style></head>` +
    `<body${bodyAttrs}>${body.join("")}</body></html>`;

  return { html, style: LANDING_STYLE, script, headScript, pixelScript, pixels: { tiktok, meta } };
}

/** Page complète (HTML), identique pour tout visiteur. */
export function renderLandingHtml(input: LandingRenderInput): string {
  return renderLandingDocument(input).html;
}
