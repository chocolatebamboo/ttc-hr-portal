import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/announcements — the caller's own visible feed: published, not expired, and
 *  targeted at them (their department, them individually, or Everyone). */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const announcements = await listAnnouncementsForEmployee(employee);
    return NextResponse.json({ announcements });
  } catch (err) {
    return toErrorResponse(err);
  }
}
