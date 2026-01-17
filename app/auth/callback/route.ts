import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // If Supabase didn't send a code, just go back to login
  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name, options) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  // This is the missing step that makes the confirm link "work"
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  // If code expired/invalid, send back to login with a clean flag
  if (error) {
    return NextResponse.redirect(new URL("/login?confirm=expired", url.origin));
  }

  // Success
  return NextResponse.redirect(new URL("/app/plan", url.origin));
}
