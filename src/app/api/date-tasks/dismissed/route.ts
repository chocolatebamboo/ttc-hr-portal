import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDismissedKeys } from "@/lib/dashboard-dismissals";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/date-tasks/dismissed — bulk-checks which of this employee's CURRENTLY loaded Team
 *  tasks cards have already been cleared from Home (see dismiss/route.ts above), so
 *  DateTasksSection can hide them again on a fresh page load instead of just for the rest of
 *  that one browser session. Body: `{ keys: string[] }` — the content-derived
 *  `date-task:<id>:<status>` keys for whatever DateTasksSection just fetched; returns the subset
 *  already dismissed. listDismissedKeys itself is the same generic bulk lookup the HR roster's
 *  Decided-availability cards already use (src/lib/dashboard-dismissals.ts) — no new backend
 *  concept here, just a new caller of it. */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));
    const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === "string") : [];
    const dismissed = await listDismissedKeys(employee, keys);
    return NextResponse.json({ dismissed: Array.from(dismissed) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
