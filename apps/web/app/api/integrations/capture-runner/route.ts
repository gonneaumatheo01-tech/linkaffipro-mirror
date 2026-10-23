import { checkCaptureRunnerToken, runnerNext, runnerResult, type RunnerResultBody } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";

export const dynamic = "force-dynamic";

/**
 * Captures faites depuis le Mac du client (phase 23, `pnpm agents:capture-runner`) : la base n'étant pas exposée,
 * le Mac prend ici les demandes « mac » (GET) et y dépose les résultats (POST). Jeton `Authorization: Bearer`.
 */
async function authorized(req: Request): Promise<boolean> {
  return checkCaptureRunnerToken(prisma, req.headers.get("authorization"));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json({ error: "jeton refusé" }, 401);
  const job = await runnerNext(prisma, "mac");
  return json({ job });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json({ error: "jeton refusé" }, 401);
  let body: RunnerResultBody;
  try {
    body = (await req.json()) as RunnerResultBody;
  } catch {
    return json({ error: "corps JSON invalide" }, 400);
  }
  const r = await runnerResult(prisma, body);
  return json(r, r.ok ? 200 : 400);
}
