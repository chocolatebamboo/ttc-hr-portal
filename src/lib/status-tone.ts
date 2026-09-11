/**
 * Shared card-background gradient, keyed by decision status instead of by person or type —
 * CB, Sept 2026 (round three of the card redesign): after round two colored each card by
 * employee (Availability) or by leave type (PTO), she pointed at an actual Approved card and
 * an actual Pending card in chat and asked for the opposite mapping — "instead of the yellow
 * background, I want the pink background" for Approved, "the pending color should be that
 * yellow as well." Confirmed explicitly: status should drive the color everywhere, replacing
 * the old per-person/per-type schemes in both TeamAvailabilityCards and TeamPtoCards, not just
 * those two specific cards. Denied gets its own rose tone (not asked for by name, but every
 * other status needed one and rose already reads as "declined" everywhere else in this app —
 * PtoStatusPill, TeamPtoCards' old SICK tone). Cancelled was originally a neutral slate for the
 * same reason, but CB, round four: "I want blue somewhere in there because the organization's
 * colors is pink and blue" — Approved already owns pink, so Cancelled (the other "closed out,
 * nothing to review" status) picks up the brand blue instead of slate.
 */
export const STATUS_TONE: Record<"PENDING" | "APPROVED" | "DENIED" | "CANCELLED", { from: string; to: string }> = {
  PENDING: { from: "#f59e0b", to: "#b45309" }, // amber-500 → amber-700
  APPROVED: { from: "var(--ttc-pink)", to: "var(--ttc-pink-ink)" },
  DENIED: { from: "#f43f5e", to: "#be123c" }, // rose-500 → rose-700
  CANCELLED: { from: "var(--ttc-blue)", to: "var(--ttc-blue-ink)" },
};

export function toneForStatus(status: string): { from: string; to: string } {
  return STATUS_TONE[status as keyof typeof STATUS_TONE] ?? STATUS_TONE.PENDING;
}
