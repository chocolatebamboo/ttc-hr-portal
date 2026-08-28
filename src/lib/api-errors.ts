import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authorization";
import {
  InvalidClockActionError,
  InvalidReviewActionError,
  InvalidCorrectionError,
  MissingReturnCommentError,
} from "@/lib/time-actions";
import { InvalidPtoRequestError } from "@/lib/pto-actions";

/** Maps our typed domain errors to the right HTTP status instead of leaking a 500 + stack. */
export function toErrorResponse(err: unknown) {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof InvalidClockActionError || err instanceof InvalidReviewActionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (
    err instanceof MissingReturnCommentError ||
    err instanceof InvalidCorrectionError ||
    err instanceof InvalidPtoRequestError
  ) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again or contact HR." },
    { status: 500 }
  );
}
