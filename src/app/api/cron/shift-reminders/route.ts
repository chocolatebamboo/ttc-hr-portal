import { NextRequest, NextResponse } from "next/server";
import { sendPendingShiftReminders } from "@/lib/shift-reminders";

/**
 * POST /api/cron/shift-reminders — hit on a schedule by a Render Cron Job, not by any
 * user-facing UI. Same shape as /api/cron/clockout-reminders: no signed-in employee behind
 * this call, so it's protected by the same shared secret (CRON_SECRET) instead of
 * requireEmployee()/assertIsAdmin() — see README's "Shift reminders" section for how the Cron
 * Job is configured to send it.
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
    const result = await sendPendingShiftReminders();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
