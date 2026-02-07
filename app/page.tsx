// app/page.tsx
// Lightweight landing page for BirthdayScout
// Introduces the app and funnels users into the login/signup flow

import Link from "next/link";

export default function Home() {
  return (
    // Full-screen hero layout
    // Centered both vertically and horizontally for a clean first impression
    <main className="min-h-screen flex flex-col items-center justify-center bg-black text-white px-6">
      {/* App name / brand header */}
      <h1 className="text-5xl font-bold mb-4">🎂 BirthdayScout</h1>

      {/* Short value proposition explaining what the app does */}
      <p className="text-lg text-zinc-400 mb-8 text-center max-w-md">
        Plan your birthday freebies, save your favorites, and build the perfect route.
      </p>

      {/* Primary call-to-action
          Sends users into the authentication flow */}
      <Link
        href="/login"
        className="rounded-full bg-white text-black px-6 py-3 font-medium hover:bg-zinc-200 transition"
      >
        Get Started
      </Link>
    </main>
  );
}
