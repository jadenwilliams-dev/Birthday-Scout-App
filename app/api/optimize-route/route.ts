// app/api/optimize-route/route.ts
// This endpoint takes a start location + a list of birthday-deal stops,
// resolves each stop to real coordinates (using Google Places for chains and ORS for everything else),
// optionally returns a preview (distances/ETAs), and otherwise asks ORS Optimization to order the route.

import { NextResponse } from "next/server";

// Force Node runtime (not Edge) so AbortController + timeouts behave consistently.
export const runtime = "nodejs"; // ensure Node runtime (not Edge)

// Shape of the request body coming from the client.
type ReqBody = {
  startQuery?: string; // zip or text (ex: "89109" or "Tempe AZ" or "123 Main St")
  startCoords?: { lat: number; lon: number }; // GPS override (from browser location)
  destinationId?: string; // optional: force the final stop
  previewOnly?: boolean; // optional: skip optimization and just return distances + ETA
  stops: { id: string; query: string }[]; // stops user wants to visit (id + human query string)
};

// Internal lat/lon container (we keep naming consistent throughout the file).
type Geo = { lon: number; lat: number };

// API keys pulled from env (fail fast if missing).
const ORS_KEY = process.env.ORS_API_KEY;
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

// ---------- fetch with timeout ----------
// A small fetch helper that aborts if the API call takes too long.
// This prevents the request from hanging forever when ORS/Google is slow.
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
// Straight-line (great-circle) distance in meters.
// Used to pick the closest geocode candidate and as a fallback if matrix fails.
function haversineMeters(a: Geo, b: Geo) {
  const R = 6371000; // Earth radius in meters
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

// Convert meters → miles for UI-friendly display.
function metersToMiles(m: number) {
  return m / 1609.34;
}

// ---------- ORS geocode ----------
// Search ORS geocoding near the user's start point.
// We do multiple passes (small radius → bigger radius) elsewhere to find a usable result.
async function geocodeSearch(query: string, start: Geo, radiusMeters: number, size: number) {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const u = new URL("https://api.openrouteservice.org/geocode/search");
  u.searchParams.set("api_key", ORS_KEY);
  u.searchParams.set("text", query);
  u.searchParams.set("size", String(size));
  u.searchParams.set("boundary.country", "US");
  u.searchParams.set("layers", "venue,address");

  // Bias results toward start so "Starbucks" doesn't randomly land in another city.
  u.searchParams.set("focus.point.lat", String(start.lat));
  u.searchParams.set("focus.point.lon", String(start.lon));

  // Hard bound results inside a circle around the start.
  u.searchParams.set("boundary.circle.lat", String(start.lat));
  u.searchParams.set("boundary.circle.lon", String(start.lon));
  u.searchParams.set("boundary.circle.radius", String(radiusMeters));

  const res = await fetchWithTimeout(u.toString(), { cache: "no-store" }, 9000);
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const data = await res.json();
  const feats = data?.features;
  return Array.isArray(feats) ? feats : [];
}

// Pick the physically closest ORS geocode result to the start point.
// We gather candidates from multiple radius passes and dedupe them.
async function geocodeClosest(query: string, start: Geo): Promise<Geo> {
  const passes = [
    { radius: 8000, size: 35 }, // tight search first
    { radius: 20000, size: 35 }, // widen if needed
    { radius: 50000, size: 35 }, // last resort (still local-ish)
  ];

  const all: any[] = [];
  const seen = new Set<string>();

  // Build a pool of candidates across radius passes.
  for (const p of passes) {
    const feats = await geocodeSearch(query, start, p.radius, p.size);
    for (const f of feats) {
      const coords = f?.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      // Dedupe by rounded coordinate so we don't evaluate the same place repeatedly.
      const key = `${coords[0].toFixed(5)},${coords[1].toFixed(5)}`;
      if (seen.has(key)) continue;

      seen.add(key);
      all.push(f);
    }
    // Once we have enough candidates, stop expanding.
    if (all.length >= 15) break;
  }

  if (all.length === 0) throw new Error(`No geocode result for: ${query}`);

  // Find the closest candidate by straight-line distance.
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

// Basic ZIP recognition so we can use the postalcode layer when possible.
function isZip(s: string) {
  // Accept 5-digit ZIP or ZIP+4 (12345-6789)
  return /^\d{5}(-\d{4})?$/.test(s.trim());
}

// Geocode a ZIP using ORS postalcode results (usually the cleanest way to start).
async function geocodeZip(zip: string): Promise<Geo> {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const u = new URL("https://api.openrouteservice.org/geocode/search");
  u.searchParams.set("api_key", ORS_KEY);
  u.searchParams.set("text", zip);
  u.searchParams.set("size", "5");
  u.searchParams.set("boundary.country", "US");
  u.searchParams.set("layers", "postalcode");

  const res = await fetchWithTimeout(u.toString(), { cache: "no-store" }, 9000);
  if (!res.ok) throw new Error(`ZIP geocode failed (${res.status})`);

  const data = await res.json();
  const feats = Array.isArray(data?.features) ? data.features : [];
  if (!feats.length) throw new Error(`No ZIP result for: ${zip}`);

  // For postal codes, first result is usually fine.
  const [lon, lat] = feats[0].geometry.coordinates;
  return { lat, lon };
}

// ---------- Start geocode for non-zip text (NO Vegas bias) ----------
// This is only for the *start* when the user types a city/address string.
// We DO NOT bias toward Las Vegas here — we allow the query to resolve naturally.
async function geocodeStartText(query: string): Promise<Geo> {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  const u = new URL("https://api.openrouteservice.org/geocode/search");
  u.searchParams.set("api_key", ORS_KEY);
  u.searchParams.set("text", query);
  u.searchParams.set("size", "5");
  u.searchParams.set("boundary.country", "US");
  u.searchParams.set("layers", "locality,borough,neighbourhood,county,region,address,venue,postalcode");

  const res = await fetchWithTimeout(u.toString(), { cache: "no-store" }, 9000);
  if (!res.ok) throw new Error(`Start geocode failed (${res.status})`);

  const data = await res.json();
  const feats = Array.isArray(data?.features) ? data.features : [];
  if (!feats.length) throw new Error(`No start result for: ${query}`);

  const [lon, lat] = feats[0].geometry.coordinates;
  return { lat, lon };
}

// ---------- ORS matrix (start -> each stop) ----------
// One request to get driving distance + duration from the start to each stop.
// This is used for realistic "how far" + ETA shown to the user.
async function matrixFromStart(start: Geo, stops: Geo[]) {
  if (!ORS_KEY) throw new Error("Missing ORS_API_KEY in env");

  // ORS matrix expects [lon,lat] arrays.
  const locations = [[start.lon, start.lat], ...stops.map((s) => [s.lon, s.lat])];

  // Source index 0 is our start; destinations are each stop index.
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

  // Defensive check: sometimes APIs return weird shapes on partial failure.
  if (!Array.isArray(distances) || !Array.isArray(durations)) {
    throw new Error("ORS matrix returned unexpected format");
  }

  return { distances, durations };
}

// ---------- chain detection ----------
// Some stops are "chains" where geocoding can be ambiguous.
// For those, we use Google Places to find the nearest real location by name.
function detectChain(query: string): { name: string } | null {
  const q = query.toLowerCase();
  if (q.includes("starbucks")) return { name: "Starbucks" };
  if (q.includes("chipotle")) return { name: "Chipotle" };
  if (q.includes("nothing bundt")) return { name: "Nothing Bundt Cakes" };
  return null;
}

// ---------- Google Places cache ----------
// Small in-memory cache to avoid hammering Google Places for the same chain
// around the same start area.
const placesCache = new Map<string, { at: number; geo: Geo }>();
const PLACES_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function placesCacheKey(name: string, start: Geo) {
  // Round start coords so cache isn't too granular (and stays useful).
  const lat = start.lat.toFixed(2);
  const lon = start.lon.toFixed(2);
  return `${name}:${lat},${lon}`;
}

// ---------- Google Places: nearest STRICT match by name ----------
// Finds the nearest business whose name includes the chain name.
// We keep this strict because the whole point is avoiding random wrong picks.
async function placesNearestByName(start: Geo, name: string): Promise<Geo> {
  if (!GOOGLE_PLACES_KEY) throw new Error("Missing GOOGLE_PLACES_API_KEY in env");

  // Cache lookup first
  const key = placesCacheKey(name, start);
  const cached = placesCache.get(key);
  if (cached && Date.now() - cached.at < PLACES_TTL_MS) return cached.geo;

  const target = name.toLowerCase();

  // Simple "strict enough" filter: result name must contain our chain name.
  function isGoodMatch(r: any) {
    const n = String(r?.name || "").toLowerCase();
    return n.includes(target);
  }

  // Convert the first Google result into our {lat,lon} shape.
  function pickFirst(arr: any[]): Geo | null {
    const first = arr[0];
    const lat = first?.geometry?.location?.lat;
    const lon = first?.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    return { lat, lon };
  }

  // 1) Best case: rankby=distance gives closest results without a radius limit.
  const u1 = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  u1.searchParams.set("key", GOOGLE_PLACES_KEY);
  u1.searchParams.set("location", `${start.lat},${start.lon}`);
  u1.searchParams.set("rankby", "distance");
  u1.searchParams.set("name", name);

  const res1 = await fetchWithTimeout(u1.toString(), { cache: "no-store" }, 8000);
  if (!res1.ok) throw new Error(`Places NearbySearch failed (${res1.status})`);
  const data1 = await res1.json();

  const results1: any[] = Array.isArray(data1?.results) ? data1.results : [];
  const good1 = results1.filter(isGoodMatch);
  const got1 = pickFirst(good1);

  // If we found a strict match, cache it and return.
  if (got1) {
    placesCache.set(key, { at: Date.now(), geo: got1 });
    return got1;
  }

  // 2) Fallback: use a radius (50km) and manually choose closest by haversine.
  const u2 = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  u2.searchParams.set("key", GOOGLE_PLACES_KEY);
  u2.searchParams.set("location", `${start.lat},${start.lon}`);
  u2.searchParams.set("radius", "50000");
  u2.searchParams.set("name", name);

  const res2 = await fetchWithTimeout(u2.toString(), { cache: "no-store" }, 8000);
  if (!res2.ok) throw new Error(`Places NearbySearch (radius) failed (${res2.status})`);
  const data2 = await res2.json();

  const results2: any[] = Array.isArray(data2?.results) ? data2.results : [];
  const good2 = results2.filter(isGoodMatch);

  // If nothing matched strictly, bail with a useful error.
  if (good2.length === 0) {
    const status = data2?.status ? String(data2.status) : "unknown";
    throw new Error(`Places returned no strict match for "${name}" (status=${status})`);
  }

  // Sort candidates by physical distance to start (closest first).
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

  // Pull the closest candidate and validate geometry.
  const got2 = pickFirst(good2);
  if (!got2) throw new Error(`Places strict match had bad geometry for "${name}"`);

  // Cache result so repeat calls are fast/cheap.
  placesCache.set(key, { at: Date.now(), geo: got2 });
  return got2;
}

// ---------- resolve stop ----------
// Decide how we resolve each stop query:
// - chains go to Google Places (nearest real store)
// - non-chains go to ORS geocode (closest match around start)
async function resolveStopGeo(query: string, start: Geo): Promise<{ geo: Geo; pickedFrom: string }> {
  const chain = detectChain(query);

  // Chains => Google Places strict nearest (better for Starbucks/Chipotle style queries)
  if (chain) {
    const geo = await placesNearestByName(start, chain.name);
    return { geo, pickedFrom: `google_places:${chain.name}` };
  }

  // Everything else → ORS geocoding closest to the start area
  const geo = await geocodeClosest(query, start);
  return { geo, pickedFrom: "ors" };
}

export async function POST(req: Request) {
  try {
    // These keys are required for the endpoint to do its job.
    if (!ORS_KEY) return NextResponse.json({ optimized: false, note: "Missing ORS_API_KEY" }, { status: 500 });
    if (!GOOGLE_PLACES_KEY)
      return NextResponse.json({ optimized: false, note: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });

    // Read request payload
    const body = (await req.json()) as ReqBody;

    // Defensive: normalize stops to an array
    const stopsIn = Array.isArray(body.stops) ? body.stops : [];

    // Nothing to optimize if stops are empty
    if (stopsIn.length === 0) {
      return NextResponse.json({ optimized: false, orderedIds: [], note: "No stops provided" }, { status: 400 });
    }

    // ---- start ----
    // Resolve the user's start location to coordinates.
    // Priority: GPS coords > ZIP/text query.
    let start: Geo | null = null;
    let startSource: "gps" | "zip" = "zip";

    // If the client sent explicit coordinates, trust those (this is the most accurate)
    if (body.startCoords && typeof body.startCoords.lat === "number" && typeof body.startCoords.lon === "number") {
      start = { lat: body.startCoords.lat, lon: body.startCoords.lon };
      startSource = "gps";
    } else if (body.startQuery && body.startQuery.trim()) {
      // Otherwise use the text input
      const q = body.startQuery.trim();

      if (isZip(q)) {
        // ZIP (or ZIP+4) → coords
        start = await geocodeZip(q);
        startSource = "zip";
      } else {
        // Free-text start location (no Vegas bias)
        start = await geocodeStartText(q);
        startSource = "zip";
      }
    } else {
      // If neither coords nor a usable query exist, we can't proceed.
      return NextResponse.json({ optimized: false, note: "Missing start (coords or zip)" }, { status: 400 });
    }

    // ---- resolve stop coords ----
    // Turn each stop query into a real coordinate near the start location.
    // Also compute straight-line distance as a quick baseline.
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
    // Attempt to get driving distances + durations using ORS matrix.
    // If it fails (rate limit, timeout, etc.), we still return something usable.
    let drivingMeters: number[] | null = null;
    let drivingSeconds: number[] | null = null;

    try {
      const { distances, durations } = await matrixFromStart(start!, resolvedStopsBase.map((s) => s.geo));
      drivingMeters = distances.map((x: any) => (typeof x === "number" ? x : NaN));
      drivingSeconds = durations.map((x: any) => (typeof x === "number" ? x : NaN));
    } catch {
      // Non-fatal fallback: UI can use straight-line distance if matrix fails.
      drivingMeters = null;
      drivingSeconds = null;
    }

    // Merge driving numbers into each stop (when available).
    const resolvedStops = resolvedStopsBase.map((s, idx) => {
      const m = drivingMeters?.[idx];
      const sec = drivingSeconds?.[idx];

      // If matrix gave a valid number, show the driving distance; otherwise omit.
      const driveDistMi = typeof m === "number" && isFinite(m) ? metersToMiles(m) : undefined;

      // ETA shown in whole minutes, minimum of 1 minute when present.
      const etaMin = typeof sec === "number" && isFinite(sec) ? Math.max(1, Math.round(sec / 60)) : undefined;

      return { ...s, drive_mi: driveDistMi, eta_min: etaMin };
    });

    // ---- suggested destination (farthest; prefer driving miles) ----
    // Heuristic: make the farthest stop the "destination" so the optimizer ends there.
    // Prefer driving distance if we have it; otherwise fall back to straight-line distance.
    let suggested = resolvedStops[0];
    for (const s of resolvedStops) {
      const a = typeof s.drive_mi === "number" ? s.drive_mi : s.dist_mi;
      const b = typeof suggested.drive_mi === "number" ? suggested.drive_mi : suggested.dist_mi;
      if (a > b) suggested = s;
    }

    // ---- previewOnly ----
    // Preview mode is used by the UI to show distances/ETAs and a suggested destination
    // without committing to an optimized order yet.
    if (body.previewOnly) {
      return NextResponse.json({
        preview: true,
        optimized: false,
        startUsed: { lat: start!.lat, lon: start!.lon, source: startSource },
        suggestedDestinationId: suggested.id,
        stops: resolvedStops.map((s) => ({
          id: s.id,
          // Prefer driving distance when available for realism
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
    // Allow the client to force a destination, but only if it's actually in the stop list.
    const requestedDest = (body.destinationId || "").trim();
    const destExists = requestedDest && resolvedStops.some((s) => s.id === requestedDest);

    // If invalid or missing, use our suggested farthest stop
    const destinationId = destExists ? requestedDest : suggested.id;

    // ORS optimization expects "jobs" = intermediate stops only (destination handled by vehicle end)
    const jobsList = resolvedStops.filter((s) => s.id !== destinationId);

    // ORS wants numeric job IDs, so we map int IDs back to our real string IDs.
    const intToId = new Map<number, string>();
    const jobs = jobsList.map((s, idx) => {
      const jobId = idx + 1; // ORS job ids are integers
      intToId.set(jobId, s.id);
      return { id: jobId, location: [s.geo.lon, s.geo.lat] };
    });

    // Destination stop (final location)
    const destStop = resolvedStops.find((s) => s.id === destinationId)!;

    // Single vehicle route: start at start coords, end at destination coords
    const vehicle = {
      id: 1,
      profile: "driving-car",
      start: [start!.lon, start!.lat],
      end: [destStop.geo.lon, destStop.geo.lat],
    };

    // Call ORS Optimization to compute best visit order for the jobs
    const optRes = await fetchWithTimeout(
      "https://api.openrouteservice.org/optimization",
      {
        method: "POST",
        headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ jobs, vehicles: [vehicle] }),
      },
      20000 // optimization can take longer than geocode/matrix
    );

    // If ORS optimization fails, return a helpful message to the client.
    if (!optRes.ok) {
      const txt = await optRes.text();
      return NextResponse.json(
        { optimized: false, note: `ORS optimization failed (${optRes.status}): ${txt}` },
        { status: 502 }
      );
    }

    // Parse optimization response
    const opt = await optRes.json();
    const route = opt?.routes?.[0];
    const steps = route?.steps ?? [];

    // ORS returns steps that reference numeric job IDs — convert them back to our real stop IDs.
    const orderedIntermediate: string[] = [];
    for (const step of steps) {
      if (typeof step?.job === "number") {
        const realId = intToId.get(step.job);
        if (realId) orderedIntermediate.push(realId);
      }
    }

    // Final order = all intermediate jobs (in optimized order) + destination at the end
    const orderedIds = [...orderedIntermediate, destinationId];

    // Optional summary numbers ORS provides for the whole route
    const routeDistance_m = typeof route?.distance === "number" && isFinite(route.distance) ? route.distance : undefined;
    const routeDuration_s = typeof route?.duration === "number" && isFinite(route.duration) ? route.duration : undefined;

    // Final response back to the client
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
        pickedFrom: s.pickedFrom, // useful for debugging why a location was chosen
      })),
    });
  } catch (e: any) {
    // Catch-all for timeouts, API failures, invalid JSON, etc.
    // AbortError is treated as a friendly timeout message.
    return NextResponse.json(
      { optimized: false, note: e?.name === "AbortError" ? "Request timed out. Try again." : e?.message || "Server error" },
      { status: 500 }
    );
  }
}
