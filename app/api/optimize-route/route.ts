// app/api/optimize-route/route.ts
import { NextResponse } from "next/server";

type ReqBody = {
  startQuery?: string; // ZIP in your UI
  startCoords?: { lat: number; lon: number }; // GPS mode
  destinationId?: string;
  previewOnly?: boolean;
  stops: { id: string; query: string }[]; // query should be mapQuery/name (no Vegas hardcoding)
};

type Geo = { lon: number; lat: number };

const ORS_KEY = process.env.ORS_API_KEY;

// ---------- fetch with timeout ----------
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- distance ----------
function haversineMeters(a: Geo, b: Geo) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function metersToMiles(m: number) {
  return m / 1609.34;
}

// ---------- ORS matrix (start -> each stop) ----------
async function matrixFromStart(start: Geo, stops: Geo[]) {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const locations = [[start.lon, start.lat], ...stops.map((s) => [s.lon, s.lat])];
  const destinations = stops.map((_, i) => i + 1);

  const body = {
    locations,
    sources: [0],
    destinations,
    metrics: ["distance", "duration"],
    units: "m",
  };

  const res = await fetchWithTimeout(
    "https://api.openrouteservice.org/v2/matrix/driving-car",
    {
      method: "POST",
      headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    9000
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ORS matrix failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const distances = data?.distances?.[0];
  const durations = data?.durations?.[0];

  if (!Array.isArray(distances) || !Array.isArray(durations)) {
    throw new Error("ORS matrix returned unexpected format");
  }

  return { distances, durations };
}

// ---------- ORS Geocode (Pelias) ----------
// This is the key change: instead of Nominatim (which can return “random top 10”),
// we bias each brand query near the user's start point using focus.point.*.
async function geocodeZipORS(zip: string): Promise<Geo> {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const z = zip.trim();
  if (!z) throw new Error("Missing ZIP");

  const u = new URL("https://api.openrouteservice.org/geocode/search");
  u.searchParams.set("text", `${z} United States`);
  u.searchParams.set("size", "1");
  u.searchParams.set("boundary.country", "USA");

  const res = await fetchWithTimeout(
    u.toString(),
    { method: "GET", headers: { Authorization: ORS_KEY }, cache: "no-store" },
    9000
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ORS ZIP geocode failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const f = data?.features?.[0];
  const coords = f?.geometry?.coordinates;

  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error(`Could not geocode ZIP: ${z}`);
  }

  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!isFinite(lat) || !isFinite(lon)) throw new Error(`Bad ZIP geocode for: ${z}`);

  return { lat, lon };
}

async function orsNearest(query: string, near: Geo): Promise<Geo> {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const q = query.trim();
  if (!q) throw new Error("Empty place query");

  const u = new URL("https://api.openrouteservice.org/geocode/search");
  u.searchParams.set("text", q);
  u.searchParams.set("size", "20");

  // bias near the start point
  u.searchParams.set("focus.point.lat", String(near.lat));
  u.searchParams.set("focus.point.lon", String(near.lon));

  // keep in US
  u.searchParams.set("boundary.country", "USA");

  const res = await fetchWithTimeout(
    u.toString(),
    { method: "GET", headers: { Authorization: ORS_KEY }, cache: "no-store" },
    9000
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ORS place geocode failed (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const feats = data?.features;
  if (!Array.isArray(feats) || feats.length === 0) {
    throw new Error(`No ORS results for: ${q}`);
  }

  // pick closest returned feature (extra safety)
  let best: Geo | null = null;
  let bestDist = Infinity;

  for (const f of feats) {
    const coords = f?.geometry?.coordinates; // [lon, lat]
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isFinite(lat) || !isFinite(lon)) continue;

    const g = { lat, lon };
    const d = haversineMeters(near, g);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }

  if (!best) throw new Error("ORS results had no valid coordinates");
  return best;
}

// ---------- resolve stop ----------
async function resolveStopGeo(query: string, start: Geo): Promise<{ geo: Geo; pickedFrom: string }> {
  const geo = await orsNearest(query, start);
  return { geo, pickedFrom: "ors-geocode" };
}

export async function POST(req: Request) {
  try {
    if (!ORS_KEY) {
      return NextResponse.json({ optimized: false, note: "Missing ORS_API_KEY" }, { status: 500 });
    }

    const body = (await req.json()) as ReqBody;
    const stopsIn = Array.isArray(body.stops) ? body.stops : [];

    if (stopsIn.length === 0) {
      return NextResponse.json({ optimized: false, orderedIds: [], note: "No stops provided" }, { status: 400 });
    }

    // ---- start ----
    let start: Geo | null = null;
    let startSource: "gps" | "zip" = "zip";

    if (body.startCoords && typeof body.startCoords.lat === "number" && typeof body.startCoords.lon === "number") {
      start = { lat: body.startCoords.lat, lon: body.startCoords.lon };
      startSource = "gps";
    } else if (body.startQuery && body.startQuery.trim()) {
      // key change: use ORS for ZIP geocode too (more consistent)
      start = await geocodeZipORS(body.startQuery.trim());
      startSource = "zip";
    } else {
      return NextResponse.json({ optimized: false, note: "Missing start (coords or zip)" }, { status: 400 });
    }

    // ---- resolve stop coords (near the start) ----
    const resolvedStopsBase = await Promise.all(
      stopsIn.map(async (s) => {
        const { geo, pickedFrom } = await resolveStopGeo(s.query, start!);
        const dist_m = haversineMeters(start!, geo);
        return {
          id: s.id,
          query: s.query,
          pickedFrom,
          geo,
          dist_mi: metersToMiles(dist_m),
        };
      })
    );

    // ---- driving distance + ETA from start ----
    let drivingMeters: number[] | null = null;
    let drivingSeconds: number[] | null = null;

    try {
      const { distances, durations } = await matrixFromStart(start!, resolvedStopsBase.map((s) => s.geo));
      drivingMeters = distances.map((x: any) => (typeof x === "number" ? x : NaN));
      drivingSeconds = durations.map((x: any) => (typeof x === "number" ? x : NaN));
    } catch {
      drivingMeters = null;
      drivingSeconds = null;
    }

    const resolvedStops = resolvedStopsBase.map((s, idx) => {
      const m = drivingMeters?.[idx];
      const sec = drivingSeconds?.[idx];

      const driveDistMi = typeof m === "number" && isFinite(m) ? metersToMiles(m) : undefined;
      const etaMin = typeof sec === "number" && isFinite(sec) ? Math.max(1, Math.round(sec / 60)) : undefined;

      return { ...s, drive_mi: driveDistMi, eta_min: etaMin };
    });

    // ---- suggested destination (farthest; prefer driving miles) ----
    let suggested = resolvedStops[0];
    for (const s of resolvedStops) {
      const a = typeof s.drive_mi === "number" ? s.drive_mi : s.dist_mi;
      const b = typeof suggested.drive_mi === "number" ? suggested.drive_mi : suggested.dist_mi;
      if (a > b) suggested = s;
    }

    // ---- previewOnly ----
    if (body.previewOnly) {
      return NextResponse.json({
        preview: true,
        optimized: false,
        startUsed: { lat: start!.lat, lon: start!.lon, source: startSource },
        suggestedDestinationId: suggested.id,
        stops: resolvedStops.map((s) => ({
          id: s.id,
          dist_mi: typeof s.drive_mi === "number" ? s.drive_mi : s.dist_mi,
          eta_min: s.eta_min,
          lat: s.geo.lat,
          lon: s.geo.lon,
          pickedFrom: s.pickedFrom,
        })),
        note: "Preview distances + ETA computed",
      });
    }

    // ---- destination ----
    const requestedDest = (body.destinationId || "").trim();
    const destExists = requestedDest && resolvedStops.some((s) => s.id === requestedDest);
    const destinationId = destExists ? requestedDest : suggested.id;

    const jobsList = resolvedStops.filter((s) => s.id !== destinationId);

    const intToId = new Map<number, string>();
    const jobs = jobsList.map((s, idx) => {
      const jobId = idx + 1;
      intToId.set(jobId, s.id);
      return { id: jobId, location: [s.geo.lon, s.geo.lat] };
    });

    const destStop = resolvedStops.find((s) => s.id === destinationId)!;

    const vehicle = {
      id: 1,
      profile: "driving-car",
      start: [start!.lon, start!.lat],
      end: [destStop.geo.lon, destStop.geo.lat],
    };

    const optRes = await fetchWithTimeout(
      "https://api.openrouteservice.org/optimization",
      {
        method: "POST",
        headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ jobs, vehicles: [vehicle] }),
      },
      20000
    );

    if (!optRes.ok) {
      const txt = await optRes.text();
      return NextResponse.json(
        { optimized: false, note: `ORS optimization failed (${optRes.status}): ${txt}` },
        { status: 502 }
      );
    }

    const opt = await optRes.json();
    const route = opt?.routes?.[0];
    const steps = route?.steps ?? [];

    const orderedIntermediate: string[] = [];
    for (const step of steps) {
      if (typeof step?.job === "number") {
        const realId = intToId.get(step.job);
        if (realId) orderedIntermediate.push(realId);
      }
    }

    const orderedIds = [...orderedIntermediate, destinationId];

    const routeDistance_m = typeof route?.distance === "number" && isFinite(route.distance) ? route.distance : undefined;
    const routeDuration_s = typeof route?.duration === "number" && isFinite(route.duration) ? route.duration : undefined;

    return NextResponse.json({
      optimized: true,
      orderedIds,
      destinationId,
      note: "Optimized route",
      routeDistance_m,
      routeDuration_s,
      startUsed: { lat: start!.lat, lon: start!.lon, source: startSource },
      resolvedStops: resolvedStops.map((s) => ({
        id: s.id,
        lat: s.geo.lat,
        lon: s.geo.lon,
        pickedFrom: s.pickedFrom,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        optimized: false,
        note: e?.name === "AbortError" ? "Request timed out. Try again." : e?.message || "Server error",
      },
      { status: 500 }
    );
  }
}
