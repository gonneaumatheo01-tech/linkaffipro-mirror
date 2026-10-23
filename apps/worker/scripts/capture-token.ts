/**
 * Jeton du `capture-runner` (phase 23). À lancer DANS le conteneur du site (la base de production n'est pas exposée) :
 *   railway ssh --service web -- pnpm --silent agents:capture-token [--rotate]
 * Affiche une seule ligne `CAPTURE_RUNNER_TOKEN=…`, lue par `pnpm agents:capture-runner` qui la range dans `.env.local`
 * (jamais affichée par le runner).
 */
import { issueCaptureRunnerToken } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";

const token = await issueCaptureRunnerToken(prisma, { rotate: process.argv.includes("--rotate") });
process.stdout.write(`CAPTURE_RUNNER_TOKEN=${token}\n`);
await prisma.$disconnect();
