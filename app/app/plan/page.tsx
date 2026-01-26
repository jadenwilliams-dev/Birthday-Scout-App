// app/app/plan/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ALL_DEALS } from "@/app/lib/deals";
import OpenRouteButton from "./OpenRouteButton";
import { supabase } from "@/app/lib/supabaseClient";

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
  orderedIds?: string[];
  destinationId?: string;
  optimized?: boolean;
  note?: string;
  routeDistance_m?: number;
  routeDuration_s?: number;
  resolvedStops?: { id: string; lat: number; lon: number }[];
};

type PreviewResp = {
  preview?: boolean;
  suggestedDestinationId?: string;
  stops?: { id: string; dist_mi: number; eta_min?: number; lat?: number; lon?: number }[];
  note?: string;
};

const PLAN_KEY = "bs_plan";
const CLAIMED_KEY = "bs_claimed";
const ZIP_KEY = "bs_zip";
const START_KEY = "bs_start";

const DEST_KEY = "bs_destination_id";
const DEST_PROMPT_OFF_KEY = "bs_dest_prompt_off";

const LAST_OPT_KEY = "bs_last_optimized_at";
const LAST_ROUTE_DIST_M = "bs_last_route_distance_m";
const LAST_ROUTE_DUR_S = "bs_last_route_duration_s";
const LAST_ROUTE_ORDER = "bs_last_route_order";

const SKIPPED_KEY = "bs_skipped";

const AUTO_ADVANCE_OPEN_KEY = "bs_auto_advance_open_maps";
const RESOLVED_KEY = "bs_resolved_stops";

const PLAN_UPDATED_EVENT = "bs_plan_updated";
const PROFILE_UPDATED_EVENT = "bs_profile_updated";

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
    return [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, arr: string[]) {
  localStorage.setItem(key, JSON.stringify(arr));
}

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBool(key: string, val: boolean) {
  localStorage.setItem(key, val ? "true" : "false");
}

function readNum(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeNum(key: string, val: number) {
  localStorage.setItem(key, String(val));
}

function formatWhen(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function metersToMiles(m: number) {
  return m / 1609.34;
}

function secondsToMinutes(s: number) {
  return Math.max(1, Math.round(s / 60));
}

function isProbablyIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function openPlaceInMaps(query: string) {
  const q = encodeURIComponent(query);
  const url = isProbablyIOS()
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function tryConfetti() {
  try {
    const w = window as any;
    if (typeof w.confetti === "function") {
      w.confetti({ particleCount: 90, spread: 55, origin: { y: 0.7 } });
    }
  } catch {}
}

function normalizeZip(input: string) {
  return input.replace(/\D/g, "").slice(0, 5);
}

/** ✅ Pull zip from Supabase profiles (per-user) */
async function fetchZipFromDB(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return "";

  const { data: p, error } = await supabase
    .from("profiles")
    .select("zip")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return "";
  const z = typeof p?.zip === "string" ? p.zip : "";
  return z || "";
}

/** ✅ Write zip to Supabase profiles (per-user) */
async function saveZipToDB(nextZip: string) {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;

  await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      zip: nextZip || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const cls =
    tone === "good"
      ? "border-emerald-300/18 bg-black/35 text-emerald-100"
      : tone === "warn"
      ? "border-amber-300/18 bg-black/35 text-amber-100"
      : "border-white/14 bg-black/35 text-zinc-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] leading-none ${cls}`}>
      {children}
    </span>
  );
}

function IconDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        on ? "bg-emerald-200/80 shadow-[0_0_16px_rgba(16,185,129,0.35)]" : "bg-white/15"
      }`}
    />
  );
}

function LocationGlyph() {
  return (
    <span className="grid place-items-center h-8 w-8 rounded-full border border-emerald-200/22 bg-black/25 shadow-[0_0_38px_rgba(16,185,129,0.12)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 21s7-4.4 7-11a7 7 0 1 0-14 0c0 6.6 7 11 7 11Z"
          stroke="rgba(167,243,208,0.95)"
          strokeWidth="1.6"
        />
        <circle cx="12" cy="10" r="2.3" stroke="rgba(167,243,208,0.95)" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

/**
 * Brand logo mapping (uses /public/brands/*.png)
 */
function getBrandLogoSrc(d: Deal): string | null {
  const id = (d.id || "").toLowerCase();
  const name = (d.name || "").toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/starbucks/, "/brands/starbucks1.png"],
    [/chipotle/, "/brands/chipotle1.png"],
    [/krispy|krispykreme/, "/brands/krispy.png"],
    [/nothingbundt|bundt/, "/brands/nothingbundt.png"],
    [/panera/, "/brands/panera3.png"],
    [/sephora/, "/brands/sephora.png"],
  ];

  for (const [rx, path] of rules) {
    if (rx.test(id) || rx.test(name)) return path;
  }
  return null;
}

function brandBg(deal: Deal): string {
  const id = (deal.id || "").toLowerCase();
  const name = (deal.name || "").toLowerCase();
  if (/starbucks/.test(id) || /starbucks/.test(name)) return "#006241";
  if (/chipotle/.test(id) || /chipotle/.test(name)) return "#ffffff";
  return "rgba(255,255,255,0.03)";
}

function brandZoom(deal: Deal): number {
  const id = (deal.id || "").toLowerCase();
  const name = (deal.name || "").toLowerCase();
  if (/starbucks/.test(id) || /starbucks/.test(name)) return 1.06;
  if (/chipotle/.test(id) || /chipotle/.test(name)) return 1.12;
  return 1.08;
}

function BrandAvatar({
  deal,
  dim = false,
  size = 40,
}: {
  deal: Deal;
  dim?: boolean;
  size?: number;
}) {
  const src = getBrandLogoSrc(deal);
  const fx = dim ? "opacity-60 grayscale" : "";
  if (!src) {
    return (
      <div
        className={`grid place-items-center rounded-full border border-white/14 ring-1 ring-white/6 ${fx}`}
        style={{ width: size, height: size, background: "rgba(255,255,255,0.03)" }}
        aria-hidden
        title={deal.name}
      >
        <span className="text-sm text-zinc-200">{(deal.name?.[0] || "?").toUpperCase()}</span>
      </div>
    );
  }

  const z = brandZoom(deal);

  return (
    <div
      className={`relative rounded-full border border-white/14 ring-1 ring-white/6 overflow-hidden ${fx}`}
      style={{ width: size, height: size, background: brandBg(deal) }}
      aria-hidden
      title={deal.name}
    >
      <Image
        src={src}
        alt=""
        fill
        className="object-cover object-center"
        style={{ transform: `translateY(1.3px) scale(${z})`, transformOrigin: "center" }}
        sizes={`${size}px`}
      />
    </div>
  );
}

/** Mock-style rail node */
function RailNode({ variant }: { variant: "start" | "next" | "claimed" | "skipped" | "normal" }) {
  const base = "relative mt-1 h-4 w-4 rounded-full";
  const core = "absolute inset-0 rounded-full border";
  const inner = "absolute inset-[5px] rounded-full";

  if (variant === "next") {
    return (
      <div className={base} aria-hidden>
        <div className="absolute -inset-4 rounded-full bg-emerald-300/10 blur-xl" />
        <div className={`${core} border-emerald-200/40 bg-black/20`} />
        <div className={`${inner} bg-emerald-200/95 shadow-[0_0_22px_rgba(16,185,129,0.55)]`} />
      </div>
    );
  }

  if (variant === "start") {
    return (
      <div className={base} aria-hidden>
        <div className="absolute -inset-5 rounded-full bg-emerald-300/12 blur-xl" />
        <div className="absolute -inset-2 rounded-full border border-emerald-200/25" />
        <div className={`${core} border-emerald-200/35 bg-black/18`} />
        <div className={`${inner} bg-emerald-200/80 shadow-[0_0_18px_rgba(16,185,129,0.40)]`} />
      </div>
    );
  }

  if (variant === "claimed") {
    return (
      <div className={base} aria-hidden>
        <div className={`${core} border-emerald-200/18 bg-white/0`} />
        <div className={`${inner} bg-emerald-200/45 shadow-[0_0_14px_rgba(16,185,129,0.25)]`} />
      </div>
    );
  }

  if (variant === "skipped") {
    return (
      <div className={base} aria-hidden>
        <div className={`${core} border-white/14 bg-white/0`} />
        <div className={`${inner} bg-white/10`} />
      </div>
    );
  }

  return (
    <div className={base} aria-hidden>
      <div className={`${core} border-white/14 bg-white/0`} />
      <div className={`${inner} bg-white/12`} />
    </div>
  );
}

/**
 * HERO LOGO (lockup) — matches your inspo.
 */
function BrandLockup() {
  const candidates = [
    "/brands/lockup.png",
    "/lockup.png",
    "/brand-lockup.png",
    "/brand-lockup.webp",
    "/brand-lockup.jpg",
    "/logo-lockup.png",
    "/logo.png",
  ];

  const [idx, setIdx] = useState(0);

  if (idx >= candidates.length) return null;

  return (
    <div className="-mt-31 mb-6 -ml-2 sm:-ml-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={candidates[idx]}
        alt="BirthdayScout"
        className="block h-[300px] sm:h-[360px] w-auto select-none drop-shadow-[0_28px_70px_rgba(0,0,0,0.70)]"
        draggable={false}
        onError={() => setIdx((v) => v + 1)}
      />
    </div>
  );
}

export default function PlanPage() {
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const [zip, setZip] = useState<string>("");

  const [destinationId, setDestinationId] = useState<string>("");
  const [promptOff, setPromptOff] = useState<boolean>(false);

  const [hasGPSStart, setHasGPSStart] = useState<boolean>(false);

  const [lastOptimizedAt, setLastOptimizedAt] = useState<number | null>(null);
  const [lastRouteDistanceM, setLastRouteDistanceM] = useState<number | null>(null);
  const [lastRouteDurationS, setLastRouteDurationS] = useState<number | null>(null);
  const [lastRouteOrder, setLastRouteOrder] = useState<string[]>([]);

  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [autoOpenMaps, setAutoOpenMaps] = useState<boolean>(false);

  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const [optimizing, setOptimizing] = useState<boolean>(false);
  const [shareBusy, setShareBusy] = useState<boolean>(false);

  // modal state
  const [showDestModal, setShowDestModal] = useState<boolean>(false);
  const [modalChoice, setModalChoice] = useState<string>("");
  const [modalDistances, setModalDistances] = useState<Record<string, number>>({});
  const [modalEtas, setModalEtas] = useState<Record<string, number>>({});
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);

  useEffect(() => {
    const p = readStringArray(PLAN_KEY);
    const c = readStringArray(CLAIMED_KEY);
    setPlanIds(p);
    setClaimedIds(c);

    setDestinationId(localStorage.getItem(DEST_KEY) || "");
    setPromptOff(readBool(DEST_PROMPT_OFF_KEY));

    setLastOptimizedAt(readNum(LAST_OPT_KEY));
    setLastRouteDistanceM(readNum(LAST_ROUTE_DIST_M));
    setLastRouteDurationS(readNum(LAST_ROUTE_DUR_S));
    setLastRouteOrder(readStringArray(LAST_ROUTE_ORDER));

    setSkippedIds(readStringArray(SKIPPED_KEY));
    setAutoOpenMaps(readBool(AUTO_ADVANCE_OPEN_KEY));

    try {
      const raw = localStorage.getItem(START_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s?.lat === "number" && typeof s?.lon === "number") setHasGPSStart(true);
      }
    } catch {}

    // ✅ DB-first zip (per-user). Fallback to localStorage if DB empty.
    (async () => {
      const dbZip = await fetchZipFromDB();
      if (dbZip) {
        setZip(dbZip);
        try {
          localStorage.setItem(ZIP_KEY, dbZip);
        } catch {}
      } else {
        setZip(localStorage.getItem(ZIP_KEY) || "");
      }
    })();
  }, []);

  // ✅ When profile saves, refresh zip here too.
  useEffect(() => {
    async function refresh() {
      const dbZip = await fetchZipFromDB();
      if (dbZip) {
        setZip(dbZip);
        try {
          localStorage.setItem(ZIP_KEY, dbZip);
        } catch {}
      }
    }

    function onProfileUpdated() {
      refresh();
    }

    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
  }, []);

  function hasStartCoords(): boolean {
    const raw = localStorage.getItem(START_KEY);
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      return typeof s?.lat === "number" && typeof s?.lon === "number";
    } catch {
      return false;
    }
  }

  function buildStopQuery(name: string): string {
    const usingGPS = hasStartCoords();
    const z = (localStorage.getItem(ZIP_KEY) || "89109").trim();
    if (usingGPS) return name.trim();
    return `${name.trim()} ${z}`;
  }

  useEffect(() => {
    if (!destinationId) return;
    if (!planIds.includes(destinationId)) {
      setDestinationId("");
      localStorage.removeItem(DEST_KEY);
    }
  }, [planIds, destinationId]);

  useEffect(() => {
    if (skippedIds.length === 0) return;
    const planSet = new Set(planIds);
    const cleaned = skippedIds.filter((id) => planSet.has(id));
    if (cleaned.length !== skippedIds.length) {
      setSkippedIds(cleaned);
      writeStringArray(SKIPPED_KEY, cleaned);
    }
  }, [planIds, skippedIds]);

  const items: Deal[] = useMemo(() => {
    const byId = new Map<string, Deal>();
    for (const d of ALL_DEALS as Deal[]) byId.set(d.id, d);
    return planIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
  }, [planIds]);

  const skippedSet = useMemo(() => new Set(skippedIds), [skippedIds]);
  const claimedSet = useMemo(() => new Set(claimedIds), [claimedIds]);

  const activeItems: Deal[] = useMemo(() => {
    if (items.length === 0) return [];
    return items.filter((d) => !skippedSet.has(d.id));
  }, [items, skippedSet]);

  // ✅ EMPTY STATE FLAG
  const hasAnyPlanned = items.length > 0;

  const claimedCount = useMemo(() => {
    const set = new Set(claimedIds);
    return planIds.filter((id) => set.has(id)).length;
  }, [planIds, claimedIds]);

  const pct = planIds.length ? Math.round((claimedCount / planIds.length) * 100) : 0;
  const progressPct = Math.min(100, Math.max(0, pct));
  const glowT = progressPct / 100;

  const progShadow = `0 0 ${12 + 34 * glowT}px rgba(16,185,129,${0.14 + 0.38 * glowT}),
                    0 0 ${5 + 16 * glowT}px rgba(16,185,129,${0.24 + 0.52 * glowT})`;

  const progBg = `linear-gradient(90deg,
  rgba(16,185,129,${0.20 + 0.18 * glowT}) 0%,
  rgba(16,185,129,${0.46 + 0.34 * glowT}) 60%,
  rgba(167,243,208,${0.58 + 0.30 * glowT}) 100%
)`;

  function dispatchPlanUpdated() {
    window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
  }

  // ✅ Update zip locally + in DB + notify other pages
  function saveZip(next: string) {
    const z = normalizeZip(next);
    setZip(z);
    try {
      localStorage.setItem(ZIP_KEY, z);
    } catch {}

    // fire-and-forget DB save (so Profile stays in sync too)
    (async () => {
      try {
        await saveZipToDB(z);
        window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
      } catch {}
    })();
  }

async function useMyLocation() {
  setError("");
  setStatus("");

  if (!navigator.geolocation) {
    setError("Geolocation not supported in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      localStorage.setItem(START_KEY, JSON.stringify({ lat, lon }));
      setHasGPSStart(true);
      setStatus("Using current location (GPS).");
      setError("");
    },
    (err) => {
      // ✅ IMPORTANT FIX: clear any stale GPS so we fall back to ZIP
      try {
        localStorage.removeItem(START_KEY);
      } catch {}

      setHasGPSStart(false);

      const msg = err?.message || "Could not access your location.";
      // Optional: friendlier message
      setError(`Location not available. Using ZIP instead. (${msg})`);
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}


  function toggleSkipped(id: string) {
    const set = new Set(skippedIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);

    const next = Array.from(set);
    setSkippedIds(next);
    writeStringArray(SKIPPED_KEY, next);

    if (id === destinationId && set.has(id) === true) {
      setDestinationId("");
      localStorage.removeItem(DEST_KEY);
      setStatus("Destination cleared (it was skipped).");
    }
  }

  function clearSkipped() {
    setSkippedIds([]);
    writeStringArray(SKIPPED_KEY, []);
    setStatus("Cleared skipped stops.");
  }

  function removeFromPlan(id: string) {
    setError("");
    setStatus("");

    const next = planIds.filter((x) => x !== id);
    setPlanIds(next);
    writeStringArray(PLAN_KEY, next);

    const nextClaimed = claimedIds.filter((x) => x !== id);
    setClaimedIds(nextClaimed);
    writeStringArray(CLAIMED_KEY, nextClaimed);

    const nextSkipped = skippedIds.filter((x) => x !== id);
    if (nextSkipped.length !== skippedIds.length) {
      setSkippedIds(nextSkipped);
      writeStringArray(SKIPPED_KEY, nextSkipped);
    }

    if (destinationId === id) {
      setDestinationId("");
      localStorage.removeItem(DEST_KEY);
    }

    if (lastRouteOrder.includes(id)) {
      setLastRouteOrder([]);
      localStorage.removeItem(LAST_ROUTE_ORDER);
    }

    dispatchPlanUpdated();
  }

  function openStopInMaps(d: Deal) {
    const z = (localStorage.getItem(ZIP_KEY) || "89109").trim();
    openPlaceInMaps(`${d.name} Las Vegas NV ${z}`);
  }

  function computeNextStop(prospectiveClaimed: Set<string>): Deal | null {
    const candidates = routeSummary && routeSummary.length ? routeSummary : activeItems;
    for (const d of candidates) {
      if (!prospectiveClaimed.has(d.id) && !skippedSet.has(d.id)) return d;
    }
    return null;
  }

  function toggleClaim(id: string) {
    const set = new Set(claimedIds);
    const wasClaimed = set.has(id);

    if (wasClaimed) set.delete(id);
    else set.add(id);

    const nextArr = Array.from(set);
    setClaimedIds(nextArr);
    writeStringArray(CLAIMED_KEY, nextArr);

    if (!wasClaimed) {
      tryConfetti();
      const nextStop2 = computeNextStop(set);
      if (nextStop2) {
        setStatus(`Claimed ✅ Next stop: ${nextStop2.name}`);
      } else {
        setStatus("Claimed ✅ No next stop — everything is claimed or skipped 🎉");
      }
    }
  }

  function resetClaimed() {
    setClaimedIds([]);
    writeStringArray(CLAIMED_KEY, []);
  }

  function clearPlan() {
    setPlanIds([]);
    setClaimedIds([]);
    writeStringArray(PLAN_KEY, []);
    writeStringArray(CLAIMED_KEY, []);

    setDestinationId("");
    localStorage.removeItem(DEST_KEY);

    setLastOptimizedAt(null);
    setLastRouteDistanceM(null);
    setLastRouteDurationS(null);
    localStorage.removeItem(LAST_OPT_KEY);
    localStorage.removeItem(LAST_ROUTE_DIST_M);
    localStorage.removeItem(LAST_ROUTE_DUR_S);

    setLastRouteOrder([]);
    localStorage.removeItem(LAST_ROUTE_ORDER);

    setSkippedIds([]);
    localStorage.removeItem(SKIPPED_KEY);

    localStorage.removeItem(RESOLVED_KEY);

    dispatchPlanUpdated();
  }

  function setAsDestination(id: string) {
    setDestinationId(id);
    localStorage.setItem(DEST_KEY, id);
    setStatus("Destination set.");
    setError("");
  }

  function clearDestination() {
    setDestinationId("");
    localStorage.removeItem(DEST_KEY);
    setStatus("Destination cleared.");
  }

  function getStartPayload(): { startCoords?: { lat: number; lon: number }; startQuery?: string } | null {
    const raw = localStorage.getItem(START_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (typeof s?.lat === "number" && typeof s?.lon === "number") {
          return { startCoords: { lat: s.lat, lon: s.lon } };
        }
      } catch {}
    }

    const z = (localStorage.getItem(ZIP_KEY) || "").trim();
    if (z) return { startQuery: z };
    return null;
  }

  async function doOptimize(destOverride?: string) {
    const start = getStartPayload();
    if (!start) {
      setError('Set a start first: click "Use my location" or enter a ZIP.');
      return;
    }

    if (activeItems.length < 2) {
      setError("Unskip at least 2 stops to optimize.");
      return;
    }

    const stops = activeItems.map((d) => ({
      id: d.id,
      query: buildStopQuery(d.name),
    }));

    const destToSend =
      (destOverride && planIds.includes(destOverride) ? destOverride : "") ||
      (destinationId && planIds.includes(destinationId) ? destinationId : undefined);

    const safeDestToSend = destToSend && skippedSet.has(destToSend) ? undefined : destToSend;

    setOptimizing(true);
    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...start, destinationId: safeDestToSend, stops }),
      });

      const data = (await res.json()) as OptimizeResp;

      if (!res.ok || !data?.optimized || !Array.isArray(data?.orderedIds)) {
        setError(data?.note || "Optimization failed.");
        return;
      }

      setStatus(data.note || "Optimized ✅");
      tryConfetti();

      if (Array.isArray(data.resolvedStops)) {
        const map: Record<string, { lat: number; lon: number }> = {};
        for (const s of data.resolvedStops) {
          if (s && typeof s.id === "string" && typeof s.lat === "number" && typeof s.lon === "number") {
            map[s.id] = { lat: s.lat, lon: s.lon };
          }
        }
        localStorage.setItem(RESOLVED_KEY, JSON.stringify(map));
      }

      if (data.destinationId && data.destinationId !== destinationId) {
        setDestinationId(data.destinationId);
        localStorage.setItem(DEST_KEY, data.destinationId);
      }

      const orderedIds = data.orderedIds;

      setLastRouteOrder(orderedIds);
      writeStringArray(LAST_ROUTE_ORDER, orderedIds);

      const planSet = new Set(planIds);
      const cleaned = orderedIds.filter((id) => planSet.has(id));

      const remaining = planIds.filter((id) => !cleaned.includes(id));
      const finalOrder = [...cleaned, ...remaining];

      setPlanIds(finalOrder);
      writeStringArray(PLAN_KEY, finalOrder);
      dispatchPlanUpdated();

      const ts = Date.now();
      setLastOptimizedAt(ts);
      writeNum(LAST_OPT_KEY, ts);

      if (typeof data.routeDistance_m === "number" && isFinite(data.routeDistance_m)) {
        setLastRouteDistanceM(data.routeDistance_m);
        writeNum(LAST_ROUTE_DIST_M, data.routeDistance_m);
      }

      if (typeof data.routeDuration_s === "number" && isFinite(data.routeDuration_s)) {
        setLastRouteDurationS(data.routeDuration_s);
        writeNum(LAST_ROUTE_DUR_S, data.routeDuration_s);
      }
    } catch (e: any) {
      setError(e?.message || "Optimization error.");
    } finally {
      setOptimizing(false);
    }
  }

  async function fetchPreviewAndOpenModal() {
    const start = getStartPayload();
    if (!start) {
      setError('Set a start first: click "Use my location" or enter a ZIP.');
      return;
    }

    if (activeItems.length < 2) {
      setError("Unskip at least 2 stops to optimize.");
      return;
    }

    const stops = activeItems.map((d) => ({
      id: d.id,
      query: buildStopQuery(d.name),
    }));

    setLoadingPreview(true);
    setModalDistances({});
    setModalEtas({});
    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...start, previewOnly: true, stops }),
      });

      const data = (await res.json()) as PreviewResp;

      if (!res.ok || !data?.preview || !Array.isArray(data?.stops)) {
        setError(data?.note || "Could not compute preview.");
        return;
      }

      const distMap: Record<string, number> = {};
      const etaMap: Record<string, number> = {};

      for (const s of data.stops) {
        distMap[s.id] = s.dist_mi;
        if (typeof s.eta_min === "number" && isFinite(s.eta_min)) etaMap[s.id] = s.eta_min;
      }

      setModalDistances(distMap);
      setModalEtas(etaMap);

      const suggested = data.suggestedDestinationId || activeItems[activeItems.length - 1]?.id || "";
      setModalChoice(suggested);
      setShowDestModal(true);
    } catch (e: any) {
      setError(e?.message || "Preview error.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function optimizeRoute() {
    setError("");
    setStatus("");

    if (activeItems.length < 2) {
      setError("Unskip at least 2 stops to optimize.");
      return;
    }

    if (destinationId && planIds.includes(destinationId) && !skippedSet.has(destinationId)) {
      await doOptimize();
      return;
    }

    if (promptOff) {
      await doOptimize();
      return;
    }

    await fetchPreviewAndOpenModal();
  }

  const routeLine = useMemo(() => {
    if (!lastRouteDurationS && !lastRouteDistanceM) return null;

    const parts: string[] = [];
    if (typeof lastRouteDurationS === "number") parts.push(`~${secondsToMinutes(lastRouteDurationS)} min`);
    if (typeof lastRouteDistanceM === "number") parts.push(`${metersToMiles(lastRouteDistanceM).toFixed(1)} mi`);
    return parts.join(" • ");
  }, [lastRouteDurationS, lastRouteDistanceM]);

  const routeSummary = useMemo(() => {
    if (!lastRouteOrder || lastRouteOrder.length === 0) return null;

    const byId = new Map<string, Deal>();
    for (const d of ALL_DEALS as Deal[]) byId.set(d.id, d);

    const orderedDeals = lastRouteOrder
      .filter((id) => !skippedSet.has(id))
      .map((id) => byId.get(id))
      .filter(Boolean) as Deal[];

    if (orderedDeals.length === 0) return null;
    return orderedDeals;
  }, [lastRouteOrder, skippedSet]);

  const nextStop: Deal | null = useMemo(() => {
    const candidates = routeSummary && routeSummary.length ? routeSummary : activeItems;
    for (const d of candidates) {
      if (!claimedSet.has(d.id) && !skippedSet.has(d.id)) return d;
    }
    return null;
  }, [routeSummary, activeItems, claimedSet, skippedSet]);

  function openNextStop() {
    if (!nextStop) return;
    openStopInMaps(nextStop);
  }

  async function shareRoute() {
    setError("");
    setStatus("");

    if (!routeSummary || routeSummary.length === 0) {
      setError("Optimize first so we have a route to share.");
      return;
    }

    setShareBusy(true);
    try {
      const z = (localStorage.getItem(ZIP_KEY) || "89109").trim();

      const stops = routeSummary.map((d, i) => `${i + 1}. ${d.name}`).join("\n");
      const stats = routeLine ? `Route: ${routeLine}` : "";
      const destName =
        destinationId && routeSummary.some((d) => d.id === destinationId)
          ? routeSummary.find((d) => d.id === destinationId)?.name
          : routeSummary[routeSummary.length - 1]?.name;

      const text =
        `BirthdayScout route\n` +
        `${stats ? stats + "\n" : ""}` +
        `${destName ? `Destination: ${destName}\n` : ""}` +
        `ZIP: ${z}\n` +
        `${skippedIds.length ? `Skipped today: ${skippedIds.length}\n` : ""}` +
        `\nStops:\n${stops}`;

      const ok = await copyText(text);
      if (ok) setStatus("Copied route to clipboard ✅");
      else setError("Could not copy (browser blocked clipboard).");
    } finally {
      setShareBusy(false);
    }
  }

  function toggleAutoOpenMaps(v: boolean) {
    setAutoOpenMaps(v);
    writeBool(AUTO_ADVANCE_OPEN_KEY, v);
    setStatus(v ? "Auto-advance: will open Maps after claiming." : "Auto-advance: will NOT open Maps automatically.");
  }

  const startLabel = hasGPSStart ? "Current location" : zip?.trim() ? `ZIP ${zip.trim()}` : "Not set";
  const destinationName =
    destinationId && items.some((d) => d.id === destinationId) ? items.find((d) => d.id === destinationId)?.name : "";

  const mapOrderedDeals = (routeSummary && routeSummary.length ? routeSummary : activeItems).map((d) => ({
    id: d.id,
    name: d.name,
    city: d.city,
  }));

  // ======= aesthetics =======
  const NARROW = "mx-auto w-full max-w-[1200px]";

  const GlassSection =
    "relative rounded-[28px] border border-white/14 bg-black/30 " +
    "shadow-[0_24px_90px_rgba(0,0,0,0.60)]";

  const GlassCard =
    "relative rounded-[26px] border border-white/14 bg-black/44 backdrop-blur-xl " +
    "shadow-[0_18px_70px_rgba(0,0,0,0.55)]";

  const NeonRim =
    "relative " +
    "before:content-[''] before:absolute before:inset-0 before:rounded-[26px] " +
    "before:ring-1 before:ring-emerald-200/18 " +
    "before:shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_0_46px_rgba(16,185,129,0.10)]";

  const NextRimGlow =
    "relative " +
    "after:content-[''] after:absolute after:inset-0 after:rounded-[26px] after:pointer-events-none " +
    "after:bg-[radial-gradient(80%_62%_at_50%_0%,rgba(16,185,129,0.44)_0%,rgba(16,185,129,0.18)_34%,rgba(0,0,0,0)_72%),radial-gradient(70%_90%_at_0%_55%,rgba(16,185,129,0.32)_0%,rgba(16,185,129,0.12)_40%,rgba(0,0,0,0)_72%),radial-gradient(70%_90%_at_100%_55%,rgba(16,185,129,0.32)_0%,rgba(16,185,129,0.12)_40%,rgba(0,0,0,0)_72%)] " +
    "after:blur-[20px] after:opacity-95 " +
    "before:content-[''] before:absolute before:inset-0 before:rounded-[26px] before:pointer-events-none " +
    "before:ring-1 before:ring-emerald-200/22 " +
    "before:bg-[linear-gradient(180deg,rgba(16,185,129,0.12)_0%,rgba(0,0,0,0.00)_46%)] " +
    "before:shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_-12px_56px_rgba(16,185,129,0.20),-18px_0_52px_rgba(16,185,129,0.16),18px_0_52px_rgba(16,185,129,0.16)]";

  const NextCtaBtn =
    "w-full rounded-2xl border border-emerald-200/26 px-5 py-3 text-[15px] font-medium text-emerald-50 " +
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.55)_0%,rgba(16,185,129,0.34)_48%,rgba(0,0,0,0.10)_100%)] " +
    "hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.62)_0%,rgba(16,185,129,0.38)_48%,rgba(0,0,0,0.12)_100%)] " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.14),0_18px_54px_rgba(0,0,0,0.62),0_0_34px_rgba(16,185,129,0.26)] " +
    "transition";

  const EmptyPrimaryBtn =
    "inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/22 px-5 py-3 text-[15px] font-medium text-emerald-50 " +
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.46)_0%,rgba(16,185,129,0.26)_55%,rgba(0,0,0,0.10)_100%)] " +
    "hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.54)_0%,rgba(16,185,129,0.30)_55%,rgba(0,0,0,0.12)_100%)] " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_18px_54px_rgba(0,0,0,0.62),0_0_34px_rgba(16,185,129,0.20)] " +
    "transition";

  return (
    <main className="relative min-h-screen overflow-x-hidden text-white">
      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bg-stars.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover select-none"
          style={{
            opacity: 1,
            transform: "translate3d(0,0,0)",
            filter: "saturate(1.15) contrast(1.08) brightness(1.12)",
          }}
          draggable={false}
        />
      </div>

      {/* OVERLAYS */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute inset-0 bg-[radial-gradient(1100px_760px_at_50%_18%,rgba(0,0,0,0.00)_0%,rgba(0,0,0,0.12)_55%,rgba(0,0,0,0.34)_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      {/* CONTENT */}
      <div className="relative z-20 px-6 pt-0 pb-[190px]">
        <div className="h-[72px]" />
        <div className={NARROW}>
          {/* Header / hero */}
          <header className="mb-8">
            <BrandLockup />

            <div className="pl-10 lg:pl-30 -mt-24">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/35 px-3 py-1 text-xs text-zinc-300">
                <IconDot on={hasGPSStart || !!zip.trim()} />
                Trip builder
              </div>

              <h1 className="mt-2 text-[46px] leading-[1.03] font-semibold tracking-tight">
                Your birthday route
              </h1>

              <p className="mt-2 max-w-[640px] text-[19px] leading-snug text-zinc-300/90">
                Plan stops, skip what you don’t want today, and
                <br className="hidden sm:block" /> open the optimized route in Maps.
              </p>
            </div>
          </header>

          {/* HERO CARDS */}
          <div className="grid gap-6 lg:gap-8 lg:grid-cols-2 items-start max-w-[980px] mx-auto">
            {/* Summary (left) */}
            <section className={`${GlassCard} p-7 lg:p-8 lg:translate-y-10`}>
              <div className="text-[12px] uppercase tracking-wider text-zinc-500">Summary</div>

              <div className="mt-2 text-[22px] font-semibold">
                {activeItems.length} active stops
                {skippedIds.length ? <span className="text-zinc-400"> • {skippedIds.length} skipped</span> : null}
              </div>

              <div className="mt-3 text-sm text-zinc-300/90">
                Start: <span className="text-white/90">{startLabel}</span>
                {destinationName ? (
                  <>
                    {" "}
                    • Destination: <span className="text-white/90">{destinationName}</span>
                  </>
                ) : (
                  <span className="text-zinc-500"> • Destination not set</span>
                )}
              </div>

              {routeLine ? <div className="mt-2 text-sm text-zinc-200/90">Route: {routeLine}</div> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Pill tone="neutral">
                  Progress {claimedCount}/{planIds.length}
                </Pill>
                <Pill tone="good">{pct}% complete</Pill>
                {lastOptimizedAt ? <Pill>Optimized {formatWhen(lastOptimizedAt)}</Pill> : <Pill>Not optimized</Pill>}
              </div>

              <div className="mt-5 relative h-2.5 w-full max-w-[520px] rounded-full bg-white/8 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full blur-lg"
                  style={{
                    width: `${progressPct}%`,
                    background: "rgba(16,185,129,0.35)",
                    opacity: 0.18 + 0.62 * glowT,
                  }}
                />
                <div
                  className="relative h-full rounded-full"
                  style={{
                    width: `${progressPct}%`,
                    backgroundImage: progBg,
                    boxShadow: progShadow,
                  }}
                >
                  <div
                    className="absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full"
                    style={{
                      background: "rgba(167,243,208,0.95)",
                      boxShadow: `0 0 ${14 + 30 * glowT}px rgba(16,185,129,${0.28 + 0.58 * glowT})`,
                      opacity: progressPct === 0 ? 0 : 1,
                    }}
                  />
                </div>
              </div>
            </section>

            {/* Right card */}
            <section className="flex flex-col gap-4 lg:-translate-y-34 lg:pl-2">
              {/* ✅ If there are no deals yet, show the empty-state card */}
              {!hasAnyPlanned ? (
                <div className={`${GlassCard} ${NextRimGlow} p-6 lg:p-8 w-full`}>
                  <div className="text-[12px] uppercase tracking-wider text-zinc-400">Get started</div>

                  <div className="mt-2 text-[32px] leading-[1.05] font-semibold">
                    Add deals to
                    <br />
                    build your route ✨
                  </div>

                  <p className="mt-3 text-[15px] leading-relaxed text-zinc-200/85">
                    Go to the Deals page and tap <span className="text-white/90 font-semibold">Add</span> on anything you
                    want to claim. Once you have stops, I’ll optimize the order and open it in Maps.
                  </p>

                  <Link href="/app/deals" className={`mt-5 ${EmptyPrimaryBtn}`}>
                    Browse deals →
                  </Link>
                </div>
              ) : activeItems.length ? (
                nextStop ? (
                  <div className={`${GlassCard} ${NextRimGlow} p-6 lg:p-8 w-full`}>
                    <div className="relative">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[12px] uppercase tracking-wider text-zinc-400">Next stop</div>
                          <div className="mt-2 text-[32px] leading-[1.05] font-semibold truncate">{nextStop.name}</div>
                          <div className="mt-2 text-[18px] text-zinc-200/90">
                            {nextStop.freebie || "Open it in Maps and grab your freebie."}
                          </div>
                        </div>

                        <div className="relative shrink-0">
                          <div className="pointer-events-none absolute -inset-6 rounded-full bg-emerald-300/12 blur-2xl" />
                          <BrandAvatar deal={nextStop} size={58} />
                        </div>
                      </div>

                      <button onClick={openNextStop} className={`mt-5 ${NextCtaBtn}`}>
                        Open in Maps →
                      </button>

                      <div className="mt-3 text-[12px] text-zinc-400">
                        Skips claimed &amp; “skipped today” automatically.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/12 bg-black/35 p-5 text-sm text-zinc-300">
                    No next stop — everything is claimed or skipped 🎉
                  </div>
                )
              ) : null}

              {/* ✅ Hide reset claimed when there are no planned deals */}
              {hasAnyPlanned ? (
                <div className="flex justify-end w-full">
                  <button
                    onClick={resetClaimed}
                    className="rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm hover:bg-white/5"
                  >
                    Reset claimed
                  </button>
                </div>
              ) : null}
            </section>
          </div>

          {status ? (
            <div className="mt-5 rounded-2xl border border-white/12 bg-black/35 p-4 text-sm text-zinc-200">
              {status}
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/8 p-4 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {/* Rail + Stops */}
          {items.length === 0 ? (
            <section className={`${GlassSection} mt-7 p-10 text-center text-zinc-300`}>
              Add deals from the Deals page to start planning your birthday run 🎉
              <div className="mt-5 flex justify-center">
                <Link href="/app/deals" className={EmptyPrimaryBtn}>
                  Browse deals →
                </Link>
              </div>
            </section>
          ) : (
            <section className={`${GlassSection} mt-14 max-w-[900px] mx-auto`}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/12">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">Stops</div>
                  <div className="text-sm text-zinc-300">
                    {routeSummary && routeSummary.length ? "Showing optimized order" : "Showing your saved order"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {skippedIds.length ? (
                    <button
                      onClick={clearSkipped}
                      className="rounded-full border border-white/12 bg-black/35 px-3.5 py-2 text-sm hover:bg-white/5"
                    >
                      Clear skipped
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="relative px-5 py-5">
                <div className="pointer-events-none absolute left-[30px] top-6 bottom-6 w-[6px] -translate-x-1/2 bg-emerald-200/10 blur-[6px]" />
                <div className="pointer-events-none absolute left-[30px] top-6 bottom-6 w-px bg-emerald-200/22" />
                <div className="pointer-events-none absolute left-[30px] top-6 h-40 w-px bg-gradient-to-b from-emerald-200/35 to-transparent" />
                <div className="pointer-events-none absolute left-[30px] bottom-6 h-40 w-px bg-gradient-to-t from-emerald-200/18 to-transparent" />
                <div className="pointer-events-none absolute left-[30px] bottom-[54px] h-2 w-2 -translate-x-1/2 rounded-full bg-emerald-200/70 shadow-[0_0_18px_rgba(16,185,129,0.45)]" />
                <div className="pointer-events-none absolute left-[30px] bottom-[38px] h-2 w-2 -translate-x-1/2 rounded-full bg-emerald-200/55 shadow-[0_0_14px_rgba(16,185,129,0.35)]" />

                {/* start node */}
                <div className="mb-5 flex items-start gap-4">
                  <div className="relative w-10 flex justify-center -translate-x-2.5">
                    <RailNode variant="start" />
                  </div>

                  <div className={`${GlassCard} flex-1 p-4`}>
                    <div className="flex items-center gap-3">
                      <LocationGlyph />
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Start</div>
                        <div className="mt-0.5 text-sm text-zinc-200">
                          {hasGPSStart ? "Current location (GPS)" : zip?.trim() ? `ZIP ${zip.trim()}` : "Not set"}
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            value={zip}
                            onChange={(e) => saveZip(e.target.value)}
                            placeholder="89109"
                            className="w-full rounded-xl border border-white/12 bg-black/35 px-4 py-2.5 text-sm outline-none focus:border-emerald-300/20 focus:ring-1 focus:ring-emerald-300/10"
                          />
                          <button
                            onClick={useMyLocation}
                            className="rounded-xl border border-white/12 bg-black/35 px-4 py-2.5 text-sm hover:bg-white/5"
                          >
                            Use my location
                          </button>
                        </div>

                        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            checked={autoOpenMaps}
                            onChange={(e) => toggleAutoOpenMaps(e.target.checked)}
                          />
                          Auto-open Maps after I claim
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* deals list */}
                <div className="space-y-4">
                  {items.map((d, idx) => {
                    const isClaimed = claimedSet.has(d.id);
                    const isDest = destinationId === d.id;
                    const isSkipped = skippedSet.has(d.id);
                    const isNext = !!nextStop && nextStop.id === d.id && !isClaimed && !isSkipped;

                    const statusPill = isClaimed ? (
                      <Pill tone="good">Claimed</Pill>
                    ) : isSkipped ? (
                      <Pill tone="warn">Skipped</Pill>
                    ) : (
                      <Pill>Planned</Pill>
                    );

                    const nodeVariant: "next" | "claimed" | "skipped" | "normal" = isNext
                      ? "next"
                      : isClaimed
                      ? "claimed"
                      : isSkipped
                      ? "skipped"
                      : "normal";

                    const ActionBtn = "rounded-full border px-3.5 py-2 text-sm hover:bg-white/5 transition-colors";

                    return (
                      <div key={d.id} className="flex items-start gap-4">
                        <div className="relative w-10 flex justify-center -translate-x-2.5">
                          <RailNode variant={nodeVariant} />
                        </div>

                        <div className="min-w-0 flex-1">
                          {isNext ? (
                            <div className={`${GlassCard} ${NeonRim} p-4`}>
                              <div className="relative">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] text-zinc-500">Stop {idx + 1}</span>
                                      {statusPill}
                                      {isDest ? <Pill>Final</Pill> : null}
                                      <Pill tone="good">Up next</Pill>
                                    </div>

                                    <div className="mt-3 flex items-center gap-3">
                                      <BrandAvatar deal={d} dim={isClaimed || isSkipped} size={40} />
                                      <div className="min-w-0">
                                        <div className="text-base font-semibold truncate">{d.name}</div>
                                        {d.freebie ? <div className="mt-1 text-sm text-zinc-200">{d.freebie}</div> : null}
                                        {d.conditions ? (
                                          <div className="mt-1 text-sm text-zinc-500">{d.conditions}</div>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="mt-4 flex flex-wrap gap-2">
                                      <button
                                        onClick={() => toggleClaim(d.id)}
                                        className="rounded-full border border-emerald-200/18 bg-black/35 px-3.5 py-2 text-sm text-emerald-50 hover:bg-white/5"
                                      >
                                        {isClaimed ? "Unclaim" : "Mark claimed"}
                                      </button>

                                      <button
                                        onClick={() => toggleSkipped(d.id)}
                                        className={`${ActionBtn} border-white/12 bg-black/35`}
                                      >
                                        {isSkipped ? "Unskip" : "Skip today"}
                                      </button>

                                      {!isDest ? (
                                        <button
                                          onClick={() => setAsDestination(d.id)}
                                          disabled={isSkipped}
                                          className={`${ActionBtn} border-white/12 bg-black/35 disabled:opacity-50`}
                                          title={isSkipped ? "Unskip it first to set as destination" : "Make destination"}
                                        >
                                          Make destination
                                        </button>
                                      ) : (
                                        <button
                                          onClick={clearDestination}
                                          className={`${ActionBtn} border-white/12 bg-black/35`}
                                        >
                                          Clear destination
                                        </button>
                                      )}

                                      <button
                                        onClick={() => removeFromPlan(d.id)}
                                        className={`${ActionBtn} border-red-500/25 bg-red-500/8 text-red-200 hover:bg-red-500/12`}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => openStopInMaps(d)}
                                    className="shrink-0 rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm hover:bg-white/5"
                                    title="Open this stop in Maps"
                                  >
                                    Maps
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`${GlassCard} p-4 ${isSkipped ? "opacity-70" : ""} ${isClaimed ? "opacity-85" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] text-zinc-500">Stop {idx + 1}</span>
                                    {statusPill}
                                    {isDest ? <Pill>Final</Pill> : null}
                                  </div>

                                  <div className="mt-3 flex items-center gap-3">
                                    <BrandAvatar deal={d} dim={isClaimed || isSkipped} size={40} />
                                    <div className="min-w-0">
                                      <div className="text-base font-semibold truncate">{d.name}</div>
                                      {d.freebie ? <div className="mt-1 text-sm text-zinc-200">{d.freebie}</div> : null}
                                      {d.conditions ? (
                                        <div className="mt-1 text-sm text-zinc-500">{d.conditions}</div>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                      onClick={() => toggleClaim(d.id)}
                                      className="rounded-full border border-emerald-200/18 bg-black/35 px-3.5 py-2 text-sm text-emerald-50 hover:bg-white/5"
                                    >
                                      {isClaimed ? "Unclaim" : "Mark claimed"}
                                    </button>

                                    <button
                                      onClick={() => toggleSkipped(d.id)}
                                      className="rounded-full border border-white/12 bg-black/35 px-3.5 py-2 text-sm hover:bg-white/5"
                                    >
                                      {isSkipped ? "Unskip" : "Skip today"}
                                    </button>

                                    {!isDest ? (
                                      <button
                                        onClick={() => setAsDestination(d.id)}
                                        disabled={isSkipped}
                                        className="rounded-full border border-white/12 bg-black/35 px-3.5 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
                                        title={isSkipped ? "Unskip it first to set as destination" : "Make destination"}
                                      >
                                        Make destination
                                      </button>
                                    ) : (
                                      <button
                                        onClick={clearDestination}
                                        className="rounded-full border border-white/12 bg-black/35 px-3.5 py-2 text-sm hover:bg-white/5"
                                      >
                                        Clear destination
                                      </button>
                                    )}

                                    <button
                                      onClick={() => removeFromPlan(d.id)}
                                      className="rounded-full border border-red-500/25 bg-red-500/8 px-3.5 py-2 text-sm text-red-200 hover:bg-red-500/12"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>

                                <button
                                  onClick={() => openStopInMaps(d)}
                                  className="shrink-0 rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm hover:bg-white/5"
                                >
                                  Maps
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 pb-5">
                <div className={`${GlassCard} p-4`}>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">Manage</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={clearPlan}
                      className="rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm hover:bg-white/5"
                    >
                      Clear plan
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">
                    Selected: {planIds.length} • Active: {activeItems.length} • Skipped: {skippedIds.length} • Claimed:{" "}
                    {claimedCount}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ✅ Hide sticky bottom dock when no deals are selected */}
      {hasAnyPlanned ? (
        <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
          <div
            className="mx-auto w-full max-w-[560px] px-5"
            style={{ paddingBottom: "calc(18px + env(safe-area-inset-bottom))" }}
          >
            <div className="pointer-events-auto relative rounded-[22px] border border-white/12 bg-black/50 backdrop-blur-md shadow-[0_30px_120px_rgba(0,0,0,0.70)] px-4 py-3">
              <div className="pointer-events-none absolute inset-x-4 -top-[1px] h-px bg-gradient-to-r from-transparent via-emerald-200/22 to-transparent" />
              <div className="pointer-events-none absolute inset-x-4 -bottom-[1px] h-px bg-gradient-to-r from-transparent via-emerald-200/14 to-transparent" />
              <div className="pointer-events-none absolute -top-10 left-10 right-10 h-16 rounded-full bg-emerald-300/10 blur-3xl" />

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-300">
                  {routeLine ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-200/70 shadow-[0_0_18px_rgba(16,185,129,0.35)]" />
                      {routeLine}
                    </span>
                  ) : (
                    "Optimize to compute ETA + distance"
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <OpenRouteButton orderedDeals={mapOrderedDeals} full />

                  <button
                    onClick={optimizeRoute}
                    disabled={optimizing || loadingPreview || shareBusy}
                    className={
                      "rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm text-zinc-100 " +
                      "hover:bg-white/5 disabled:opacity-50 shadow-[0_14px_45px_rgba(0,0,0,0.60)] transition"
                    }
                  >
                    {loadingPreview ? "Checking ETA..." : optimizing ? "Optimizing..." : "Optimize"}
                  </button>

                  <button
                    onClick={shareRoute}
                    disabled={optimizing || loadingPreview || shareBusy}
                    className={
                      "rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm text-zinc-100 " +
                      "hover:bg-white/5 disabled:opacity-50 shadow-[0_14px_45px_rgba(0,0,0,0.60)] transition"
                    }
                    title="Copy a route summary to your clipboard"
                  >
                    {shareBusy ? "Copying..." : "Share"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
