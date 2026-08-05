/** India statutory filing deadlines — config-driven, client-side only. */

export interface StatutoryDeadline {
  id: string;
  name: string;
  description: string;
  /** Day of month the filing is due (1–31). */
  dayOfMonth: number;
  /** If true, deadline is in the month FOLLOWING the period month. */
  followingMonth?: boolean;
  category: "PF" | "ESI" | "PT" | "INCOME_TAX";
  link?: string; // internal route to navigate on click
}

// VERIFY against current government notifications before relying on these dates.
export const STATUTORY_DEADLINES: StatutoryDeadline[] = [
];

/** Compute the next occurrence date of a deadline relative to today. */
export function nextOccurrence(deadline: StatutoryDeadline): Date {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed

  // Target month (0-indexed)
  const targetMonth = deadline.followingMonth ? month + 1 : month;
  const target = new Date(year, targetMonth, deadline.dayOfMonth);

  // If the deadline has already passed this month, move to next month.
  if (target <= today) {
    return new Date(year, targetMonth + 1, deadline.dayOfMonth);
  }
  return target;
}

/** Days remaining until the deadline. */
export function daysUntil(deadline: StatutoryDeadline): number {
  const next = nextOccurrence(deadline);
  return Math.ceil((next.getTime() - Date.now()) / 86_400_000);
}

/** Get the 3 soonest deadlines. */
export function getNextDeadlines(count = 3): Array<StatutoryDeadline & { daysLeft: number; nextDate: Date }> {
  return STATUTORY_DEADLINES.map((d) => ({
    ...d,
    daysLeft: daysUntil(d),
    nextDate: nextOccurrence(d),
  }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, count);
}
