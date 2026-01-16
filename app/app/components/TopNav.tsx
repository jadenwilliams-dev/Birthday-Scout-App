"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={
        "rounded-xl px-3 py-2 text-sm transition " +
        (active
          ? "bg-white/10 text-white border border-white/10"
          : "text-zinc-300 hover:bg-white/5 hover:text-white border border-transparent")
      }
    >
      {label}
    </Link>
  );
}

export default function TopNav() {
  return (
    <div className="sticky top-0 z-50 border-b border-white/10 bg-black/70 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            🎉
          </span>
          <span className="font-semibold tracking-tight">BirthdayScout</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/deals" label="Deals" />
          <NavLink href="/plan" label="Plan" />
          <NavLink href="/profile" label="Profile" />
        </nav>
      </div>
    </div>
  );
}
