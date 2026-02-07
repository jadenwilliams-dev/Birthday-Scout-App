"use client"; // This page uses client-side state + localStorage + geolocation

import { useEffect, useMemo, useState } from "react";
import { ALL_DEALS } from "@/app/lib/deals"; // Master list of deals (static data)

/**
 * Deal shape used by this page.
 * Keep it minimal so the component isn’t coupled to every possible field in deals.json/ts.
 */
type Deal = {
  id: string;
  name: string;
  city?: string;
  type?: string;
  freebie?: string;
  conditions?: string;
  link?: string;
};

/**
 * Response from /api/optimize-route.
 * This supports both newer + older field names so the UI doesn’t break if the API changes slightly.
 */
type OptimizeResp = {
  orderedStopIds?: string[];
  orderedIds?: string[];
  destinationId?: string;
  optimized?: boolean;
  note?: string;
};

// localStorage keys (centralized to avoid typos)
const PLAN_KEY = "bs_plan";
const CLAIMED_KEY = "bs_claimed";
const PLAN_UPDATED_EVENT = "bs_plan_updated";
const ZIP_KEY = "bs_zip";

/**
 * Reads a string[] from localStorage safely.
 * Also supports a legacy format where we stored objects like { id: "chipotle", ... }.
 */
function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);

    // Current format: ["chipotle","starbucks",...]
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;

    // Legacy format: [{id:"chipotle"}, {id:"starbucks"}, ...]
    if (
      Array.isArray(parsed) &&
      parsed.every((x) => x && typeof x === "object" && typeof (x as any).id === "string")
    ) {
      return parsed.map((x: any) => x.id);
    }
  } catch {
    // If localStorage is blocked/corrupt, we fail “quietly” and just treat it as empty.
  }
  return [];
}

/**
 * Writes string[] to localStorage.
 * Wrapped so storage errors don’t crash the UI.
 */
function writeStringArray(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {}
}

/**
 * Broadcast an event when the plan changes.
 * Other pages/components can listen and re-load without needing global state.
 */
function notifyPlanUpdated() {
  try {
    window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
  } catch {}
}

export default function PlanPage() {
  // IDs of deals in the current plan (order matters)
  const [planIds, setPlanIds] = useState<string[]>([]);

  // IDs of deals the user has claimed (used for progress + toggles)
  const [claimedIds, setClaimedIds] = useState<string[]>([]);

  // Start settings (we support ZIP or GPS)
  const [zip, setZip] = useState<string>("");
  const [startMode, setStartMode] = useState<"none" | "zip" | "gps">("none");
  const [startCoords, setStartCoords] = useState<{ lat: number; lon: number } | null>(null);

  // UI state + feedback
  const [status, setStatus] = useState<string>(""); // status/error messages for the user
  const [busy, setBusy] = useState(false); // used to disable buttons + show loading text
  const [destinationId, setDestinationId] = useState<string>(""); // (optional) “final stop” returned by optimizer

  /**
   * Initial load:
   * - Restore plan + claimed from localStorage
   * - Restore ZIP
   * - Subscribe to plan updates triggered from other pages
   */
  useEffect(() => {
    const load = () => {
      setPlanIds(readStringArray(PLAN_KEY));
      setClaimedIds(readStringArray(CLAIMED_KEY));

      // Load ZIP from storage so the user doesn’t have to retype it
      try {
        const z = localStorage.getItem(ZIP_KEY) || "";
        setZip(z);

        // If we have a ZIP, default to ZIP mode unless the user is already in GPS mode
        if (z) setStartMode((m) => (m === "gps" ? "gps" : "zip"));
      } catch {}
    };

    load();
    window.addEventListener(PLAN_UPDATED_EVENT, load);
    return () => window.removeEventListener(PLAN_UPDATED_EVENT, load);
  }, []);

  /**
   * Persist claimed IDs whenever they change.
   * (Plan IDs are persisted at the time we update/remove/optimize.)
   */
  useEffect(() => {
    writeStringArray(CLAIMED_KEY, claimedIds);
  }, [claimedIds]);

  /**
   * Build a fast lookup map so we can go from id -> Deal quickly.
   * This avoids repeatedly searching ALL_DEALS.
   */
  const dealById = useMemo(() => {
    const m = new Map<string, Deal>();
    for (const d of ALL_DEALS as Deal[]) m.set(d.id, d);
    return m;
  }, []);

  /**
   * Expand plan IDs into actual deal objects for rendering.
   * filter(Boolean) drops any IDs that no longer exist in ALL_DEALS.
   */
  const items = useMemo(() => {
    return planIds.map((id) => dealById.get(id)).filter(Boolean) as Deal[];
  }, [planIds, dealById]);

  /**
   * Compute claimed progress based on visible items.
   */
  const claimedCount = useMemo(() => {
    const set = new Set(claimedIds);
    return items.filter((d) => set.has(d.id)).length;
  }, [items, claimedIds]);

  // Simple percent for the progress bar (0 if empty plan)
  const percent = items.length ? Math.round((claimedCount / items.length) * 100) : 0;

  /**
   * Save ZIP and update start mode.
   * If they type a ZIP, that becomes the fallback (and overrides GPS mode).
   */
  function saveZip(nextZip: string) {
    const clean = nextZip.trim();
    setZip(clean);

    try {
      localStorage.setItem(ZIP_KEY, clean);
    } catch {}

    if (clean) {
      setStartMode("zip");
      setStartCoords(null); // if the user chooses ZIP, we ignore GPS coords
    } else {
      setStartMode("none");
    }
  }

  /**
   * Ask the browser for the user's location.
   * If it fails, we tell them to use ZIP instead.
   */
  async function useMyLocation() {
    setStatus("");

    // Guard for environments where navigator/geolocation isn't available
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("Geolocation not available in this browser.");
      return;
    }

    setBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setStartCoords(coords);
      setStartMode("gps");
      setStatus("Using your current location.");
    } catch (e: any) {
      setStatus("Could not get location. Use ZIP instead.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Build the “start” portion of the optimizer payload.
   * Priority: GPS (if selected and available) > ZIP > none.
   */
  function getStartForPayload(): { startQuery?: string; startCoords?: { lat: number; lon: number } } {
    // Prefer GPS if we have it
    if (startMode === "gps" && startCoords) return { startCoords };

    // Otherwise ZIP if set
    const z = zip.trim();
    if (z) return { startQuery: z };

    // none
    return {};
  }

  /**
   * Calls /api/optimize-route with the current plan and start location,
   * then reorders planIds based on the returned order.
   */
  async function optimizeRoute() {
    setStatus("");

    // Need at least 2 stops for optimization to be meaningful
    if (planIds.length < 2) {
      setStatus("Add at least 2 deals to your plan first.");
      return;
    }

    // Must have either GPS or ZIP as a starting point
    const start = getStartForPayload();
    if (!start.startCoords && !start.startQuery) {
      setStatus("Set a start first: click “Use my location” or enter a ZIP.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        ...start,

        // Each stop gets a geocodable query string
        // If a deal doesn't specify city, we fallback to Las Vegas
        stops: planIds.map((id) => {
          const d = dealById.get(id);
          const base = d?.name || id;
          const q = d?.city ? `${base}, ${d.city}` : `${base}, Las Vegas, NV`;
          return { id, query: q };
        }),
      };

      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as OptimizeResp;

      // Support multiple response field names (API evolution)
      const ordered =
        data.orderedStopIds?.length
          ? data.orderedStopIds
          : data.orderedIds?.length
          ? data.orderedIds
          : [];

      if (!ordered.length) throw new Error(data.note || "No optimized order returned.");

      let finalOrder = ordered;

      // If the API provides a destination, force it to be the last stop in the UI
      if (data.destinationId && ordered.includes(data.destinationId)) {
        finalOrder = [...ordered.filter((x) => x !== data.destinationId), data.destinationId];
        setDestinationId(data.destinationId);
      } else {
        setDestinationId("");
      }

      // Update state + persist + notify listeners
      setPlanIds(finalOrder);
      writeStringArray(PLAN_KEY, finalOrder);
      notifyPlanUpdated();

      // Optional note from the API (good for user feedback)
      if (data.note) setStatus(data.note);
    } catch (e: any) {
      setStatus(e?.message || "Optimize failed.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Toggle a deal as claimed/unclaimed.
   * This only affects progress; it doesn’t remove it from the plan.
   */
  function toggleClaim(id: string) {
    setClaimedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /**
   * Remove a deal from the plan.
   * Also clears destination if the removed item was the destination.
   */
  function removeFromPlan(id: string) {
    const next = planIds.filter((x) => x !== id);
    setPlanIds(next);
    setDestinationId((prev) => (prev === id ? "" : prev));
    writeStringArray(PLAN_KEY, next);
    notifyPlanUpdated();
  }

  /**
   * Clears all claimed status (does not change plan order).
   */
  function resetClaimed() {
    setClaimedIds([]);
  }

  /**
   * Completely resets the plan (and destination label).
   */
  function clearPlan() {
    setPlanIds([]);
    setDestinationId("");
    writeStringArray(PLAN_KEY, []);
    notifyPlanUpdated();
  }

  /**
   * Friendly label shown in the UI so the user knows what start mode is active.
   */
  const startLabel =
    startMode === "gps"
      ? "Using current location (GPS)"
      : startMode === "zip" && zip
      ? `Using ZIP: ${zip}`
      : "No start set yet";

  return (
    // Main page wrapper (dark theme)
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto w-full max-w-5xl">
        {/* Page title + helper subtitle */}
        <h1 className="text-3xl font-bold mb-2">My Plan</h1>
        <p className="text-zinc-400 mb-6">Your saved freebies + your progress.</p>

        {/* START BOX: choose GPS or ZIP fallback */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              {/* Current start mode label */}
              <div className="text-sm text-zinc-400 mb-2">Start</div>
              <div className="text-sm text-zinc-500 mb-3">{startLabel}</div>

              {/* ZIP entry (fallback if GPS fails or user prefers ZIP) */}
              <label className="text-sm text-zinc-300">ZIP (fallback)</label>
              <input
                value={zip}
                onChange={(e) => saveZip(e.target.value)}
                placeholder="89109"
                className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 outline-none focus:border-white/30"
              />
              <div className="text-xs text-zinc-500 mt-1">
                Tip: If GPS fails, we’ll use this ZIP.
              </div>
            </div>

            {/* GPS button */}
            <button
              onClick={useMyLocation}
              disabled={busy}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
            >
              {busy ? "Getting location..." : "Use my location"}
            </button>
          </div>
        </div>

        {/* Progress card: claimed count + percent bar */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">
              Progress: {claimedCount}/{items.length} claimed
            </div>
            <div className="text-zinc-400 text-sm">{percent}%</div>
          </div>

          {/* Simple progress bar */}
          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div className="h-2 rounded-full bg-white/40" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {/* Status/error message (shown only when status has text) */}
        {status ? (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {status}
          </div>
        ) : null}

        {/* Empty state vs plan grid */}
        {planIds.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-zinc-300">
            Your plan is empty. Go to Deals and add some freebies.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {items.map((d) => {
              // Per-card UI flags
              const isClaimed = claimedIds.includes(d.id);
              const isDestination = destinationId && d.id === destinationId;

              return (
                <div key={d.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  {/* Small category/type label */}
                  <div className="text-sm text-zinc-400 mb-1">{d.type || "Deal"}</div>

                  {/* Destination badge (if optimizer marked this as final stop) */}
                  {isDestination ? (
                    <div className="inline-block mb-2 rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200">
                      Destination
                    </div>
                  ) : null}

                  {/* Main deal content */}
                  <div className="text-xl font-bold leading-tight">{d.name}</div>
                  <div className="text-zinc-300 mt-2">{d.freebie}</div>

                  {/* Conditions are optional, so only show if present */}
                  {d.conditions ? (
                    <div className="text-sm text-zinc-400 mt-2">{d.conditions}</div>
                  ) : null}

                  {/* Action buttons */}
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={() => toggleClaim(d.id)}
                      className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
                    >
                      {isClaimed ? "Unclaim" : "Mark claimed"}
                    </button>

                    <button
                      onClick={() => removeFromPlan(d.id)}
                      className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer actions: summary + optimize + reset/clear */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {/* Quick numbers so the user knows what’s selected */}
          <div className="text-sm text-zinc-400">
            Selected in plan: <span className="text-white">{planIds.length}</span> • Claimed:{" "}
            <span className="text-white">{claimedCount}</span>
          </div>

          {/* Spacer to push buttons to the right on wide screens */}
          <div className="flex-1" />

          {/* Optimize route (calls API) */}
          <button
            onClick={optimizeRoute}
            disabled={busy}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
          >
            {busy ? "Optimizing..." : "Optimize route"}
          </button>

          {/* Reset claimed only (keeps plan) */}
          <button
            onClick={resetClaimed}
            className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm hover:bg-white/10"
          >
            Reset claimed
          </button>

          {/* Clear plan entirely */}
          <button
            onClick={clearPlan}
            className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm hover:bg-white/10"
          >
            Clear plan
          </button>
        </div>
      </div>
    </main>
  );
}
