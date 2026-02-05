from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional, Tuple
import math

app = FastAPI()

class OptimizeRequest(BaseModel):
    ids: List[str]
    # dist[i][j] = distance/time cost from ids[i] -> ids[j]
    dist: List[List[float]]
    start_index: int = 0

class OptimizeResponse(BaseModel):
    ordered_ids: List[str]
    improved: bool
    total_cost: float

def route_cost(order: List[int], dist: List[List[float]]) -> float:
    total = 0.0
    for k in range(len(order) - 1):
        total += dist[order[k]][order[k+1]]
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
    # Classic 2-opt for an open path (not a cycle)
    n = len(order)
    improved = False

    while True:
        best_delta = 0.0
        best_i = -1
        best_j = -1

        # i..j segment will be reversed
        for i in range(1, n - 2):
            for j in range(i + 1, n - 1):
                a, b = order[i - 1], order[i]
                c, d = order[j], order[j + 1]

                # current edges: a->b and c->d
                # proposed edges: a->c and b->d (with segment reversed)
                delta = (dist[a][c] + dist[b][d]) - (dist[a][b] + dist[c][d])

                if delta < best_delta:
                    best_delta = delta
                    best_i = i
                    best_j = j

        if best_delta < 0 and best_i != -1:
            order[best_i:best_j + 1] = reversed(order[best_i:best_j + 1])
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

    if any(len(row) != n for row in dist) or len(dist) != n:
        # basic validation
        raise ValueError("dist must be an NxN matrix matching ids length")

    start = max(0, min(req.start_index, n - 1))

    # 1) initial route
    order = nearest_neighbor(dist, start)

    # 2) improve with 2-opt
    order2, improved = two_opt(dist, order)

    ordered_ids = [ids[i] for i in order2]
    total = route_cost(order2, dist)

    return OptimizeResponse(ordered_ids=ordered_ids, improved=improved, total_cost=total)
