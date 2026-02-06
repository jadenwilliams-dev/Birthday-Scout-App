// Server component that renders the detailed view for a single deal.
// It looks up the deal by ID, shows all of its information,
// and provides actions like add-to-plan, mark claimed, and open in maps.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_DEALS } from "@/app/lib/deals";
import AddToPlanButton from "./AddToPlanButton";
import OpenInMapsButton from "./OpenInMapsButton";
import ClaimedButton from "./ClaimedButton";

// Deal details page.
// This is an async server component because route params are async
// and no client-side state is required here.
export default async function DealDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Extract the deal ID from the route params
  const { id } = await params;

  // Find the matching deal from the full deals list
  const deal = ALL_DEALS.find((d) => d.id === id);

  // If no deal exists for this ID, show a 404 page
  if (!deal) notFound();

  // Base query used for Google Maps searches:
  // prefer an explicit mapQuery if provided, otherwise fall back to the deal name
  const baseQuery = deal.mapQuery ?? deal.name;

  return (
    <div className="mx-auto max-w-md pb-24">
      {/* Back navigation */}
      <div className="mb-4">
        <Link
          href="/app/deals"
          className="text-sm text-zinc-400 underline underline-offset-4"
        >
          ← Back to Deals
        </Link>
      </div>

      {/* Hero / main deal card */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 relative overflow-hidden">
        {/* Decorative gradient blobs for visual polish */}
        <div className="pointer-events-none absolute -top-20 -right-24 h-56 w-56 rounded-full bg-gradient-to-br from-pink-500/25 via-purple-500/20 to-cyan-500/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-24 h-56 w-56 rounded-full bg-gradient-to-tr from-cyan-500/20 via-purple-500/15 to-pink-500/20 blur-2xl" />

        {/* Deal content */}
        <div className="relative">
          {/* Deal category */}
          <p className="text-xs text-zinc-400">{deal.category}</p>

          {/* Deal name */}
          <h1 className="text-2xl font-bold mt-1 leading-tight">
            {deal.name}
          </h1>

          {/* Main freebie description */}
          <p className="text-zinc-100 mt-3 text-base font-semibold">
            {deal.freebie}
          </p>

          {/* Optional conditions */}
          {deal.conditions ? (
            <p className="text-zinc-300/90 mt-3 text-sm">
              {deal.conditions}
            </p>
          ) : (
            <p className="text-zinc-400 mt-3 text-sm">
              No special conditions listed.
            </p>
          )}
        </div>
      </div>

      {/* Primary action buttons */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {/* Add/remove this deal from the user’s plan */}
        <AddToPlanButton dealId={deal.id} />

        {/* Mark this deal as claimed */}
        <ClaimedButton dealId={deal.id} />

        {/* Open Google Maps search for this deal */}
        <OpenInMapsButton baseQuery={baseQuery} />

        {/* Shortcut to the plan page */}
        <Link
          href="/app/plan"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10 transition text-center"
        >
          Go to My Plan
        </Link>
      </div>

      {/* Optional rewards signup link */}
      {deal.signupUrl ? (
        <a
          href={deal.signupUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-zinc-200 transition text-center"
        >
          Join rewards
        </a>
      ) : null}

      {/* Claim steps section */}
      {deal.claimSteps && deal.claimSteps.length > 0 ? (
        <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-base font-semibold mb-3">How to claim</h2>
          {/* Ordered list of steps for claiming the deal */}
          <ol className="list-decimal pl-5 space-y-2 text-zinc-200 text-sm">
            {deal.claimSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      ) : (
        // Fallback when no claim steps are provided yet
        <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-base font-semibold mb-2">How to claim</h2>
          <p className="text-sm text-zinc-400">
            No steps listed yet — we can add them to make this feel more
            “DoorDash detail page”.
          </p>
        </div>
      )}

      {/* Sticky bottom call-to-action */}
      {/* Encourages the user to add the deal to their plan and optimize a route */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="mx-auto max-w-md px-4 pb-4">
          <div className="rounded-3xl border border-white/10 bg-black/70 backdrop-blur-xl p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-200 font-semibold">
                Ready to route?
              </p>
              <p className="text-xs text-zinc-400">
                Add it to your plan then optimize.
              </p>
            </div>
            <Link
              href="/app/plan"
              className="rounded-2xl bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-zinc-200 transition"
            >
              Open Plan
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
