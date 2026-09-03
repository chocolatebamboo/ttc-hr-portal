import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { resendInvite } from "@/lib/employees-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/employees/[id]/resend-invite — HR/Super Admin only. Re-sends the Supabase
 *  invite email for someone who hasn't confirmed their account yet (see resendInvite's doc
 *  comment for why this refuses once someone has already signed in at least once). */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/employees/[id]/resend-invite">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    await resendInvite(employee, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
