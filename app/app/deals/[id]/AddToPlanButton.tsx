"use client";

import { useEffect, useState } from "react";

const PLAN_KEY = "bs_plan";
const PLAN_UPDATED_EVENT = "bs_plan_updated";

type Props = {
  dealId: string;
};

function readPlanIds(): string[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
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

function writePlanIds(ids: string[]) {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(ids));
  } catch {}
}

export default function AddToPlanButton({ dealId }: Props) {
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const sync = () => setAdded(readPlanIds().includes(dealId));
    sync();

    window.addEventListener(PLAN_UPDATED_EVENT, sync);
    return () => window.removeEventListener(PLAN_UPDATED_EVENT, sync);
  }, [dealId]);

  function toggle() {
    const ids = readPlanIds();

    if (ids.includes(dealId)) {
      const next = ids.filter((x) => x !== dealId);
      writePlanIds(next);
      setAdded(false);

      try {
        window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
      } catch {}

      return;
    }

    const next = [...ids, dealId];
    writePlanIds(next);
    setAdded(true);

    try {
      window.dispatchEvent(new Event(PLAN_UPDATED_EVENT));
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
    >
      {added ? "Added" : "Add"}
    </button>
  );
}
