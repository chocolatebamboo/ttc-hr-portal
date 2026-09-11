import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { cancelPtoRequest } from "@/lib/pto-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/pto/requests/[id]/cancel — an employee withdrawing their own pending request. */
export async function POST(_request: Request, ctx: RouteContext<"/api/pto/requests/[id]/cancel">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const request = await cancelPtoRequest(employee, id);
    return NextResponse.json({ request });
  } catch (err) {
    return toErrorResponse(err);
  }
}
