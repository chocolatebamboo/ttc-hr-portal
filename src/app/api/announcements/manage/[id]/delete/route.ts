import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { deleteAnnouncement } from "@/lib/announcements";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/announcements/manage/[id]/delete — HR/Super Admin only. A POST-to-a-/delete-path
 *  action, matching the mutation convention used everywhere else in this app (e.g.
 *  /api/documents/[id]/archive) rather than the DELETE HTTP verb. Unlike archiving a document,
 *  Announcement has no archivedAt field, so this really does remove the row. */
export async function POST(_request: Request, ctx: RouteContext<"/api/announcements/manage/[id]/delete">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    await deleteAnnouncement(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
