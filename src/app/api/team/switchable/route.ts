import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listAccessibleTeamMembers } from "@/lib/directory";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/team/switchable — every employee the caller may land on via /team/[employeeId],
 *  for the team-member switcher on that page's banner (ReviewEmployeeView.tsx) — see
 *  listAccessibleTeamMembers's own doc comment in src/lib/directory.ts for the exact scoping. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const employees = await listAccessibleTeamMembers(employee);
    return NextResponse.json({ employees });
  } catch (err) {
    return toErrorResponse(err);
  }
}
