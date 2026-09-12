import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { cancelAvailabilitySubmission } from "@/lib/availability";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/availability/[submissionId]/cancel — a team member clearing one of their OWN
 * Pending or Denied submissions. Mirrors POST /api/pto/requests/[id]/cancel exactly — see
 * cancelAvailabilitySubmission's doc comment in src/lib/availability.ts for why Approved
 * submissions aren't included.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/availability/[submissionId]/cancel">) {
  try {
    const employee = await requireEmployee();
    const { submissionId } = await ctx.params;
    const submission = await cancelAvailabilitySubmission(employee, submissionId);
    return NextResponse.json(submission);
  } catch (err) {
    return toErrorResponse(err);
  }
}
