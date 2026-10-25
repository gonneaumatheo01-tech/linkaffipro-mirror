/**
 * Phase 34, chantier A — logique de la route `POST /api/internal/site-ops` (testable sans Next) : taille, signature,
 * anti-rejeu, lecture du corps `{ op, input, actor, dryRun }`, exécution, réponse JSON `SiteOpResult`. Toute exception
 * → `{ ok: false, code: "unavailable" }` sans pile.
 */
import type { SiteOpResult } from "@linkaffipro/agents";
import type { SiteOpRequest } from "./execute";
import { siteOpsKey, verifySiteOpsRequest, type ReplayGuard } from "./endpoint-auth";

/** Un document CSV joint par Kevin tient largement dans 5 Mo ; au-delà, c'est un abus. */
export const SITE_OPS_MAX_BODY_BYTES = 5_000_000;

function json(body: SiteOpResult, status = 200): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleSiteOpsPost(
  req: Request,
  opts: { run(r: SiteOpRequest): Promise<SiteOpResult>; key?: Buffer; now?: number; replay?: ReplayGuard },
): Promise<Response> {
  try {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > SITE_OPS_MAX_BODY_BYTES) return json({ ok: false, code: "invalid", error: "Demande trop grosse." }, 413);
    const body = await req.text();
    if (body.length > SITE_OPS_MAX_BODY_BYTES) return json({ ok: false, code: "invalid", error: "Demande trop grosse." }, 413);
    let key: Buffer;
    try {
      key = opts.key ?? siteOpsKey();
    } catch {
      return json({ ok: false, code: "unavailable", error: "Entrée interne non configurée." }, 503);
    }
    const auth = verifySiteOpsRequest(req.headers, body, { key, now: opts.now, replay: opts.replay });
    if (!auth.ok) return json({ ok: false, code: "forbidden", error: "Signature refusée." }, 401);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ ok: false, code: "invalid", error: "Corps illisible." }, 400);
    }
    const o = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    if (!o || typeof o.op !== "string" || !o.actor || typeof o.actor !== "object")
      return json({ ok: false, code: "invalid", error: "Corps illisible." }, 400);
    const input = o.input && typeof o.input === "object" && !Array.isArray(o.input) ? (o.input as Record<string, unknown>) : {};
    const result = await opts.run({ op: o.op, input, actor: o.actor as SiteOpRequest["actor"], dryRun: o.dryRun === true });
    return json(result);
  } catch {
    return json({ ok: false, code: "unavailable", error: "Le site n'a pas pu faire l'opération." }, 500);
  }
}
