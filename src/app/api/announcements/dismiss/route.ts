import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { dismissAnnouncementForEmployee } from "@/lib/announcements";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/announcements/dismiss — Oct 2026 (CB, circling the Announcements card on her Home
 * dashboard: "I should be able to clear this notification as well"). Body: `{ announcementId }`.
 * Same per-employee dismissal (src/lib/dashboard-dismissals.ts) the approvals/messages banners
 * already use (src/app/api/dashboard/notifications/dismiss/route.ts) — dismissAnnouncementForEmployee
 * is a no-op for an announcementId that doesn't exist or was never shown to this employee, so
 * there's nothing here to additionally check before calling it.
 */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    const body = await request.json().catch(() => ({}));
    const announcementId = body?.announcementId;
    if (typeof announcementId !== "string" || !announcementId) {
      return NextResponse.json({ error: "Missing announcementId." }, { status: 400 });
    }
    await dismissAnnouncementForEmployee(employee, announcementId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
