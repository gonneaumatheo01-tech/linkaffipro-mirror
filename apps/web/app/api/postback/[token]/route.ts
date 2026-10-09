import { after } from "next/server";
import { hashIp } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { handlePostback } from "@/lib/postback/apply";

export const dynamic = "force-dynamic";

/** Limite de débit en mémoire : 60 requêtes par minute et par jeton. */
const WINDOW_MS = 60_000;
const LIMIT = 60;
const hits = new Map<string, number[]>();
export function rateLimited(token: string, now = Date.now()): boolean {
  const arr = (hits.get(token) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) {
    hits.set(token, arr);
    return true;
  }
  arr.push(now);
  hits.set(token, arr);
  return false;
}

async function readParams(req: Request): Promise<Record<string, string | string[] | undefined>> {
  const url = new URL(req.url);
  const params: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of url.searchParams.entries()) params[k] = v;
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    try {
      if (ct.includes("application/json")) {
        const body = (await req.json()) as Record<string, unknown>;
        for (const [k, v] of Object.entries(body ?? {})) params[k] = Array.isArray(v) ? v.map(String) : v === null || v === undefined ? undefined : String(v);
      } else if (ct.includes("form")) {
        const fd = await req.formData();
        for (const [k, v] of fd.entries()) params[k] = typeof v === "string" ? v : undefined;
      } else {
        const text = await req.text();
        if (text.trim().startsWith("{")) {
          const body = JSON.parse(text) as Record<string, unknown>;
          for (const [k, v] of Object.entries(body ?? {})) params[k] = v === null || v === undefined ? undefined : String(v);
        } else if (text.includes("=")) {
          for (const [k, v] of new URLSearchParams(text).entries()) params[k] = v;
        }
      }
    } catch {
      /* corps illisible : on garde les paramètres d'URL */
    }
  }
  return params;
}

async function handle(req: Request, ctx: RouteContext<"/api/postback/[token]">) {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return Response.json({ ok: false, error: "unknown" }, { status: 404 });
  const endpoint = await prisma.postbackEndpoint.findUnique({ where: { token } });
  if (!endpoint) return Response.json({ ok: false, error: "unknown" }, { status: 404 });
  if (!endpoint.isActive) return Response.json({ ok: false, error: "inactive" }, { status: 403 });
  if (rateLimited(token)) return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });

  const params = await readParams(req);
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const ipHash = ip && process.env.IP_HASH_SALT ? hashIp(ip) : null;

  // Réponse immédiate ; traitement et journalisation après la réponse.
  after(async () => {
    await handlePostback(endpoint, params, ipHash);
  });
  return Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, ctx: RouteContext<"/api/postback/[token]">) {
  return handle(req, ctx);
}
export async function POST(req: Request, ctx: RouteContext<"/api/postback/[token]">) {
  return handle(req, ctx);
}
