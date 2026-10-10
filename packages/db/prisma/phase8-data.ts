// Reprise des données de production pour la phase 8. Idempotente et réconciliante : on peut la relancer sans risque,
// même pendant que le worker tourne (voir 1 : chaque écart est relu dans une transaction à instantané unique).
//   railway ssh --service web -- pnpm db:phase8
//
// 1) NGR daté, une seule source :
//    - les « revenue » / « ngr » importés de player_events deviennent des événements bruts (OTHER) : seules les variations
//      des instantanés revshare (et les postbacks directs) portent du NGR ;
//    - l'ancienne reprise (un événement du cumul complet, sans identifiant, parfois daté à l'import) est retirée ;
//    - pour chaque joueur, écart = Player.ngr − somme de ses événements NGR ; s'il n'est pas nul, un événement de l'écart
//      (identifiant `phase8-backfill:<joueur>`, mis à jour s'il existe déjà) daté de la dernière activité Link Affi
//      (`lastEventAt`), à défaut de l'inscription (`registeredAt`), jamais de la date d'import ou de mise à jour.
//      Un premier balayage repère les joueurs en écart ; pour chacun, le cumul et la somme sont relus ensemble dans une
//      transaction REPEATABLE READ avant d'écrire : une variation enregistrée entre-temps par la synchro (événement et
//      cumul dans sa propre transaction) n'est jamais reprise une seconde fois.
// 2) Catégories : c'est le client qui crée les siennes. Les 7 catégories créées d'office (bonus, preuve-de-gains, teasing,
//    rappel, information, evenement, sondage) sont retirées des modèles et des messages de test (canal de test, brouillon
//    ou échec), puis supprimées si aucun vrai message du client (envoyé ou programmé, hors canal de test) ne les porte.
//    Leurs identifiants sont retirés des conditions d'automatisation et des segments d'envoi ; une automatisation ou un
//    envoi programmé dont la liste de catégories devient vide est mis à l'arrêt (sinon il viserait tout le monde).
//    Ce nettoyage ne tourne qu'une fois (Setting `phase8.officeCategories` écrit à la fin) et ne vise jamais une
//    catégorie créée ou modifiée par l'équipe (trace dans le journal des actions), même si elle porte un nom d'origine
//    (« Bonus », « Rappel »…) : le site lui donne alors le même identifiant court que la catégorie d'office.
// 3) Recalcul complet des statistiques journalières : tâche `stats` { type: "daily", full: true } si REDIS_URL est présent.
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";

export const OFFICE_CATEGORY_SLUGS = [
  "bonus",
  "preuve-de-gains",
  "teasing",
  "rappel",
  "information",
  "evenement",
  "sondage",
];
export const BACKFILL_PREFIX = "phase8-backfill:";
/** Setting écrit à la fin du premier nettoyage des catégories d'office réussi : les passages suivants n'y touchent plus. */
export const CATEGORIES_DONE_KEY = "phase8.officeCategories";

type Db = PrismaClient;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type NgrReport = {
  converted: number;
  removedOld: number;
  created: number;
  adjusted: number;
  undatable: number;
  players: number;
};

/** NGR daté : une seule source, et somme des événements NGR = cumul `Player.ngr` pour chaque joueur. */
export async function reconcileNgr(db: Db): Promise<NgrReport> {
  // a) « revenue » / « ngr » venus de player_events (ligne Link Affi brute, sans `source`) → OTHER.
  const legacy = await db.playerEvent.findMany({
    where: {
      type: "NGR",
      OR: [
        { raw: { path: ["event"], equals: "revenue" } },
        { raw: { path: ["event"], equals: "ngr" } },
      ],
    },
    select: { id: true, raw: true },
  });
  const fromPlayerEvents = legacy
    .filter(
      (e) =>
        !(e.raw && typeof e.raw === "object" && "source" in (e.raw as Record<string, unknown>)),
    )
    .map((e) => e.id);
  const converted = fromPlayerEvents.length
    ? (
        await db.playerEvent.updateMany({
          where: { id: { in: fromPlayerEvents } },
          data: { type: "OTHER" },
        })
      ).count
    : 0;

  // b) Ancienne reprise (cumul complet sur une seule date, sans identifiant) : retirée, l'écart est recréé ci-dessous.
  const removedOld = (
    await db.playerEvent.deleteMany({
      where: {
        type: "NGR",
        externalId: null,
        raw: { path: ["source"], equals: "phase8-backfill" },
      },
    })
  ).count;

  // c) Réconciliation joueur par joueur.
  const sums = await db.playerEvent.groupBy({
    by: ["playerId"],
    where: { type: "NGR" },
    _sum: { amount: true },
  });
  const sumBy = new Map(sums.map((s) => [s.playerId, Number(s._sum.amount ?? 0)]));
  const players = await db.player.findMany({
    select: { id: true, ngr: true, lastEventAt: true, registeredAt: true },
  });
  let created = 0;
  let adjusted = 0;
  let undatable = 0;
  for (const p of players) {
    // Balayage : la somme et le cumul ci-dessus sont lus à deux moments différents, l'écart n'est qu'un indice.
    if (round2(Number(p.ngr) - (sumBy.get(p.id) ?? 0)) === 0) continue;
    const result = await reconcilePlayer(db, p.id);
    if (result === "created") created++;
    else if (result === "adjusted") adjusted++;
    else if (result === "undatable") undatable++;
  }
  return { converted, removedOld, created, adjusted, undatable, players: players.length };
}

/**
 * Réconcilie un joueur : cumul et somme des événements NGR relus dans une même transaction REPEATABLE READ (un seul
 * instantané), puis événement d'écart créé ou ajusté. Une transaction concurrente de la synchro (événement + cumul) est
 * soit entièrement visible, soit entièrement invisible : l'écart n'inclut jamais sa variation. Conflit d'écriture
 * (deux reprises en même temps) : nouvel essai, trois fois au plus.
 */
async function reconcilePlayer(
  db: Db,
  playerId: string,
): Promise<"none" | "created" | "adjusted" | "undatable"> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const p = await tx.player.findUnique({
            where: { id: playerId },
            select: { ngr: true, lastEventAt: true, registeredAt: true },
          });
          if (!p) return "none" as const;
          const agg = await tx.playerEvent.aggregate({
            where: { playerId, type: "NGR" },
            _sum: { amount: true },
          });
          const gap = round2(Number(p.ngr) - Number(agg._sum.amount ?? 0));
          if (gap === 0) return "none" as const;
          const occurredAt = p.lastEventAt ?? p.registeredAt;
          if (!occurredAt) return "undatable" as const;
          const externalId = `${BACKFILL_PREFIX}${playerId}`;
          const existing = await tx.playerEvent.findUnique({
            where: { playerId_externalId: { playerId, externalId } },
            select: { id: true, amount: true },
          });
          if (existing) {
            await tx.playerEvent.update({
              where: { id: existing.id },
              data: { amount: round2(Number(existing.amount ?? 0) + gap), occurredAt },
            });
            return "adjusted" as const;
          }
          await tx.playerEvent.create({
            data: {
              playerId,
              type: "NGR",
              amount: gap,
              currency: "EUR",
              occurredAt,
              externalId,
              raw: {
                source: "phase8-backfill",
                reason: "écart entre le cumul et la somme des événements NGR",
              },
            },
          });
          return "created" as const;
        },
        { isolationLevel: "RepeatableRead" },
      );
    } catch (e) {
      const code = (e as { code?: string }).code;
      // P2034 : conflit d'écriture ou interblocage ; P2002 : écart créé au même moment par une autre reprise.
      if (attempt < 3 && (code === "P2034" || code === "P2002")) continue;
      throw e;
    }
  }
}

export type CategoryReport = {
  detached: number;
  removed: string[];
  kept: string[];
  rulesUpdated: number;
  rulesStopped: number;
  broadcastsUpdated: number;
  broadcastsStopped: number;
  /** Catégories au nom d'origine mais créées ou modifiées par l'équipe : jamais touchées. */
  clientOwned: string[];
  /** Date du premier nettoyage réussi quand ce passage n'a rien fait (nettoyage déjà fait). */
  alreadyDoneAt?: string;
};

/** Retire `ids` d'une liste JSON ; renvoie la nouvelle liste, ou null si rien ne change. */
function without(list: unknown, ids: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(list)) return null;
  const next = list.filter((x) => !(typeof x === "string" && ids.has(x)));
  return next.length === list.length ? null : (next as string[]);
}

/**
 * Catégories créées d'office : retirées des modèles et des messages de test, puis supprimées si plus rien de réel ne les
 * porte. Une seule fois : les passages suivants ne touchent plus à aucune catégorie (celles qui restent sont au client).
 * Une catégorie au nom d'origine créée ou modifiée par l'équipe (trace `MessageCategory` dans le journal des actions)
 * n'est jamais visée.
 */
export async function cleanOfficeCategories(db: Db): Promise<CategoryReport> {
  const report: CategoryReport = {
    detached: 0,
    removed: [],
    kept: [],
    rulesUpdated: 0,
    rulesStopped: 0,
    broadcastsUpdated: 0,
    broadcastsStopped: 0,
    clientOwned: [],
  };
  const done = await db.setting.findUnique({ where: { key: CATEGORIES_DONE_KEY } });
  if (done) {
    const at = (done.value as { at?: unknown } | null)?.at;
    report.alreadyDoneAt = typeof at === "string" ? at : done.updatedAt.toISOString();
    return report;
  }
  const candidates = await db.messageCategory.findMany({
    where: { slug: { in: OFFICE_CATEGORY_SLUGS } },
    select: { id: true, name: true },
  });
  const touched = candidates.length
    ? await db.auditLog.findMany({
        where: { entityType: "MessageCategory", entityId: { in: candidates.map((c) => c.id) } },
        select: { entityId: true },
        distinct: ["entityId"],
      })
    : [];
  const owned = new Set(touched.map((t) => t.entityId));
  const cats = candidates.filter((c) => !owned.has(c.id));
  report.clientOwned = candidates.filter((c) => owned.has(c.id)).map((c) => c.name);
  await cleanCategories(db, cats, report);
  // Fin du nettoyage (même vide) : les catégories qui restent, ou créées ensuite avec le même nom, sont au client.
  const value = {
    at: new Date().toISOString(),
    removed: report.removed,
    kept: report.kept,
    clientOwned: report.clientOwned,
  };
  await db.setting.upsert({
    where: { key: CATEGORIES_DONE_KEY },
    create: { key: CATEGORIES_DONE_KEY, value },
    update: { value },
  });
  return report;
}

async function cleanCategories(
  db: Db,
  cats: Array<{ id: string; name: string }>,
  report: CategoryReport,
): Promise<void> {
  if (cats.length === 0) return;
  const ids = cats.map((c) => c.id);
  report.detached = (
    await db.post.updateMany({
      where: {
        categoryId: { in: ids },
        OR: [
          { isTemplate: true },
          { channel: { isTest: true } },
          { status: { in: ["DRAFT", "FAILED"] } },
        ],
      },
      data: { categoryId: null },
    })
  ).count;
  const removed = new Set<string>();
  for (const c of cats) {
    const real = await db.post.count({
      where: {
        categoryId: c.id,
        isTemplate: false,
        status: { in: ["SENT", "SCHEDULED"] },
        channel: { isTest: false },
      },
    });
    if (real > 0) {
      report.kept.push(`${c.name} (${real} message(s) du client)`);
      continue;
    }
    await db.post.updateMany({ where: { categoryId: c.id }, data: { categoryId: null } });
    await db.messageCategory.delete({ where: { id: c.id } });
    removed.add(c.id);
    report.removed.push(c.name);
  }
  if (removed.size === 0) return;

  // Automatisations : une liste de catégories vidée élargirait la règle à toutes les catégories → règle mise à l'arrêt.
  for (const r of await db.automationRule.findMany({
    select: { id: true, conditions: true, isActive: true },
  })) {
    const cond = (
      r.conditions && typeof r.conditions === "object" && !Array.isArray(r.conditions)
        ? r.conditions
        : {}
    ) as Record<string, unknown>;
    const next = without(cond.categoryIds, removed);
    if (!next) continue;
    const stop = next.length === 0 && r.isActive;
    const conditions = { ...cond } as Record<string, unknown>;
    if (next.length) conditions.categoryIds = next;
    else delete conditions.categoryIds;
    await db.automationRule.update({
      where: { id: r.id },
      data: {
        conditions: conditions as Prisma.InputJsonValue,
        ...(stop ? { isActive: false } : {}),
      },
    });
    report.rulesUpdated++;
    if (stop) report.rulesStopped++;
  }
  // Envois groupés : même raison ; un envoi programmé dont la liste se vide repasse en brouillon.
  for (const b of await db.broadcast.findMany({
    where: { status: { not: "SENDING" } },
    select: { id: true, segment: true, status: true },
  })) {
    const seg = (
      b.segment && typeof b.segment === "object" && !Array.isArray(b.segment) ? b.segment : {}
    ) as Record<string, unknown>;
    const next = without(seg.clickedCategoryIds, removed);
    if (!next) continue;
    const stop = next.length === 0 && b.status === "SCHEDULED";
    const segment = { ...seg } as Record<string, unknown>;
    if (next.length) segment.clickedCategoryIds = next;
    else delete segment.clickedCategoryIds;
    await db.broadcast.update({
      where: { id: b.id },
      data: { segment: segment as Prisma.InputJsonValue, ...(stop ? { status: "DRAFT" } : {}) },
    });
    report.broadcastsUpdated++;
    if (stop) report.broadcastsStopped++;
  }
}

/** Enfile le recalcul complet des statistiques journalières (tâche lue par le worker). */
async function enqueueFullRecompute(): Promise<string> {
  if (!process.env.REDIS_URL) {
    return "REDIS_URL absente : recalcul complet NON lancé. Lancez-le depuis le Tableau de bord → onglet Campagnes → « Recalculer les statistiques ».";
  }
  // Import par chemin calculé : le paquet db ne dépend pas de la file (qui dépend de lui) ; le script tourne dans le
  // monorepo complet (conteneur web), où packages/queue et ses dépendances sont présents.
  const spec = new URL("../../queue/src/client.ts", import.meta.url).href;
  const queue = (await import(spec)) as {
    enqueue: (
      name: string,
      data: Record<string, unknown>,
      opts?: { jobId?: string },
    ) => Promise<unknown>;
    closeQueues: () => Promise<void>;
  };
  try {
    await queue.enqueue(
      "stats",
      { type: "daily", full: true },
      { jobId: `stats-daily-full-phase8-${Date.now()}` },
    );
    return "recalcul complet des statistiques journalières enfilé (le worker le traite dans la minute).";
  } finally {
    await queue.closeQueues();
  }
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const ngr = await reconcileNgr(db);
    console.log(
      `[phase8] NGR daté : ${ngr.players} joueur(s) vérifié(s) ; ${ngr.converted} « revenue » de player_events passé(s) en événement brut ; ${ngr.removedOld} ancienne(s) reprise(s) retirée(s) ; ${ngr.created} écart(s) créé(s), ${ngr.adjusted} ajusté(s) ; ${ngr.undatable} joueur(s) sans date (ni activité ni inscription) laissé(s) de côté.`,
    );
    const cats = await cleanOfficeCategories(db);
    if (cats.alreadyDoneAt)
      console.log(
        `[phase8] catégories d'office : nettoyage déjà fait le ${cats.alreadyDoneAt}, aucune catégorie touchée.`,
      );
    else
      console.log(
        `[phase8] catégories d'office : ${cats.detached} modèle(s) ou message(s) de test détaché(s) ; supprimées : ${cats.removed.join(", ") || "aucune"}.`,
      );
    for (const k of cats.kept) console.log(`[phase8] catégorie conservée : ${k}.`);
    for (const k of cats.clientOwned)
      console.log(`[phase8] catégorie « ${k} » créée ou modifiée par l'équipe : non touchée.`);
    if (cats.rulesUpdated || cats.broadcastsUpdated)
      console.log(
        `[phase8] ${cats.rulesUpdated} automatisation(s) et ${cats.broadcastsUpdated} envoi(s) nettoyé(s) ; mis à l'arrêt : ${cats.rulesStopped} automatisation(s), ${cats.broadcastsStopped} envoi(s) programmé(s) repassé(s) en brouillon.`,
      );
    await db.auditLog.create({
      data: {
        action: "maintenance.phase8_data",
        entityType: "System",
        metadata: { ngr, categories: cats } as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(`[phase8] ${await enqueueFullRecompute()}`);
  } finally {
    await db.$disconnect();
  }
}

// Exécuté directement (pnpm db:phase8) ; importé par les tests sans rien lancer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
