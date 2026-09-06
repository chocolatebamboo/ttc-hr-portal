import { NextRequest, NextResponse } from "next/server";
import { autoCloseStaleClockIns } from "@/lib/auto-clockout";

/**
 * POST /api/cron/auto-clockout — hit on a schedule by the same GitHub Actions workflow as
 * clockout-reminders/shift-reminders (see README's "Auto clock-out" section), not by any
 * user-facing UI. There's no signed-in employee behind this call, so it's protected by a shared
 * secret (CRON_SECRET) instead of requireEmployee()/assertIsAdmin() — same shape as the other
 * two cron routes.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await autoCloseStaleClockIns();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
