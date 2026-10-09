import { after } from "next/server";
import { buildRedirectEvent, logRedirect, redirectResponse, resolveTarget } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** Redirection go.goolink.eu : une requête en base, 302 immédiat, journalisation après la réponse. */
export async function GET(req: Request, ctx: RouteContext<"/r/[[...slug]]">) {
  const { slug } = await ctx.params;
  const resolved = await resolveTarget(slug ?? []);
  const payload = buildRedirectEvent(req, resolved);
  after(async () => {
    await logRedirect(payload);
  });
  return redirectResponse(resolved.target);
}

export async function HEAD(req: Request, ctx: RouteContext<"/r/[[...slug]]">) {
  const { slug } = await ctx.params;
  const resolved = await resolveTarget(slug ?? []);
  return redirectResponse(resolved.target);
}
