import {
  bookmakerRunnerNext,
  bookmakerRunnerResult,
  bookmakerRunnerStatus,
  checkCaptureRunnerToken,
  runnerNext,
  runnerResult,
  type BookmakerRunnerResultBody,
  type RunnerResultBody,
} from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";

export const dynamic = "force-dynamic";

/**
 * Mac du client (phase 23 `pnpm agents:capture-runner`, phase 35 `bookmaker-runner`) : la base n'étant pas exposée,
 * le Mac prend ici ses travaux (GET) et y dépose les résultats (POST). Jeton `Authorization: Bearer`.
 * - GET : captures de la phase 23 (`job`) ; avec `?read=1`, aussi les lectures des bookmakers (`readJob`) parmi les
 *   sortes annoncées (`kinds=page,fetch-api,…`), battement du Mac, attente longue `wait` (secondes, 25 au plus) ;
 * - GET `?status=1` : dernier battement du Mac (rien n'est pris) ;
 * - POST : résultat d'une capture (`id`) ou d'une lecture (`readJobId`), session rendue rechiffrée.
 */
async function authorized(req: Request): Promise<boolean> {
  return checkCaptureRunnerToken(prisma, req.headers.get("authorization"));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json({ error: "jeton refusé" }, 401);
  const q = new URL(req.url).searchParams;
  if (q.get("status") === "1") return json(await bookmakerRunnerStatus(prisma));
  const job = await runnerNext(prisma, "mac");
  if (job || q.get("read") !== "1") return json({ job, readJob: null });
  const kinds = (q.get("kinds") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const wait = Math.min(Math.max(Number(q.get("wait") ?? 0) || 0, 0), 25);
  const readJob = await bookmakerRunnerNext(prisma, { kinds, version: q.get("v"), visible: q.get("visible") === "1", waitMs: wait * 1000 });
  return json({ job: null, readJob });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json({ error: "jeton refusé" }, 401);
  let body: RunnerResultBody & BookmakerRunnerResultBody;
  try {
    body = (await req.json()) as RunnerResultBody & BookmakerRunnerResultBody;
  } catch {
    return json({ error: "corps JSON invalide" }, 400);
  }
  const r = body.readJobId !== undefined ? await bookmakerRunnerResult(prisma, body) : await runnerResult(prisma, body);
  return json(r, r.ok ? 200 : 400);
}
