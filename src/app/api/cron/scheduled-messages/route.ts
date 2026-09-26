import { NextRequest, NextResponse } from "next/server";
import { sendDueScheduledMessages } from "@/lib/direct-messages";

/**
 * POST /api/cron/scheduled-messages — "Schedule message" (Sept 2026, confirmed for deployment).
 * Hit on a schedule by the same GitHub Actions workflow as the other three cron endpoints
 * (.github/workflows/reminder-emails.yml), not by any user-facing UI. Same shape as
 * /api/cron/shift-reminders: no signed-in employee behind this call, so it's protected by the
 * same shared secret (CRON_SECRET) instead of requireEmployee()/assertIsAdmin() — see README's
 * "Scheduled messages" section for how the workflow is configured to send it.
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
    const result = await sendDueScheduledMessages();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
