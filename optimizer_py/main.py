# FastAPI service that exposes a simple route optimization endpoint.
# Uses heuristic algorithms (Nearest Neighbor + 2-opt) to order stops
# based on a provided distance matrix.

from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional, Tuple
import math

app = FastAPI()

# ----------- Request / Response Models -----------

class OptimizeRequest(BaseModel):
    # Ordered list of stop identifiers
    ids: List[str]

    # dist[i][j] represents the cost (distance or time)
    # of traveling from ids[i] -> ids[j]
    dist: List[List[float]]

    # Optional index indicating which stop to start from
    start_index: int = 0

class OptimizeResponse(BaseModel):
    # Final optimized order of stop IDs
    ordered_ids: List[str]

    # Whether the optimizer improved on the initial route
    improved: bool

    # Total cost of the final route
    total_cost: float


# ----------- Helper Functions -----------

# Compute the total cost of a given route order
# by summing pairwise distances along the path
def route_cost(order: List[int], dist: List[List[float]]) -> float:
    total = 0.0
    for k in range(len(order) - 1):
        total += dist[order[k]][order[k + 1]]
    return total


# Nearest Neighbor heuristic:
# Greedily builds a route by always visiting the closest
# unvisited node next.
#
# Fast to compute, but not guaranteed to be optimal.
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


# 2-opt optimization:
# Iteratively improves a route by reversing segments
# when doing so reduces the total cost.
#
# This version handles an open path (not a closed cycle).
def two_opt(dist: List[List[float]], order: List[int]) -> Tuple[List[int], bool]:
    n = len(order)
    improved = False

    while True:
        best_delta = 0.0
        best_i = -1
        best_j = -1

        # Try reversing every possible segment i..j
        for i in range(1, n - 2):
            for j in range(i + 1, n - 1):
                a, b = order[i - 1], order[i]
                c, d = order[j], order[j + 1]

                # Current edges: a->b and c->d
                # Proposed edges: a->c and b->d
                delta = (dist[a][c] + dist[b][d]) - (dist[a][b] + dist[c][d])

                if delta < best_delta:
                    best_delta = delta
                    best_i = i
                    best_j = j

        # Apply the best improving swap, if any
        if best_delta < 0 and best_i != -1:
            order[best_i : best_j + 1] = reversed(order[best_i : best_j + 1])
            improved = True
        else:
            break

    return order, improved


# ----------- API Endpoint -----------

@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    ids = req.ids
    dist = req.dist
    n = len(ids)

    # Handle empty input gracefully
    if n == 0:
        return OptimizeResponse(
            ordered_ids=[],
            improved=False,
            total_cost=0.0
        )

    # Basic validation: dist must be an NxN matrix
    if any(len(row) != n for row in dist) or len(dist) != n:
        raise ValueError("dist must be an NxN matrix matching ids length")

    # Clamp start index to valid range
    start = max(0, min(req.start_index, n - 1))

    # 1) Build an initial greedy route
    order = nearest_neighbor(dist, start)

    # 2) Improve the route using 2-opt
    order2, improved = two_opt(dist, order)

    # Convert index order back into ID order
    ordered_ids = [ids[i] for i in order2]

    # Compute final route cost
    total = route_cost(order2, dist)

    return OptimizeResponse(
        ordered_ids=ordered_ids,
        improved=improved,
        total_cost=total
    )
