"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_DEALS } from "@/app/lib/deals";

type Deal = {
  id: string;
  name: string;
  city?: string;
  type?: string;
  freebie?: string;
  conditions?: string;
  link?: string;
};

type OptimizeResp = {
  orderedStopIds?: string[];
  orderedIds?: string[];
  destinationId?: string;
  optimized?: boolean;
  note?: string;
};

const PLAN_KEY = "bs_plan";
const CLAIMED_KEY = "bs_claimed";
const PLAN_UPDATED_EVENT = "bs_plan_updated";
const ZIP_KEY = "bs_zip";

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;

    if (
      Array.isArray(parsed) &&
      parsed.every((x) => x && typeof x === "object" && typeof (x as any).id === "string")
    ) {
      return parsed.map((x: any) => x.id);
    }
  } catch {}
  return [];
}

function writeStringArray(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {}
}

function notifyPlanUpdated() {
  try {
    window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
  } catch {}
}

export default function PlanPage() {
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [claimedIds, setClaimedIds] = useState<string[]>([]);

  // Start settings
  const [zip, setZip] = useState<string>("");
  const [startMode, setStartMode] = useState<"none" | "zip" | "gps">("none");
  const [startCoords, setStartCoords] = useState<{ lat: number; lon: number } | null>(null);

  // UI state
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [destinationId, setDestinationId] = useState<string>("");

  useEffect(() => {
    const load = () => {
      setPlanIds(readStringArray(PLAN_KEY));
      setClaimedIds(readStringArray(CLAIMED_KEY));

      // load zip
      try {
        const z = localStorage.getItem(ZIP_KEY) || "";
        setZip(z);
        if (z) setStartMode((m) => (m === "gps" ? "gps" : "zip"));
      } catch {}
    };

    load();
    window.addEventListener(PLAN_UPDATED_EVENT, load);
    return () => window.removeEventListener(PLAN_UPDATED_EVENT, load);
  }, []);

  useEffect(() => {
    writeStringArray(CLAIMED_KEY, claimedIds);
  }, [claimedIds]);

  const dealById = useMemo(() => {
    const m = new Map<string, Deal>();
    for (const d of ALL_DEALS as Deal[]) m.set(d.id, d);
    return m;
  }, []);

  const items = useMemo(() => {
    return planIds.map((id) => dealById.get(id)).filter(Boolean) as Deal[];
  }, [planIds, dealById]);

  const claimedCount = useMemo(() => {
    const set = new Set(claimedIds);
    return items.filter((d) => set.has(d.id)).length;
  }, [items, claimedIds]);

  const percent = items.length ? Math.round((claimedCount / items.length) * 100) : 0;

  function saveZip(nextZip: string) {
    const clean = nextZip.trim();
    setZip(clean);
    try {
      localStorage.setItem(ZIP_KEY, clean);
    } catch {}
    if (clean) {
      setStartMode("zip");
      setStartCoords(null);
    } else {
      setStartMode("none");
    }
  }

  async function useMyLocation() {
    setStatus("");
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

  function getStartForPayload(): { startQuery?: string; startCoords?: { lat: number; lon: number } } {
    // Prefer GPS if we have it
    if (startMode === "gps" && startCoords) return { startCoords };

    // Otherwise ZIP if set
    const z = zip.trim();
    if (z) return { startQuery: z };

    // none
    return {};
  }

  async function optimizeRoute() {
    setStatus("");

    if (planIds.length < 2) {
      setStatus("Add at least 2 deals to your plan first.");
      return;
    }

    const start = getStartForPayload();
    if (!start.startCoords && !start.startQuery) {
      setStatus("Set a start first: click “Use my location” or enter a ZIP.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        ...start,
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

      const ordered =
        data.orderedStopIds?.length
          ? data.orderedStopIds
          : data.orderedIds?.length
          ? data.orderedIds
          : [];

      if (!ordered.length) throw new Error(data.note || "No optimized order returned.");

      let finalOrder = ordered;

      if (data.destinationId && ordered.includes(data.destinationId)) {
        finalOrder = [...ordered.filter((x) => x !== data.destinationId), data.destinationId];
        setDestinationId(data.destinationId);
      } else {
        setDestinationId("");
      }

      setPlanIds(finalOrder);
      writeStringArray(PLAN_KEY, finalOrder);
      notifyPlanUpdated();

      if (data.note) setStatus(data.note);
    } catch (e: any) {
      setStatus(e?.message || "Optimize failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggleClaim(id: string) {
    setClaimedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function removeFromPlan(id: string) {
    const next = planIds.filter((x) => x !== id);
    setPlanIds(next);
    setDestinationId((prev) => (prev === id ? "" : prev));
    writeStringArray(PLAN_KEY, next);
    notifyPlanUpdated();
  }

  function resetClaimed() {
    setClaimedIds([]);
  }

  function clearPlan() {
    setPlanIds([]);
    setDestinationId("");
    writeStringArray(PLAN_KEY, []);
    notifyPlanUpdated();
  }

  const startLabel =
    startMode === "gps"
      ? "Using current location (GPS)"
      : startMode === "zip" && zip
      ? `Using ZIP: ${zip}`
      : "No start set yet";

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-3xl font-bold mb-2">My Plan</h1>
        <p className="text-zinc-400 mb-6">Your saved freebies + your progress.</p>

        {/* START BOX */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              <div className="text-sm text-zinc-400 mb-2">Start</div>
              <div className="text-sm text-zinc-500 mb-3">{startLabel}</div>

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

            <button
              onClick={useMyLocation}
              disabled={busy}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
            >
              {busy ? "Getting location..." : "Use my location"}
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">
              Progress: {claimedCount}/{items.length} claimed
            </div>
            <div className="text-zinc-400 text-sm">{percent}%</div>
          </div>

          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div className="h-2 rounded-full bg-white/40" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {status ? (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {status}
          </div>
        ) : null}

        {planIds.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-zinc-300">
            Your plan is empty. Go to Deals and add some freebies.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {items.map((d) => {
              const isClaimed = claimedIds.includes(d.id);
              const isDestination = destinationId && d.id === destinationId;

              return (
                <div key={d.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className="text-sm text-zinc-400 mb-1">{d.type || "Deal"}</div>

                  {isDestination ? (
                    <div className="inline-block mb-2 rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200">
                      Destination
                    </div>
                  ) : null}

                  <div className="text-xl font-bold leading-tight">{d.name}</div>
                  <div className="text-zinc-300 mt-2">{d.freebie}</div>
                  {d.conditions ? (
                    <div className="text-sm text-zinc-400 mt-2">{d.conditions}</div>
                  ) : null}

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

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="text-sm text-zinc-400">
            Selected in plan: <span className="text-white">{planIds.length}</span> • Claimed:{" "}
            <span className="text-white">{claimedCount}</span>
          </div>

          <div className="flex-1" />

          <button
            onClick={optimizeRoute}
            disabled={busy}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
          >
            {busy ? "Optimizing..." : "Optimize route"}
          </button>

          <button
            onClick={resetClaimed}
            className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm hover:bg-white/10"
          >
            Reset claimed
          </button>

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
