"use client";

import * as React from "react";

type DealLite = { id: string; name: string; city?: string };

const DEST_KEY = "bs_destination_id";
const RESOLVED_KEY = "bs_resolved_stops";
const START_KEY = "bs_start";
const ZIP_KEY = "bs_zip";
const START_MODE_KEY = "bs_start_mode";

function isProbablyIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function readResolved(): Record<string, { lat: number; lon: number }> {
  try {
    const raw = localStorage.getItem(RESOLVED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function readStart(): { lat: number; lon: number } | null {
  try {
    const raw = localStorage.getItem(START_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s?.lat === "number" && typeof s?.lon === "number") {
      return { lat: s.lat, lon: s.lon };
    }
    return null;
  } catch {
    return null;
  }
}

export default function OpenRouteButton({
  orderedDeals,
  full,
}: {
  orderedDeals: DealLite[];
  full?: boolean;
}) {
  function openRoute() {
    if (!orderedDeals || orderedDeals.length === 0) return;

    const resolved = readResolved();
    const gpsStart = readStart();

    const mode = (localStorage.getItem(START_MODE_KEY) || "geo").trim();
    const zip = (localStorage.getItem(ZIP_KEY) || "").trim();

    // Reorder so destination is last
    const destId = (localStorage.getItem(DEST_KEY) || "").trim();
    let deals = orderedDeals.slice();
    if (destId) {
      const idx = deals.findIndex((d) => d.id === destId);
      if (idx !== -1) {
        const [dest] = deals.splice(idx, 1);
        deals.push(dest);
      }
    }

    // Build stops (ALWAYS prefer resolved coords)
    const stops = deals.map((d) => {
      const r = resolved[d.id];
      if (r && typeof r.lat === "number" && typeof r.lon === "number") {
        return `${r.lat},${r.lon}`;
      }
      // fallback text — ZIP anchored
      return zip ? `${d.name} ${zip}` : `${d.name} Las Vegas NV`;
    });

    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(0, -1);

    // START LOGIC (THIS WAS THE BUG)
    // ZIP MODE → use ZIP
    // GEO MODE → use GPS if available
    const origin =
      mode === "zip" && zip
        ? zip
        : gpsStart
        ? `${gpsStart.lat},${gpsStart.lon}`
        : zip
        ? zip
        : "Las Vegas NV";

    const url = isProbablyIOS()
      ? `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(
          [destination, ...waypoints].join(" to: ")
        )}`
      : "https://www.google.com/maps/dir/?api=1" +
        `&origin=${encodeURIComponent(origin)}` +
        `&destination=${encodeURIComponent(destination)}` +
        (waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : "") +
        "&travelmode=driving";

    window.open(url, "_blank", "noopener,noreferrer");
  }

  const greenBtn =
    "rounded-full border border-emerald-200/20 px-4 py-2 text-sm text-emerald-50 " +
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.34)_0%,rgba(16,185,129,0.20)_55%,rgba(0,0,0,0.06)_100%)] " +
    "shadow-[0_16px_46px_rgba(0,0,0,0.55),0_0_30px_rgba(16,185,129,0.18)] " +
    "hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.42)_0%,rgba(16,185,129,0.22)_60%,rgba(0,0,0,0.06)_100%)] " +
    "active:translate-y-[1px] transition";

  const neutralBtn =
    "rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm text-zinc-100 " +
    "hover:bg-white/5 shadow-[0_14px_45px_rgba(0,0,0,0.60)] transition";

  return (
    <button
      onClick={openRoute}
      disabled={!orderedDeals || orderedDeals.length === 0}
      className={(full ? greenBtn : neutralBtn) + " disabled:opacity-50"}
      title="Open the optimized route in Maps"
    >
      Open in Maps
    </button>
  );
}
