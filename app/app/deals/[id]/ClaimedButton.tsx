"use client";

import { useEffect, useState } from "react";

export default function ClaimedButton({ dealId }: { dealId: string }) {
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bs_claimed");
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      setClaimed(ids.includes(dealId));
    } catch {}
  }, [dealId]);

  function toggle() {
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem("bs_claimed") || "[]");
    } catch {
      ids = [];
    }

    const next = ids.includes(dealId)
      ? ids.filter((x) => x !== dealId)
      : [...ids, dealId];

    localStorage.setItem("bs_claimed", JSON.stringify(next));
    setClaimed(next.includes(dealId));
  }

  return (
    <button
      onClick={toggle}
      className={
        "rounded-xl px-4 py-2 text-sm font-medium transition " +
        (claimed
          ? "bg-white text-black hover:bg-zinc-200"
          : "border border-white/15 text-white hover:bg-white/10")
      }
    >
      {claimed ? "Claimed" : "Mark claimed"}
    </button>
  );
}
