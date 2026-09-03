import { NextRequest, NextResponse } from "next/server";
import { sendPendingClockoutReminders } from "@/lib/clockout-reminders";

/**
 * POST /api/cron/clockout-reminders — hit on a schedule by a Render Cron Job, not by any
 * user-facing UI. There's no signed-in employee behind this call, so it's protected by a
 * shared secret (CRON_SECRET) instead of requireEmployee()/assertIsAdmin() — see README's
 * "Clock-out reminders" section for how the Cron Job is configured to send it.
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
    const result = await sendPendingClockoutReminders();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
