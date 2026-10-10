/**
 * `pnpm a11y` : contrôle d'accessibilité axe (règles wcag2a + wcag2aa par défaut) de chaque écran à 1440 px, avec
 * le compte de vérification de la base de démonstration locale. Rapport complet dans
 * `docs/captures/a11y-report.json`, résumé en console ; code de sortie 1 s'il reste une violation « critical »
 * (`--fail-on serious` pour être plus strict). Même liste de pages et même procédure que `pnpm captures`
 * (voir l'en-tête de captures.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import {
  blockingPages,
  countByImpact,
  formatSummary,
  toPageViolations,
  type A11yPageResult,
} from "./lib/a11y-report";
import { contextOptions, dismissTour, launchBrowser, login, visit } from "./lib/browser";
import { A11Y_HELP, OptionError, parseA11yOptions } from "./lib/options";
import { isPublicRoute } from "./lib/routes";
import { planTargets } from "./lib/targets";

const WEB_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..", "..");

function pathOnly(p: string): string {
  const q = p.search(/[?#]/);
  return q === -1 ? p : p.slice(0, q);
}

/** Analyse axe ; une navigation tardive de la page (onglet par défaut, filtres mémorisés) est attendue puis reprise. */
async function analyze(page: Page, tags: string[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await new AxeBuilder({ page })
        .withTags(tags)
        .exclude("nextjs-portal") // outils de développement Next.js, absents en production
        .analyze();
    } catch (err) {
      if (attempt >= 1) throw err;
      await page.waitForLoadState("load").catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }
}

async function main(): Promise<number> {
  const opts = parseA11yOptions(process.argv.slice(2), process.env);
  if (opts.help) {
    console.log(A11Y_HELP);
    return 0;
  }
  const reportFile = path.resolve(REPO_ROOT, opts.report);
  const { targets, notes } = await planTargets(opts.pages, {
    webDir: WEB_DIR,
    repoRoot: REPO_ROOT,
    env: process.env,
  });
  for (const n of notes) console.warn(`[a11y] ${n}`);
  console.log(
    `[a11y] ${targets.length} page(s) à ${opts.width} px sur ${opts.base}, règles ${opts.tags.join(", ")}`,
  );

  const pages: A11yPageResult[] = [];
  const browser = await launchBrowser();
  try {
    const admin = await browser.newContext(contextOptions(opts.width));
    await login(admin, opts);
    const adminPage = await admin.newPage();
    let anonPage: Page | null = null;
    let first = true;
    for (const t of targets) {
      const result: A11yPageResult = {
        route: t.route,
        path: t.path,
        status: "ok",
        httpStatus: null,
        note: null,
        violations: [],
      };
      pages.push(result);
      if (!t.path) {
        result.status = "no-id";
        continue;
      }
      const pagePath = t.path;
      const isPublic = isPublicRoute(t.route);
      if (isPublic && !anonPage)
        anonPage = await (await browser.newContext(contextOptions(opts.width))).newPage();
      const page = isPublic ? anonPage! : adminPage;
      const check = async () => {
        let v = await visit(page, `${opts.base}${pagePath}`, opts.timeoutMs);
        if (!isPublic && v.finalPath === "/login") {
          await login(admin, opts);
          v = await visit(page, `${opts.base}${pagePath}`, opts.timeoutMs);
        }
        result.httpStatus = v.httpStatus;
        if (v.loadError && v.httpStatus === null) {
          result.status = "error";
          result.note = v.loadError;
          return;
        }
        if (v.httpStatus === 404 || v.notFound) {
          result.status = "absent";
          result.httpStatus = 404;
          return;
        }
        if (v.finalPath !== pathOnly(pagePath)) {
          result.status = "redirect";
          result.note = `vers ${v.finalPath}${v.finalSearch}`;
          return;
        }
        if (v.httpStatus !== null && v.httpStatus >= 500) result.status = "error";
        if (!isPublic) {
          await dismissTour(page, first ? 3_000 : 0);
          first = false;
        }
        const axe = await analyze(page, opts.tags);
        result.violations = toPageViolations(axe.violations);
        const n = result.violations.length;
        console.log(`[a11y] ${t.route} : ${n ? `${n} règle(s) en violation` : "aucune violation"}`);
      };
      try {
        await check();
      } catch (err) {
        // Une page qui casse (navigation imprévue, délai dépassé…) est notée en erreur ; le contrôle continue.
        result.status = "error";
        result.note = err instanceof Error ? err.message.split("\n")[0]! : String(err);
        console.log(`[a11y] ${t.route} : erreur (${result.note})`);
      }
    }
  } finally {
    await browser.close();
  }

  mkdirSync(path.dirname(reportFile), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    base: opts.base,
    width: opts.width,
    tags: opts.tags,
    failOn: opts.failOn,
    totals: countByImpact(pages),
    pages,
  };
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log("");
  for (const line of formatSummary(pages, opts.failOn)) console.log(`[a11y] ${line}`);
  console.log(`[a11y] rapport : ${path.relative(REPO_ROOT, reportFile)}`);
  return blockingPages(pages, opts.failOn).length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof OptionError) {
      console.error(`[a11y] ${err.message}`);
      process.exit(2);
    }
    console.error(`[a11y] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
