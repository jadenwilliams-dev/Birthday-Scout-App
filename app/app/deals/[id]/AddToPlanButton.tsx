"use client";
// Client-side component because it uses localStorage, window events,
// and React state/effects to sync plan data across the app.

import { useEffect, useState } from "react";

// localStorage key where the planned deal IDs are stored
const PLAN_KEY = "bs_plan";

// Custom window event used to notify other components
// when the plan is updated (add/remove)
const PLAN_UPDATED_EVENT = "bs_plan_updated";

type Props = {
  dealId: string; // unique ID for the deal tied to this button
};

// Read the current plan from localStorage and normalize it into an array of IDs.
// This is defensive because older versions of the app may have stored
// full objects instead of just string IDs.
function readPlanIds(): string[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // New format: array of string IDs
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }

    // Legacy format: array of objects with an `id` field
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (x) => x && typeof x === "object" && typeof (x as any).id === "string"
      )
    ) {
      return parsed.map((x: any) => x.id);
    }
  } catch {
    // Ignore JSON/parse errors and fall back to empty plan
  }

  return [];
}

// Persist the plan IDs back into localStorage.
// Wrapped in try/catch so storage errors don’t break the UI.
function writePlanIds(ids: string[]) {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(ids));
  } catch {
    // Fail silently if storage is unavailable (private mode, quota, etc.)
  }
}

// Button that toggles whether a deal is part of the user's plan.
export default function AddToPlanButton({ dealId }: Props) {
  // Tracks whether this specific deal is currently in the plan
  const [added, setAdded] = useState(false);

  useEffect(() => {
    // Sync local state with whatever is in localStorage
    const sync = () => setAdded(readPlanIds().includes(dealId));

    // Initial sync on mount
    sync();

    // Listen for plan updates triggered elsewhere in the app
    window.addEventListener(PLAN_UPDATED_EVENT, sync);

    // Clean up listener on unmount
    return () => window.removeEventListener(PLAN_UPDATED_EVENT, sync);
  }, [dealId]);

  // Toggle this deal in/out of the plan
  function toggle() {
    const ids = readPlanIds();

    // If already added, remove it
    if (ids.includes(dealId)) {
      const next = ids.filter((x) => x !== dealId);
      writePlanIds(next);
      setAdded(false);

      // Notify other components that the plan changed
      try {
        window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
      } catch {}

      return;
    }

    // Otherwise, add the deal to the plan
    const next = [...ids, dealId];
    writePlanIds(next);
    setAdded(true);

    // Notify listeners of the update
    try {
      window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
    } catch {}
  }

  return (
    // Simple toggle button with visual feedback
    <button
      onClick={toggle}
      className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
    >
      {/* Button text reflects whether the deal is in the plan */}
      {added ? "Added" : "Add"}
    </button>
  );
}
