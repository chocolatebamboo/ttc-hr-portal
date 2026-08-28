import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { submitEmployeeCorrection } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

function parseNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date/time value.");
  return d;
}

/**
 * POST /api/time/entries/[id]/correct — the employee's own resubmission after a
 * supervisor/HR Return. Ownership and status (must be RETURNED) are enforced inside
 * submitEmployeeCorrection, independently backed by the same RLS policy every other
 * time-entry write goes through.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/time/entries/[id]/correct">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const body = await request.json();

    const input = {
      clockIn: parseNullableDate(body.clockIn),
      lunchStart: parseNullableDate(body.lunchStart),
      lunchEnd: parseNullableDate(body.lunchEnd),
      clockOut: parseNullableDate(body.clockOut),
    };

    const entry = await submitEmployeeCorrection(employee, id, input);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
