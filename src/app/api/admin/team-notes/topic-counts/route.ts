import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listAllTeamNoteTopicCounts } from "@/lib/team-notes";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/team-notes/topic-counts — every employee's message counts per date/request
 *  conversation, in one call, so TeamAvailabilityCards/TeamPtoCards (which list many people's
 *  cards on one admin page) can badge every chip without one fetch per employee. HR/Super
 *  Admin only. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const counts = await listAllTeamNoteTopicCounts(employee);
    return NextResponse.json({ counts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
