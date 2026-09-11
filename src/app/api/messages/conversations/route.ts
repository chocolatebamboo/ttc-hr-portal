import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listConversationSummaries } from "@/lib/direct-messages";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/messages/conversations — every DM conversation the caller is part of, one row per
 *  other person. Backs the DM section of the unified My Messages inbox
 *  (src/app/(portal)/messages/MessagesInboxView.tsx), alongside the general thread and the
 *  existing per-date/PTO topic conversations that page already lists. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const conversations = await listConversationSummaries(employee);
    return NextResponse.json({ conversations });
  } catch (err) {
    return toErrorResponse(err);
  }
}
