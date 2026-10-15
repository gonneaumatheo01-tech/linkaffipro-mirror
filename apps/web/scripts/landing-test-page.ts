/**
 * `pnpm landing:test-page` (phase 15, D12) : page d'atterrissage « test » pour les mesures réelles (Lighthouse, poids,
 * temps de première réponse, clic → Telegram), UNIQUEMENT sur un canal marqué « canal de test » (`Channel.isTest`).
 * Tout autre canal est refusé, et une page « test » déjà posée sur un vrai canal n'est jamais touchée.
 *
 * - Crée la page « test » (adresse `/j/test`) si elle n'existe pas, sinon la garde (textes inchangés, sauf `--reset`) et
 *   la remet en ligne ;
 * - sources « tk01 », « tk03 », « exo1 » et la source par défaut, actives ;
 * - liens d'invitation des sources créés par le bot de l'univers du canal (ou un autre de nos bots administrateurs),
 *   comme depuis la rubrique Pages (`syncLandingPageLinks`) ; cache des pages invalidé ;
 * - affiche les adresses à ouvrir (une par source) et l'état de chaque lien.
 *
 * Options : `--channel <id>` (canal de test à utiliser quand il y en a plusieurs), `--reset` (remet les textes de la
 * page de test), `--dry-run` (montre ce qui serait fait : aucune écriture, aucun appel à Telegram).
 * En production : `railway ssh --service web -- pnpm landing:test-page` (lancé par le coordinateur, jamais en test
 * automatique). Les scripts lisent `.env.local` à la racine.
 */
import { pathToFileURL } from "node:url";
import { landingPublicUrl } from "@linkaffipro/core";
import { audit, prisma } from "@linkaffipro/db";
import { publishLandingInvalidate } from "@linkaffipro/queue";
import { env } from "@/lib/env";
import { loadLandingSourceLinks, syncLandingPageLinks } from "@/lib/landing/links";

export const TEST_PAGE_SLUG = "test";
export const TEST_PAGE_SOURCES = ["", "tk01", "tk03", "exo1"] as const;

/** Textes de la page de test (français, comme le reste de la plateforme). */
export const TEST_PAGE_TEXTS = {
  name: "test",
  language: "fr",
  headline: "Canal de test : rejoins-nous en un clic",
  subtext: "Page de mesure de la plateforme (vitesse, clic, comptage).",
  buttonText: null,
  footnote: "Gratuit · 1 clic · via Telegram",
} as const;

export class TestPageError extends Error {}

export type TestPageResult = {
  dryRun: boolean;
  created: boolean;
  pageId: string | null;
  channel: { id: string; title: string };
  /** Une ligne par source : adresse publique de la page, lien Telegram ou refus. */
  sources: Array<{ key: string; url: string; inviteUrl: string | null; error: string | null }>;
  message: string | null;
};

/** Canal de test à utiliser : celui demandé (refusé s'il n'est pas un canal de test), sinon le seul canal de test. */
export async function pickTestChannel(channelId?: string): Promise<{ id: string; title: string }> {
  if (channelId) {
    const c = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, title: true, isTest: true },
    });
    if (!c) throw new TestPageError(`Canal introuvable : ${channelId}.`);
    if (!c.isTest)
      throw new TestPageError(
        `Refusé : « ${c.title} » n'est pas un canal de test. La page de test ne va que sur un canal marqué « canal de test ».`,
      );
    return { id: c.id, title: c.title };
  }
  const tests = await prisma.channel.findMany({
    where: { isTest: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true },
  });
  if (tests.length === 0)
    throw new TestPageError(
      "Aucun canal marqué « canal de test » : marquez le canal TEST comme canal de test, puis relancez.",
    );
  if (tests.length > 1)
    throw new TestPageError(
      `Plusieurs canaux de test : relancez avec --channel <id>.\n${tests.map((c) => `  ${c.id}  ${c.title}`).join("\n")}`,
    );
  return tests[0]!;
}

/** Crée ou met à jour la page de test (voir l'en-tête). */
export async function runLandingTestPage(
  opts: { channelId?: string; reset?: boolean; dryRun?: boolean; baseUrl?: string } = {},
): Promise<TestPageResult> {
  const baseUrl = opts.baseUrl ?? env.trackingBaseUrl;
  const channel = await pickTestChannel(opts.channelId);
  const existing = await prisma.landingPage.findUnique({
    where: { slug: TEST_PAGE_SLUG },
    select: {
      id: true,
      isActive: true,
      channelId: true,
      channel: { select: { id: true, title: true, isTest: true } },
    },
  });
  if (existing && !existing.channel.isTest)
    throw new TestPageError(
      `Refusé : l'adresse /j/${TEST_PAGE_SLUG} est déjà une page du canal « ${existing.channel.title} », qui n'est pas un canal de test. Rien n'a été modifié.`,
    );
  if (existing && existing.channelId !== channel.id)
    throw new TestPageError(
      `La page « ${TEST_PAGE_SLUG} » est déjà sur le canal de test « ${existing.channel.title} » : relancez avec --channel ${existing.channelId}.`,
    );
  const urlOf = (key: string) => landingPublicUrl(baseUrl, TEST_PAGE_SLUG, key);

  if (opts.dryRun)
    return {
      dryRun: true,
      created: !existing,
      pageId: existing?.id ?? null,
      channel,
      sources: TEST_PAGE_SOURCES.map((key) => ({
        key,
        url: urlOf(key),
        inviteUrl: null,
        error: null,
      })),
      message: existing
        ? `La page « ${TEST_PAGE_SLUG} » existe sur « ${channel.title} » : sources et liens seraient vérifiés.`
        : `La page « ${TEST_PAGE_SLUG} » serait créée sur « ${channel.title} ».`,
    };

  const page = existing
    ? await prisma.landingPage.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          ...(opts.reset
            ? {
                ...TEST_PAGE_TEXTS,
                showPhoto: false,
                cookieBanner: false,
                version: { increment: 1 },
              }
            : {}),
        },
        select: { id: true },
      })
    : await prisma.landingPage.create({
        data: { slug: TEST_PAGE_SLUG, channelId: channel.id, ...TEST_PAGE_TEXTS },
        select: { id: true },
      });
  for (const key of TEST_PAGE_SOURCES)
    await prisma.landingSource.upsert({
      where: { landingPageId_key: { landingPageId: page.id, key } },
      create: { landingPageId: page.id, key },
      update: { isActive: true },
    });
  await publishLandingInvalidate({ pageId: page.id });

  const synced = await syncLandingPageLinks(page.id);
  await audit({
    action: existing ? "landing.test_page_updated" : "landing.test_page_created",
    entityType: "LandingPage",
    entityId: page.id,
    metadata: {
      channelId: channel.id,
      sources: [...TEST_PAGE_SOURCES],
      linksCreated: synced.created,
      linksFailed: synced.failed,
      reset: opts.reset === true,
    },
  });
  const views = await loadLandingSourceLinks(page.id);
  return {
    dryRun: false,
    created: !existing,
    pageId: page.id,
    channel,
    sources: TEST_PAGE_SOURCES.map((key) => {
      const v = views.find((s) => s.key === key);
      return { key, url: urlOf(key), inviteUrl: v?.inviteUrl ?? null, error: v?.error ?? null };
    }),
    message: synced.message,
  };
}

function parseArgs(argv: readonly string[]) {
  const opts: { channelId?: string; reset?: boolean; dryRun?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--channel") opts.channelId = argv[++i];
    else if (a.startsWith("--channel=")) opts.channelId = a.slice("--channel=".length);
    else if (a === "--reset") opts.reset = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--") continue;
    else throw new TestPageError(`Option inconnue : ${a} (--channel <id>, --reset, --dry-run).`);
  }
  return opts;
}

async function main() {
  try {
    const r = await runLandingTestPage(parseArgs(process.argv.slice(2)));
    console.log(
      `${r.dryRun ? "[essai à blanc] " : ""}Page « ${TEST_PAGE_SLUG} » ${r.created ? (r.dryRun ? "à créer" : "créée") : "à jour"} sur le canal de test « ${r.channel.title} ».`,
    );
    for (const s of r.sources) {
      const state = r.dryRun
        ? ""
        : s.inviteUrl
          ? `  → ${s.inviteUrl}`
          : `  → lien en attente${s.error ? ` : ${s.error}` : ""}`;
      console.log(`  ${s.key ? `source ${s.key}` : "par défaut"} : ${s.url}${state}`);
    }
    if (r.message) console.log(r.message);
  } catch (err) {
    console.error(err instanceof TestPageError ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    // Connexion Redis de la publication : le processus doit se terminer.
    const { closeQueues } = await import("@linkaffipro/queue");
    await closeQueues().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
