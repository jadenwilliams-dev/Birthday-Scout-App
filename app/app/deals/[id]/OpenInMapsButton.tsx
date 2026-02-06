"use client";
// Client component because it reads from localStorage and builds a
// Google Maps URL dynamically based on user profile data.

import { useEffect, useMemo, useState } from "react";

// Minimal profile shape stored in localStorage.
// Only the fields needed here are typed.
type Profile = {
  birthday: string;
  zip: string;
};

// Button/link that opens Google Maps with a search for the given base query.
// If the user has a ZIP saved in their profile, the search is biased near that ZIP.
export default function OpenInMapsButton({ baseQuery }: { baseQuery: string }) {
  // ZIP code pulled from the user's saved profile (if available)
  const [zip, setZip] = useState("");

  useEffect(() => {
    // On mount, attempt to read the user's profile from localStorage
    try {
      const raw = localStorage.getItem("bs_profile");
      if (!raw) return;

      const p: Profile = JSON.parse(raw);

      // Only set ZIP if it exists to avoid building a bad query
      if (p?.zip) setZip(p.zip);
    } catch {
      // Fail silently if localStorage or JSON parsing fails
    }
  }, []);

  // Build the Google Maps search URL.
  // Memoized so it only recalculates when the base query or ZIP changes.
  const mapsUrl = useMemo(() => {
    // If we have a ZIP, bias the search near it; otherwise use the raw query
    const finalQuery = zip ? `${baseQuery} near ${zip}` : baseQuery;

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      finalQuery
    )}`;
  }, [baseQuery, zip]);

  return (
    // Anchor tag used instead of a button so it opens directly in Google Maps
    <a
      href={mapsUrl}
      target="_blank" // Open in a new tab
      rel="noreferrer" // Security best practice for external links
      className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
    >
      Open in Maps
    </a>
  );
}
