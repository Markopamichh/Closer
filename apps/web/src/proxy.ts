import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Optimistic check only: bounce requests without a session cookie to /login early.
 * It does not validate the session — every protected layout asks the API, which does.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: "closer" })) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/select-org", "/accept-invitation/:path*"],
};
