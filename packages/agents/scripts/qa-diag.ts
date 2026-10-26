/**
 * `pnpm qa:diag` (phase 30) : accès de la clé IA de la plateforme à `claude-fable-5-1`, appel test, latence, réponse
 * JSON, dépense du mois face au plafond. Code 0 si tout est prêt, 1 sinon. En production (la base n'est pas exposée) :
 * `railway ssh --service web -- pnpm qa:diag`.
 */
import { prisma } from "@linkaffipro/db";
import { formatQaDiag, runQaDiag } from "../src/qa/diag";

const result = await runQaDiag({ prisma: process.env.DATABASE_URL ? prisma : null }).catch((err: unknown) => ({
  ok: false,
  latencyMs: null,
  rows: [{ label: "Diagnostic", ok: false, detail: (err as Error).message.slice(0, 200) }],
}));
console.log(formatQaDiag(result));
await prisma.$disconnect().catch(() => undefined);
process.exit(result.ok ? 0 : 1);
