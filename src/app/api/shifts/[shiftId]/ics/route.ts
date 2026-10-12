import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getShiftForCalendar } from "@/lib/shifts";
import { buildIcsEvent } from "@/lib/ics";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/shifts/[shiftId]/ics — "Add to Calendar" (CB, Oct 2026). Deliberately a plain
 * navigable link rather than a fetch+blob download: iOS Safari's native "Add to Calendar"
 * confirmation sheet only triggers off actually navigating to a text/calendar response, so the
 * button on ScheduleView's ShiftCard is a real <a href> pointing straight at this route instead
 * of a JS-driven click handler. Same report-as-a-file shape as
 * /api/payroll/hours/csv — one GET, self-contained response, no JSON body on success. Self-only
 * — see getShiftForCalendar's own doc comment in src/lib/shifts.ts for why there's no
 * supervisor/admin case here.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/shifts/[shiftId]/ics">) {
  try {
    const employee = await requireEmployee();
    const { shiftId } = await ctx.params;
    const shift = await getShiftForCalendar(employee, shiftId);

    const ics = buildIcsEvent({
      uid: `shift-${shift.id}@hr.talentedteenclub.org`,
      summary: "TTC Shift",
      location: "Talented Teen Club",
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="ttc-shift-${shift.date}.ics"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
