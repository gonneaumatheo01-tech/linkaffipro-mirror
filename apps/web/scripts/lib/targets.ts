/**
 * Liste des pages d'une passe (`pnpm captures`, `pnpm a11y`) : `--pages` (liste ou fichier) ou, par défaut, toutes
 * les pages de l'admin trouvées dans `app/(admin)/**\/page.tsx` + adresses prévues + pages publiques ; les fiches
 * (`/campaigns/[id]`…) reçoivent un identifiant réel lu dans la base LOCALE (données de `pnpm db:demo` en priorité).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolvePagesValue, type Env } from "./options";
import {
  defaultRoutes,
  fillRoute,
  isDynamicRoute,
  routeFromPageFile,
  type EntityIds,
} from "./routes";

export type Target = { route: string; path: string | null };

/** Fichiers page.tsx sous `app/(admin)`, chemins relatifs. */
export function listAdminPageFiles(webDir: string): string[] {
  const root = path.join(webDir, "app", "(admin)");
  return (readdirSync(root, { recursive: true }) as string[])
    .map((p) => p.split(path.sep).join("/"))
    .filter((p) => p === "page.tsx" || p.endsWith("/page.tsx"));
}

export function discoverAdminRoutes(webDir: string): string[] {
  return listAdminPageFiles(webDir)
    .map(routeFromPageFile)
    .filter((r): r is string => r !== null);
}

/**
 * Base locale seulement (même règle que la garde de `packages/db/prisma/demo-seed.ts`) : les identifiants des fiches
 * ne sont jamais lus ailleurs.
 */
export function isLocalDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return false;
    const local = (h: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(h);
    const hostParam = u.searchParams.get("host");
    if (hostParam && !hostParam.startsWith("/") && !local(hostParam)) return false;
    return local(u.hostname);
  } catch {
    return false;
  }
}

/** Identifiants réels pour les fiches, en privilégiant les données de démonstration (« Démo … »). */
export async function loadEntityIds(env: Env): Promise<{ ids: EntityIds; note: string | null }> {
  if (!env.DATABASE_URL)
    return { ids: {}, note: "DATABASE_URL absente : fiches sans identifiant." };
  if (!isLocalDatabaseUrl(env.DATABASE_URL))
    return {
      ids: {},
      note: "DATABASE_URL ne vise pas une base locale : identifiants des fiches non lus.",
    };
  const { prisma } = await import("@linkaffipro/db");
  try {
    const demo = { startsWith: "Démo" };
    const [campaign, channel, member, post, postAb, broadcast, broadcastAb, automation, batch] =
      await Promise.all([
        prisma.campaign
          .findFirst({
            where: { name: demo, status: "ACTIVE" },
            // La plus fournie (le plus de liens d'entrée), pour une fiche représentative.
            orderBy: [{ inviteLinks: { _count: "desc" } }, { createdAt: "asc" }],
            select: { id: true },
          })
          .then(
            (r) =>
              r ??
              prisma.campaign.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
          ),
        prisma.channel
          .findFirst({
            where: { title: demo, isTest: false },
            orderBy: [{ memberships: { _count: "desc" } }, { createdAt: "asc" }],
            select: { id: true },
          })
          .then(
            (r) =>
              r ??
              prisma.channel.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
          ),
        prisma.member
          .findFirst({
            where: { anonymizedAt: null, players: { some: { ftdAt: { not: null } } } },
            orderBy: { firstSeenAt: "asc" },
            select: { id: true },
          })
          .then(
            (r) =>
              r ??
              prisma.member.findFirst({ orderBy: { firstSeenAt: "desc" }, select: { id: true } }),
          ),
        prisma.post
          .findFirst({
            where: {
              isTemplate: false,
              status: "SENT",
              abGroupId: null,
              stats: { offerClicks: { gt: 0 } },
            },
            orderBy: { sentAt: "desc" },
            select: { id: true },
          })
          .then(
            (r) =>
              r ??
              prisma.post.findFirst({
                where: { isTemplate: false },
                orderBy: { createdAt: "desc" },
                select: { id: true },
              }),
          ),
        prisma.post.findFirst({
          where: { isTemplate: false, abGroupId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { abGroupId: true },
        }),
        prisma.broadcast
          .findFirst({
            where: { status: "SENT", abGroupId: null },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
          .then(
            (r) =>
              r ??
              prisma.broadcast.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
          ),
        prisma.broadcast.findFirst({
          where: { abGroupId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { abGroupId: true },
        }),
        prisma.automationRule.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
        prisma.importBatch.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
      ]);
    const ids: EntityIds = {};
    if (campaign) ids.campaign = campaign.id;
    if (channel) ids.channel = channel.id;
    if (member) ids.member = member.id;
    if (post) ids.post = post.id;
    if (postAb?.abGroupId) ids.postAbGroup = postAb.abGroupId;
    if (broadcast) ids.broadcast = broadcast.id;
    if (broadcastAb?.abGroupId) ids.broadcastAbGroup = broadcastAb.abGroupId;
    if (automation) ids.automation = automation.id;
    if (batch) ids.importBatch = batch.id;
    return { ids, note: null };
  } catch (err) {
    return {
      ids: {},
      note: `Base locale injoignable (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) : fiches sans identifiant.`,
    };
  } finally {
    await prisma.$disconnect();
  }
}

/** Pages de la passe, avec leur adresse concrète (null : fiche sans identifiant). */
export async function planTargets(
  pagesValue: string | null,
  o: { webDir: string; repoRoot: string; env: Env },
): Promise<{ targets: Target[]; notes: string[] }> {
  let routes: string[];
  if (pagesValue === null) routes = defaultRoutes(discoverAdminRoutes(o.webDir));
  else {
    const resolve = (p: string) =>
      existsSync(path.resolve(p)) ? path.resolve(p) : path.resolve(o.repoRoot, p);
    routes = resolvePagesValue(pagesValue, {
      exists: (p) => existsSync(resolve(p)),
      read: (p) => readFileSync(resolve(p), "utf8"),
    });
  }
  const notes: string[] = [];
  let ids: EntityIds = {};
  if (routes.some(isDynamicRoute)) {
    const loaded = await loadEntityIds(o.env);
    ids = loaded.ids;
    if (loaded.note) notes.push(loaded.note);
  }
  return { targets: routes.map((route) => ({ route, path: fillRoute(route, ids) })), notes };
}
