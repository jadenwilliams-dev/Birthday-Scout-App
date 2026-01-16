"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      // End Supabase session (middleware will see logged-out state)
      await supabase.auth.signOut();
    } catch {
      // ignore errors, still redirect
    }

    // IMPORTANT: do NOT clear localStorage
    // This is what preserves name / birthday / zip

    router.replace("/login");
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="rounded-lg border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
