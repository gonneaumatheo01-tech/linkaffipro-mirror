import { after } from "next/server";
import { recordEvent } from "@linkaffipro/db";
import { buildRedirectEvent, redirectResponse, resolveTarget } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** Redirection goolink.eu : 302 immédiat, journalisation après la réponse. */
export async function GET(req: Request, ctx: RouteContext<"/r/[[...slug]]">) {
  const { slug } = await ctx.params;
  const resolved = resolveTarget(slug ?? []);
  const payload = buildRedirectEvent(req, resolved);
  after(async () => {
    await recordEvent({ type: "tracking.redirect", payload });
  });
  return redirectResponse(resolved.target);
}

export async function HEAD(req: Request, ctx: RouteContext<"/r/[[...slug]]">) {
  const { slug } = await ctx.params;
  return redirectResponse(resolveTarget(slug ?? []).target);
}
