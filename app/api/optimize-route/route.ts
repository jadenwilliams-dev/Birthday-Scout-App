import { NextResponse } from "next/server";

type ReqBody = {
  ids: string[];
  dist?: number[][];
  startIndex?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;

    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ optimized: false, note: "No ids provided" }, { status: 400 });
    }

    const n = ids.length;

    // TEMP matrix if you didn't send one (proves the pipeline works)
    const dist =
      body.dist && Array.isArray(body.dist) && body.dist.length === n
        ? body.dist
        : Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.abs(i - j) + 1))
          );

    const startIndex = typeof body.startIndex === "number" ? body.startIndex : 0;

    const py = await fetch("http://127.0.0.1:8001/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids,
        dist,
        start_index: startIndex,
      }),
      cache: "no-store",
    });

    if (!py.ok) {
      const text = await py.text();
      return NextResponse.json({ optimized: false, note: "Python optimizer failed", detail: text }, { status: 500 });
    }

    const data = await py.json();

    return NextResponse.json({
      optimized: true,
      orderedIds: data.ordered_ids ?? [],
      improved: !!data.improved,
      totalCost: data.total_cost ?? null,
      note: "Optimized by Python",
    });
  } catch (e: any) {
    return NextResponse.json({ optimized: false, note: e?.message || "Server error" }, { status: 500 });
  }
}
