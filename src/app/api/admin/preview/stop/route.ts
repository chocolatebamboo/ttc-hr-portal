import { NextResponse } from "next/server";
import { requireRealEmployee } from "@/lib/auth";
import { endPreview } from "@/lib/preview";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/preview/stop — clears any active "View as" preview for the caller. No role
 *  check beyond being signed in: exiting a preview must always work. src/proxy.ts carves this
 *  one path out as the sole exception to "no mutations while previewing," since without that
 *  exception nobody previewing could ever call it to get out. */
export async function POST() {
  try {
    await requireRealEmployee();
    await endPreview();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
