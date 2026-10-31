/** Resolves range/date search params to a [from, to] window. */
export function dateWindow(range?: string, date?: string): { from: Date; to: Date } {
  const now = new Date();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const from = new Date(`${date}T00:00:00`);
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return { from: now, to: new Date(startOfDay.getTime() + 86_400_000) };
    case "tomorrow":
      return { from: new Date(startOfDay.getTime() + 86_400_000), to: new Date(startOfDay.getTime() + 2 * 86_400_000) };
    case "48h":
      return { from: now, to: new Date(now.getTime() + 48 * 3600_000) };
    default:
      return { from: now, to: new Date(now.getTime() + 7 * 86_400_000) };
  }
}
