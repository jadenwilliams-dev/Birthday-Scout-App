// app/auth/callback/route.ts
// Handles the redirect back from Supabase after email / magic-link authentication

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  // Parse the incoming callback URL
  const url = new URL(request.url);

  // Supabase sends ?code=... as part of the PKCE / magic-link flow
  // This code must be exchanged for a session
  const code = url.searchParams.get("code");

  // Optional "next" param lets us control where the user lands after login
  // Default is the deals page if nothing is provided
  const next = url.searchParams.get("next") ?? "/app/deals";
  const redirectTo = new URL(next, url.origin);

  // If there's no code, something went wrong or the link was malformed
  // Send the user back to login with an error flag
  if (!code) {
    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirectTo);
  }

  // Create the response up front
  // We need this so we can attach auth cookies to it
  const response = NextResponse.redirect(redirectTo);

  // Create a Supabase server client scoped to this request
  // We manually wire cookie handling so Supabase can persist the session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Read cookies from the incoming request
        get(name) {
          return request.headers
            .get("cookie")
            ?.match(new RegExp(`${name}=([^;]+)`))?.[1];
        },

        // Set cookies on the outgoing response
        // This is what actually stores the Supabase session
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },

        // Remove cookies (used internally by Supabase if needed)
        remove(name, options) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Exchange the one-time code for a Supabase session
  // This is the critical step that logs the user in
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  // If the code is expired or invalid, send the user back to login
  if (error) {
    const errUrl = new URL("/login", url.origin);
    errUrl.searchParams.set("error", "otp_expired_or_invalid");
    return NextResponse.redirect(errUrl);
  }

  // Success:
  // - Session cookies are set
  // - User is redirected to their intended destination
  return response;
}
