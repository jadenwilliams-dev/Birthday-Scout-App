"use client";
// Client component because it reads/writes localStorage and uses React state/effects
// to track whether a deal has been marked as claimed.

import { useEffect, useState } from "react";

// Button that lets the user mark a deal as "claimed" or undo that action.
// Claimed deals are persisted in localStorage so the state survives refreshes.
export default function ClaimedButton({ dealId }: { dealId: string }) {
  // Local UI state: whether this deal is currently marked as claimed
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    // On mount (or when dealId changes), read claimed deals from localStorage
    try {
      const raw = localStorage.getItem("bs_claimed");
      if (!raw) return;

      const ids = JSON.parse(raw) as string[];
      setClaimed(ids.includes(dealId));
    } catch {
      // Fail silently if localStorage or JSON parsing fails
    }
  }, [dealId]);

  // Toggle this deal in/out of the claimed list
  function toggle() {
    let ids: string[] = [];

    // Safely read the existing claimed IDs
    try {
      ids = JSON.parse(localStorage.getItem("bs_claimed") || "[]");
    } catch {
      ids = [];
    }

    // If already claimed, remove it; otherwise add it
    const next = ids.includes(dealId)
      ? ids.filter((x) => x !== dealId)
      : [...ids, dealId];

    // Persist updated claimed list
    localStorage.setItem("bs_claimed", JSON.stringify(next));

    // Update local UI state to reflect the new value
    setClaimed(next.includes(dealId));
  }

  return (
    // Button styling changes based on claimed state
    <button
      onClick={toggle}
      className={
        "rounded-xl px-4 py-2 text-sm font-medium transition " +
        (claimed
          ? // Claimed state: filled button with dark text
            "bg-white text-black hover:bg-zinc-200"
          : // Unclaimed state: outlined button
            "border border-white/15 text-white hover:bg-white/10")
      }
    >
      {/* Button label reflects current claimed state */}
      {claimed ? "Claimed" : "Mark claimed"}
    </button>
  );
}
