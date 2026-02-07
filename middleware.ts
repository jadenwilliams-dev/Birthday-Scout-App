// middleware.ts
// Gatekeeper for protected routes.
// Ensures users must be logged in to access /app/*,
// and redirects logged-in users away from /login and /.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  // Default response: let the request continue
  // (Supabase may still attach updated cookies to this response)
  let res = NextResponse.next();

  // Create a Supabase server client for middleware context.
  // We wire cookies through NextRequest/NextResponse so session refresh works properly.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Read cookies from the incoming request
        getAll() {
          return req.cookies.getAll();
        },

        // Write cookies to the outgoing response
        // Supabase uses this to persist/refresh sessions
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Ask Supabase if the user has a valid session
  // (If the session is expired, Supabase may refresh it via cookies)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Current path being requested (used for redirect rules below)
  const path = req.nextUrl.pathname;

  // 1) If logged OUT and trying to access /app/* -> redirect to /login
  // We preserve the intended destination using ?next=...
  if (path.startsWith("/app") && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // 2) If logged IN and hits /login -> redirect to Deals
  // Prevents logged-in users from seeing the auth screen again
  if (path === "/login" && session) {
    const url = req.nextUrl.clone();
    url.pathname = "/app/deals";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 3) (Optional) If logged IN and hits homepage -> redirect to Deals
  // Makes "/" behave like an app entry point once authenticated
  if (path === "/" && session) {
    const url = req.nextUrl.clone();
    url.pathname = "/app/deals";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // If no redirects were triggered, allow request through
  return res;
}

// Only run middleware on routes that need auth gating / redirect behavior
export const config = {
  matcher: ["/app/:path*", "/login", "/"],
};
