/** India statutory filing deadlines — config-driven, client-side only. */

export interface StatutoryDeadline {
  id: string;
  name: string;
  description: string;
  /** Day of month the filing is due (1–31). */
  dayOfMonth: number;
  /** If true, deadline is in the month FOLLOWING the period month. */
  followingMonth?: boolean;
  category: "PF" | "ESI" | "TDS" | "PT" | "INCOME_TAX";
  link?: string; // internal route to navigate on click
}

// VERIFY against current government notifications before relying on these dates.
export const STATUTORY_DEADLINES: StatutoryDeadline[] = [
  {
    id: "pf-ecr",
    name: "PF ECR Filing",
    description: "EPFO Electronic Challan cum Return for PF/EPS deposits",
    dayOfMonth: 15,
    followingMonth: true,
    category: "PF",
    link: "/reports",
  },
  {
    id: "esi-filing",
    name: "ESI Filing & Deposit",
    description: "ESIC contribution deposit for eligible employees",
    dayOfMonth: 15,
    followingMonth: true,
    category: "ESI",
    link: "/compliance",
  },
  {
    id: "tds-deposit",
    name: "TDS Deposit",
    description: "Monthly TDS deducted from salaries deposited with government",
    dayOfMonth: 7,
    followingMonth: true,
    category: "TDS",
    link: "/tds",
  },
  {
    id: "pt-maharashtra",
    name: "PT Return (Maharashtra)",
    description: "Professional Tax return filing for Maharashtra",
    dayOfMonth: 31,
    followingMonth: true,
    category: "PT",
    link: "/compliance",
  },
  {
    id: "form-24q-q1",
    name: "Form 24Q (Q1)",
    description: "TDS return for April–June",
    dayOfMonth: 31,
    category: "TDS",
    link: "/reports",
  },
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
