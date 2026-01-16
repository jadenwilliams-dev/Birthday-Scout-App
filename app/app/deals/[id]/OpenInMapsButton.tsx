"use client";

import { useEffect, useMemo, useState } from "react";

type Profile = {
  birthday: string;
  zip: string;
};

export default function OpenInMapsButton({ baseQuery }: { baseQuery: string }) {
  const [zip, setZip] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bs_profile");
      if (!raw) return;
      const p: Profile = JSON.parse(raw);
      if (p?.zip) setZip(p.zip);
    } catch {}
  }, []);

  const mapsUrl = useMemo(() => {
    const finalQuery = zip ? `${baseQuery} near ${zip}` : baseQuery;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      finalQuery
    )}`;
  }, [baseQuery, zip]);

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noreferrer"
      className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
    >
      Open in Maps
    </a>
  );
}
