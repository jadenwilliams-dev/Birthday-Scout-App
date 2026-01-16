"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

const PROFILE_KEY = "bs_profile";
const ZIP_KEY = "bs_zip";
const START_KEY = "bs_start";
const LOC_PROMPT_OFF_KEY = "bs_loc_prompt_off";
const PROFILE_UPDATED_EVENT = "bs_profile_updated";

type Profile = {
  birthday: string;
  zip: string;
  displayName?: string;
  avatar?: string;
};

// Final cleanup (run on submit)
function clampName(s: string) {
  return s.replace(/\s+/g, " ").trim().slice(0, 24);
}

// Live typing (DO NOT trim, so spaces work naturally)
function sanitizeNameInput(s: string) {
  return s.replace(/\s+/g, " ").slice(0, 24);
}

function normalizeZip(input: string) {
  return input.replace(/\D/g, "").slice(0, 5);
}

function readProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Profile;
    return null;
  } catch {
    return null;
  }
}

function writeProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}

function safeNext(raw: string | null): string {
  const fallback = "/app/deals";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw === "/app" || raw.startsWith("/app?")) return "/app/deals";
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();

  const nextPath = useMemo(() => safeNext(search.get("next")), [search]);

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  const [name, setName] = useState(""); // only used in signup UI
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Location modal state
  const [showLocModal, setShowLocModal] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (showLocModal) setDontAskAgain(false);
  }, [showLocModal]);

  function goNext() {
    router.replace(nextPath);
    router.refresh();
  }

  function ensureNameSaved(displayName: string) {
    const existing = readProfile() || { birthday: "", zip: "" };

    const zipFallback = normalizeZip(
      (existing.zip || localStorage.getItem(ZIP_KEY) || "").toString()
    );

    const next: Profile = {
      ...existing,
      zip: zipFallback,
      displayName,
      avatar: existing.avatar || "sparkle",
    };

    writeProfile(next);
    if (zipFallback) localStorage.setItem(ZIP_KEY, zipFallback);
  }

  function shouldPromptForLocation(): boolean {
    try {
      return localStorage.getItem(LOC_PROMPT_OFF_KEY) !== "true";
    } catch {
      return false;
    }
  }

  function afterAuthSuccess() {
    if (shouldPromptForLocation()) {
      setShowLocModal(true);
      return;
    }
    goNext();
  }

  async function onContinue(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setErr("");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setErr("Enter an email.");
    if (!pw || pw.length < 6) return setErr("Enter a password (min 6 chars).");

    const cleanName = clampName(name);

    if (mode === "signup" && !cleanName) {
      return setErr("Enter your name.");
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: pw,
          options: { data: { displayName: cleanName } },
        });
        if (error) throw error;

        // If email confirmation is enabled, no session yet.
        if (!data.session) {
          ensureNameSaved(cleanName);
          setErr("Check your email to confirm your account, then come back and log in.");
          return;
        }

        await supabase.auth.getSession();
        ensureNameSaved(cleanName);
        afterAuthSuccess();
        return;
      }

      // LOGIN (no name asked)
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: pw,
      });
      if (error) throw error;

      await supabase.auth.getSession();
      afterAuthSuccess();
    } catch (e: any) {
      setErr(e?.message || (mode === "signup" ? "Sign up failed." : "Login failed."));
    } finally {
      setBusy(false);
    }
  }

  function closeLocModalContinue() {
    if (dontAskAgain) {
      try {
        localStorage.setItem(LOC_PROMPT_OFF_KEY, "true");
      } catch {}
    }
    setShowLocModal(false);
    goNext();
  }

  async function allowLocation() {
    setLocBusy(true);
    setErr("");

    if (!navigator.geolocation) {
      setErr("Geolocation not supported in this browser.");
      setLocBusy(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          localStorage.setItem(START_KEY, JSON.stringify({ lat, lon }));
        } catch {}

        setShowLocModal(false);
        setLocBusy(false);
        goNext();
      },
      (e) => {
        setErr(e?.message || "Could not access location.");
        setLocBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  // ---------- styles (match your Deals glass) ----------
  const panel =
    "relative rounded-[28px] border border-white/10 " +
    "bg-[linear-gradient(180deg,rgba(255,255,255,0.085)_0%,rgba(255,255,255,0.03)_42%,rgba(0,0,0,0.28)_100%)] " +
    "backdrop-blur-xl shadow-[0_24px_90px_rgba(0,0,0,0.72)] " +
    "before:pointer-events-none before:absolute before:inset-0 before:rounded-[28px] " +
    "before:shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-1px_0_rgba(0,0,0,0.40)]";

  const inner =
    "rounded-2xl border border-white/10 bg-black/35 backdrop-blur-xl " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_18px_70px_rgba(0,0,0,0.58)]";

  const inputCls =
    "w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none";

  const ctaGreen =
    "inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/22 " +
    "bg-[linear-gradient(180deg,rgba(16,185,129,0.22)_0%,rgba(16,185,129,0.12)_55%,rgba(16,185,129,0.08)_100%)] " +
    "px-4 py-2 text-sm font-semibold text-emerald-50 " +
    "shadow-[0_0_0_1px_rgba(16,185,129,0.14),0_18px_60px_rgba(0,0,0,0.65),0_0_55px_rgba(16,185,129,0.22)] " +
    "hover:bg-[linear-gradient(180deg,rgba(16,185,129,0.26)_0%,rgba(16,185,129,0.14)_55%,rgba(16,185,129,0.10)_100%)] " +
    "active:translate-y-[0.5px] transition disabled:opacity-50";

  return (
    <main className="relative min-h-screen overflow-x-hidden text-white">
      {/* ✅ BACKGROUND — copied EXACTLY from Deals */}
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

      {/* ✅ OVERLAYS — copied EXACTLY from Deals */}
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

      {/* Location modal */}
      {showLocModal ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-4">
          <div className={`w-full max-w-md ${panel} p-5`}>
            <div className="text-lg font-semibold">Use your current location?</div>
            <p className="mt-1 text-sm text-zinc-400">
              This helps us pick the closest stops when optimizing your route.
            </p>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
              You can still use ZIP fallback anytime.
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
              />
              Don’t ask again
            </label>

            {err ? (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {err}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={closeLocModalContinue}
                disabled={locBusy}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm hover:bg-white/5 disabled:opacity-50"
              >
                Not now
              </button>
              <button onClick={allowLocation} disabled={locBusy} className={ctaGreen + " px-4 py-3"}>
                {locBusy ? "Requesting..." : "Allow location"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CONTENT */}
      <div className="relative z-20 mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-14">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="-mb-16 flex items-center justify-center">
            <Link href="/app/deals" aria-label="BirthdayScout" className="inline-flex select-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brands/longlogo1.png"
                alt="BirthdayScout"
                className=" h-[320px] sm:30 md:auto w-auto opacity-95 drop-shadow-[0_14px_40px_rgba(0,0,0,0.9)] "
                draggable={false}
              />
            </Link>
          </div>

          {/* Card */}
          <div className={`${panel} p-6`}>
            <div className="pointer-events-none absolute left-1/2 top-[-1px] h-px w-[92%] -translate-x-1/2 rounded-full bg-emerald-300/25" />
            <div className="pointer-events-none absolute left-1/2 top-[-1px] h-[22px] w-[92%] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-2xl" />

            <h1 className="text-2xl font-bold mb-2">
              {mode === "login" ? "Log in" : "Create account"}
            </h1>

            <p className="text-sm text-zinc-400 mb-6">
              Save your birthday, plan your freebies, and build your route.
            </p>

            {err ? (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {err}
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={onContinue}>
              {mode === "signup" ? (
                <div>
                  <label className="text-sm text-zinc-300">Name</label>
                  <div className={`${inner} mt-1 flex items-center px-4 py-3`}>
                    <input
                      value={name}
                      onChange={(e) => setName(sanitizeNameInput(e.target.value))}
                      type="text"
                      autoComplete="name"
                      className={inputCls}
                      placeholder="John Doe"
                      disabled={busy}
                      required
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label className="text-sm text-zinc-300">Email</label>
                <div className={`${inner} mt-1 flex items-center px-4 py-3`}>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    className={inputCls}
                    placeholder="you@example.com"
                    disabled={busy}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-zinc-300">Password</label>
                <div className={`${inner} mt-1 flex items-center px-4 py-3`}>
                  <input
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className={inputCls}
                    placeholder="••••••••"
                    disabled={busy}
                    required
                    minLength={6}
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500">Minimum 6 characters.</p>
              </div>

              <button type="submit" disabled={busy} className={ctaGreen + " w-full py-3"}>
                {busy
                  ? mode === "signup"
                    ? "Creating..."
                    : "Signing in..."
                  : mode === "signup"
                  ? "Create account"
                  : "Continue"}
              </button>

              <div className="text-center text-sm text-zinc-400">
                {mode === "login" ? (
                  <>
                    No account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setErr("");
                        setMode("signup");
                        setName("");
                      }}
                      className="text-white underline underline-offset-4 hover:text-zinc-200"
                      disabled={busy}
                    >
                      Create one
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setErr("");
                        setMode("login");
                        setName("");
                      }}
                      className="text-white underline underline-offset-4 hover:text-zinc-200"
                      disabled={busy}
                    >
                      Log in
                    </button>
                  </>
                )}
              </div>

              <p className="text-xs text-zinc-500 text-center">
                Tip: if sign up says “check your email”, your Supabase project has email confirmation enabled.
              </p>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
