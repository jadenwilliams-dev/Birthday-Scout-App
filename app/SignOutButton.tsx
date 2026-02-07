// app/SignOutButton.tsx
// Client-side sign out button that logs the user out
// and clears user-specific cached data from localStorage

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Handles the full sign-out flow
  // Includes auth logout, cache cleanup, and redirect
  async function signOut() {
    if (busy) return; // Prevent double-clicks
    setBusy(true);

    try {
      // Invalidate the Supabase session
      await supabase.auth.signOut();
    } catch {
      // Ignore errors — user should still be redirected out
    }

    // Clear user-specific cached keys so another user
    // on the same browser doesn't see previous data
    try {
      localStorage.removeItem("bs_profile");
      localStorage.removeItem("bs_plan");
      localStorage.removeItem("bs_claimed");

      // These are intentionally left intact:
      // - start location
      // - ZIP fallback
      // - location prompt preference
      // Uncomment if you want a truly “clean slate” logout
      // localStorage.removeItem("bs_start");
      // localStorage.removeItem("bs_loc_prompt_off");
      // localStorage.removeItem("bs_zip");
    } catch {}

    // Redirect back to login and refresh app state
    router.replace("/login");
    router.refresh();
    setBusy(false);
  }

  return (
    // Simple inline button used in headers / menus
    <button
      onClick={signOut}
      disabled={busy}
      className="rounded-lg border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
