import { NextRequest, NextResponse } from "next/server";
import { sendPendingNotificationEmails } from "@/lib/notification-emails";

/**
 * POST /api/cron/notification-emails — hit on a schedule by the same GitHub Actions workflow
 * that already pings the other reminder-style endpoints (.github/workflows/
 * reminder-emails.yml), not by any user-facing UI. Same shape as /api/cron/clockin-reminders and
 * /api/cron/clockout-reminders: no signed-in employee behind this call, so it's protected by the
 * same shared secret (CRON_SECRET) instead of requireEmployee()/assertIsAdmin() — see README's
 * "Notification emails" section.
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
    const result = await sendPendingNotificationEmails();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
