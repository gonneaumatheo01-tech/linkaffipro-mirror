/**
 * Adaptateur d'un bookmaker (phase 23) : interface commune et adaptateur générique piloté par des sélecteurs CSS
 * réglables (un site change souvent : on ajuste les sélecteurs sans toucher au code, voir `adapters.ts`).
 * L'adaptateur n'agit que par `GuardedPage` (garde « jamais de mise ») et lève des `CaptureError` classées.
 */
import type { CaptureRequest } from "../screenshot";
import { CaptureError, detectPageObstacle, looksLikeLoginFailure } from "./errors";
import type { GuardedPage, ReadonlyLocator } from "./guard";
import { parseOddsText, textMatchesMarket, textMatchesSelection, textMentionsMatch } from "./match";

export type BookmakerCredentials = { login: string; password: string };

/** Sélecteurs CSS (plusieurs possibilités séparées par des virgules ; chaîne vide = étape absente sur ce site). */
export type BookmakerSelectors = {
  cookieAccept: string;
  /** Visible seulement une fois connecté (solde, avatar, bouton « Mon compte »). */
  loggedInMarker: string;
  loginOpen: string;
  loginUser: string;
  loginPassword: string;
  loginSubmit: string;
  loginError: string;
  searchOpen: string;
  searchInput: string;
  /** Un résultat de recherche cliquable (lien vers le match). */
  searchResult: string;
  /** Onglets ou filtres de marchés sur la page du match. */
  marketTab: string;
  marketBlock: string;
  marketTitle: string;
  selectionRow: string;
  /** Cote dans une ligne de sélection (lue, jamais cliquée). */
  selectionOdds: string;
  /** Iframe du site de paris quand il est intégré dans une page (sinon vide). */
  sportsbookFrame: string;
};

export type BookmakerConfig = {
  key: string;
  label: string;
  baseUrl: string;
  /** Page de connexion directe (sinon bouton `loginOpen`). */
  loginUrl: string | null;
  /** Recherche par adresse (`{q}` = texte), sinon champ de recherche. */
  searchUrl: string | null;
  allowedHosts: string[];
  selectors: BookmakerSelectors;
  /** Délai d'attente d'un élément (ms). */
  stepTimeoutMs: number;
};

export type AdapterSession = {
  page: GuardedPage;
  credentials: BookmakerCredentials | null;
};

export type MarketHandle = { marketText: string; selectionText: string; odds: ReadonlyLocator };

export type LoginOutcome = "already" | "logged_in" | "skipped";

export interface BookmakerAdapter {
  readonly key: string;
  readonly label: string;
  readonly config: BookmakerConfig;
  openHome(s: AdapterSession): Promise<void>;
  login(s: AdapterSession): Promise<LoginOutcome>;
  findEvent(s: AdapterSession, req: CaptureRequest): Promise<void>;
  findMarket(s: AdapterSession, req: CaptureRequest): Promise<MarketHandle>;
  readOdds(s: AdapterSession, h: MarketHandle): Promise<number>;
  highlightAndCapture(s: AdapterSession, h: MarketHandle): Promise<Uint8Array>;
}

async function throwIfObstacle(page: GuardedPage, afterLogin = false): Promise<void> {
  const kind = detectPageObstacle(await page.signals(), { afterLogin });
  if (kind === "geo_blocked") throw new CaptureError(kind, "le site indique ne pas être disponible depuis ce pays");
  if (kind === "captcha") throw new CaptureError(kind, "le site affiche une vérification anti-robot");
  if (kind === "two_factor") throw new CaptureError(kind, "le site demande un code de vérification");
}

async function visible(page: GuardedPage, selector: string): Promise<boolean> {
  if (!selector) return false;
  const loc = page.find(selector);
  return (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
}

/** Petite pause variable : un robot qui enchaîne en 0 ms se fait repérer plus vite. */
function humanPause(page: GuardedPage, min = 250, max = 700): Promise<void> {
  return page.pause(min + Math.floor(Math.random() * (max - min)));
}

export function createSelectorAdapter(config: BookmakerConfig): BookmakerAdapter {
  const sel = config.selectors;
  const t = config.stepTimeoutMs;

  const adapter: BookmakerAdapter = {
    key: config.key,
    label: config.label,
    config,

    async openHome(s) {
      s.page.useFrame(null);
      await s.page.goto(config.baseUrl);
      await throwIfObstacle(s.page);
      if (sel.cookieAccept && (await s.page.waitFor(sel.cookieAccept, 1_500))) {
        // Bannière de cookies : on accepte si la garde le permet, sinon on continue sans.
        await s.page.click(s.page.find(sel.cookieAccept), "cookie_accept").catch((err) => {
          if ((err as CaptureError).kind !== "forbidden_action") throw err;
        });
      }
    },

    async login(s) {
      if (await visible(s.page, sel.loggedInMarker)) return "already";
      if (!s.credentials) return "skipped";
      if (config.loginUrl) await s.page.goto(config.loginUrl);
      else if (sel.loginOpen && (await s.page.waitFor(sel.loginOpen, t))) await s.page.click(s.page.find(sel.loginOpen), "open_login");
      await throwIfObstacle(s.page);
      if (!(await s.page.waitFor(sel.loginUser, t))) throw new CaptureError("login_failed", "formulaire de connexion introuvable (sélecteurs à vérifier)");
      await s.page.fill(s.page.find(sel.loginUser), s.credentials.login, "login");
      await humanPause(s.page);
      await s.page.fill(s.page.find(sel.loginPassword), s.credentials.password, "password");
      await humanPause(s.page);
      if (sel.loginSubmit && (await visible(s.page, sel.loginSubmit))) await s.page.click(s.page.find(sel.loginSubmit), "login_submit");
      else await s.page.pressEnter(s.page.find(sel.loginPassword), "password");
      // Attente du repère « connecté », en surveillant captcha, code de vérification et message d'erreur.
      const deadline = Date.now() + t * 2;
      while (Date.now() < deadline) {
        if (await visible(s.page, sel.loggedInMarker)) return "logged_in";
        await throwIfObstacle(s.page, true);
        if (await visible(s.page, sel.loginError)) throw new CaptureError("login_failed", "identifiant ou mot de passe refusé par le site");
        const { text } = await s.page.signals();
        if (looksLikeLoginFailure(text)) throw new CaptureError("login_failed", "identifiant ou mot de passe refusé par le site");
        await s.page.pause(400);
      }
      throw new CaptureError("login_failed", "connexion non confirmée par le site (délai dépassé)");
    },

    async findEvent(s, req) {
      if (req.eventUrl) {
        try {
          await s.page.goto(req.eventUrl);
          await throwIfObstacle(s.page);
          if (sel.sportsbookFrame) s.page.useFrame(sel.sportsbookFrame);
          if (await s.page.waitFor(sel.marketBlock, t)) return;
        } catch (err) {
          // Adresse directe refusée par la garde ou périmée : on passe par la recherche.
          if ((err as CaptureError).kind && !["forbidden_action", "timeout"].includes((err as CaptureError).kind)) throw err;
        }
      }
      for (const query of [req.homeTeam, req.awayTeam]) {
        s.page.useFrame(null);
        if (config.searchUrl) {
          await s.page.goto(config.searchUrl.replace("{q}", encodeURIComponent(query)));
          await throwIfObstacle(s.page);
          if (sel.sportsbookFrame) s.page.useFrame(sel.sportsbookFrame);
        } else {
          if (sel.sportsbookFrame) s.page.useFrame(sel.sportsbookFrame);
          if (!(await visible(s.page, sel.searchInput)) && sel.searchOpen && (await s.page.waitFor(sel.searchOpen, t)))
            await s.page.click(s.page.find(sel.searchOpen), "open_search");
          if (!(await s.page.waitFor(sel.searchInput, t))) throw new CaptureError("not_found", "champ de recherche introuvable (sélecteurs à vérifier)");
          await s.page.fill(s.page.find(sel.searchInput), query, "search");
          await humanPause(s.page);
          await s.page.pressEnter(s.page.find(sel.searchInput), "search");
        }
        if (!(await s.page.waitFor(sel.searchResult, t))) continue;
        const results = s.page.find(sel.searchResult);
        const n = Math.min(await results.count(), 25);
        for (let i = 0; i < n; i++) {
          const r = results.nth(i);
          if (!textMentionsMatch(await r.text(), req.homeTeam, req.awayTeam)) continue;
          await s.page.click(r, "search_result");
          await throwIfObstacle(s.page);
          if (sel.sportsbookFrame) s.page.useFrame(sel.sportsbookFrame);
          if (!(await s.page.waitFor(sel.marketBlock, t))) throw new CaptureError("market_missing", "page du match sans marché affiché");
          return;
        }
      }
      throw new CaptureError("not_found", `match ${req.homeTeam} – ${req.awayTeam} introuvable sur ${config.label}`);
    },

    async findMarket(s, req) {
      const scan = async (): Promise<MarketHandle | null> => {
        const blocks = s.page.find(sel.marketBlock);
        const n = Math.min(await blocks.count(), 80);
        for (let i = 0; i < n; i++) {
          const block = blocks.nth(i);
          const title = sel.marketTitle ? await block.find(sel.marketTitle).first().text().catch(() => "") : await block.text();
          if (!textMatchesMarket(title, req.marketLabel)) continue;
          const rows = block.find(sel.selectionRow);
          const m = Math.min(await rows.count(), 60);
          for (let j = 0; j < m; j++) {
            const row = rows.nth(j);
            const rowText = await row.text();
            if (!textMatchesSelection(rowText, req.selectionLabel, req.line)) continue;
            if (/suspendu|suspended|locked|ferme|indisponible|unavailable/i.test(rowText)) throw new CaptureError("market_missing", "sélection suspendue sur le site");
            const odds = row.find(sel.selectionOdds);
            if ((await odds.count()) === 0) throw new CaptureError("market_missing", "cote absente pour cette sélection");
            s.page.mark(block, "market");
            s.page.mark(row, "selection");
            return { marketText: title.slice(0, 120), selectionText: rowText.slice(0, 120), odds: odds.first() };
          }
        }
        return null;
      };
      const direct = await scan();
      if (direct) return direct;
      if (sel.marketTab) {
        const tabs = s.page.find(sel.marketTab);
        const n = Math.min(await tabs.count(), 30);
        for (let i = 0; i < n; i++) {
          const tab = tabs.nth(i);
          if (!textMatchesMarket(await tab.text(), req.marketLabel)) continue;
          await s.page.click(tab, "market_tab");
          await humanPause(s.page);
          const found = await scan();
          if (found) return found;
        }
      }
      throw new CaptureError("market_missing", `marché « ${req.marketLabel} » / « ${req.selectionLabel} » absent sur ${config.label}`);
    },

    async readOdds(_s, h) {
      const v = parseOddsText(await h.odds.text());
      if (v === null) throw new CaptureError("market_missing", "cote illisible sur le site");
      return v;
    },

    async highlightAndCapture(s) {
      await s.page.highlight("selection");
      await s.page.pause(150);
      return s.page.capture("market");
    },
  };
  return adapter;
}
