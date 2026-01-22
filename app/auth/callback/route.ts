// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Supabase sends ?code=... for PKCE email confirmation
  const code = url.searchParams.get("code");

  // Where to send the user after we exchange the code
  const next = url.searchParams.get("next") ?? "/app/deals";
  const redirectTo = new URL(next, url.origin);

  // If no code, just bounce them to login with an error
  if (!code) {
    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirectTo);
  }

  // We must set cookies on the response for the session to stick
  const response = NextResponse.redirect(redirectTo);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.headers.get("cookie")?.match(new RegExp(`${name}=([^;]+)`))?.[1];
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Exchange the code for a session (this is the key step)
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errUrl = new URL("/login", url.origin);
    errUrl.searchParams.set("error", "otp_expired_or_invalid");
    return NextResponse.redirect(errUrl);
  }

  return response;
}
