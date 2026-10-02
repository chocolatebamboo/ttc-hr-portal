import { NextRequest, NextResponse } from "next/server";
import { sendPendingAnnouncementNotifications } from "@/lib/announcement-notifications";

/**
 * POST /api/cron/announcement-notifications — hit on a schedule by the GitHub Actions workflow
 * (.github/workflows/reminder-emails.yml), not by any user-facing UI. There's no signed-in
 * employee behind this call, so it's protected by a shared secret (CRON_SECRET) instead of
 * requireEmployee()/assertIsAdmin() — same shape as every other /api/cron/* route in this app.
 * See README's "Announcement notifications" section.
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
    const result = await sendPendingAnnouncementNotifications();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
