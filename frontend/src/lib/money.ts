// METRO_CITIES must match the backend constant exactly.
// VERIFY: services/salary-service/app/settings.py METRO_CITIES
export const METRO_CITIES = new Set(["Mumbai", "Delhi", "Kolkata", "Chennai"]);

const INR_FMT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a money string/number as ₹XX,XX,XXX.XX */
export function formatINR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "₹0.00";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "₹0.00";
  return INR_FMT.format(n);
}

/** Round half-up to 2 decimal places — mirrors Python Decimal ROUND_HALF_UP. */
function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Client-side salary breakdown preview.
 * Must mirror exactly: services/salary-service/app/logic.py compute_breakdown()
 */
export function computeSalaryPreview(
  ctcAnnual: number,
  workLocation: string | null | undefined
): {
  monthlyGross: number;
  basic: number;
  hra: number;
  specialAllowance: number;
  isMetro: boolean;
} {
  const monthlyGross = r2(ctcAnnual / 12);
  const basic = r2(monthlyGross * 0.4);
  const isMetro = METRO_CITIES.has(workLocation || "");
  const hra = r2(basic * (isMetro ? 0.5 : 0.4));
  const specialAllowance = r2(monthlyGross - basic - hra);
  return { monthlyGross, basic, hra, specialAllowance, isMetro };
}
