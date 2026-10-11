/**
 * `pnpm captures` : captures pleine page de chaque écran de l'admin, en webp, aux largeurs demandées
 * (1440 et 390 px par défaut), dans `docs/captures/`, avec l'index `docs/REFONTE-CAPTURES.md`.
 *
 * Procédure (base de démonstration LOCALE, jamais la production) :
 *   1. Données : `pnpm db:demo` (refuse toute base qui n'est pas sur localhost ; compte de vérification
 *      verification@linkaffipro.internal, mot de passe DEMO_PASSWORD ou « demo-local-1234 »).
 *   2. Serveur de développement sur votre port, en arrière-plan, depuis apps/web (`next` n'est pas à la racine du
 *      dépôt, et Next.js recopie les options de Node dans NODE_OPTIONS, où `--env-file-if-exists` est refusé : le
 *      préchargement scripts/load-env.cjs lit .env.local sans écraser PORT / AUTH_URL / APP_BASE_URL) :
 *        PORT=3103 AUTH_URL=http://localhost:3103 APP_BASE_URL=http://localhost:3103 \
 *          node --require ./scripts/load-env.cjs node_modules/next/dist/bin/next dev -p 3103
 *      Un seul `next dev` à la fois dans apps/web : Next.js verrouille `.next/dev/lock` (« Another next dev server
 *      is already running ») ; attendez que le serveur en place s'arrête, ou capturez-le avec --base.
 *   3. Captures : `pnpm captures` (toutes les pages) ou `pnpm captures --pages /,/campaigns,/campaigns/:id`
 *      (`--base http://localhost:<port>` pour un autre port ; `--help` pour toutes les options).
 *   4. Accessibilité : `pnpm a11y` (même liste, rapport docs/captures/a11y-report.json).
 *
 * Noms de fichiers stables, tirés de l'adresse (`/campaigns/[id]` → campaigns-id-1440.webp) ; une passe partielle ne
 * remplace que ses lignes de l'index. Pages absentes (404), redirections et fiches sans identifiant sont notées dans
 * l'index sans image. La visite guidée est fermée si elle s'affiche (bouton `data-tour-skip` ou « Passer la visite »).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import {
  contextOptions,
  dismissTour,
  fullPageShot,
  launchBrowser,
  login,
  prepareForShot,
  viewportHeight,
  visit,
  writeWebp,
} from "./lib/browser";
import {
  mergeEntries,
  parseManifest,
  renderIndex,
  type CaptureEntry,
  type CaptureStatus,
} from "./lib/manifest";
import { CAPTURES_HELP, DEFAULT_OUT, OptionError, parseCaptureOptions } from "./lib/options";
import { summarizeErrors } from "./lib/console-errors";
import { captureFileName, isPublicRoute } from "./lib/routes";
import { planTargets } from "./lib/targets";

const WEB_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..", "..");
const DEFAULT_INDEX = path.join(REPO_ROOT, "docs", "REFONTE-CAPTURES.md");

function pathOnly(p: string): string {
  const q = p.search(/[?#]/);
  return q === -1 ? p : p.slice(0, q);
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} Ko`;
}

async function main(): Promise<void> {
  const opts = parseCaptureOptions(process.argv.slice(2), process.env);
  if (opts.help) {
    console.log(CAPTURES_HELP);
    return;
  }
  const outDir = path.resolve(REPO_ROOT, opts.out);
  const rawDir = path.join(outDir, "raw");
  // L'index du dépôt ne référence que le dossier par défaut ; un autre dossier reçoit son propre INDEX.md.
  const indexFile =
    outDir === path.resolve(REPO_ROOT, DEFAULT_OUT) ? DEFAULT_INDEX : path.join(outDir, "INDEX.md");
  mkdirSync(outDir, { recursive: true });
  if (opts.keepPng) mkdirSync(rawDir, { recursive: true });

  const { targets, notes } = await planTargets(opts.pages, {
    webDir: WEB_DIR,
    repoRoot: REPO_ROOT,
    env: process.env,
  });
  for (const n of notes) console.warn(`[captures] ${n}`);
  console.log(
    `[captures] ${targets.length} page(s) × ${opts.widths.join(", ")} px sur ${opts.base}${opts.browser === "chromium" ? "" : ` (${opts.browser})`} → ${path.relative(REPO_ROOT, outDir) || "."}`,
  );

  const manifestFile = path.join(outDir, "index.json");
  const prev = parseManifest(existsSync(manifestFile) ? readFileSync(manifestFile, "utf8") : null);
  const prevByRoute = new Map(prev.entries.map((e) => [e.route, e]));
  /** Retire les images d'une adresse qui n'a plus de capture (page absente, redirigée…). */
  const removeImages = (route: string) => {
    const names = new Set([
      ...opts.widths.map((w) => captureFileName(route, w)),
      ...Object.values(prevByRoute.get(route)?.files ?? {}),
    ]);
    for (const n of names) rmSync(path.join(outDir, n), { force: true });
  };

  const entries: CaptureEntry[] = [];
  let totalBytes = 0;
  const browser = await launchBrowser(opts.browser);
  try {
    const admin = await browser.newContext(contextOptions(opts.widths[0]!));
    await login(admin, opts);
    const adminPage = await admin.newPage();
    let anonPage: Page | null = null;
    let firstAdminShot = true;

    for (const t of targets) {
      const started = Date.now();
      const entry: CaptureEntry = {
        route: t.route,
        path: t.path,
        title: null,
        status: "ok",
        httpStatus: null,
        redirectedTo: null,
        note: null,
        files: {},
        jsErrors: 0,
        capturedAt: new Date().toISOString(),
      };
      if (!t.path) {
        entry.status = "no-id";
        removeImages(t.route);
        entries.push(entry);
        console.log(`[captures] ${t.route} : aucun identifiant dans la base locale`);
        continue;
      }
      const isPublic = isPublicRoute(t.route);
      if (isPublic && !anonPage)
        anonPage = await (await browser.newContext(contextOptions(opts.widths[0]!))).newPage();
      const page = isPublic ? anonPage! : adminPage;
      const truncated: string[] = [];
      const errors: string[] = [];

      for (const w of opts.widths) {
        try {
          await page.setViewportSize({ width: w, height: viewportHeight(w) });
          let v = await visit(page, `${opts.base}${t.path}`, opts.timeoutMs);
          if (!isPublic && v.finalPath === "/login" && pathOnly(t.path) !== "/login") {
            await login(admin, opts); // session perdue (redémarrage du serveur, mot de passe changé) : une reprise
            v = await visit(page, `${opts.base}${t.path}`, opts.timeoutMs);
          }
          entry.httpStatus = v.httpStatus;
          entry.title ??= v.title;
          let status: CaptureStatus = "ok";
          if (v.loadError && v.httpStatus === null) {
            status = "error";
            entry.note = v.loadError;
          } else if (v.httpStatus === 404 || v.notFound) {
            status = "absent";
            entry.httpStatus = 404;
            entry.title = null;
          } else if (v.finalPath !== pathOnly(t.path)) {
            status = "redirect";
            entry.redirectedTo = `${v.finalPath}${v.finalSearch}`;
          } else if (v.httpStatus !== null && v.httpStatus >= 500) status = "error";
          entry.status = status;
          if (
            status === "absent" ||
            status === "redirect" ||
            (status === "error" && v.httpStatus === null)
          )
            break;

          if (!isPublic) {
            await dismissTour(page, firstAdminShot ? 3_000 : 0);
            firstAdminShot = false;
          }
          await prepareForShot(page);
          const shot = await fullPageShot(page);
          if (shot.truncatedFrom)
            truncated.push(`${w} px coupée à ${shot.height} px (page de ${shot.truncatedFrom} px)`);
          if (shot.overflowWidth)
            truncated.push(
              `déborde à droite à ${w} px (contenu de ${shot.overflowWidth} px de large)`,
            );
          const name = captureFileName(t.route, w);
          const size = await writeWebp(shot.png, path.join(outDir, name));
          if (opts.keepPng)
            writeFileSync(path.join(rawDir, captureFileName(t.route, w, "png")), shot.png);
          totalBytes += size;
          entry.files[String(w)] = name;
          errors.push(...v.errors);
        } catch (err) {
          // Une page qui casse (navigation imprévue, délai dépassé…) est notée en erreur ; la passe continue.
          entry.status = "error";
          entry.note = err instanceof Error ? err.message.split("\n")[0]! : String(err);
          break;
        }
      }
      if (truncated.length) entry.note = [entry.note, ...truncated].filter(Boolean).join(" ; ");
      const errs = summarizeErrors(errors);
      entry.jsErrors = errs.count;
      if (errs.samples.length) entry.errorSamples = errs.samples;
      // Largeur ratée dans cette passe : son ancienne image n'est plus à jour.
      for (const w of opts.widths)
        if (!entry.files[String(w)])
          rmSync(path.join(outDir, captureFileName(t.route, w)), { force: true });
      if (Object.keys(entry.files).length === 0) removeImages(t.route);
      else {
        // Passe à une seule largeur (--widths 1440) : les images des autres largeurs déjà prises restent dans l'index.
        const kept = Object.entries(prevByRoute.get(t.route)?.files ?? {}).filter(
          ([w, f]) => !opts.widths.includes(Number(w)) && existsSync(path.join(outDir, f)),
        );
        entry.files = { ...Object.fromEntries(kept), ...entry.files };
      }
      entries.push(entry);
      const what =
        entry.status === "ok"
          ? Object.values(entry.files).join(", ")
          : entry.status === "redirect"
            ? `redirige vers ${entry.redirectedTo}`
            : entry.status === "absent"
              ? "absente (404)"
              : `erreur ${entry.httpStatus ?? ""} ${entry.note ?? ""}`.trim();
      const errText = entry.jsErrors
        ? ` — ${entry.jsErrors} erreur(s) JavaScript : ${(entry.errorSamples ?? []).join(" | ")}`
        : "";
      console.log(
        `[captures] ${t.route} : ${what}${errText} (${Math.round((Date.now() - started) / 1000)} s)`,
      );
    }
  } finally {
    await browser.close();
  }

  const merged = mergeEntries(prev.entries, entries, { prune: opts.prune });
  if (opts.prune) {
    const kept = new Set(merged.map((e) => e.route));
    for (const e of prev.entries) if (!kept.has(e.route)) removeImages(e.route);
  }
  const manifest = { version: 1 as const, updatedAt: new Date().toISOString(), entries: merged };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const imageDir = path.relative(path.dirname(indexFile), outDir).split(path.sep).join("/") || ".";
  writeFileSync(indexFile, renderIndex(manifest, { imageDir, widths: opts.widths }));

  const count = (s: CaptureStatus) => entries.filter((e) => e.status === s).length;
  console.log(
    `[captures] terminé : ${count("ok")} capturée(s), ${count("absent")} absente(s), ${count("redirect")} redirection(s), ${count("no-id")} sans identifiant, ${count("error")} en erreur ; ${kb(totalBytes)} écrits.`,
  );
  console.log(`[captures] index : ${path.relative(REPO_ROOT, indexFile)}`);
}

main().catch((err) => {
  if (err instanceof OptionError) {
    console.error(`[captures] ${err.message}`);
    process.exit(2);
  }
  console.error(`[captures] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
