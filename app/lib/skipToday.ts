const SKIP_KEY = "bs_skipped_today";

type SkipData = {
  date: string;
  ids: string[];
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function getSkippedToday(): string[] {
  try {
    const raw = localStorage.getItem(SKIP_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as SkipData;

    if (parsed.date !== todayStr()) {
      localStorage.removeItem(SKIP_KEY);
      return [];
    }

    return Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

export function skipDealToday(id: string) {
  const current = getSkippedToday();

  const data: SkipData = {
    date: todayStr(),
    ids: Array.from(new Set([...current, id]))
  };

  localStorage.setItem(SKIP_KEY, JSON.stringify(data));
}

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
