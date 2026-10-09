import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { dismiss } from "@/lib/dashboard-dismissals";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/dismiss — Oct 2026 (CB: "swipe left to kind of clear that notification...
 *  I'm just saying like clear it from the home page, but it will still show up in... my tasks
 *  page"): clears one task card from the Home dashboard's Team tasks widget only, same
 *  per-employee dismissal (src/lib/dashboard-dismissals.ts) AnnouncementsSection already uses —
 *  dismiss() is a no-op for a key that's never been seen before, so there's nothing to
 *  additionally validate before calling it. Body: `{ key }`, a content-derived key built
 *  client-side as `date-task:<taskId>:<status>` (see DateTasksSection's dismissKeyFor) so a later
 *  status change on the same task is new information and isn't swallowed by an old dismissal —
 *  same scheme every other dashboard-dismissals caller already follows. */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));
    const key = body?.key;
    if (typeof key !== "string" || !key.startsWith("date-task:")) {
      return NextResponse.json({ error: "Missing or invalid key." }, { status: 400 });
    }
    await dismiss(employee, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
