// Reprise des données de production pour la phase 8 (idempotent, à lancer une fois après le déploiement :
//   railway ssh --service web -- pnpm db:phase8
// 1) NGR daté : pour chaque joueur avec un NGR cumulé mais aucun événement NGR, un événement à la date réelle connue
//    (dernier instantané Link Affi `lastEventAt`), pour que les statistiques par période cessent d'utiliser la date d'import.
// 2) Catégories : plus de catégories créées d'office ; celles qui ne portent que des modèles ou aucun message sont retirées
//    (les 63 modèles gardent leur thème dans leur nom) ; une catégorie portée par un vrai message du client est conservée.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function backfillNgr() {
  const players = await prisma.player.findMany({ where: { ngr: { not: 0 }, events: { none: { type: "NGR" } } }, select: { id: true, ngr: true, lastEventAt: true, updatedAt: true } });
  let created = 0;
  for (const p of players) {
    await prisma.playerEvent.create({ data: { playerId: p.id, type: "NGR", amount: p.ngr, currency: "EUR", occurredAt: p.lastEventAt ?? p.updatedAt, raw: { source: "phase8-backfill" } } });
    created++;
  }
  console.log(`[phase8] NGR daté : ${created} événement(s) créé(s) pour ${players.length} joueur(s).`);
}

async function cleanCategories() {
  const cats = await prisma.messageCategory.findMany({ select: { id: true, name: true, posts: { select: { id: true, isTemplate: true } } } });
  let removed = 0;
  for (const c of cats) {
    const real = c.posts.filter((p) => !p.isTemplate);
    if (real.length > 0) {
      console.log(`[phase8] catégorie « ${c.name} » conservée (${real.length} message(s) du client).`);
      continue;
    }
    await prisma.post.updateMany({ where: { categoryId: c.id }, data: { categoryId: null } });
    await prisma.messageCategory.delete({ where: { id: c.id } });
    removed++;
  }
  console.log(`[phase8] catégories retirées : ${removed} sur ${cats.length}.`);
}

try {
  await backfillNgr();
  await cleanCategories();
} finally {
  await prisma.$disconnect();
}
