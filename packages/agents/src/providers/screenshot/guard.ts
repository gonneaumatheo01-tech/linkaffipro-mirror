/**
 * Garde « jamais de mise » (phase 23, règle 5) : l'adaptateur d'un bookmaker ne reçoit JAMAIS la page Playwright
 * brute, seulement `GuardedPage`, qui ne sait faire que la liste blanche : aller à une adresse du site, remplir les
 * champs de connexion ou de recherche, appuyer sur Entrée dans la recherche, cliquer sur un bouton de connexion, un
 * résultat de recherche, un onglet de marché ou l'acceptation des cookies, lire, injecter le cadre CSS, capturer.
 * Tout élément qui ressemble à miser / parier / déposer / retirer / payer / modifier le compte, ou à une cote (un clic
 * sur une cote l'ajoute au ticket), est refusé (`forbidden_action`), quel que soit le motif annoncé.
 */
import type { FrameLocator, Locator, Page } from "playwright-core";
import { CaptureError, fold } from "./errors";

// Textes interdits (après `fold` : minuscules, sans accents). « paris » seul n'y est pas (Paris Saint-Germain).
const FORBIDDEN_TEXT: RegExp[] = [
  // Miser / parier
  /\b(parier|pariez|parie|miser|misez|mise|mises|placer|placez|valider (le |mon )?(pari|ticket|coupon))\b/,
  /\b(faire|placer|valider|confirmer) (un |le |mon |mes )?(pari|paris)\b/,
  /\b(ticket|coupon|panier) de paris?\b|\bmes paris\b|\bcash ?out\b|\bencaisser\b/,
  /\b(bet|bets|betting|bet now|place bet|wager|stake|stakes|betslip|bet slip|placebet|accept odds|accepter (la |les )?cotes?)\b/,
  /\b(apostar|apuesta|apuestas|apostas|scommetti|scommessa|wetten|wette|einsatz|setzen|tippen)\b/,
  // Argent : dépôt, retrait, paiement
  /\b(deposer|deposez|depot|depots|deposit|deposits|depositar|deposito|einzahlen|einzahlung|recharger|crediter)\b/,
  /\b(retirer|retirez|retrait|retraits|withdraw|withdrawal|withdrawals|retirar|retiro|auszahlen|auszahlung)\b/,
  /\b(payer|paiement|payment|pay|pay now|checkout|cashier|caisse|wallet|portefeuille|acheter|buy|purchase|bonus|promo|reclamer|claim|redeem)\b/,
  // Compte : profil, réglages, mot de passe, limites, fermeture
  /\b(mon compte|my account|profil|profile|parametres|settings|reglages|preferences|modifier|edit|changer|change|update|mettre a jour|supprimer|delete|fermer|close|desactiver|deactivate)\b/,
  /\b(mot de passe oublie|forgot password|reset password|reinitialiser|limite?s? de (depot|jeu)|deposit limits?|auto-?exclusion|self-?exclusion|verification (du |de )?compte|kyc|documents?)\b/,
  /\b(inscription|s'?inscrire|register|sign ?up|creer un compte|create account|join now)\b/,
  /\b(deconnexion|se deconnecter|logout|log out|sign out)\b/,
];

// Attributs interdits (classes, id, data-*, href, name) : boutons de mise, ticket, caisse, cotes cliquables.
const FORBIDDEN_ATTR: RegExp[] = [
  /bet-?slip|betslip|place-?bet|placebet|add-?to-?(slip|bet|coupon)|quick-?bet|bet-?button|bet-?now|stake|wager|coupon|cash-?out/,
  /deposit|withdraw|cashier|payment|checkout|wallet|purchase|\/pay\b|bonus|promo/,
  /\/(account|profile|settings|preferences|limits|kyc|documents|register|signup|logout)\b|account-?settings|my-?account|edit-?profile|change-?password|self-?exclusion/,
  /\b(odds?|outcome|selection|price)[-_]?(button|btn|cell|box|clickable)\b|data-(odd|odds|outcome|selection|price)[-_]?id\b|\bodd\b/,
];

// Adresses refusées même sur le domaine du bookmaker.
const FORBIDDEN_PATH = /\/(deposit|withdraw|cashier|payment|checkout|wallet|account|profile|settings|preferences|limits|kyc|documents|register|signup|logout|bonus|promotions?)(\/|\?|#|$)/i;

// Champs interdits à remplir : montants et mises.
const FORBIDDEN_FIELD = /stake|amount|montant|\bmise\b|einsatz|importe|valor|deposit|withdraw|\bbet\b|betslip|card|carte|iban|cvv|cvc|phone|telephone/;
// Pour l'identifiant de connexion : seulement l'argent (un identifiant peut s'appeler « account » ou « phone »).
const FORBIDDEN_LOGIN_FIELD = /stake|amount|montant|\bmise\b|einsatz|deposit|withdraw|card|carte|iban|cvv|cvc/;

export type ClickPurpose = "open_login" | "login_submit" | "cookie_accept" | "open_search" | "search_result" | "market_tab" | "show_more";
export type FillPurpose = "login" | "password" | "search";

/** Description d'un élément visé (texte et attributs de l'élément, de son bouton ou lien et de ses descendants). */
export type TargetDescription = { text: string; attributes: string[]; tag?: string; type?: string | null };

/**
 * Pur : un clic sur cet élément est-il interdit ? Le bouton de connexion a droit au mot « connexion » ; aucun motif
 * ne lève l'interdiction des mises, de l'argent et du compte.
 */
export function forbiddenClickReason(d: TargetDescription, purpose: ClickPurpose): string | null {
  const text = fold(d.text).slice(0, 400);
  const attrs = fold(d.attributes.join(" ")).slice(0, 2000);
  // L'acceptation des cookies dit « accepter » : seul ce motif y a droit, et jamais sur un ticket.
  for (const r of FORBIDDEN_TEXT) {
    const m = r.exec(text);
    if (!m) continue;
    // « Modifier mes choix » sur une bannière de cookies reste interdit ; « Se connecter » n'est jamais dans la liste.
    return `texte « ${m[0]} »`;
  }
  for (const r of FORBIDDEN_ATTR) {
    const m = r.exec(attrs);
    if (m) return `attribut « ${m[0].slice(0, 40)} »`;
  }
  if (purpose !== "login_submit" && d.type && /submit/i.test(d.type) && purpose !== "open_search") {
    // Un bouton d'envoi de formulaire hors connexion peut valider un ticket : refusé.
    return "bouton d'envoi hors connexion";
  }
  return null;
}

/** Pur : un champ peut-il être rempli pour ce motif ? */
export function forbiddenFillReason(d: TargetDescription, purpose: FillPurpose): string | null {
  const attrs = fold(d.attributes.join(" "));
  const type = (d.type ?? "text").toLowerCase();
  if (purpose === "password") return type === "password" ? null : "le mot de passe ne va que dans un champ mot de passe";
  if (type === "password") return "champ mot de passe hors connexion";
  if (!["text", "search", "email", "tel", ""].includes(type)) return `champ de type ${type}`;
  const m = (purpose === "login" ? FORBIDDEN_LOGIN_FIELD : FORBIDDEN_FIELD).exec(attrs);
  if (m) return `champ « ${m[0]} »`;
  return null;
}

/** Pur : une adresse est-elle permise (domaine du bookmaker, jamais une page d'argent ou de compte) ? */
export function forbiddenUrlReason(url: string, allowedHosts: readonly string[]): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "adresse invalide";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return `protocole ${u.protocol}`;
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) return `domaine ${host} hors du bookmaker`;
  // Une page de connexion rangée sous /account/ reste permise ; jamais une page d'argent.
  const loginPage = /\/(login|signin|sign-in|connexion|connect)(\/|$)/i.test(u.pathname) && !/deposit|withdraw|cashier|payment|wallet/i.test(u.pathname);
  if (FORBIDDEN_PATH.test(u.pathname) && !loginPage) return `page ${u.pathname}`;
  return null;
}

// Types minimaux du DOM pour le code exécuté dans la page (le paquet ne charge pas la bibliothèque « dom »).
type DomAttr = { name: string; value: string };
type DomEl = {
  attributes: ArrayLike<DomAttr>;
  tagName: string;
  innerText?: string;
  textContent: string | null;
  closest(sel: string): DomEl | null;
  querySelectorAll(sel: string): ArrayLike<DomEl>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  scrollIntoView(o: unknown): void;
  outerHTML: string;
  href?: string;
};
type DomDoc = {
  body: DomEl | null;
  head: { appendChild(n: unknown): void };
  title: string;
  querySelector(sel: string): DomEl | null;
  querySelectorAll(sel: string): ArrayLike<DomEl>;
  createElement(tag: string): { textContent: string };
};

/** Collecte texte et attributs d'un élément, de son bouton / lien englobant et de ses descendants (côté page). */
async function describe(target: Locator): Promise<TargetDescription> {
  return target.evaluate((node) => {
    const el = node as unknown as DomEl;
    const attrsOf = (e: DomEl): string[] => {
      const out: string[] = [];
      for (const a of Array.from(e.attributes)) if (a.name !== "style" && a.name !== "data-lap-mark") out.push(`${a.name}=${a.value}`);
      return out;
    };
    const clickable = el.closest("a,button,[role=button],[onclick],label") ?? el;
    const attributes = [...attrsOf(el), ...(clickable !== el ? attrsOf(clickable) : [])];
    for (const child of Array.from(clickable.querySelectorAll("*")).slice(0, 40)) attributes.push(...attrsOf(child));
    const text = [clickable.innerText ?? clickable.textContent ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? "", el.getAttribute("value") ?? ""].join(" ");
    return { text, attributes, tag: clickable.tagName.toLowerCase(), type: clickable.getAttribute("type") };
  });
}

async function fieldOf(target: Locator): Promise<TargetDescription> {
  return target.evaluate((node) => {
    const el = node as unknown as DomEl;
    return { text: "", attributes: Array.from(el.attributes).map((a) => `${a.name}=${a.value}`), tag: el.tagName.toLowerCase(), type: el.getAttribute("type") };
  });
}

export type GuardLog = (action: string, detail: string) => void;

// Le Locator Playwright reste privé au module : un adaptateur ne peut ni cliquer ni écrire sans passer par la garde.
const RAW = new WeakMap<ReadonlyLocator, Locator>();
function rawOf(l: ReadonlyLocator): Locator {
  const r = RAW.get(l);
  if (!r) throw new CaptureError("forbidden_action", "élément inconnu de la garde");
  return r;
}

/** Locator en lecture seule : compter, lire, chercher dedans ; jamais cliquer ni écrire (voir `GuardedPage`). */
export class ReadonlyLocator {
  constructor(raw: Locator) {
    RAW.set(this, raw);
  }
  count(): Promise<number> {
    return rawOf(this).count();
  }
  nth(i: number): ReadonlyLocator {
    return new ReadonlyLocator(rawOf(this).nth(i));
  }
  first(): ReadonlyLocator {
    return new ReadonlyLocator(rawOf(this).first());
  }
  find(selector: string): ReadonlyLocator {
    return new ReadonlyLocator(rawOf(this).locator(selector));
  }
  async text(): Promise<string> {
    const loc = rawOf(this).first();
    const t = await loc.innerText({ timeout: 5_000 }).catch(() => null);
    return (t ?? (await loc.textContent({ timeout: 5_000 }).catch(() => null)) ?? "").trim();
  }
  isVisible(): Promise<boolean> {
    return rawOf(this).first().isVisible();
  }
}

/** Seule interface donnée à un adaptateur. Chaque action est vérifiée et journalisée. */
export class GuardedPage {
  readonly #page: Page;
  readonly #hosts: readonly string[];
  readonly #log: GuardLog;
  #lastStatus: number | null = null;
  // Cadre du site de paris quand le bookmaker l'affiche dans une iframe (sélecteur réglable).
  #root: Page | FrameLocator;
  readonly #marks = new Map<string, Locator>();

  constructor(page: Page, allowedHosts: readonly string[], log: GuardLog = () => undefined) {
    this.#page = page;
    this.#hosts = allowedHosts.map((h) => h.toLowerCase());
    this.#log = log;
    this.#root = page;
  }

  /** Cherche désormais dans l'iframe donnée (site de paris intégré), ou de nouveau dans la page (`null`). */
  useFrame(selector: string | null): void {
    this.#root = selector ? this.#page.frameLocator(selector) : this.#page;
  }

  get lastStatus(): number | null {
    return this.#lastStatus;
  }

  url(): string {
    return this.#page.url();
  }

  async goto(url: string, timeoutMs = 30_000): Promise<void> {
    const why = forbiddenUrlReason(url, this.#hosts);
    if (why) throw new CaptureError("forbidden_action", `adresse refusée : ${why}`);
    this.#log("goto", new URL(url).pathname);
    const res = await this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    this.#lastStatus = res?.status() ?? null;
    await this.#checkUrl();
  }

  /** Après un clic, une redirection vers une page interdite est stoppée net. */
  async #checkUrl(): Promise<void> {
    const current = this.#page.url();
    if (current === "about:blank") return;
    const why = forbiddenUrlReason(current, this.#hosts);
    if (why) {
      await this.#page.goto("about:blank").catch(() => undefined);
      throw new CaptureError("forbidden_action", `page refusée après navigation : ${why}`);
    }
  }

  find(selector: string): ReadonlyLocator {
    return new ReadonlyLocator(this.#root.locator(selector));
  }

  async click(target: ReadonlyLocator, purpose: ClickPurpose, timeoutMs = 10_000): Promise<void> {
    const loc = rawOf(target).first();
    const why = forbiddenClickReason(await describe(loc), purpose);
    if (why) {
      this.#log("refused", `${purpose} : ${why}`);
      throw new CaptureError("forbidden_action", `clic refusé (${purpose}) : ${why}`);
    }
    // Un lien vers une page interdite est refusé avant le clic.
    const href = await loc.evaluate((node) => {
      const a = (node as unknown as DomEl).closest("a");
      return a ? (a.href ?? null) : null;
    });
    if (href && /^https?:/i.test(href)) {
      const bad = forbiddenUrlReason(href, this.#hosts);
      if (bad) throw new CaptureError("forbidden_action", `lien refusé : ${bad}`);
    }
    this.#log("click", purpose);
    await loc.click({ timeout: timeoutMs });
    await this.#page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
    await this.#checkUrl();
  }

  async fill(target: ReadonlyLocator, value: string, purpose: FillPurpose, timeoutMs = 10_000): Promise<void> {
    const loc = rawOf(target).first();
    const d = await fieldOf(loc);
    if (d.tag !== "input") throw new CaptureError("forbidden_action", `remplissage refusé : élément ${d.tag}`);
    const why = forbiddenFillReason(d, purpose);
    if (why) throw new CaptureError("forbidden_action", `remplissage refusé (${purpose}) : ${why}`);
    if (purpose === "search" && value.length > 120) throw new CaptureError("forbidden_action", "recherche trop longue");
    this.#log("fill", purpose);
    await loc.fill(value, { timeout: timeoutMs });
  }

  /** Entrée seulement, et seulement dans un champ de recherche ou de connexion. */
  async pressEnter(target: ReadonlyLocator, purpose: "search" | "password", timeoutMs = 10_000): Promise<void> {
    const loc = rawOf(target).first();
    const why = forbiddenFillReason(await fieldOf(loc), purpose);
    if (why) throw new CaptureError("forbidden_action", `Entrée refusée : ${why}`);
    this.#log("press", `Enter (${purpose})`);
    await loc.press("Enter", { timeout: timeoutMs });
    await this.#page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
    await this.#checkUrl();
  }

  async waitFor(selector: string, timeoutMs: number): Promise<boolean> {
    return this.#root
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  async pause(ms: number): Promise<void> {
    await this.#page.waitForTimeout(ms);
  }

  /** Signaux de la page pour `detectPageObstacle`. */
  async signals(): Promise<{ text: string; title: string; url: string; frames: string[]; attributes: string[]; status: number | null }> {
    const data = await this.#page
      .evaluate(() => {
        const doc = (globalThis as unknown as { document: DomDoc }).document;
        return {
          text: (doc.body?.innerText ?? "").slice(0, 6000),
          title: doc.title,
          frames: Array.from(doc.querySelectorAll("iframe")).map((f) => f.getAttribute("src") ?? ""),
          // Seulement les éléments affichés : un champ de code caché existe sur bien des pages de connexion.
          attributes: Array.from(doc.querySelectorAll("[autocomplete=one-time-code],[class*=captcha],[id*=captcha],[data-sitekey]"))
            .filter((e) => (e as unknown as { getClientRects(): ArrayLike<unknown> }).getClientRects().length > 0)
            .slice(0, 5)
            .map((e) => e.outerHTML.slice(0, 200)),
        };
      })
      .catch(() => ({ text: "", title: "", frames: [] as string[], attributes: [] as string[] }));
    return { ...data, url: this.#page.url(), status: this.#lastStatus };
  }

  /** Retient l'élément visé (sélection, marché) pour le cadre et la capture ; rien n'est envoyé au site. */
  mark(target: ReadonlyLocator, name: string): void {
    this.#marks.set(name, rawOf(target).first());
  }

  /** Cadre de couleur injecté en CSS autour de l'élément retenu (dans son propre document, iframe comprise) ; aucun clic. */
  async highlight(markName: string, color = "#ff7a00"): Promise<void> {
    const loc = this.#marks.get(markName);
    if (!loc) throw new CaptureError("market_missing", "élément à entourer introuvable");
    this.#log("highlight", markName);
    await loc.evaluate(
      (node, c) => {
        const el = node as unknown as DomEl & { ownerDocument: DomDoc };
        el.setAttribute("data-lap-mark", "1");
        const style = el.ownerDocument.createElement("style");
        style.textContent = `[data-lap-mark="1"]{outline:4px solid ${c}!important;outline-offset:3px!important;box-shadow:0 0 0 8px ${c}55!important;border-radius:6px!important;position:relative;z-index:2}`;
        el.ownerDocument.head.appendChild(style);
        el.scrollIntoView({ block: "center", inline: "center" });
      },
      color,
    );
  }

  /** Capture PNG recadrée sur la zone marquée (avec une marge), ou de la fenêtre visible. */
  async capture(markName?: string, padding = 48): Promise<Uint8Array> {
    this.#log("capture", markName ?? "page");
    const loc = markName ? this.#marks.get(markName) : undefined;
    if (loc) {
      const box = await loc.boundingBox();
      const vp = this.#page.viewportSize() ?? { width: 1280, height: 900 };
      if (box) {
        const x = Math.max(0, Math.floor(box.x - padding));
        const y = Math.max(0, Math.floor(box.y - padding));
        const width = Math.min(vp.width - x, Math.ceil(box.width + padding * 2));
        const height = Math.min(vp.height - y, Math.ceil(box.height + padding * 2));
        if (width > 20 && height > 20) return new Uint8Array(await this.#page.screenshot({ type: "png", clip: { x, y, width, height } }));
      }
    }
    return new Uint8Array(await this.#page.screenshot({ type: "png" }));
  }
}
