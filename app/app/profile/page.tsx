// app/app/profile/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

const ZIP_KEY = "bs_zip";
const START_MODE_KEY = "bs_start_mode"; // "geo" | "zip"
const DEFAULT_ZIP = "11111";

function normalizeZip(input: string) {
  return input.replace(/\D/g, "").slice(0, 5);
}

function clampName(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 24);
}

function isTodayISO(isoDate: string) {
  if (!isoDate) return false;
  const [, m, d] = isoDate.split("-").map(Number);
  if (!m || !d) return false;
  const now = new Date();
  return now.getMonth() + 1 === m && now.getDate() === d;
}

// ---------- copied look pieces from Plan page ----------
function IconDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        on ? "bg-emerald-200/80 shadow-[0_0_16px_rgba(16,185,129,0.35)]" : "bg-white/15"
      }`}
    />
  );
}

/**
 * HERO LOGO (lockup) — same as Plan page.
 */
function BrandLockup() {
  const candidates = [
    "/brands/lockup.png",
    "/lockup.png",
    "/brand-lockup.png",
    "/brand-lockup.webp",
    "/brand-lockup.jpg",
    "/logo-lockup.png",
    "/logo.png",
  ];

  const [idx, setIdx] = useState(0);
  if (idx >= candidates.length) return null;

  return (
    <div className="-mt-31 mb-6 -ml-2 sm:-ml-3">
      <img
        src={candidates[idx]}
        alt="BirthdayScout"
        className="block h-[300px] sm:h-[360px] w-auto select-none drop-shadow-[0_28px_70px_rgba(0,0,0,0.70)]"
        draggable={false}
        onError={() => setIdx((v) => v + 1)}
      />
    </div>
  );
}

type EditPanel = "none" | "all" | "name" | "birthday" | "zip" | "start";

export default function ProfilePage() {
  const [email, setEmail] = useState<string>("");

  // saved values (what the cards show)
  const [displayName, setDisplayName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [zip, setZip] = useState(DEFAULT_ZIP);
  const [startMode, setStartMode] = useState<"geo" | "zip">("geo");

  // draft values (what inputs edit)
  const [draftName, setDraftName] = useState("");
  const [draftBirthday, setDraftBirthday] = useState("");
  const [draftZip, setDraftZip] = useState(DEFAULT_ZIP);
  const [draftStartMode, setDraftStartMode] = useState<"geo" | "zip">("geo");

  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const [panel, setPanel] = useState<EditPanel>("none");

  // ✅ Load user + DB profile
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
          setErr("Not logged in.");
          return;
        }

        setEmail(user.email || "");

        const { data: p, error } = await supabase
          .from("profiles")
          .select("display_name,birthday,zip")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;

        const storedZip = localStorage.getItem(ZIP_KEY) || "";
        const z = (typeof p?.zip === "string" && p.zip) ? p.zip : (storedZip || DEFAULT_ZIP);

        const mode = localStorage.getItem(START_MODE_KEY) === "zip" ? "zip" : "geo";

        setDisplayName((p?.display_name as string) || "");
        setBirthday((p?.birthday as string) || "");
        setZip(z);
        setStartMode(mode);

        // init drafts
        setDraftName((p?.display_name as string) || "");
        setDraftBirthday((p?.birthday as string) || "");
        setDraftZip(z);
        setDraftStartMode(mode);
      } catch (e: any) {
        setErr(e?.message || "Failed to load profile.");
      }
    })();
  }, []);

  const birthdayIsToday = useMemo(() => isTodayISO(birthday), [birthday]);

  const profileComplete = !!clampName(displayName) && !!birthday && normalizeZip(zip).length === 5;

  // ======= aesthetics (match Plan page) =======
  const NARROW = "mx-auto w-full max-w-[1200px]";

  const GlassSection =
    "relative rounded-[28px] border border-white/14 bg-black/30 " +
    "shadow-[0_24px_90px_rgba(0,0,0,0.60)]";

  const Field =
    "mt-2 w-full rounded-2xl border border-white/12 bg-black/35 px-4 py-3 text-sm outline-none " +
    "focus:border-emerald-300/20 focus:ring-1 focus:ring-emerald-300/10";

  const BtnEdit =
    "rounded-xl border border-emerald-200/30 bg-emerald-400/15 px-4 py-2 text-sm text-emerald-50 " +
    "hover:bg-emerald-400/20 transition";

  const BtnEditSub =
    "rounded-xl border border-emerald-200/25 bg-black/35 px-4 py-2 text-sm text-emerald-100 " +
    "hover:bg-white/5 transition";

  const BtnCancel =
    "rounded-xl border border-white/12 bg-black/35 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5 transition";

  const BtnSave =
    "rounded-xl border border-emerald-200/26 px-4 py-2 text-sm font-medium text-emerald-50 " +
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.55)_0%,rgba(16,185,129,0.34)_48%,rgba(0,0,0,0.10)_100%)] " +
    "hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.62)_0%,rgba(16,185,129,0.38)_48%,rgba(0,0,0,0.12)_100%)] " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.14),0_18px_54px_rgba(0,0,0,0.40),0_0_22px_rgba(16,185,129,0.18)] " +
    "transition";

  function openPanel(next: EditPanel) {
    setErr("");
    setDraftName(displayName);
    setDraftBirthday(birthday);
    setDraftZip(zip);
    setDraftStartMode(startMode);
    setPanel(next);
  }

  function cancelPanel() {
    setErr("");
    setDraftName(displayName);
    setDraftBirthday(birthday);
    setDraftZip(zip);
    setDraftStartMode(startMode);
    setPanel("none");
  }

  function validateDrafts(opts: { name?: boolean; birthday?: boolean; zip?: boolean }) {
    const needName = opts.name ?? false;
    const needBirthday = opts.birthday ?? false;
    const needZip = opts.zip ?? false;

    const name = clampName(draftName);
    const bday = draftBirthday;
    const z = normalizeZip(draftZip) || DEFAULT_ZIP;

    if (needName && !name) return "Add a name so the app can personalize your experience.";
    if (needBirthday && !bday) return "Add your birthday.";
    if (needZip && z.length !== 5) return "ZIP must be 5 digits.";
    return "";
  }

  async function saveToDB(next: { display_name: string; birthday: string; zip: string }) {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) throw new Error("Not logged in.");

    const { error } = await supabase.from("profiles").upsert(
      {
        user_id: user.id,
        display_name: next.display_name,
        birthday: next.birthday || null,
        zip: next.zip || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;
  }

  async function applySave(which: EditPanel) {
    setErr("");

    const name = clampName(draftName);
    const bday = draftBirthday;
    const z = normalizeZip(draftZip) || DEFAULT_ZIP;
    const mode = draftStartMode;

    const v =
      which === "all"
        ? validateDrafts({ name: true, birthday: true, zip: true })
        : which === "name"
        ? validateDrafts({ name: true })
        : which === "birthday"
        ? validateDrafts({ birthday: true })
        : which === "zip"
        ? validateDrafts({ zip: true })
        : which === "start"
        ? ""
        : "";

    if (v) {
      setErr(v);
      return;
    }

    const nextDisplay =
      which === "birthday" || which === "zip" || which === "start" ? displayName : name;
    const nextBirthday =
      which === "name" || which === "zip" || which === "start" ? birthday : bday;
    const nextZip =
      which === "name" || which === "birthday" || which === "start" ? zip : z;

    const finalDisplay = which === "all" ? name : nextDisplay;
    const finalBirthday = which === "all" ? bday : nextBirthday;
    const finalZip = which === "all" ? z : nextZip;

    try {
      // Persist start mode locally (preference)
      localStorage.setItem(START_MODE_KEY, mode);

      // Keep ZIP cache locally for other pages that might still read ZIP_KEY
      localStorage.setItem(ZIP_KEY, finalZip);

      // ✅ Save profile per-user
      await saveToDB({
        display_name: finalDisplay || "",
        birthday: finalBirthday || "",
        zip: finalZip || DEFAULT_ZIP,
      });

      // Update UI state
      setDisplayName(finalDisplay || "");
      setBirthday(finalBirthday || "");
      setZip(finalZip || DEFAULT_ZIP);
      setStartMode(mode);

      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
      setPanel("none");
    } catch (e: any) {
      setErr(e?.message || "Failed to save profile.");
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden text-white">
      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="/bg-stars.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover select-none"
          style={{
            opacity: 1,
            transform: "translate3d(0,0,0)",
            filter: "saturate(1.15) contrast(1.08) brightness(1.12)",
          }}
          draggable={false}
        />
      </div>

      {/* OVERLAYS */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute inset-0 bg-[radial-gradient(1100px_760px_at_50%_18%,rgba(0,0,0,0.00)_0%,rgba(0,0,0,0.12)_55%,rgba(0,0,0,0.34)_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      {/* CONTENT */}
      <div className="relative z-20 px-6 pt-0 pb-[130px]">
        <div className="h-[72px]" />

        <div className={NARROW}>
          <header className="mb-8">
            <BrandLockup />

            <div className="pl-10 lg:pl-30 -mt-24">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/35 px-3 py-1 text-xs text-zinc-300">
                <IconDot on={profileComplete} />
                Settings
              </div>

              <h1 className="mt-2 text-[46px] leading-[1.03] font-semibold tracking-tight">Profile</h1>

              <p className="mt-2 max-w-[640px] text-[19px] leading-snug text-zinc-300/90">
                Manage your personal info and routing preferences.
              </p>
            </div>
          </header>

          <section className={`${GlassSection} max-w-[980px] mx-auto`}>
            <div className="px-6 py-5 border-b border-white/12 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500">Profile</div>
                <div className="text-sm text-zinc-300">Review and update your birthday, location, and routing defaults.</div>
              </div>
            </div>

            <div className="p-6">
              <div className="relative rounded-[26px] border border-white/14 bg-black/45 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.55)] p-6">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="h-14 w-14 rounded-full bg-emerald-400/20 border border-emerald-200/30 flex items-center justify-center text-xl font-semibold text-emerald-100 shadow-[0_0_30px_rgba(16,185,129,0.35)]">
                      {displayName?.[0]?.toUpperCase() || "?"}
                    </div>

                    <div className="min-w-0">
                      <div className="text-lg font-semibold truncate">{displayName || "Your name"}</div>
                      <div className="text-sm text-zinc-400 truncate">{email || "—"}</div>

                      <div className="mt-1 text-xs text-emerald-200 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.45)]" />
                        Birthday: {birthday || "—"} • ZIP: {zip}
                      </div>
                    </div>
                  </div>

                  <button onClick={() => openPanel("all")} className={BtnEdit}>
                    Edit
                  </button>
                </div>

                <div className="my-6 h-px bg-white/10" />

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🎂</span>
                      <div>
                        <div className="text-sm text-zinc-200">Birthday</div>
                        <div className="text-xs text-zinc-400">{birthday || "Not set"}</div>
                        {birthdayIsToday ? <div className="text-xs text-emerald-200 mt-1">Happy birthday 🎉</div> : null}
                      </div>
                    </div>
                    <button onClick={() => openPanel("birthday")} className={BtnEditSub}>
                      Edit
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">📍</span>
                      <div>
                        <div className="text-sm text-zinc-200">ZIP Code</div>
                        <div className="text-xs text-zinc-400">{zip}</div>
                      </div>
                    </div>
                    <button onClick={() => openPanel("zip")} className={BtnEditSub}>
                      Edit
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🧭</span>
                      <div>
                        <div className="text-sm text-zinc-200">Default Route Start</div>
                        <div className="text-xs text-zinc-400">
                          {startMode === "geo" ? "Use current location" : "Use ZIP code"}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => openPanel("start")} className={BtnEditSub}>
                      Edit
                    </button>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 text-sm text-emerald-200">
                  <span className="h-4 w-4 rounded-full bg-emerald-400/25 flex items-center justify-center text-xs">✓</span>
                  {profileComplete ? "All set! Your profile is fully completed." : "Finish setup to complete your profile."}
                </div>

                {err ? (
                  <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                    {err}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {/* EDIT MODAL */}
          {panel !== "none" ? (
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-4">
              <div className="w-full max-w-xl rounded-2xl border border-white/12 bg-black/70 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.85)]">
                <div className="px-5 py-4 border-b border-white/10">
                  <div className="text-lg font-semibold">
                    {panel === "all"
                      ? "Edit profile"
                      : panel === "name"
                      ? "Edit name"
                      : panel === "birthday"
                      ? "Edit birthday"
                      : panel === "zip"
                      ? "Edit ZIP"
                      : "Edit route start"}
                  </div>
                  <div className="text-sm text-zinc-400">Changes are stored to your account.</div>
                </div>

                <div className="p-5 space-y-5">
                  {(panel === "all" || panel === "name") && (
                    <div>
                      <label className="text-sm text-zinc-200">Display name</label>
                      <input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className={Field}
                        placeholder="Jaden"
                      />
                      {email ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          Signed in as <span className="text-zinc-300">{email}</span>
                        </p>
                      ) : null}
                    </div>
                  )}

                  {(panel === "all" || panel === "birthday") && (
                    <div>
                      <label className="text-sm text-zinc-200">Birthday</label>
                      <input
                        type="date"
                        value={draftBirthday}
                        onChange={(e) => setDraftBirthday(e.target.value)}
                        className={Field}
                      />
                    </div>
                  )}

                  {(panel === "all" || panel === "zip") && (
                    <div>
                      <label className="text-sm text-zinc-200">ZIP Code</label>
                      <input
                        value={draftZip}
                        onChange={(e) => setDraftZip(normalizeZip(e.target.value))}
                        inputMode="numeric"
                        className={Field}
                        placeholder={DEFAULT_ZIP}
                      />
                      <div className="mt-2 text-xs text-zinc-500">Default: {DEFAULT_ZIP}</div>
                    </div>
                  )}

                  {(panel === "all" || panel === "start") && (
                    <div>
                      <label className="text-sm text-zinc-200">Default route start</label>
                      <div className="mt-3 flex flex-wrap gap-3">
                        {[
                          { id: "geo", label: "Use current location" },
                          { id: "zip", label: "Use ZIP code" },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setDraftStartMode(opt.id as any)}
                            className={
                              "rounded-full px-4 py-2 text-sm border transition " +
                              (draftStartMode === opt.id
                                ? "border-emerald-200/30 bg-emerald-400/15 text-emerald-50"
                                : "border-white/12 bg-black/35 text-zinc-300 hover:bg-white/5")
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-3">
                  <button onClick={cancelPanel} className={BtnCancel}>
                    Cancel
                  </button>
                  <button onClick={() => applySave(panel)} className={BtnSave}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Saved toast */}
          {saved ? (
            <div className="fixed left-1/2 top-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-black/80 px-4 py-2 text-sm text-zinc-200">
              Saved
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
