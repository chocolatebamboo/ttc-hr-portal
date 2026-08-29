import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import {
  listAnnouncementsForAdmin,
  createAnnouncement,
  InvalidAnnouncementError,
} from "@/lib/announcements";
import { toErrorResponse } from "@/lib/api-errors";
import type { AnnouncementAudienceType } from "@/types";

const VALID_AUDIENCE_TYPES: AnnouncementAudienceType[] = ["EVERYONE", "DEPARTMENTS", "EMPLOYEES"];

/** GET /api/announcements/manage — HR/Super Admin only. Every post, including future-dated and
 *  expired ones, with who it targeted. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const announcements = await listAnnouncementsForAdmin(employee);
    return NextResponse.json({ announcements });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/announcements/manage — HR/Super Admin only. Body:
 * { title, message, publishDate?, expirationDate?, audienceType, departmentIds?, employeeIds? }
 */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const body = await request.json().catch(() => ({}));

    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new InvalidAnnouncementError("Title is required.");
    }
    if (typeof body.message !== "string" || !body.message.trim()) {
      throw new InvalidAnnouncementError("Message is required.");
    }
    if (!VALID_AUDIENCE_TYPES.includes(body.audienceType)) {
      throw new InvalidAnnouncementError("Choose who this announcement is for.");
    }

    const publishDate = typeof body.publishDate === "string" && body.publishDate ? new Date(body.publishDate) : undefined;
    if (publishDate && Number.isNaN(publishDate.getTime())) {
      throw new InvalidAnnouncementError("Choose a valid publish date.");
    }
    const expirationDate =
      typeof body.expirationDate === "string" && body.expirationDate ? new Date(body.expirationDate) : undefined;
    if (expirationDate && Number.isNaN(expirationDate.getTime())) {
      throw new InvalidAnnouncementError("Choose a valid expiration date.");
    }

    const departmentIds = Array.isArray(body.departmentIds)
      ? body.departmentIds.filter((id: unknown): id is string => typeof id === "string")
      : undefined;
    const employeeIds = Array.isArray(body.employeeIds)
      ? body.employeeIds.filter((id: unknown): id is string => typeof id === "string")
      : undefined;

    const announcement = await createAnnouncement(employee, {
      title: body.title,
      message: body.message,
      publishDate,
      expirationDate,
      audienceType: body.audienceType,
      departmentIds,
      employeeIds,
    });

    return NextResponse.json({ announcement }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
