import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { decideRoute } from "./lib/routing";

const { auth } = NextAuth(authConfig);

/**
 * Proxy (ex-middleware) :
 * 1. le trafic du domaine de tracking (go.goolink.eu) est réécrit vers /r/… sans authentification ;
 * 2. les chemins publics passent ;
 * 3. tout le reste exige une session, sinon redirection vers /login.
 */
export default async function proxy(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const decision = decideRoute(host, request.nextUrl.pathname, process.env.TRACKING_HOST);

  if (decision.kind === "tracking") {
    const url = request.nextUrl.clone();
    url.pathname = decision.rewriteTo;
    return NextResponse.rewrite(url);
  }
  if (decision.kind === "public") return NextResponse.next();

  const session = await auth();
  if (!session?.user) {
    const login = new URL("/login", request.nextUrl.origin);
    const back = request.nextUrl.pathname + request.nextUrl.search;
    if (back !== "/") login.searchParams.set("callbackUrl", back);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
