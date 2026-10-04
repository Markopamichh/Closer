import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchWidgetConfig, frameAncestors } from "@/lib/widget";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * The embed page is the one page other sites may frame, and only the sites its owner
 * listed: the header depends on the widget, so it is set here per request (next.config
 * headers are static). A missing or disabled widget gets the dashboard's 'self' only.
 */
async function embed(request: NextRequest) {
  const publicKey = request.nextUrl.pathname.split("/")[2] ?? "";
  const config = await fetchWidgetConfig(apiUrl, publicKey).catch(() => null);
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", frameAncestors(config?.allowedOrigins ?? []));
  return response;
}

/**
 * Dashboard routes: optimistic check only, bounce requests without a session cookie to
 * /login early. It does not validate the session — every protected layout asks the API.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/embed/")) return embed(request);
  if (!getSessionCookie(request, { cookiePrefix: "closer" })) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/select-org", "/accept-invitation/:path*", "/embed/:path*"],
};
