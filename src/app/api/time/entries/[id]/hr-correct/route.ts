import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanEditFlaggedTimeEntries } from "@/lib/authorization";
import { InvalidCorrectionError, submitReviewerCorrection, type CorrectionSessionInput } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";
import { withRlsContext } from "@/lib/db";

function parseSessions(body: unknown): CorrectionSessionInput[] {
  if (!Array.isArray(body)) {
    throw new InvalidCorrectionError("At least one clock-in/clock-out pair is required.");
  }
  return body.map((raw) => {
    const s = (raw ?? {}) as { clockIn?: unknown; clockOut?: unknown };
    if (!s.clockIn || !s.clockOut) {
      throw new InvalidCorrectionError("Each session needs both a clock-in and a clock-out time.");
    }
    const clockIn = new Date(String(s.clockIn));
    const clockOut = new Date(String(s.clockOut));
    if (Number.isNaN(clockIn.getTime()) || Number.isNaN(clockOut.getTime())) {
      throw new InvalidCorrectionError("Invalid date/time value.");
    }
    return { clockIn, clockOut };
  });
}

/**
 * Round 10 (CB, Oct 2026, pointing at Haile's flagged double-clock-in recorded as 0h 00m: "we
 * should have the option to adjust the time and manually edit the time... but remember only
 * Shawn and I am supposed to be able to have those types of capabilities"). POST
 * /api/time/entries/[id]/hr-correct, body { sessions: [{ clockIn, clockOut }, ...] } — the
 * reviewer-side counterpart to /correct above, for a flagged (AWAITING_APPROVAL) entry rather
 * than the employee's own RETURNED one. Same "look up whose entry this is before deciding if the
 * caller may act on it" shape as /approve — never trusts a client-supplied employeeId for the
 * authorization check — but gates on assertCanEditFlaggedTimeEntries (the per-person
 * canEditFlaggedTimeEntries flag, restricted to CB and Shawn) instead of assertCanReviewTimesheet.
 * Status/ownership rules themselves (must be AWAITING_APPROVAL) are enforced again inside
 * submitReviewerCorrection, independently backed by the same RLS policy every other time-entry
 * write goes through.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/time/entries/[id]/hr-correct">) {
  try {
    const reviewer = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json();
    const sessions = parseSessions(body.sessions);

    const target = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, (tx) =>
      tx.timeEntry.findUnique({ where: { id }, select: { employeeId: true } })
    );
    if (!target) {
      return NextResponse.json({ error: "Time entry not found." }, { status: 404 });
    }
    await assertCanEditFlaggedTimeEntries(reviewer, target.employeeId);

    const entry = await submitReviewerCorrection(reviewer, id, sessions);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
