// app/api/optimize-route/route.ts
import { NextResponse } from "next/server";

type ReqBody = {
  startQuery?: string;
  startCoords?: { lat: number; lon: number };
  destinationId?: string;
  previewOnly?: boolean;
  stops: { id: string; query: string }[];
};

type Geo = { lon: number; lat: number };

const ORS_KEY = process.env.ORS_API_KEY;
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

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

// ---------- ORS geocode ----------
async function geocodeSearch(query: string, start: Geo, radiusMeters: number, size: number) {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const u = new URL("https://api.openrouteservice.org/geocode/search");
  u.searchParams.set("api_key", ORS_KEY);
  u.searchParams.set("text", query);
  u.searchParams.set("size", String(size));
  u.searchParams.set("boundary.country", "US");
  u.searchParams.set("layers", "venue,address");

  u.searchParams.set("focus.point.lat", String(start.lat));
  u.searchParams.set("focus.point.lon", String(start.lon));

  u.searchParams.set("boundary.circle.lat", String(start.lat));
  u.searchParams.set("boundary.circle.lon", String(start.lon));
  u.searchParams.set("boundary.circle.radius", String(radiusMeters));

  const res = await fetchWithTimeout(u.toString(), { cache: "no-store" }, 9000);
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const data = await res.json();
  const feats = data?.features;
  return Array.isArray(feats) ? feats : [];
}

async function geocodeClosest(query: string, start: Geo): Promise<Geo> {
  const passes = [
    { radius: 8000, size: 35 },
    { radius: 20000, size: 35 },
    { radius: 50000, size: 35 },
  ];

  const all: any[] = [];
  const seen = new Set<string>();

  for (const p of passes) {
    const feats = await geocodeSearch(query, start, p.radius, p.size);
    for (const f of feats) {
      const coords = f?.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const key = `${coords[0].toFixed(5)},${coords[1].toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(f);
    }
    if (all.length >= 15) break;
  }

  if (all.length === 0) throw new Error(`No geocode result for: ${query}`);

  let best = all[0];
  let bestDist = Infinity;

  for (const f of all) {
    const [lon, lat] = f.geometry.coordinates;
    const d = haversineMeters(start, { lat, lon });
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }

  const [lon, lat] = best.geometry.coordinates;
  return { lat, lon };
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

// ---------- chain detection ----------
function detectChain(query: string): { name: string } | null {
  const q = query.toLowerCase();
  if (q.includes("starbucks")) return { name: "Starbucks" };
  if (q.includes("chipotle")) return { name: "Chipotle" };
  if (q.includes("nothing bundt")) return { name: "Nothing Bundt Cakes" };
  return null;
}

// ---------- Google Places cache ----------
const placesCache = new Map<string, { at: number; geo: Geo }>();

// During dev you can set this to 30_000 to avoid “sticky wrong answers” while testing.
// In production, use 24h.
const PLACES_TTL_MS = 24 * 60 * 60 * 1000;

function placesCacheKey(name: string, start: Geo) {
  // ~1km grid so close-by queries reuse cached answer
  const lat = start.lat.toFixed(2);
  const lon = start.lon.toFixed(2);
  return `${name}:${lat},${lon}`;
}

// ---------- Google Places: nearest STRICT match by name ----------
async function placesNearestByName(start: Geo, name: string): Promise<Geo> {
  if (!GOOGLE_PLACES_KEY) throw new Error("Missing GOOGLE_PLACES_API_KEY in env");

  const key = placesCacheKey(name, start);
  const cached = placesCache.get(key);
  if (cached && Date.now() - cached.at < PLACES_TTL_MS) return cached.geo;

  const target = name.toLowerCase();

  function isGoodMatch(r: any) {
    const n = String(r?.name || "").toLowerCase();
    // strict: must include chain name in the returned place name
    return n.includes(target);
  }

  function pickFirst(arr: any[]): Geo | null {
    const first = arr[0];
    const lat = first?.geometry?.location?.lat;
    const lon = first?.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    return { lat, lon };
  }

  // 1) rankby=distance (fast), but filter strictly
  const u1 = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  u1.searchParams.set("key", GOOGLE_PLACES_KEY);
  u1.searchParams.set("location", `${start.lat},${start.lon}`);
  u1.searchParams.set("rankby", "distance");
  u1.searchParams.set("name", name); // ✅ stricter than keyword

  const res1 = await fetchWithTimeout(u1.toString(), { cache: "no-store" }, 8000);
  if (!res1.ok) throw new Error(`Places NearbySearch failed (${res1.status})`);
  const data1 = await res1.json();

  const results1: any[] = Array.isArray(data1?.results) ? data1.results : [];
  const good1 = results1.filter(isGoodMatch);
  const got1 = pickFirst(good1);

  if (got1) {
    placesCache.set(key, { at: Date.now(), geo: got1 });
    return got1;
  }

  // 2) fallback: radius search (more results), then choose closest by haversine
  const u2 = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  u2.searchParams.set("key", GOOGLE_PLACES_KEY);
  u2.searchParams.set("location", `${start.lat},${start.lon}`);
  u2.searchParams.set("radius", "50000"); // 50km
  u2.searchParams.set("name", name);

  const res2 = await fetchWithTimeout(u2.toString(), { cache: "no-store" }, 8000);
  if (!res2.ok) throw new Error(`Places NearbySearch (radius) failed (${res2.status})`);
  const data2 = await res2.json();

  const results2: any[] = Array.isArray(data2?.results) ? data2.results : [];
  const good2 = results2.filter(isGoodMatch);

  if (good2.length === 0) {
    const status = data2?.status ? String(data2.status) : "unknown";
    throw new Error(`Places returned no strict match for "${name}" (status=${status})`);
  }

  good2.sort((a, b) => {
    const al = a?.geometry?.location;
    const bl = b?.geometry?.location;

    const ag: Geo | null =
      typeof al?.lat === "number" && typeof al?.lng === "number" ? { lat: al.lat, lon: al.lng } : null;
    const bg: Geo | null =
      typeof bl?.lat === "number" && typeof bl?.lng === "number" ? { lat: bl.lat, lon: bl.lng } : null;

    if (!ag && !bg) return 0;
    if (!ag) return 1;
    if (!bg) return -1;

    return haversineMeters(start, ag) - haversineMeters(start, bg);
  });

  const got2 = pickFirst(good2);
  if (!got2) throw new Error(`Places strict match had bad geometry for "${name}"`);

  placesCache.set(key, { at: Date.now(), geo: got2 });
  return got2;
}

// ---------- resolve stop ----------
async function resolveStopGeo(query: string, start: Geo): Promise<{ geo: Geo; pickedFrom: string }> {
  const chain = detectChain(query);

  // Chains => Google Places strict nearest
  if (chain) {
    const geo = await placesNearestByName(start, chain.name);
    return { geo, pickedFrom: `google_places:${chain.name}` };
  }

  // Non-chain => ORS geocode closest
  const geo = await geocodeClosest(query, start);
  return { geo, pickedFrom: "ors" };
}

export async function POST(req: Request) {
  try {
    if (!ORS_KEY) {
      return NextResponse.json({ optimized: false, note: "Missing ORS_API_KEY" }, { status: 500 });
    }
    if (!GOOGLE_PLACES_KEY) {
      return NextResponse.json({ optimized: false, note: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
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
      const vegasSeed = { lat: 36.1699, lon: -115.1398 };
      start = await geocodeClosest(`${body.startQuery.trim()} United States`, vegasSeed);
      startSource = "zip";
    } else {
      return NextResponse.json({ optimized: false, note: "Missing start (coords or zip)" }, { status: 400 });
    }

    // ---- resolve stop coords ----
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
      return NextResponse.json({ optimized: false, note: `ORS optimization failed (${optRes.status}): ${txt}` }, { status: 502 });
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
      { optimized: false, note: e?.name === "AbortError" ? "Request timed out. Try again." : e?.message || "Server error" },
      { status: 500 }
    );
  }
}
