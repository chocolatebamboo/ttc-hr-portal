import { NextRequest, NextResponse } from "next/server";
import { sendPendingClockinReminders } from "@/lib/clockin-reminders";

/**
 * POST /api/cron/clockin-reminders — hit on a schedule by the GitHub Actions workflow
 * (.github/workflows/reminder-emails.yml), not by any user-facing UI. Replaces the now-retired
 * POST /api/cron/shift-reminders (src/lib/shift-reminders.ts), same CRON_SECRET-protected shape
 * as every other cron route in this app — see README's "Clock-in reminders" section.
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
    const result = await sendPendingClockinReminders();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
