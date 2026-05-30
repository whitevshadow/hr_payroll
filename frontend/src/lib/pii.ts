/**
 * PII masking helpers.
 * "Reveal" is handled by the UI calling POST /employees/{id}/pii-access
 * and then displaying the raw value. The mask is display-only.
 */

export type PiiType = "pan" | "account" | "aadhaar" | "ifsc" | "generic";

export function maskPii(value: string | null | undefined, type: PiiType = "generic"): string {
  if (!value) return "—";
  switch (type) {
    case "pan":
      // ABCDE1234F → XXXXX1234F
      return `XXXXX${value.slice(5)}`;
    case "account":
      // Show last 4 digits
      return `XXXXXXXX${value.slice(-4)}`;
    case "aadhaar":
      return `XXXX XXXX ${value.slice(-4)}`;
    case "ifsc":
      return `${value.slice(0, 4)}XXXXXXX`;
    default:
      return value.length > 4
        ? `${"X".repeat(value.length - 4)}${value.slice(-4)}`
        : "XXXX";
  }
}
