// Enregistre les bots dont les jetons sont dans TELEGRAM_BOT_TOKEN_<UNIVERS> (CASINO, SPORTS, DATING).
// Même code que la page Bots de l'interface. N'affiche jamais les jetons.
import { VERTICALS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { registerBotFromToken } from "../src/service";

async function main() {
  let count = 0;
  for (const vertical of VERTICALS) {
    const token = process.env[`TELEGRAM_BOT_TOKEN_${vertical}`];
    if (!token) continue;
    count++;
    try {
      const r = await registerBotFromToken(token, vertical);
      console.log(`[${vertical}] @${r.username} ${r.created ? "créé" : "mis à jour"} — webhook : ${r.webhook.url}${r.webhook.last_error_message ? ` (erreur : ${r.webhook.last_error_message})` : " (ok)"}`);
    } catch (err) {
      console.error(`[${vertical}] échec :`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }
  if (count === 0) console.log("Aucune variable TELEGRAM_BOT_TOKEN_* trouvée.");
}

main().finally(() => prisma.$disconnect());
