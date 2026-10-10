/**
 * Outils Playwright communs à `pnpm captures` et `pnpm a11y` : navigateur, connexion par le formulaire /login,
 * visite d'une page (statut, redirection, erreurs JavaScript), fermeture de la visite guidée, capture pleine page.
 */
import sharp from "sharp";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type ConsoleMessage,
  type Page,
  type Response,
} from "playwright";

/** Hauteur de fenêtre par largeur : ordinateur 900 px, tablette 1024 px, téléphone 844 px (iPhone 14). */
export function viewportHeight(width: number): number {
  if (width >= 1024) return 900;
  if (width >= 768) return 1024;
  return 844;
}

export function contextOptions(width: number): BrowserContextOptions {
  return {
    viewport: { width, height: viewportHeight(width) },
    deviceScaleFactor: 1,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "light",
    reducedMotion: "reduce",
  };
}

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(
      `Chromium ne démarre pas : lancez « pnpm --filter web exec playwright install chromium ». Détail : ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    );
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Connexion par le formulaire /login (Auth.js, fournisseur « credentials ») : champs `name="email"` et
 * `name="password"`, bouton d'envoi du formulaire. Échoue vite avec un message clair si le site refuse.
 */
export async function login(
  context: BrowserContext,
  o: { base: string; email: string; password: string; timeoutMs: number },
): Promise<void> {
  const page = await context.newPage();
  try {
    try {
      await page.goto(`${o.base}/login`, { waitUntil: "domcontentloaded", timeout: o.timeoutMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(msg))
        throw new Error(
          `Aucun serveur sur ${o.base} : lancez d'abord le serveur de développement (procédure en tête de apps/web/scripts/captures.ts).`,
        );
      throw err;
    }
    if (!pathnameOf(page.url()).startsWith("/login")) return; // session déjà ouverte
    await page.locator('input[name="email"]').fill(o.email);
    await page.locator('input[name="password"]').fill(o.password);
    await page.locator('form button[type="submit"]').first().click();
    const deadline = Date.now() + o.timeoutMs;
    while (Date.now() < deadline) {
      if (!pathnameOf(page.url()).startsWith("/login")) return;
      const refused = await page
        .getByText(/incorrect|impossible|désactivé/i)
        .first()
        .textContent({ timeout: 250 })
        .catch(() => null);
      if (refused)
        throw new Error(
          `Connexion refusée pour ${o.email} : « ${refused.trim()} ». Base locale : lancez « pnpm db:demo » (compte de vérification), sinon passez --email / --password.`,
        );
      await page.waitForTimeout(400);
    }
    throw new Error(`Connexion : pas de redirection après ${Math.round(o.timeoutMs / 1000)} s.`);
  } finally {
    await page.close();
  }
}

export type Visit = {
  httpStatus: number | null;
  finalPath: string;
  finalSearch: string;
  title: string | null;
  /** Page « introuvable » de Next.js (notFound() pendant le rendu en flux : statut HTTP 200 mais page 404). */
  notFound: boolean;
  /** Exceptions non rattrapées et console.error pendant le chargement. */
  errors: string[];
  loadError: string | null;
};

/** Charge une page et attend qu'elle soit stable (réseau calme, polices chargées). */
export async function visit(page: Page, url: string, timeoutMs: number): Promise<Visit> {
  const errors: string[] = [];
  const onPageError = (e: Error) => errors.push(e.message);
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  // Statut du document principal (hors redirections), lu aussi quand la page remplace sa propre adresse au chargement
  // (filtres mémorisés : `router.replace`), ce qui interrompt `goto` avec net::ERR_ABORTED.
  let documentStatus: number | null = null;
  const onResponse = (res: Response) => {
    const req = res.request();
    if (req.isNavigationRequest() && res.frame() === page.mainFrame() && !req.redirectedTo())
      documentStatus ??= res.status();
  };
  page.on("response", onResponse);
  let httpStatus: number | null = null;
  let loadError: string | null = null;
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    httpStatus = res?.status() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    if (/ERR_ABORTED|interrupted by another navigation/i.test(msg) && documentStatus !== null) {
      await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => undefined);
      httpStatus = documentStatus;
    } else loadError = msg;
  }
  page.off("response", onResponse);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page
    .evaluate(async () => {
      await document.fonts?.ready;
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
  const title = await page
    .evaluate(() => {
      const h1 = document.querySelector("main h1") ?? document.querySelector("h1");
      const t = h1?.textContent?.trim() || document.title?.trim();
      return t || null;
    })
    .catch(() => null);
  const notFound = await page
    .evaluate(() => !!document.querySelector('meta[name="next-error"][content="not-found"]'))
    .catch(() => false);
  page.off("pageerror", onPageError);
  page.off("console", onConsole);
  const final = new URL(page.url());
  return {
    httpStatus,
    finalPath: final.pathname,
    finalSearch: final.search,
    title,
    notFound,
    errors,
    loadError,
  };
}

/** Bouton « Passer la visite » de la visite guidée (attribut `data-tour-skip` conseillé, sinon le texte). */
function tourSkip(page: Page) {
  return page
    .locator("[data-tour-skip]")
    .or(page.getByRole("button", { name: /^\s*passer la visite\s*$/i }))
    .or(page.getByRole("dialog").getByRole("button", { name: /^\s*passer\s*$/i }))
    .first();
}

/** Ferme la visite guidée si elle s'affiche ; `waitMs` : temps laissé à son apparition (première page). */
export async function dismissTour(page: Page, waitMs = 0): Promise<boolean> {
  const skip = tourSkip(page);
  if (waitMs > 0) await skip.waitFor({ state: "visible", timeout: waitMs }).catch(() => undefined);
  if (!(await skip.isVisible().catch(() => false))) return false;
  await skip.click({ timeout: 5_000 }).catch(() => undefined);
  await skip.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(200);
  return true;
}

/** Outils de développement Next.js (badge, alertes) masqués sur les captures ; curseur de saisie caché. */
const HIDE_DEV_CSS = `nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }
*, *::before, *::after { caret-color: transparent !important; }`;

/**
 * Prépare la capture : masque les outils de développement et, si la page défile dans un conteneur interne
 * (hauteur d'écran fixe + `overflow: auto`) plutôt que dans le document, déplie ce conteneur pour que la
 * capture « pleine page » montre tout le contenu.
 */
export async function prepareForShot(page: Page): Promise<void> {
  await page.addStyleTag({ content: HIDE_DEV_CSS }).catch(() => undefined);
  await page
    .evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      if (doc.scrollHeight > window.innerHeight + 4) return;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const s = getComputedStyle(el);
        const scrolls = s.overflowY === "auto" || s.overflowY === "scroll";
        if (!scrolls || el.scrollHeight <= el.clientHeight + 4) continue;
        if (el.clientHeight < window.innerHeight * 0.5) continue;
        el.style.overflow = "visible";
        el.style.height = "auto";
        el.style.maxHeight = "none";
        for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          p.style.height = "auto";
          p.style.maxHeight = "none";
          p.style.overflow = "visible";
        }
      }
    })
    .catch(() => undefined);
}

/** Au-delà, la capture est coupée (le format webp est limité à 16 383 px de haut). */
export const MAX_SHOT_HEIGHT = 16_000;

/**
 * Capture pleine hauteur, à la largeur de la fenêtre : on voit ce que voit l'utilisateur. La fenêtre est d'abord
 * étirée à la hauteur de la page, pour que les éléments à hauteur d'écran (barre de menu `h-screen`, barre du bas
 * fixe) apparaissent comme pendant le défilement, puis remise à sa taille. Si la page déborde à droite (contenu plus
 * large que l'écran), la largeur réelle est rendue dans `overflowWidth` pour être signalée dans l'index.
 */
export async function fullPageShot(page: Page): Promise<{
  png: Buffer;
  height: number;
  truncatedFrom: number | null;
  overflowWidth: number | null;
}> {
  // La page peut encore changer d'adresse juste après son chargement (onglet par défaut, filtres mémorisés) : on
  // attend la fin de cette navigation et on mesure à nouveau.
  const measure = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await page.evaluate(() => ({
          height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
          scrollWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth ?? 0,
          ),
        }));
      } catch (err) {
        if (attempt >= 2) throw err;
        await page.waitForLoadState("load").catch(() => undefined);
        await page.waitForTimeout(500);
      }
    }
  };
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  let size = await measure();
  try {
    for (let i = 0; i < 2 && size.height > viewport.height; i++) {
      const target = Math.min(size.height, MAX_SHOT_HEIGHT);
      if (page.viewportSize()?.height === target) break;
      await page.setViewportSize({ width: viewport.width, height: target });
      await page.waitForTimeout(250);
      size = await measure();
    }
    const height = Math.min(size.height, MAX_SHOT_HEIGHT);
    const png = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      type: "png",
      clip: { x: 0, y: 0, width: viewport.width, height },
    });
    return {
      png,
      height,
      truncatedFrom: size.height > MAX_SHOT_HEIGHT ? size.height : null,
      overflowWidth: size.scrollWidth > viewport.width + 1 ? size.scrollWidth : null,
    };
  } finally {
    await page.setViewportSize(viewport);
  }
}

/** PNG → webp (qualité 70, largeur ramenée à 1440 px au plus). Retourne la taille du fichier écrit. */
export async function writeWebp(png: Buffer, file: string, maxWidth = 1440): Promise<number> {
  const info = await sharp(png)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 70, effort: 5 })
    .toFile(file);
  return info.size;
}
