import { NextResponse } from "next/server";
import { requireRealEmployee } from "@/lib/auth";
import { startPreview } from "@/lib/preview";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/preview/start — Super Admin only. Body: { employeeId: string }. Starts (or
 *  replaces) a "View as" preview of that employee. Always resolves the REAL caller
 *  (requireRealEmployee, not requireEmployee) so this can't be called from inside an already-
 *  active preview using the previewed identity by mistake. */
export async function POST(request: Request) {
  try {
    const actor = await requireRealEmployee();
    const body = await request.json().catch(() => ({}));
    if (typeof body.employeeId !== "string" || !body.employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }
    await startPreview(actor, body.employeeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
