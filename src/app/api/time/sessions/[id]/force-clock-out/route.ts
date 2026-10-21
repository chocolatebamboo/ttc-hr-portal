import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanEditFlaggedTimeEntries } from "@/lib/authorization";
import { InvalidCorrectionError, forceClockOutSession } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";
import { withRlsContext } from "@/lib/db";

/**
 * POST /api/time/sessions/[id]/force-clock-out — stop and correct a currently open clock-in
 * from the admin side (CB, Oct 2026, looking at a card running hours past a scheduled end on
 * the Home dashboard's "Clocked in now": "I feel like there should be kind of an option...
 * from an admin perspective... to stop it and correct it"), body { clockOut: <ISO datetime> }.
 * Same "look up whose entry this is before deciding if the caller may act on it" shape as
 * /api/time/entries/[id]/hr-correct — never trusts a client-supplied employeeId for the
 * authorization check — gated on assertCanEditFlaggedTimeEntries, same as every other "manually
 * edit someone else's recorded time" capability CB restricted to just herself and Shawn.
 * Status/ownership rules themselves (session must still be open, no other open session on the
 * same day) are enforced again inside forceClockOutSession, independently backed by the same
 * RLS policy every other time-entry write goes through.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/time/sessions/[id]/force-clock-out">) {
  try {
    const reviewer = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json();

    if (!body.clockOut) {
      throw new InvalidCorrectionError("A clock-out time is required.");
    }
    const clockOut = new Date(String(body.clockOut));
    if (Number.isNaN(clockOut.getTime())) {
      throw new InvalidCorrectionError("Invalid date/time value.");
    }

    const target = await withRlsContext({ employeeId: reviewer.id, role: reviewer.role }, (tx) =>
      tx.timeSession.findUnique({ where: { id }, select: { timeEntry: { select: { employeeId: true } } } })
    );
    if (!target) {
      return NextResponse.json({ error: "That clock-in session couldn't be found." }, { status: 404 });
    }
    await assertCanEditFlaggedTimeEntries(reviewer, target.timeEntry.employeeId);

    const entry = await forceClockOutSession(reviewer, id, clockOut);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
