/**
 * Configure le proxy résidentiel pour la lecture des bookmakers.
 * Usage : node --env-file-if-exists=.env.local --import tsx scripts/set-proxy.ts <proxy-url>
 * En prod : railway ssh --service web -- node --import tsx scripts/set-proxy.ts <proxy-url>
 */
import { encrypt } from "@linkaffipro/core";
import { PrismaClient } from "@prisma/client";
import { parseProxyUrl } from "../packages/agents/src/providers/screenshot/session";

const proxyUrl = process.argv[2];
if (!proxyUrl) {
  console.error("Usage: ... set-proxy.ts <proxy-url>");
  process.exit(1);
}

const parsed = parseProxyUrl(proxyUrl);
if (!parsed) {
  console.error("Adresse de proxy invalide. Format attendu : http://user:pass@host:port");
  process.exit(1);
}

console.log(`Proxy valide : ${parsed.server} (user: ${parsed.username ? "oui" : "non"})`);

const prisma = new PrismaClient();

try {
  const settingKey = "agents.secret.providers.screenshotProxy";
  const stored = {
    enc: encrypt(proxyUrl.trim()),
    last4: proxyUrl.trim().slice(-4),
    updatedAt: new Date().toISOString(),
  };

  await prisma.setting.upsert({
    where: { key: settingKey },
    create: { key: settingKey, value: stored },
    update: { value: stored },
  });

  console.log("✅ Proxy enregistré (chiffré) dans la base.");

  // Vérification : relire et déchiffrer
  const { readScreenshotProxy } = await import("../packages/agents/src/providers/screenshot/session");
  const check = await readScreenshotProxy(prisma as any);
  if (check) {
    console.log(`✅ Vérification OK : ${check.server}`);
  } else {
    console.error("❌ La relecture a échoué.");
  }

  // Passer les 3 sites en readTarget "server"
  const result = await prisma.bookmakerSite.updateMany({
    where: { isActive: true },
    data: { readTarget: "server" },
  });
  console.log(`✅ ${result.count} site(s) passé(s) en lecture serveur.`);

} finally {
  await prisma.$disconnect();
}
