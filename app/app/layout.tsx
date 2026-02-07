"use client"; // Client component: uses hooks, localStorage, Supabase auth, and navigation

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SignOutButton from "@/app/SignOutButton";
import { supabase } from "@/app/lib/supabaseClient";

/**
 * localStorage keys shared across the app
 */
const AUTH_KEY = "bs_auth"; // Legacy/local auth fallback flag
const PROFILE_KEY = "bs_profile"; // Cached profile data (name, birthday, zip)
const PROFILE_UPDATED_EVENT = "bs_profile_updated"; // Broadcast when profile changes

/**
 * Navigation link with active state styling.
 * Highlights the current section based on pathname.
 */
function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();

  // Active if exact match OR nested route (e.g. /app/plan/*)
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

/**
 * App layout wrapper for all authenticated /app routes.
 * Handles:
 * - Auth guard
 * - Top navigation
 * - Profile greeting
 * - Page shell layout
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Used to block rendering until auth check finishes
  const [ready, setReady] = useState(false);

  // Display name shown in greeting (pulled from shared profile cache)
  const [displayName, setDisplayName] = useState("");

  /**
   * AUTH GUARD
   * - Primary source: Supabase session
   * - Optional fallback: local AUTH_KEY (legacy support)
   * - Redirects to /login if not authenticated
   */
  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        // 1) Check Supabase session (authoritative)
        const { data } = await supabase.auth.getSession();
        const hasSession = !!data?.session;

        // 2) Optional local fallback (in case you still use it)
        let hasLocal = false;
        try {
          hasLocal = localStorage.getItem(AUTH_KEY) === "1";
        } catch {}

        // If neither auth source exists → force login
        if (!hasSession && !hasLocal) {
          router.replace("/login");
          return;
        }

        // Only mark ready if component is still mounted
        if (!cancelled) setReady(true);
      } catch {
        router.replace("/login");
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /**
   * Profile listener
   * - Reads cached profile from localStorage
   * - Listens for PROFILE_UPDATED_EVENT so name updates instantly
   *   when user edits Profile page (no refresh needed)
   */
  useEffect(() => {
    function loadProfile() {
      try {
        const raw = localStorage.getItem(PROFILE_KEY);
        if (!raw) {
          setDisplayName("");
          return;
        }
        const p = JSON.parse(raw);
        setDisplayName(typeof p?.displayName === "string" ? p.displayName : "");
      } catch {
        setDisplayName("");
      }
    }

    // Initial load
    loadProfile();

    // Listen for profile updates (same tab + other tabs)
    const handler = () => loadProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    window.addEventListener("storage", handler);

    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  /**
   * Friendly greeting based on display name
   */
  const greeting = useMemo(() => {
    const n = displayName.trim();
    return n ? `Hey, ${n}` : "Hey";
  }, [displayName]);

  /**
   * Block UI until auth check finishes
   * Prevents flicker of protected pages
   */
  if (!ready) {
    return (
      <div className="min-h-screen bg-black text-white grid place-items-center">
        <div className="text-zinc-300 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden overflow-y-visible">
      {/* TOP NAV */}
      <header className="fixed top-0 inset-x-0 z-50 bg-transparent">
        <div className="mx-auto max-w-[1200px] px-6 pt-6 flex items-center justify-end gap-2">
          <nav className="flex items-center gap-1">
            <NavLink href="/app/deals" label="Deals" />
            <NavLink href="/app/plan" label="Plan" />
            <NavLink href="/app/profile" label="Profile" />

            {/* Sign out lives separately so nav links stay clean */}
            <div className="ml-2 pl-2 border-l border-white/10">
              <SignOutButton />
            </div>
          </nav>
        </div>
      </header>

      {/* PAGE CONTENT */}
      <main className="relative min-h-screen pt-20 overflow-y-visible">
        {children}
      </main>
    </div>
  );
}
