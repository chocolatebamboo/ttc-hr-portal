import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authorization";
import { InvalidClockActionError } from "@/lib/time-actions";

/** Maps our typed domain errors to the right HTTP status instead of leaking a 500 + stack. */
export function toErrorResponse(err: unknown) {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof InvalidClockActionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again or contact HR." },
    { status: 500 }
  );
}
