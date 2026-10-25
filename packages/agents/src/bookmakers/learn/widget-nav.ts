/**
 * Phase 35 (suite) — NAVIGATION DANS LES WIDGETS DE PARIS. Les trois bookmakers du client n'affichent pas leurs matchs
 * dans des pages classiques : Sportaza (moteur Altenar) et Bet Portal (moteur Betby) rendent un widget dans un « shadow
 * DOM », sans lien HTML vers le football ou le jour ; Celsius affiche son site de paris dans une iframe. Observé sur les
 * vrais sites le 25 octobre 2026 :
 * - Altenar (routeur « mémoire ») : le site recopie l'état du widget dans l'adresse : `?page=sport&sportId=66`
 *   (football), `?page=coupon&sportId=66&couponType=1` (programme du jour ; 2 = demain), `?page=event&eventId=N`
 *   (fiche d'un match) ; la liste « Par Heure » s'ouvre par un onglet ; l'identifiant d'un match n'est que dans les
 *   données React de sa ligne (`data-lap-event-id` posé par le transport) ;
 * - Betby : chemins `/<langue>/sports/football-1` (sport), onglet « À venir », fiches `/…/<equipes>-<id>` ;
 *   repères stables `data-editor-id` ;
 * - site de paris classique : liens `<a href>` (déjà suivis par l'enregistreur).
 * Règles PURES : à partir d'une adresse et d'un moteur, les adresses à essayer et les textes à cliquer (le clic passe
 * par la garde « jamais de mise », motif `navigate`). Rien ici ne parle d'argent, de coupon de paris ni de compte.
 */
export type NavTarget = "football" | "today" | "tomorrow" | "list_by_time";

/** Identifiants de sport des moteurs connus (football seulement : le reste n'est pas lu). */
export const FOOTBALL_SPORT_ID: Record<string, string> = { altenar: "66", betby: "1" };

/** Textes d'un élément de navigation (après `foldText` : minuscules, sans accents), par étape. */
export const NAV_TEXT: Record<NavTarget, RegExp> = {
  football: /^(football|foot|soccer|fussball|futbol|calcio|futebol)$/,
  today: /^(aujourd ?hui|today|heute|hoy|oggi|hoje|les matche?s du jour|matche?s du jour|today'?s matches)$/,
  tomorrow: /^(demain|tomorrow|morgen|manana|domani|amanha|les matche?s de demain|matche?s de demain)$/,
  list_by_time: /^(par heure|by time|par horaire|by hour|heure|time)$/,
};

/** Onglet « à venir » (Betby) : la liste des prochains matchs. */
export const UPCOMING_TEXT = /^(a venir|upcoming|prochains? matche?s|pre-?match|prematch)$/;

function stripQuery(url: string): URL | null {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/**
 * Adresses connues d'un moteur pour une étape, à partir de l'adresse courante (page du site qui porte le widget).
 * Vide : rien de connu (on cliquera, ou on passera). Pur.
 */
export function providerUrlsFor(provider: string, currentUrl: string, target: NavTarget): string[] {
  const u = stripQuery(currentUrl);
  if (!u) return [];
  if (provider === "altenar") {
    const sport = FOOTBALL_SPORT_ID.altenar!;
    const at = (q: string) => `${u.origin}${u.pathname}?${q}`;
    if (target === "football") return [at(`page=sport&sportId=${sport}`)];
    if (target === "today") return [at(`page=coupon&sportId=${sport}&couponType=1`)];
    if (target === "tomorrow") return [at(`page=coupon&sportId=${sport}&couponType=2`)];
    return [];
  }
  if (provider === "betby") {
    if (target !== "football") return [];
    // `/fr/sports`, `/fr/sports/…`, `/sports` → `/fr/sports/football-1`.
    const m = /^((?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:sports?|sportsbook|betting))(?:\/|$)/i.exec(u.pathname);
    const base = m ? m[1]! : null;
    return base ? [`${u.origin}${base}/football-${FOOTBALL_SPORT_ID.betby}`] : [];
  }
  return [];
}

/** Étapes à cliquer APRÈS une adresse connue (Altenar : liste « Par Heure » ; Betby : onglet « À venir »). Pur. */
export function providerClicksAfter(provider: string, target: NavTarget): NavTarget[] {
  if (provider === "altenar" && (target === "today" || target === "tomorrow")) return ["list_by_time"];
  return [];
}

/**
 * Sélecteurs Playwright d'un élément de navigation portant ce texte (exact d'abord), limités aux éléments qu'un
 * humain clique (bouton, lien sans adresse, onglet, item de menu, texte d'un menu). Les sélecteurs CSS de Playwright
 * traversent le shadow DOM ouvert : un widget se cherche comme la page. Pur.
 */
export function navSelectorsFor(text: string): string[] {
  const t = JSON.stringify(text);
  return [
    `button:text-is(${t})`,
    `[role=tab]:text-is(${t})`,
    `[role=button]:text-is(${t})`,
    `[role=menuitem]:text-is(${t})`,
    `a:not([href]):text-is(${t})`,
    `span:text-is(${t})`,
    `div:text-is(${t})`,
    `li:text-is(${t})`,
  ];
}

/** Variantes de texte affichées pour une étape (ordre d'essai), en français d'abord. Pur. */
export const NAV_LABELS: Record<NavTarget, string[]> = {
  football: ["Football", "Soccer", "Foot", "Fußball", "Fútbol", "Calcio", "Futebol"],
  today: ["Aujourd’hui", "Aujourd'hui", "Les matches du jour", "Matchs du jour", "Today", "Heute", "Hoy", "Oggi", "Hoje"],
  tomorrow: ["Demain", "Les matches de demain", "Matchs de demain", "Tomorrow", "Morgen", "Mañana", "Domani", "Amanhã"],
  list_by_time: ["Par Heure", "Par heure", "By time", "By Time", "Par horaire"],
};

/** Libellés de l'onglet « à venir » (Betby et consorts). Pur. */
export const UPCOMING_LABELS = ["À venir", "A venir", "Upcoming", "Prochains matchs", "Pré-match", "Prematch"];
