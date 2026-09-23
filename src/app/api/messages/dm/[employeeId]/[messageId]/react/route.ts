import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { toggleReaction, InvalidDirectMessageError } from "@/lib/direct-messages";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/messages/dm/[employeeId]/[messageId]/react — CB, Sept 2026: "I should have the
 *  options to include emojis to react to other people's replies." Body: `{ emoji }`, one of
 *  QUICK_REACTION_EMOJIS (src/types/index.ts). Tap-to-toggle, not separate add/remove verbs — a
 *  second call with the same emoji removes it (see toggleReaction's own doc comment in
 *  src/lib/direct-messages.ts) — so one endpoint covers both directions, same as a like button.
 *  `[employeeId]` isn't used (same as the download route above): a message's own senderId/
 *  recipientId already determine access, this just keeps the URL shape consistent. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/messages/dm/[employeeId]/[messageId]/react">
) {
  try {
    const employee = await requireEmployee();
    const { messageId } = await ctx.params;

    const body = await request.json().catch(() => ({}));
    const emoji = body?.emoji;
    if (typeof emoji !== "string" || !emoji) {
      throw new InvalidDirectMessageError("That's not a reaction you can use here.");
    }

    const reactions = await toggleReaction(employee, messageId, emoji);
    return NextResponse.json({ reactions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
