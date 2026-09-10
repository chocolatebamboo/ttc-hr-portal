import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listTeamNoteTopicCounts } from "@/lib/team-notes";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/team-notes/[employeeId]/topic-counts — how many messages exist per date/request
 *  conversation for this one employee, so their own availability/PTO views (and an admin or
 *  supervisor's card view for just this person) can badge each chip without opening every
 *  thread. Same access rule as the general team-notes routes (self, their supervisor, or an
 *  admin) — see listTeamNoteTopicCounts. */
export async function GET(_request: Request, ctx: RouteContext<"/api/team-notes/[employeeId]/topic-counts">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;
    const counts = await listTeamNoteTopicCounts(employee, employeeId);
    return NextResponse.json({ counts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
