/**
 * Phase 35 (règle 1) : garde « jamais de mise » ÉTENDUE à la lecture des bookmakers. Elle s'ajoute à la garde de la
 * phase 23 (`providers/screenshot/guard.ts`, réutilisée telle quelle) et ne peut que refuser davantage :
 * - adresses : dépôt, retrait, caisse, panier / coupon, placement de pari, bonus, promotions à réclamer, profil, mot de
 *   passe, historique de paris (données du compte) → refusées AVANT la navigation et après chaque redirection ;
 * - clics : aucun élément dont le texte, le rôle ou les attributs évoquent une mise, l'argent, un coupon, une
 *   récompense, une confirmation ; aucun élément qui affiche un nombre à virgule (une cote : un clic l'ajouterait au
 *   coupon — on LIT le texte, on ne clique jamais une cote) ;
 * - appels d'API : GET, ou POST de lecture (GraphQL) dont le corps ne parle ni de mise ni d'argent.
 * Règles pures, testées sans navigateur ; le transport les passe à `GuardedPage` (`GuardExtraChecks`).
 */
import { fold } from "../providers/screenshot/errors";
import { forbiddenClickReason, forbiddenUrlReason, type ClickPurpose, type GuardExtraChecks, type TargetDescription } from "../providers/screenshot/guard";

// Mots interdits dans une adresse de lecture (chemin décodé, paramètres, fragment), en plus de la garde de base.
const READ_URL_WORD =
  /(^|[^a-z0-9])(coupons?|cart|basket|panier|ticket|slip|betslip|bet-?slip|place-?bets?|placebet|bets?\/(place|add)|add-?to-?(slip|cart|coupon|betslip)|my-?bets|mes-?paris|bet-?history|historique|cash-?out|cashout|rewards?|recompenses?|free-?bets?|freebets?|vip|loyalty|fidelite|shop|boutique|password|mot-?de-?passe|forgot|reset|security|securite|verify|verification|transactions?|balance|solde|redeem|claim|reclamer|offers?\/claim)([^a-z0-9]|$)/;

// Textes interdits pour un clic de lecture (après `fold`), en plus de la garde de base.
const READ_CLICK_TEXT: RegExp[] = [
  /\b(coupon|panier|basket|cart|ticket|slip|selection(s)? \(\d+\))\b/,
  /\b(ajouter au|add to|retirer du|remove from)\b/,
  /\b(placer|place|valider|confirmer|confirm|accepter|accept|submit|envoyer|soumettre|continuer|continue|ok)\b/,
  /\b(cash ?out|encaisser|recompenses?|rewards?|free ?bets?|paris? gratuits?|cadeaux?|gift|vip|fidelite|loyalty|boutique|shop|tournois?|tournaments?|jackpot)\b/,
  /\b(solde|balance|transactions?|historique|history|mes paris|my bets|open bets|paris en cours)\b/,
];

/** Rang de la règle « confirmer / accepter / continuer » dans `READ_CLICK_TEXT`. */
const CONFIRM_RULE = 2;

// Attributs interdits pour un clic de lecture : sélection de cote, ajout au coupon, compte.
const READ_CLICK_ATTR =
  /(^|[^a-z])(coupons?|basket|cart|slip|ticket|add-?to|selections?|outcomes?|odds?|prices?|coef\w*|stakes?|bets?|wager|deposits?|withdraw\w*|cashier|wallet|balance|accounts?|profile|bonus\w*|promo\w*|rewards?|claim)([^a-z]|$)/;

/** Même règle pour la connexion et les cookies : un bouton « Connexion » vit souvent dans un bloc « account ». */
const READ_CLICK_ATTR_LOGIN =
  /(^|[^a-z])(coupons?|basket|cart|slip|ticket|add-?to|selections?|outcomes?|odds?|prices?|coef\w*|stakes?|bets?|wager|deposits?|withdraw\w*|cashier|wallet|balance|bonus\w*|promo\w*|rewards?|claim)([^a-z]|$)/;
const LOGIN_PURPOSES: ReadonlySet<ClickPurpose> = new Set(["cookie_accept", "login_submit", "open_login"]);

/** Nombre à virgule (« 1,85 », « 2.10 », « 15.5 ») : un élément qui l'affiche peut être une cote. */
const DECIMAL_IN_TEXT = /(^|[^\d])\d{1,3}[.,]\d{1,3}([^\d]|$)/;

// Corps d'un POST de lecture : jamais une mise, jamais l'argent ni le compte.
const FORBIDDEN_POST_BODY =
  /place-?bet|placebet|betslip|bet-?slip|\bstake\b|\bwager\b|\bamount\b|deposit|withdraw|cashier|payment|checkout|wallet|coupon|addtoslip|add_to_slip|cashout|cash_out|password|mutation\s*\{?\s*(place|create|add|submit|make|accept|update|delete)/i;

/** Pur : une adresse de lecture est-elle permise (règles de base + lecture) ? */
export function forbiddenReadUrlReason(url: string, allowedHosts: readonly string[]): string | null {
  const base = forbiddenUrlReason(url, allowedHosts);
  if (base) return base;
  return readUrlExtraReason(url);
}

/** Pur : mots de lecture interdits seulement (le domaine est contrôlé par la garde de base). */
export function readUrlExtraReason(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "adresse invalide";
  }
  const parts = [u.pathname, u.hash.slice(1)];
  for (const [k, v] of u.searchParams) parts.push(k, v);
  for (const raw of parts) {
    let t = raw;
    for (let i = 0; i < 4; i++) {
      let next: string;
      try {
        next = decodeURIComponent(t.replace(/\+/g, " "));
      } catch {
        return "adresse mal encodée";
      }
      if (next === t) break;
      t = next;
    }
    const m = READ_URL_WORD.exec(fold(t));
    if (m) return `lecture : « ${m[2]} » interdit`;
  }
  return null;
}

/**
 * Pur : un clic de lecture (onglet, « voir plus », jour, sport) est-il interdit ? Règles de base (motif `market_tab`,
 * le plus strict) puis règles de lecture. Aucun motif ne lève l'interdiction.
 */
export function forbiddenReadClickReason(d: TargetDescription): string | null {
  const base = forbiddenClickReason(d, "market_tab");
  if (base) return base;
  return readClickExtraReason(d, "market_tab");
}

// Motifs où « accepter », « continuer » ou un bouton d'envoi sont attendus (cookies, formulaire de connexion).
const CONFIRM_ALLOWED: ReadonlySet<ClickPurpose> = new Set(["cookie_accept", "login_submit"]);

/** Pur : règles de lecture seules (texte, attributs, nombre à virgule, bouton d'envoi). */
export function readClickExtraReason(d: TargetDescription, purpose: ClickPurpose = "market_tab"): string | null {
  const text = fold([d.ownText ?? "", d.text].join(" ")).slice(0, 400);
  for (const [i, r] of READ_CLICK_TEXT.entries()) {
    if (i === CONFIRM_RULE && CONFIRM_ALLOWED.has(purpose)) continue;
    const m = r.exec(text);
    if (m) return `lecture : texte « ${m[0]} »`;
  }
  const attrs = fold(d.attributes.join(" ")).slice(0, 2000);
  const am = (LOGIN_PURPOSES.has(purpose) ? READ_CLICK_ATTR_LOGIN : READ_CLICK_ATTR).exec(attrs);
  if (am) return `lecture : attribut « ${am[0]} »`;
  if (DECIMAL_IN_TEXT.test(d.ownText ?? d.text)) return "lecture : l'élément affiche un nombre à virgule (cote possible)";
  if ((d.nestedTexts ?? []).some((t) => DECIMAL_IN_TEXT.test(t))) return "lecture : l'élément contient une cote";
  if (d.type && /submit/i.test(d.type) && !CONFIRM_ALLOWED.has(purpose)) return "lecture : bouton d'envoi";
  if (d.tag && ["input", "select", "textarea", "form"].includes(d.tag)) return `lecture : élément ${d.tag}`;
  return null;
}

/**
 * Pur : navigation d'un CADRE (iframe) : le moteur de paris vit souvent sur un autre domaine (permis), mais jamais une
 * caisse, un dépôt, un coupon ou un compte (mêmes mots et sous-domaines interdits que la page principale).
 */
export function forbiddenFrameUrlReason(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "adresse invalide";
  }
  // Domaine « de base » = deux derniers éléments : le reste passe par la règle des sous-domaines interdits.
  const base = host.split(".").slice(-2).join(".");
  return forbiddenReadUrlReason(url, [base]);
}

/** Pur : un appel d'API interne est-il permis (méthode, adresse, corps) ? */
export function forbiddenApiCallReason(req: { method: string; url: string; body?: string | null }, allowedHosts: readonly string[]): string | null {
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return `méthode ${method} refusée (lecture seule)`;
  const why = forbiddenReadUrlReason(req.url, allowedHosts);
  if (why) return why;
  if (method === "POST" && req.body && FORBIDDEN_POST_BODY.test(req.body)) return "corps de requête refusé (mise, argent ou compte)";
  return null;
}

/** Contrôles de lecture à passer à `GuardedPage` (4e paramètre). */
export const READ_GUARD_CHECKS: GuardExtraChecks = {
  url: readUrlExtraReason,
  click: readClickExtraReason,
};
