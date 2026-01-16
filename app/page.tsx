import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-black text-white px-6">
      <h1 className="text-5xl font-bold mb-4">🎂 BirthdayScout</h1>

      <p className="text-lg text-zinc-400 mb-8 text-center max-w-md">
        Plan your birthday freebies, save your favorites, and build the perfect route.
      </p>

      <Link
        href="/login"
        className="rounded-full bg-white text-black px-6 py-3 font-medium hover:bg-zinc-200 transition"
      >
        Get Started
      </Link>
    </main>
  );
}
