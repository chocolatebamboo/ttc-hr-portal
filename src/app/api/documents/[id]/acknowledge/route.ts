import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { acknowledgeDocument } from "@/lib/documents";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/documents/[id]/acknowledge — confirms the caller has read this document. Not a
 *  legal electronic signature; see the disclaimer shown alongside the button in the UI. */
export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/acknowledge">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const acknowledgment = await acknowledgeDocument(employee, id);
    return NextResponse.json({ acknowledgment });
  } catch (err) {
    return toErrorResponse(err);
  }
}
