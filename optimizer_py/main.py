import os
import time
import math
from typing import List, Optional, Tuple, Dict, Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


# -----------------------------
# Env (Python owns secrets)
# -----------------------------
ORS_KEY = os.getenv("ORS_API_KEY")
GOOGLE_PLACES_KEY = os.getenv("GOOGLE_PLACES_API_KEY")


# -----------------------------
# Shared helpers
# -----------------------------
class Geo(BaseModel):
    lat: float
    lon: float


def haversine_meters(a: Geo, b: Geo) -> float:
    R = 6371000.0
    to_rad = lambda x: x * math.pi / 180.0
    dlat = to_rad(b.lat - a.lat)
    dlon = to_rad(b.lon - a.lon)
    lat1 = to_rad(a.lat)
    lat2 = to_rad(b.lat)
    h = (math.sin(dlat / 2) ** 2) + (math.cos(lat1) * math.cos(lat2) * (math.sin(dlon / 2) ** 2))
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


def meters_to_miles(m: float) -> float:
    return m / 1609.34


def is_zip(s: str) -> bool:
    s = s.strip()
    if len(s) == 5 and s.isdigit():
        return True
    # ZIP+4
    if len(s) == 10 and s[:5].isdigit() and s[5] == "-" and s[6:].isdigit():
        return True
    return False


async def fetch_json(url: str, method: str = "GET", headers: Optional[Dict[str, str]] = None, json_body: Any = None, timeout_s: float = 9.0):
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        if method == "GET":
            r = await client.get(url, headers=headers)
        else:
            r = await client.post(url, headers=headers, json=json_body)
    return r


# -----------------------------
# "Old" optimizer (keep it!)
# -----------------------------
class OptimizeRequest(BaseModel):
    ids: List[str]
    dist: List[List[float]]
    start_index: int = 0


class OptimizeResponse(BaseModel):
    ordered_ids: List[str]
    improved: bool
    total_cost: float


def route_cost(order: List[int], dist: List[List[float]]) -> float:
    total = 0.0
    for k in range(len(order) - 1):
        total += dist[order[k]][order[k + 1]]
    return total


def nearest_neighbor(dist: List[List[float]], start: int) -> List[int]:
    n = len(dist)
    unvisited = set(range(n))
    unvisited.remove(start)
    order = [start]
    cur = start
    while unvisited:
        nxt = min(unvisited, key=lambda j: dist[cur][j])
        unvisited.remove(nxt)
        order.append(nxt)
        cur = nxt
    return order


def two_opt(dist: List[List[float]], order: List[int]) -> Tuple[List[int], bool]:
    n = len(order)
    improved = False
    while True:
        best_delta = 0.0
        best_i = -1
        best_j = -1
        for i in range(1, n - 2):
            for j in range(i + 1, n - 1):
                a, b = order[i - 1], order[i]
                c, d = order[j], order[j + 1]
                delta = (dist[a][c] + dist[b][d]) - (dist[a][b] + dist[c][d])
                if delta < best_delta:
                    best_delta = delta
                    best_i = i
                    best_j = j
        if best_delta < 0 and best_i != -1:
            order[best_i : best_j + 1] = list(reversed(order[best_i : best_j + 1]))
            improved = True
        else:
            break
    return order, improved


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    ids = req.ids
    dist = req.dist
    n = len(ids)

    if n == 0:
        return OptimizeResponse(ordered_ids=[], improved=False, total_cost=0.0)

    if len(dist) != n or any(len(row) != n for row in dist):
        raise HTTPException(status_code=400, detail="dist must be an NxN matrix matching ids length")

    start = max(0, min(req.start_index, n - 1))
    order = nearest_neighbor(dist, start)
    order2, improved = two_opt(dist, order)
    ordered_ids = [ids[i] for i in order2]
    total = route_cost(order2, dist)

    return OptimizeResponse(ordered_ids=ordered_ids, improved=improved, total_cost=total)


# -----------------------------
# BirthdayScout real-world API
# -----------------------------
class StopIn(BaseModel):
    id: str
    query: str


class OptimizeRouteRequest(BaseModel):
    startQuery: Optional[str] = None
    startCoords: Optional[Geo] = None
    destinationId: Optional[str] = None
    previewOnly: Optional[bool] = False
    stops: List[StopIn]


def detect_chain(query: str) -> Optional[str]:
    q = query.lower()
    if "starbucks" in q:
        return "Starbucks"
    if "chipotle" in q:
        return "Chipotle"
    if "nothing bundt" in q:
        return "Nothing Bundt Cakes"
    return None


# simple in-memory cache for Places
_places_cache: Dict[str, Tuple[float, Geo]] = {}
PLACES_TTL_S = 24 * 60 * 60


def places_cache_key(name: str, start: Geo) -> str:
    return f"{name}:{start.lat:.2f},{start.lon:.2f}"


async def ors_geocode_search(query: str, start: Geo, radius_m: int, size: int):
    if not ORS_KEY:
        raise HTTPException(status_code=500, detail="Missing ORS_API_KEY in env")

    params = {
        "api_key": ORS_KEY,
        "text": query,
        "size": str(size),
        "boundary.country": "US",
        "layers": "venue,address",
        "focus.point.lat": str(start.lat),
        "focus.point.lon": str(start.lon),
        "boundary.circle.lat": str(start.lat),
        "boundary.circle.lon": str(start.lon),
        "boundary.circle.radius": str(radius_m),
    }
    u = httpx.URL("https://api.openrouteservice.org/geocode/search", params=params)
    res = await fetch_json(str(u), "GET", timeout_s=9.0)
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ORS geocode failed ({res.status_code})")
    data = res.json()
    feats = data.get("features")
    return feats if isinstance(feats, list) else []


async def ors_geocode_closest(query: str, start: Geo) -> Geo:
    passes = [
        {"radius": 8000, "size": 35},
        {"radius": 20000, "size": 35},
        {"radius": 50000, "size": 35},
    ]

    all_feats: List[dict] = []
    seen = set()

    for p in passes:
        feats = await ors_geocode_search(query, start, p["radius"], p["size"])
        for f in feats:
            coords = (((f or {}).get("geometry") or {}).get("coordinates") or [])
            if len(coords) < 2:
                continue
            key = f"{float(coords[0]):.5f},{float(coords[1]):.5f}"
            if key in seen:
                continue
            seen.add(key)
            all_feats.append(f)
        if len(all_feats) >= 15:
            break

    if not all_feats:
        raise HTTPException(status_code=404, detail=f"No geocode result for: {query}")

    best = all_feats[0]
    best_d = float("inf")
    for f in all_feats:
        lon, lat = f["geometry"]["coordinates"]
        d = haversine_meters(start, Geo(lat=float(lat), lon=float(lon)))
        if d < best_d:
            best_d = d
            best = f

    lon, lat = best["geometry"]["coordinates"]
    return Geo(lat=float(lat), lon=float(lon))


async def ors_geocode_zip(zipcode: str) -> Geo:
    if not ORS_KEY:
        raise HTTPException(status_code=500, detail="Missing ORS_API_KEY in env")

    params = {
        "api_key": ORS_KEY,
        "text": zipcode,
        "size": "5",
        "boundary.country": "US",
        "layers": "postalcode",
    }
    u = httpx.URL("https://api.openrouteservice.org/geocode/search", params=params)
    res = await fetch_json(str(u), "GET", timeout_s=9.0)
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ZIP geocode failed ({res.status_code})")

    data = res.json()
    feats = data.get("features") if isinstance(data, dict) else []
    if not feats:
        raise HTTPException(status_code=404, detail=f"No ZIP result for: {zipcode}")

    lon, lat = feats[0]["geometry"]["coordinates"]
    return Geo(lat=float(lat), lon=float(lon))


async def ors_geocode_start_text(query: str) -> Geo:
    if not ORS_KEY:
        raise HTTPException(status_code=500, detail="Missing ORS_API_KEY in env")

    params = {
        "api_key": ORS_KEY,
        "text": query,
        "size": "5",
        "boundary.country": "US",
        "layers": "locality,borough,neighbourhood,county,region,address,venue,postalcode",
    }
    u = httpx.URL("https://api.openrouteservice.org/geocode/search", params=params)
    res = await fetch_json(str(u), "GET", timeout_s=9.0)
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Start geocode failed ({res.status_code})")

    data = res.json()
    feats = data.get("features") if isinstance(data, dict) else []
    if not feats:
        raise HTTPException(status_code=404, detail=f"No start result for: {query}")

    lon, lat = feats[0]["geometry"]["coordinates"]
    return Geo(lat=float(lat), lon=float(lon))


async def ors_matrix_from_start(start: Geo, stops: List[Geo]):
    if not ORS_KEY:
        raise HTTPException(status_code=500, detail="Missing ORS_API_KEY in env")

    locations = [[start.lon, start.lat]] + [[s.lon, s.lat] for s in stops]
    destinations = list(range(1, len(stops) + 1))
    body = {
        "locations": locations,
        "sources": [0],
        "destinations": destinations,
        "metrics": ["distance", "duration"],
        "units": "m",
    }

    res = await fetch_json(
        "https://api.openrouteservice.org/v2/matrix/driving-car",
        method="POST",
        headers={"Authorization": ORS_KEY, "Content-Type": "application/json"},
        json_body=body,
        timeout_s=9.0,
    )

    if res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ORS matrix failed ({res.status_code})")

    data = res.json()
    distances = ((data or {}).get("distances") or [None])[0]
    durations = ((data or {}).get("durations") or [None])[0]
    if not isinstance(distances, list) or not isinstance(durations, list):
        raise HTTPException(status_code=502, detail="ORS matrix returned unexpected format")

    return distances, durations


async def places_nearest_by_name(start: Geo, name: str) -> Geo:
    if not GOOGLE_PLACES_KEY:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_PLACES_API_KEY in env")

    key = places_cache_key(name, start)
    cached = _places_cache.get(key)
    if cached:
        at, geo = cached
        if time.time() - at < PLACES_TTL_S:
            return geo

    target = name.lower()

    def good_match(r: dict) -> bool:
        n = str(r.get("name", "")).lower()
        return target in n

    def pick_first(arr: list) -> Optional[Geo]:
        if not arr:
            return None
        first = arr[0]
        loc = ((first.get("geometry") or {}).get("location") or {})
        lat = loc.get("lat")
        lon = loc.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            return Geo(lat=float(lat), lon=float(lon))
        return None

    # 1) rankby=distance (best)
    params1 = {
        "key": GOOGLE_PLACES_KEY,
        "location": f"{start.lat},{start.lon}",
        "rankby": "distance",
        "name": name,
    }
    u1 = httpx.URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json", params=params1)
    r1 = await fetch_json(str(u1), "GET", timeout_s=8.0)
    if r1.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Places NearbySearch failed ({r1.status_code})")
    d1 = r1.json()
    results1 = d1.get("results") if isinstance(d1, dict) else []
    good1 = [x for x in results1 if isinstance(x, dict) and good_match(x)]
    got1 = pick_first(good1)
    if got1:
        _places_cache[key] = (time.time(), got1)
        return got1

    # 2) radius fallback
    params2 = {
        "key": GOOGLE_PLACES_KEY,
        "location": f"{start.lat},{start.lon}",
        "radius": "50000",
        "name": name,
    }
    u2 = httpx.URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json", params=params2)
    r2 = await fetch_json(str(u2), "GET", timeout_s=8.0)
    if r2.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Places NearbySearch (radius) failed ({r2.status_code})")

    d2 = r2.json()
    results2 = d2.get("results") if isinstance(d2, dict) else []
    good2 = [x for x in results2 if isinstance(x, dict) and good_match(x)]
    if not good2:
        status = str(d2.get("status", "unknown"))
        raise HTTPException(status_code=404, detail=f'Places returned no strict match for "{name}" (status={status})')

    good2.sort(key=lambda r: haversine_meters(start, Geo(
        lat=float(((r.get("geometry") or {}).get("location") or {}).get("lat", 0.0)),
        lon=float(((r.get("geometry") or {}).get("location") or {}).get("lng", 0.0)),
    )))

    got2 = pick_first(good2)
    if not got2:
        raise HTTPException(status_code=502, detail=f'Places strict match had bad geometry for "{name}"')

    _places_cache[key] = (time.time(), got2)
    return got2


async def resolve_stop_geo(query: str, start: Geo) -> Tuple[Geo, str]:
    chain = detect_chain(query)
    if chain:
        geo = await places_nearest_by_name(start, chain)
        return geo, f"google_places:{chain}"
    geo = await ors_geocode_closest(query, start)
    return geo, "ors"


@app.post("/optimize-route")
async def optimize_route(req: OptimizeRouteRequest):
    if not ORS_KEY:
        raise HTTPException(status_code=500, detail="Missing ORS_API_KEY")
    if not GOOGLE_PLACES_KEY:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_PLACES_API_KEY")

    stops_in = req.stops if isinstance(req.stops, list) else []
    if len(stops_in) == 0:
        raise HTTPException(status_code=400, detail="No stops provided")

    # start
    start: Optional[Geo] = None
    start_source = "zip"

    if req.startCoords:
        start = req.startCoords
        start_source = "gps"
    elif req.startQuery and req.startQuery.strip():
        q = req.startQuery.strip()
        if is_zip(q):
            start = await ors_geocode_zip(q)
            start_source = "zip"
        else:
            start = await ors_geocode_start_text(q)
            start_source = "zip"
    else:
        raise HTTPException(status_code=400, detail="Missing start (coords or zip)")

    # resolve stops
    resolved_base = []
    for s in stops_in:
        geo, picked = await resolve_stop_geo(s.query, start)
        dist_m = haversine_meters(start, geo)
        resolved_base.append({
            "id": s.id,
            "query": s.query,
            "pickedFrom": picked,
            "geo": geo,
            "dist_mi": meters_to_miles(dist_m),
        })

    # matrix for driving ETA/dist
    driving_meters = None
    driving_seconds = None
    try:
        distances, durations = await ors_matrix_from_start(start, [x["geo"] for x in resolved_base])
        driving_meters = [float(x) if isinstance(x, (int, float)) else float("nan") for x in distances]
        driving_seconds = [float(x) if isinstance(x, (int, float)) else float("nan") for x in durations]
    except:
        driving_meters = None
        driving_seconds = None

    resolved = []
    for i, s in enumerate(resolved_base):
        m = driving_meters[i] if driving_meters is not None and i < len(driving_meters) else None
        sec = driving_seconds[i] if driving_seconds is not None and i < len(driving_seconds) else None

        drive_mi = meters_to_miles(m) if isinstance(m, (int, float)) and math.isfinite(m) else None
        eta_min = max(1, int(round(sec / 60))) if isinstance(sec, (int, float)) and math.isfinite(sec) else None

        resolved.append({
            **{k: v for k, v in s.items() if k != "geo"},
            "geo": s["geo"],
            "drive_mi": drive_mi,
            "eta_min": eta_min,
        })

    # suggested destination = farthest
    suggested = resolved[0]
    for s in resolved:
        a = s["drive_mi"] if isinstance(s["drive_mi"], (int, float)) else s["dist_mi"]
        b = suggested["drive_mi"] if isinstance(suggested["drive_mi"], (int, float)) else suggested["dist_mi"]
        if a > b:
            suggested = s

    # previewOnly
    if req.previewOnly:
        return {
            "preview": True,
            "optimized": False,
            "startUsed": {"lat": start.lat, "lon": start.lon, "source": start_source},
            "suggestedDestinationId": suggested["id"],
            "stops": [
                {
                    "id": s["id"],
                    "dist_mi": s["drive_mi"] if isinstance(s["drive_mi"], (int, float)) else s["dist_mi"],
                    "eta_min": s["eta_min"],
                    "lat": s["geo"].lat,
                    "lon": s["geo"].lon,
                    "pickedFrom": s["pickedFrom"],
                }
                for s in resolved
            ],
            "note": "Preview distances + ETA computed",
        }

    # destination logic
    requested = (req.destinationId or "").strip()
    dest_exists = requested and any(s["id"] == requested for s in resolved)
    destination_id = requested if dest_exists else suggested["id"]

    jobs_list = [s for s in resolved if s["id"] != destination_id]
    int_to_id: Dict[int, str] = {}
    jobs = []
    for idx, s in enumerate(jobs_list):
        job_id = idx + 1
        int_to_id[job_id] = s["id"]
        jobs.append({"id": job_id, "location": [s["geo"].lon, s["geo"].lat]})

    dest_stop = next(s for s in resolved if s["id"] == destination_id)

    vehicle = {
        "id": 1,
        "profile": "driving-car",
        "start": [start.lon, start.lat],
        "end": [dest_stop["geo"].lon, dest_stop["geo"].lat],
    }

    # ORS optimization call
    res = await fetch_json(
        "https://api.openrouteservice.org/optimization",
        method="POST",
        headers={"Authorization": ORS_KEY, "Content-Type": "application/json"},
        json_body={"jobs": jobs, "vehicles": [vehicle]},
        timeout_s=20.0,
    )

    if res.status_code != 200:
        txt = res.text
        raise HTTPException(status_code=502, detail=f"ORS optimization failed ({res.status_code}): {txt}")

    opt = res.json()
    route = ((opt or {}).get("routes") or [None])[0] or {}
    steps = route.get("steps") or []

    ordered_intermediate: List[str] = []
    for step in steps:
        job = step.get("job") if isinstance(step, dict) else None
        if isinstance(job, int) and job in int_to_id:
            ordered_intermediate.append(int_to_id[job])

    ordered_ids = ordered_intermediate + [destination_id]

    route_distance_m = route.get("distance") if isinstance(route.get("distance"), (int, float)) else None
    route_duration_s = route.get("duration") if isinstance(route.get("duration"), (int, float)) else None

    return {
        "optimized": True,
        "orderedIds": ordered_ids,
        "destinationId": destination_id,
        "note": "Optimized route",
        "routeDistance_m": route_distance_m,
        "routeDuration_s": route_duration_s,
        "startUsed": {"lat": start.lat, "lon": start.lon, "source": start_source},
        "resolvedStops": [
            {"id": s["id"], "lat": s["geo"].lat, "lon": s["geo"].lon, "pickedFrom": s["pickedFrom"]}
            for s in resolved
        ],
    }
