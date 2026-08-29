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
import { InvalidEmployeeError } from "@/lib/employees-admin";
import { InvalidDepartmentError } from "@/lib/departments-admin";
import { DocumentNotFoundError, InvalidDocumentError } from "@/lib/documents";
import { DocumentUploadError } from "@/lib/storage";
import { OnboardingNotFoundError, InvalidOnboardingError } from "@/lib/onboarding";
import { AnnouncementNotFoundError, InvalidAnnouncementError } from "@/lib/announcements";
import { InvalidPayrollRangeError } from "@/lib/payroll";

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
    err instanceof DocumentNotFoundError ||
    err instanceof OnboardingNotFoundError ||
    err instanceof AnnouncementNotFoundError
  ) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (
    err instanceof MissingReturnCommentError ||
    err instanceof InvalidCorrectionError ||
    err instanceof InvalidPtoRequestError ||
    err instanceof InvalidEmployeeError ||
    err instanceof InvalidDepartmentError ||
    err instanceof InvalidDocumentError ||
    err instanceof DocumentUploadError ||
    err instanceof InvalidOnboardingError ||
    err instanceof InvalidAnnouncementError ||
    err instanceof InvalidPayrollRangeError
  ) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again or contact HR." },
    { status: 500 }
  );
}
