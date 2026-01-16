import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = req.nextUrl.pathname;

  // 1) If logged OUT and trying to access /app/* -> send to /login
  if (path.startsWith("/app") && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // 2) If logged IN and hits /login -> send to current Deals page
  if (path === "/login" && session) {
    const url = req.nextUrl.clone();
    url.pathname = "/app/deals";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 3) (Optional) If logged IN and hits homepage -> send to Deals
  if (path === "/" && session) {
    const url = req.nextUrl.clone();
    url.pathname = "/app/deals";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/"],
};
