import { NextRequest, NextResponse } from "next/server";
import { sendPendingAvailabilityCutoffReminders } from "@/lib/availability-cutoff-reminders";

/**
 * POST /api/cron/availability-cutoff-reminders — hit on a schedule by the same GitHub Actions
 * workflow as the other cron endpoints (.github/workflows/reminder-emails.yml), not by any
 * user-facing UI. Same CRON_SECRET-protected shape as every other cron route in this app — see
 * README's "Availability cutoff reminders" section.
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
    const result = await sendPendingAvailabilityCutoffReminders();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
