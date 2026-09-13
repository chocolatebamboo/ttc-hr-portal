import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { applyClockAction } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/time/clock-in — an optional JSON body `{ reason }` is only ever read (and only
 *  ever required) when this clock-in turns out to be a Phase 3 exception — see
 *  applyClockAction/getClockInStatus in src/lib/time-actions.ts. A plain empty body, same as
 *  before this phase, is exactly right for an on-time clock-in against a real scheduled shift. */
export async function POST(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const entry = await applyClockAction(employee, "CLOCK_IN", reason);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
