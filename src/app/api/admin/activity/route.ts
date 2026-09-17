import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/activity?start=YYYY-MM-DD&end=YYYY-MM-DD&actorId=...&action=... — Phase 4
 * (client spec, Sept 2026): "Reports and Activity History views." Admin-only (enforced inside
 * listActivity itself, same "assert inside the lib function" shape getPayrollHoursReport uses).
 * All four query params are optional — an empty query returns the most recent 200 rows
 * unfiltered, same "sane default view, narrow from there" shape the payroll report's own date
 * pickers default to the current period.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);

    const entries = await listActivity(employee, {
      startDate: searchParams.get("start") || undefined,
      endDate: searchParams.get("end") || undefined,
      actorId: searchParams.get("actorId") || undefined,
      action: searchParams.get("action") || undefined,
    });
    return NextResponse.json(entries);
  } catch (err) {
    return toErrorResponse(err);
  }
}
