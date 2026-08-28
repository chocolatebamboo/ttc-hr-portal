import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { applyClockAction } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

export async function POST() {
  try {
    const employee = await requireEmployee();
    const entry = await applyClockAction(employee, "CLOCK_OUT");
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
