import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { InvalidCorrectionError, submitEmployeeCorrection, type CorrectionSessionInput } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

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
 * POST /api/time/entries/[id]/correct — the employee's own resubmission after a
 * supervisor/HR Return, body { sessions: [{ clockIn, clockOut }, ...] }. Ownership and status
 * (must be RETURNED) are enforced inside submitEmployeeCorrection, independently backed by the
 * same RLS policy every other time-entry write goes through.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/time/entries/[id]/correct">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json();
    const sessions = parseSessions(body.sessions);

    const entry = await submitEmployeeCorrection(employee, id, sessions);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
