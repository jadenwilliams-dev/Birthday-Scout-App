// localStorage key used to track which deals the user skipped today
// This resets automatically each day
const SKIP_KEY = "bs_skipped_today";

// Shape of the data we store in localStorage
// Tying skips to a date makes the behavior predictable and easy to reset
type SkipData = {
  date: string;   // YYYY-MM-DD format
  ids: string[]; // Deal IDs skipped on that date
};

// Returns today's date as a simple YYYY-MM-DD string
// Using this format makes comparisons easy and timezone-safe enough for daily resets
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Read the list of deals skipped *today* from localStorage
// If the stored date is not today, we wipe it and start fresh
export function getSkippedToday(): string[] {
  try {
    const raw = localStorage.getItem(SKIP_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as SkipData;

    // If the stored date is from a previous day, clear it
    if (parsed.date !== todayStr()) {
      localStorage.removeItem(SKIP_KEY);
      return [];
    }

    // Only return IDs if the shape looks correct
    return Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    // If anything goes wrong (bad JSON, blocked storage), treat as nothing skipped
    return [];
  }
}

// Mark a deal as skipped for today
// Duplicate IDs are prevented using a Set
export function skipDealToday(id: string) {
  const current = getSkippedToday();

  const data: SkipData = {
    date: todayStr(),
    ids: Array.from(new Set([...current, id])) // ensures uniqueness
  };

  localStorage.setItem(SKIP_KEY, JSON.stringify(data));
}

// Remove a deal from today's skipped list
// This is useful if the user changes their mind
export function unskipDealToday(id: string) {
  const filtered = getSkippedToday().filter((x) => x !== id);

  localStorage.setItem(
    SKIP_KEY,
    JSON.stringify({
      date: todayStr(),
      ids: filtered
    })
  );
}
