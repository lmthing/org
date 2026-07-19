export function nextRenewal(): { name: string; date: string; daysUntil: number } {
  // find the next upcoming renewal date across all subscriptions
  const now = new Date();
  const renewalDates: [string, string][] = [
    ["Netflix", "monthly on the " + now.getDate() + "th"],     // monthly — treat as recurring today; never "overdue"
    ["Spotify Family", "monthly on the " + now.getDate() + "th"],
    ["Gym", "monthly on the " + now.getDate() + "th"],
    ["iCloud", "monthly on the " + now.getDate() + "th"],
    ["Adobe Creative Cloud", "2026-10-20"],
    ["Amazon Prime", "2027-03-01"],
    ["Kathimerini", "2026-11-15"]
  ];

  let nearest: { name: string; date: string; daysUntil: number } | null = null;

  for (const [name, dateStr] of renewalDates) {
    let target: Date;
    let displayDate: string;
    let daysUntil: number;

    if (dateStr.startsWith("monthly")) {
      // Monthly subscriptions renew today (or the same day next month) — treat as 0 days.
      target = now;
      displayDate = now.toISOString().slice(0, 10);
      daysUntil = 0;
    } else {
      target = new Date(dateStr + "T00:00:00");
      displayDate = dateStr;
      daysUntil = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (!nearest || daysUntil < nearest.daysUntil) {
      nearest = { name, date: displayDate, daysUntil };
    }
  }

  return nearest as { name: string; date: string; daysUntil: number };
}