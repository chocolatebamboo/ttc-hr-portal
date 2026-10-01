import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listAdminAvailability } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/availability — Admin or Supervisor (Correction brief #8, Sept 2026 — same cut
 * canAccessReports/canSeeAdminHomeDashboard use elsewhere). listAdminAvailability itself already
 * does the actual authorization AND scoping (admin sees every submission org-wide; a Supervisor
 * is narrowed to their own direct reports) — this route used to call assertIsAdmin() first,
 * which threw ForbiddenError for a Supervisor before that scoping logic could ever run, so
 * Daijour (SUPERVISOR) got a 403 here no matter what. Found and fixed Oct 2026 (CB: "did you make
 * sure that Daijour's role... is looking like the admin... I need that") — this endpoint backs
 * both the dashboard's "Team availability requests" widget and the full /availability page, so
 * it silently broke both for him. Dropping the extra guard here, same as /api/admin/shifts and
 * /api/team/clocked-in already do, so the one real check lives in the library function instead of
 * being duplicated (and able to drift out of sync) at the route level.
 */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const { pending, decided } = await listAdminAvailability(employee);
    return NextResponse.json({ pending, decided });
  } catch (err) {
    return toErrorResponse(err);
  }
}
