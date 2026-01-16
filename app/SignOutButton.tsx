// app/SignOutButton.tsx
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
      await supabase.auth.signOut();
    } catch {
      // ignore errors
    }

    // ✅ Clear user-specific cached keys so another user on same browser doesn't see your data
    try {
      localStorage.removeItem("bs_profile");
      localStorage.removeItem("bs_plan");
      localStorage.removeItem("bs_claimed");
      // keep these if you want:
      // localStorage.removeItem("bs_start");
      // localStorage.removeItem("bs_loc_prompt_off");
      // localStorage.removeItem("bs_zip");
    } catch {}

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
