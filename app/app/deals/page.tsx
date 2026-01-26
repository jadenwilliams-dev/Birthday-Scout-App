// app/app/deals/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ALL_DEALS } from "@/app/lib/deals";
import { supabase } from "@/app/lib/supabaseClient";

type Deal = {
  id: string;
  name: string;
  city?: string;

  // Your data might use either one:
  category?: string; // ✅ your deals.ts
  type?: string; // older schema

  freebie?: string;
  conditions?: string;
  link?: string;
  image?: string;
};

type Profile = {
  birthday: string;
  zip: string;
  displayName?: string;
};

const PLAN_KEY = "bs_plan";
const PROFILE_KEY = "bs_profile";
const PROFILE_UPDATED_EVENT = "bs_profile_updated";
const DEFAULT_ZIP = "11111";

const CATEGORIES = ["All", "Food", "Drinks", "Dessert", "Other"] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ✅ Deals page top logo (NOT fixed; scrolls with page)
   Moved UP via negative margin + reduced page top padding
   Made BIGGER via responsive heights
*/
function DealsTopLogo() {
  return (
    <div className="flex items-center justify-start -mt-28 mb-0 pl-1">
      <Link href="/app/deals" aria-label="BirthdayScout" className="inline-flex select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brands/longlogo1.png"
          alt="BirthdayScout"
          className="
  h-[96px] sm:h-[120px] md:h-[140px] lg:h-[160px]
  w-auto
  opacity-95
  drop-shadow-[0_14px_40px_rgba(0,0,0,0.9)]
"
          draggable={false}
        />
      </Link>
    </div>
  );
}

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
    return [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readProfileSafe(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { birthday: "", zip: DEFAULT_ZIP };
    const p = JSON.parse(raw);
    return {
      birthday: typeof p?.birthday === "string" ? p.birthday : "",
      zip: typeof p?.zip === "string" && p.zip ? p.zip : DEFAULT_ZIP,
      displayName: typeof p?.displayName === "string" ? p.displayName : "",
    };
  } catch {
    return { birthday: "", zip: DEFAULT_ZIP };
  }
}

function writeProfileSafe(p: Profile) {
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        birthday: p.birthday ?? "",
        zip: p.zip ?? "",
        displayName: p.displayName ?? "",
      })
    );
  } catch {}
}

function normalizeCategory(d: Deal): (typeof CATEGORIES)[number] {
  const raw = (d.category ?? d.type ?? "Other").trim();
  const lower = raw.toLowerCase();

  if (lower === "food") return "Food";
  if (lower === "drinks" || lower === "drink") return "Drinks";
  if (lower === "dessert" || lower === "desserts") return "Dessert";
  return "Other";
}

export default function DealsPage() {
  const deals = (ALL_DEALS as Deal[]) ?? [];

  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");
  const [hideAdded, setHideAdded] = useState(false);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile>({ birthday: "", zip: DEFAULT_ZIP });

  // load plan ids
  useEffect(() => {
    setPlanIds(readStringArray(PLAN_KEY));
  }, []);

  // ✅ load profile from local cache immediately, then refresh from Supabase
  // ✅ also keep it updated when Profile page saves (event/storage)
  useEffect(() => {
    let cancelled = false;

    // instant render from localStorage (fast)
    setProfile(readProfileSafe());

    async function refreshFromSupabase() {
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) return;
        const user = userRes?.user;
        if (!user) return;

        const { data, error } = await supabase
          .from("profiles")
          .select("birthday, zip, display_name")
          .eq("id", user.id)
          .single();

        if (error || !data) return;

        const next: Profile = {
          birthday: typeof data.birthday === "string" ? data.birthday : "",
          zip: typeof data.zip === "string" && data.zip ? data.zip : DEFAULT_ZIP,
          displayName: typeof (data as any).display_name === "string" ? (data as any).display_name : "",
        };

        if (cancelled) return;

        setProfile(next);
        writeProfileSafe(next);
      } catch {
        // ignore
      }
    }

    function loadProfile() {
      // update from local cache right away
      setProfile(readProfileSafe());
      // then refresh from supabase in background
      refreshFromSupabase();
    }

    // initial load
    loadProfile();

    const handler = () => loadProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    window.addEventListener("storage", handler);

    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  function isAdded(id: string) {
    return planIds.includes(id);
  }

  function toggleDeal(id: string) {
    setPlanIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeStringArray(PLAN_KEY, next);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return deals.filter((d) => {
      const dCat = normalizeCategory(d);
      const inCat = cat === "All" ? true : dCat === cat;

      const inQuery =
        !q ||
        d.name.toLowerCase().includes(q) ||
        (d.freebie || "").toLowerCase().includes(q) ||
        (d.conditions || "").toLowerCase().includes(q);

      const passHide = hideAdded ? !isAdded(d.id) : true;
      return inCat && inQuery && passHide;
    });
  }, [deals, query, cat, hideAdded, planIds]);

  function cardImageSrc(d: Deal): string {
    if (d.image) return d.image;
    return `/deals/${d.id}.png`;
  }

  const birthdayText = profile?.birthday ? profile.birthday : "—";
  const zipText = (profile?.zip || DEFAULT_ZIP).trim() || DEFAULT_ZIP;

  // ---------- styles ----------
  const pillBase =
    "rounded-full border px-3 py-1 text-xs shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition";
  const pill = `${pillBase} border-white/10 bg-white/5 text-zinc-200 hover:bg-white/8`;
  const pillActive =
    `${pillBase} border-emerald-200/28 bg-emerald-400/14 text-emerald-100 ` +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_0_44px_rgba(16,185,129,0.22)]";

  const badgeOnImage =
    "rounded-full border px-3 py-1 text-xs font-semibold leading-none " +
    "bg-black/70 border-white/20 text-white backdrop-blur-md " +
    "shadow-[0_10px_26px_rgba(0,0,0,0.75)] " +
    "drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] " +
    "mix-blend-normal";

  const badgeAddOnImage =
    "rounded-full border px-3 py-1 text-xs font-semibold leading-none " +
    "bg-black/65 border-emerald-200/30 text-emerald-50 backdrop-blur-md " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_12px_28px_rgba(0,0,0,0.70),0_0_30px_rgba(16,185,129,0.14)] " +
    "drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] " +
    "mix-blend-normal";

  const badgeAddedOnImage =
    "rounded-full border px-3 py-1 text-xs font-semibold leading-none " +
    "bg-emerald-500/18 border-emerald-200/38 text-emerald-50 backdrop-blur-md " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.20),0_12px_30px_rgba(0,0,0,0.70),0_0_44px_rgba(16,185,129,0.18)] " +
    "drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] " +
    "mix-blend-normal";

  const panel =
    "relative rounded-[28px] border border-white/10 " +
    "bg-[linear-gradient(180deg,rgba(255,255,255,0.085)_0%,rgba(255,255,255,0.03)_42%,rgba(0,0,0,0.28)_100%)] " +
    "backdrop-blur-xl shadow-[0_24px_90px_rgba(0,0,0,0.72)] " +
    "before:pointer-events-none before:absolute before:inset-0 before:rounded-[28px] " +
    "before:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-1px_0_rgba(0,0,0,0.40)]";

  const inner =
    "rounded-2xl border border-white/10 bg-black/35 backdrop-blur-xl " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_18px_70px_rgba(0,0,0,0.58)]";

  const ctaGreen =
    "inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/22 " +
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.22)_0%,rgba(16,185,129,0.12)_55%,rgba(16,185,129,0.08)_100%)] " +
    "px-4 py-2 text-sm font-semibold text-emerald-50 " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.14),0_18px_60px_rgba(0,0,0,0.65),0_0_55px_rgba(16,185,129,0.22)] " +
    "hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.26)_0%,rgba(16,185,129,0.14)_55%,rgba(16,185,129,0.10)_100%)] " +
    "active:translate-y-[0.5px] transition";

  return (
    <main className="relative min-h-screen overflow-x-hidden text-white">
      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bg-stars.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover select-none"
          style={{
            opacity: 1,
            transform: "translate3d(0,0,0)",
            filter: "saturate(1.15) contrast(1.08) brightness(1.08)",
          }}
          draggable={false}
        />
      </div>

      {/* OVERLAYS (BRIGHTER) */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute inset-0 bg-[radial-gradient(1100px_760px_at_50%_18%,rgba(0,0,0,0.00)_0%,rgba(0,0,0,0.18)_55%,rgba(0,0,0,0.45)_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      {/* CONTENT */}
      <div className="relative z-20 mx-auto max-w-6xl px-4 pb-28 pt-20">
        {/* ✅ Logo sits near the top like your first screenshot */}
        <DealsTopLogo />

        {/* Search + filters */}
        <div className={cn(panel, "p-6")}>
          {/* top shine */}
          <div className="pointer-events-none absolute left-1/2 top-[-1px] h-px w-[92%] -translate-x-1/2 rounded-full bg-emerald-300/25" />
          <div className="pointer-events-none absolute left-1/2 top-[-1px] h-[22px] w-[92%] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-2xl" />

          <div className="flex flex-col gap-4">
            <div className={cn(inner, "flex items-center gap-3 px-4 py-3")}>
              <div className="text-zinc-300">🔎</div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Starbucks, coffee, free drink..."
                className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    className={cn(c === cat ? pillActive : pill)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-zinc-200 select-none">
                <input
                  type="checkbox"
                  checked={hideAdded}
                  onChange={(e) => setHideAdded(e.target.checked)}
                  className="h-4 w-4 accent-emerald-400"
                />
                Hide added
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
              <div>
                Showing <span className="text-zinc-200">{filtered.length}</span> of{" "}
                <span className="text-zinc-200">{deals.length}</span>
              </div>
              <div>
                Birthday <span className="text-zinc-200">{birthdayText}</span> · ZIP{" "}
                <span className="text-zinc-200">{zipText}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cards grid */}
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => {
            const added = isAdded(d.id);
            const catLabel = normalizeCategory(d);

            return (
              <div
                key={d.id}
                className={cn(
                  "group relative overflow-hidden rounded-3xl border bg-black/72",
                  "border-white/10 shadow-[0_25px_100px_rgba(0,0,0,0.7)]",
                  added && "border-emerald-200/18"
                )}
              >
                <div className="relative h-48">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.10)_0%,rgba(0,0,0,0.55)_55%,rgba(0,0,0,0.85)_100%)]" />

                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cardImageSrc(d)}
                    alt={d.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/0" />

                  {/* BADGES */}
                  <div className="absolute left-4 top-4 flex items-center gap-2">
                    <span className={badgeOnImage}>{catLabel}</span>
                    <span className={added ? badgeAddedOnImage : badgeAddOnImage}>
                      {added ? "Added" : "Add"}
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-xl font-semibold leading-tight">{d.name}</div>
                  <div className="mt-1 text-sm text-zinc-300">{d.freebie || "Birthday reward"}</div>

                  {d.conditions ? (
                    <div className="mt-4 text-xs text-zinc-400">{d.conditions}</div>
                  ) : (
                    <div className="mt-4 text-xs text-zinc-500"> </div>
                  )}

                  <div className="mt-5">
                    <button
                      onClick={() => toggleDeal(d.id)}
                      className={cn(
                        "w-full rounded-2xl border px-4 py-2.5 text-sm font-semibold transition",
                        added
                          ? "border-emerald-200/18 bg-emerald-400/14 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_0_50px_rgba(16,185,129,0.20)] hover:bg-emerald-400/18"
                          : "border-white/10 bg-white/6 text-zinc-100 hover:bg-white/10"
                      )}
                    >
                      {added ? "Remove ✓" : "Add to plan"}
                    </button>

                    <div className="mt-3 text-center">
                      <Link
                        href={`/app/deals/${d.id}`}
                        className="text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200"
                      >
                        View details
                      </Link>
                    </div>
                  </div>
                </div>

                {added && (
                  <>
                    <div className="pointer-events-none absolute inset-0 bg-emerald-400/5" />
                    <div className="pointer-events-none absolute -inset-x-10 -top-16 h-40 bg-emerald-400/10 blur-3xl" />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky bottom bar */}
      {planIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50">
          <div className="mx-auto max-w-6xl px-4 pb-4">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/75 shadow-[0_30px_140px_rgba(0,0,0,0.85)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-emerald-400/14" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[18px] bg-emerald-400/10 blur-xl" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-emerald-400/14" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-emerald-400/10 blur-xl" />

              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-2xl bg-white/6 border border-white/10">
                    <span className="text-sm">🧺</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{planIds.length} selected</div>
                    <div className="text-xs text-zinc-400">Head to Plan to optimize your route.</div>
                  </div>
                </div>

                <Link href="/app/plan" className={ctaGreen}>
                  View Plan <span className="opacity-80">→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
