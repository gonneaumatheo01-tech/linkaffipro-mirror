import {
  LANDING_EVENT_PATH,
  inviteHashOf,
  isValidMetaPixelId,
  isValidTikTokPixelId,
  landingDefaults,
  landingLang,
} from "./landing";

/**
 * Rendu HTML d'une page d'atterrissage (phase 15, rubrique « Pages ») : un écran de téléphone sans défilement, dans
 * l'ordre vrai titre du canal, accroche, sous-texte facultatif, gros bouton Telegram dans la zone du pouce, petite ligne
 * facultative. CSS et script en ligne, polices du système, aucun framework, aucune ressource externe.
 *
 * Fonction PURE : la sortie ne dépend que de la page, de sa source et du titre du canal, jamais du visiteur (règle 7 du
 * client : les mêmes octets pour un robot et pour une personne). Aucune dépendance Node : utilisable aussi pour
 * l'aperçu en direct de la rubrique Pages. Contrat : `docs/PAGES-ATTERRISSAGE.md`.
 *
 * Le bouton est un vrai lien `https://t.me/+…` (utilisable sans script). Le script, identique pour toutes les pages,
 * choisit seulement la FAÇON d'ouvrir l'appli Telegram au moment du clic (même destination pour tous), envoie la visite
 * et le clic au serveur sans les attendre et charge les pixels après l'affichage.
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

/** Délai avant le repli sur `https://t.me/+…` quand l'appli ne s'ouvre pas (navigateurs intégrés). */
export const LANDING_FALLBACK_MS = { ios: 2000, android: 1500 } as const;

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
  /** Contenu exact de la balise `<script>` (empreinte pour la CSP), null en aperçu. */
  script: string | null;
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
].join("");

// ─── Script (identique pour toutes les pages) ────────────────────────────────────────────────────────────────────

/** Durée de validité d'un choix sur les cookies (6 mois, recommandation de la CNIL) : au-delà, le bandeau revient. */
export const LANDING_CONSENT_MAX_AGE_MS = 182 * 24 * 3600 * 1000;

/** Délai après le clic pendant lequel le retour sur la page (boîte de dialogue fermée) déclenche encore le repli. */
export const LANDING_FALLBACK_AFTER_DIALOG_MS = 10_000;

/**
 * Script de la page (même texte pour toutes les pages : une seule empreinte CSP). Réglages lus dans les attributs
 * `data-*` du `<body>` : `p` page, `s` source, `e` adresse d'envoi, `tt` / `fb` pixels.
 *
 * - Visite : `visitId` aléatoire (gardé pour l'onglet), VIEW envoyé après le premier affichage visible
 *   (`sendBeacon`, repli `fetch` keepalive), jamais pour une page préchargée invisible.
 * - Clic : la façon d'ouvrir est choisie AU CLIC, le lien change d'adresse dans le gestionnaire et la navigation
 *   native du lien part aussitôt (aucun `preventDefault`, aucune attente : le geste du visiteur est gardé, condition
 *   pour qu'un navigateur intégré passe la main à l'appli). Même destination pour tous, seule la façon change :
 *   - iPhone dans une appli : `tg://join?invite=` (TikTok : tirage `tg://` ou lien `https` direct), repli
 *     `https://t.me/+…` après 2 s si la page est toujours là ;
 *   - Android dans TikTok : tirage entre le lien `https` direct et `tg://` (repli 1,5 s) ; `intent://` n'y est pas
 *     fiable (tableau inapp-debugger) ;
 *   - Android dans Instagram, Facebook, Messenger : `intent://…;scheme=tg;S.browser_fallback_url=…` (repli 1,5 s),
 *     qui y fonctionne (même source) ;
 *   - autres vues web Android, Safari, Chrome, ordinateur : le lien `https` (lien universel / App Link de t.me).
 *   Un 2e appui pendant la même visite (même après rechargement : choix gardé pour l'onglet) prend le lien `https`
 *   après une tentative par l'appli, et l'appli après un lien `https`.
 * - Repli : annulé seulement si la page passe en arrière-plan ou se décharge. Une perte de focus (boîte « Ouvrir
 *   dans Telegram ? », « impossible d'ouvrir ») le REPORTE : au retour sur la page (focus ou page de nouveau visible)
 *   moins de 10 s après le clic, sans passage en arrière-plan entre-temps, il part aussitôt.
 * - CLICK envoyé avec la façon d'ouvrir ; OPENED si la page passe en arrière-plan moins de 2 s après le clic sans
 *   être déchargée (même règle pour toutes les façons d'ouvrir ; jamais pour notre propre repli). Les moteurs
 *   envoient `pagehide` AVANT le passage en arrière-plan quand la page est remplacée (page d'erreur ou blanche d'une
 *   vue web, navigation vers t.me, retour) : rien n'est alors envoyé. Sur iPhone l'envoi est immédiat (iOS suspend
 *   la page dès que l'appli passe au premier plan) ; ailleurs il attend la fin de la tâche et s'annule si la page se
 *   décharge.
 * - Pixels (TikTok `ClickButton`, Meta `Contact` au clic, `PageView` à l'affichage) chargés après `load` puis
 *   `requestIdleCallback`. Avec le bandeau cookies, chaque partenaire n'est chargé qu'après « Accepter » ; le choix
 *   est gardé sur l'appareil par partenaire et daté (`lj:ck` = `{"v":1,"tt":[1,<ms>],"fb":[0,<ms>]}`) : le bandeau
 *   revient pour un partenaire jamais demandé ou après 6 mois.
 */
export const LANDING_SCRIPT = `(function(){
var w=window,d=document,n=navigator,B=d.body.dataset,b=d.getElementById("b");
if(!b||!B.p)return;
var H=b.href,K=(/\\/\\+([\\w-]+)$/.exec(H)||[])[1],E=B.e||"/j/_e",ua=n.userAgent||"",
ios=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&n.maxTouchPoints>1),and=!ios&&/Android/.test(ua),
tt=/musical_ly|trill_|Bytedance|ByteLocale|TikTok/i.test(ua),mt=/Instagram|FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger/.test(ua),
app=tt||mt||/Snapchat|Pinterest|LinkedInApp|Twitter for|Line\\/|MicroMessenger|GSA\\//.test(ua)||(ios?!/Safari\\//.test(ua):/; wv\\)/.test(ua)),
sc=ios&&app||and&&tt?"TG_SCHEME":and&&mt?"INTENT":"",V,ss="lj:"+B.p+":"+B.s,sm=ss+":m";
function sg(k){try{return sessionStorage.getItem(k)}catch(e){return null}}
function sp(k,v){try{sessionStorage.setItem(k,v)}catch(e){}}
function rid(){var a=new Uint8Array(12),s="",i,c=w.crypto;if(c&&c.getRandomValues)c.getRandomValues(a);else for(i=0;i<12;i++)a[i]=Math.random()*256;for(i=0;i<12;i++)s+=(a[i]+256).toString(16).slice(1);return s}
V=sg(ss);
if(!V||!/^[\\w-]{8,64}$/.test(V)){V=rid();sp(ss,V)}
function send(t,m){var p=JSON.stringify({p:B.p,s:B.s,v:V,t:t,m:m||null,q:location.search.slice(0,1500)});
try{if(n.sendBeacon&&n.sendBeacon(E,p))return}catch(e){}
try{fetch(E,{method:"POST",body:p,keepalive:true,credentials:"omit"})}catch(e){}}
var seen=0;function view(){if(seen||d.visibilityState==="hidden"||d.prerendering)return;seen=1;send("VIEW")}
var tp=!!B.tt,fp=!!B.fb,okT=tp,okF=fp,pt=0,pf=0,k=d.getElementById("k"),CK="lj:ck";
function pixels(){var t,f,s;
if(okT&&!pt){pt=1;w.TiktokAnalyticsObject="ttq";t=w.ttq=w.ttq||[];t.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
t.setAndDefer=function(o,e){o[e]=function(){o.push([e].concat([].slice.call(arguments,0)))}};for(var i=0;i<t.methods.length;i++)t.setAndDefer(t,t.methods[i]);
t.instance=function(o){for(var e=t._i[o]||[],j=0;j<t.methods.length;j++)t.setAndDefer(e,t.methods[j]);return e};
t.load=function(e,o){var r="https://analytics.tiktok.com/i18n/pixel/events.js";t._i=t._i||{};t._i[e]=[];t._i[e]._u=r;t._t=t._t||{};t._t[e]=+new Date;t._o=t._o||{};t._o[e]=o||{};s=d.createElement("script");s.async=true;s.src=r+"?sdkid="+e+"&lib=ttq";d.head.appendChild(s)};
t.load(B.tt);t.page()}
if(okF&&!pf){pf=1;if(!w.fbq){f=w.fbq=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};if(!w._fbq)w._fbq=f;f.push=f;f.loaded=true;f.version="2.0";f.queue=[];
s=d.createElement("script");s.async=true;s.src="https://connect.facebook.net/en_US/fbevents.js";d.head.appendChild(s);f("init",B.fb);f("track","PageView")}}}
function idle(){(w.requestIdleCallback||function(f){setTimeout(f,1)})(pixels,{timeout:3000})}
function rc(){try{var c=JSON.parse(localStorage.getItem(CK));if(c&&c.v===1)return c}catch(e){}return{v:1}}
function has(c,x){var a=c[x];return!!a&&(a[0]===0||a[0]===1)&&a[1]>Date.now()-${LANDING_CONSENT_MAX_AGE_MS}}
if(k){var c=rc();
if((!tp||has(c,"tt"))&&(!fp||has(c,"fb"))){k.parentNode.removeChild(k);okT=tp&&c.tt[0]===1;okF=fp&&c.fb[0]===1}
else{okT=okF=false;var ch=function(v){var c2=rc(),t=Date.now();if(tp)c2.tt=[v,t];if(fp)c2.fb=[v,t];try{localStorage.setItem(CK,JSON.stringify(c2))}catch(e){}if(k.parentNode)k.parentNode.removeChild(k);if(v){okT=tp;okF=fp;idle()}};
d.getElementById("ka").onclick=function(){ch(1)};d.getElementById("kr").onclick=function(){ch(0)}}}
if(d.readyState==="complete")idle();else w.addEventListener("load",idle);
var at=0,m,tm=0,done=0,fell=0,gone=0,away=0,bl=0,last=sg(sm),first=Math.random()<0.5;
function pick(){var x=!K||!sc?"HTTPS":last?(last==="HTTPS"?sc:"HTTPS"):tt&&!first?"HTTPS":sc;
if(x==="HTTPS")return[x,H,0];
if(x==="INTENT")return[x,"intent://join?invite="+K+"#Intent;scheme=tg;S.browser_fallback_url="+encodeURIComponent(H)+";end",${LANDING_FALLBACK_MS.android}];
return[x,"tg://join?invite="+K,ios?${LANDING_FALLBACK_MS.ios}:${LANDING_FALLBACK_MS.android}]}
function fb(){tm=0;if(!done&&!away&&!fell&&!gone&&d.visibilityState!=="hidden"){fell=1;location.href=H}}
function back(){if(bl&&!away&&!done&&!fell&&Date.now()-at<${LANDING_FALLBACK_AFTER_DIALOG_MS}){bl=0;fb()}}
function hid(){if(!at)return;away=1;clearTimeout(tm);tm=0;if(gone||done||fell||Date.now()-at>2000)return;done=1;var mm=m;
if(ios)send("OPENED",mm);else setTimeout(function(){if(!gone)send("OPENED",mm)},0)}
b.addEventListener("click",function(){view();var c=pick();m=last=c[0];sp(sm,m);at=Date.now();done=fell=gone=away=bl=0;clearTimeout(tm);tm=0;b.href=c[1];
if(c[2])tm=setTimeout(fb,c[2]);
send("CLICK",m);
if(okT||okF){pixels();try{if(okT&&w.ttq)w.ttq.track("ClickButton")}catch(e){}try{if(okF&&w.fbq)w.fbq("track","Contact")}catch(e){}}
b.className="p";setTimeout(function(){b.className="";b.href=H},2500)});
w.addEventListener("blur",function(){if(tm){clearTimeout(tm);tm=0;bl=1}});
w.addEventListener("focus",back);
d.addEventListener("visibilitychange",function(){if(d.visibilityState==="hidden")hid();else{view();back()}});
d.addEventListener("prerenderingchange",view);
w.addEventListener("pagehide",function(){gone=1;clearTimeout(tm);tm=0});
w.addEventListener("pageshow",function(e){if(e&&e.persisted)gone=0});
(w.requestAnimationFrame||setTimeout)(function(){setTimeout(view,0)});
})();`;

// ─── Rendu ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Avion en papier (dessin simple, sans logo déposé), décoratif. */
const PLANE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2.2 10.9 20.6 3.4c.9-.4 1.7.3 1.4 1.3l-3.2 15c-.2 1-1 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1-1 .2-1.5z"/></svg>';

function attr(name: string, value: string | null | undefined): string {
  return value ? ` ${name}="${escapeLandingHtml(value)}"` : "";
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
  body.push(`<p class="n">${escapeLandingHtml(title)}</p>`);
  if (headline) body.push(`<h1>${escapeLandingHtml(headline)}</h1>`);
  if (subtext) body.push(`<p class="s">${escapeLandingHtml(subtext)}</p>`);
  body.push("</div>");
  body.push(
    `<div class="c"><a id="b" href="${escapeLandingHtml(href)}">${PLANE_SVG}<span>${escapeLandingHtml(button)}</span></a>`,
  );
  if (footnote) body.push(`<p class="f">${escapeLandingHtml(footnote)}</p>`);
  body.push("</div>");
  if (banner) {
    // Accord éclairé : les partenaires qui poseront des cookies sont nommés (« … publicités (TikTok, Meta). »).
    const partners = [hasTiktok ? "TikTok" : null, hasMeta ? "Meta" : null].filter(Boolean);
    const cookieText = `${defaults.cookieText.replace(/[.\s]+$/, "")} (${partners.join(", ")}).`;
    body.push(
      `<div class="k" id="k" role="region" aria-label="Cookies"><p>${escapeLandingHtml(cookieText)}</p><button type="button" id="kr">${escapeLandingHtml(defaults.cookieDecline)}</button><button type="button" id="ka">${escapeLandingHtml(defaults.cookieAccept)}</button></div>`,
    );
  }
  body.push("</main>");
  const script = preview ? null : LANDING_SCRIPT;
  if (script) body.push(`<script>${script}</script>`);

  const bodyAttrs = preview
    ? ""
    : `${attr("data-p", input.pageId)} data-s="${escapeLandingHtml(input.sourceKey ?? "")}"${
        eventUrl !== LANDING_EVENT_PATH ? attr("data-e", eventUrl) : ""
      }${tiktok ? attr("data-tt", input.tiktokPixelId) : ""}${meta ? attr("data-fb", input.metaPixelId) : ""}`;

  const html =
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="color-scheme" content="light"><meta name="format-detection" content="telephone=no">' +
    `<title>${escapeLandingHtml(title)}</title><style>${LANDING_STYLE}</style></head>` +
    `<body${bodyAttrs}>${body.join("")}</body></html>`;

  return { html, style: LANDING_STYLE, script, pixels: { tiktok, meta } };
}

/** Page complète (HTML), identique pour tout visiteur. */
export function renderLandingHtml(input: LandingRenderInput): string {
  return renderLandingDocument(input).html;
}
