/**
 * Script ponctuel : réactive les 3 sites de bookmakers pour la lecture par le Mac (VPN).
 * Décision du client du 25 octobre 2026.
 *
 * Usage : cd "Platefome de statistiques" && npx tsx scripts/reactivate-bookmakers.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SITES = ["celsius", "sportaza", "betportal"];
const TARGET_STATE_PREFIX = "bookmakers.target.";

async function main() {
  console.log("=== Réactivation des bookmakers (lecture par le Mac / VPN) ===\n");

  for (const key of SITES) {
    const site = await prisma.bookmakerSite.findUnique({ where: { key } });
    if (!site) {
      console.log(`⚠️  Site « ${key} » introuvable en base, ignoré.`);
      continue;
    }

    console.log(`📌 ${site.label} (${key})`);
    console.log(`   Avant : isActive=${site.isActive}, readTarget=${site.readTarget}, status=${site.status}`);
    console.log(`   Raison : ${site.statusReason ?? "(aucune)"}`);

    // 1. Réactiver le site, forcer la lecture par le Mac, remettre à NEW
    await prisma.bookmakerSite.update({
      where: { key },
      data: {
        isActive: true,
        readTarget: "mac",
        status: "NEW",
        statusReason: "lecture par le Mac (VPN) — décision du client du 25 oct. 2026",
      },
    });

    // 2. Écrire l'état de la cible (bascule manuelle, pas auto → pas de réessai serveur hebdomadaire)
    const now = new Date().toISOString();
    const stateKey = `${TARGET_STATE_PREFIX}${key}`;
    await prisma.setting.upsert({
      where: { key: stateKey },
      create: {
        key: stateKey,
        value: {
          auto: false,
          switchedAt: now,
          lastServerTryAt: now,
          reason: "geo_blocked",
        } as any,
      },
      update: {
        value: {
          auto: false,
          switchedAt: now,
          lastServerTryAt: now,
          reason: "geo_blocked",
        } as any,
      },
    });

    console.log(`   ✅ Après : isActive=true, readTarget=mac, status=NEW\n`);
  }

  // Vérification
  const sites = await prisma.bookmakerSite.findMany({
    where: { key: { in: SITES } },
    select: { key: true, label: true, isActive: true, readTarget: true, status: true, statusReason: true },
  });
  console.log("=== État final ===");
  for (const s of sites) {
    console.log(`  ${s.label}: active=${s.isActive}, target=${s.readTarget}, status=${s.status}`);
  }
  console.log("\n✅ Terminé. Les sites sont prêts pour la lecture par le Mac.");
  console.log("   → Vérifiez que le VPN Norvège est actif sur le Mac.");
  console.log("   → Vérifiez que le runner Mac tourne : launchctl list com.linkaffipro.bookmaker-runner");
  console.log("   → Testez via Kevin : « teste les bookmakers »");
}

main()
  .catch((err) => {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
