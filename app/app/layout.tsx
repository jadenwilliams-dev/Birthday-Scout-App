"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SignOutButton from "@/app/SignOutButton";

const AUTH_KEY = "bs_auth";
const PROFILE_KEY = "bs_profile";
const PROFILE_UPDATED_EVENT = "bs_profile_updated";

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

  // ✅ run once on mount; don't depend on pathname
  useEffect(() => {
    let authed = false;
    try {
      authed = localStorage.getItem(AUTH_KEY) === "1";
    } catch {
      authed = false;
    }

    if (!authed) {
      router.replace("/login");
      return;
    }

    setReady(true);
  }, [router]);

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

    loadProfile();

    const handler = () => loadProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    window.addEventListener("storage", handler);

    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const greeting = useMemo(() => {
    const n = displayName.trim();
    return n ? `Hey, ${n}` : "Hey";
  }, [displayName]);

  // ✅ don't return null (this is what made it look "gone")
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

      {/* CONTENT — header-safe but overflow-friendly */}
      <main className="relative min-h-screen pt-20 overflow-y-visible">
        {children}
      </main>
    </div>
  );
}
