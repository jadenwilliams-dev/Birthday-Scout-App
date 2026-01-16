// app/app/layout.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SignOutButton from "@/app/SignOutButton";
import { supabase } from "@/app/lib/supabaseClient";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(href + "/");

  const base =
    "rounded-xl px-4 py-2.5 text-[15px] font-medium transition border select-none";
  const inactive =
    "text-zinc-200 hover:bg-white/5 hover:text-white border-transparent";
  const activeCls =
    "border-emerald-200/25 bg-emerald-400/15 text-emerald-50 " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.14),0_0_24px_rgba(16,185,129,0.18)]";

  return (
    <Link href={href} className={`${base} ${active ? activeCls : inactive}`}>
      {label}
    </Link>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [displayName, setDisplayName] = useState("");

  // ✅ AUTH GUARD (Supabase only)
  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const { data } = await supabase.auth.getSession();
        const hasSession = !!data?.session;

        if (!hasSession) {
          router.replace("/login");
          return;
        }

        if (!cancelled) setReady(true);
      } catch {
        router.replace("/login");
      }
    }

    checkAuth();

    // Also react to auth changes (login/logout)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // ✅ Load name from DB profile (per-user)
  useEffect(() => {
    let alive = true;

    async function loadName() {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
          if (alive) setDisplayName("");
          return;
        }

        const { data: p, error } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;
        if (alive) setDisplayName((p?.display_name as string) || "");
      } catch {
        if (alive) setDisplayName("");
      }
    }

    loadName();
    const { data: sub } = supabase.auth.onAuthStateChange(() => loadName());

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const greeting = useMemo(() => {
    const n = displayName.trim();
    return n ? `Hey, ${n}` : "Hey";
  }, [displayName]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-black text-white grid place-items-center">
        <div className="text-zinc-300 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden overflow-y-visible">
      {/* FLOATING HEADER */}
      <header className="fixed top-0 inset-x-0 z-50 bg-transparent">
        <div className="mx-auto max-w-[1200px] px-6 pt-6 flex items-center justify-end gap-2">
          <nav className="flex items-center gap-1">
            <NavLink href="/app/deals" label="Deals" />
            <NavLink href="/app/plan" label="Plan" />
            <NavLink href="/app/profile" label="Profile" />

            <div className="ml-2 pl-2 border-l border-white/10">
              <SignOutButton />
            </div>
          </nav>
        </div>
      </header>

      {/* CONTENT */}
      <main className="relative min-h-screen pt-20 overflow-y-visible">
        {children}
      </main>
    </div>
  );
}
