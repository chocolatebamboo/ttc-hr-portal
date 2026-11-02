import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authorization";
import {
  InvalidClockActionError,
  InvalidReviewActionError,
  InvalidCorrectionError,
  InvalidTimeEntryDeleteError,
  MissingReturnCommentError,
  MissingExceptionReasonError,
} from "@/lib/time-actions";
import { InvalidPtoRequestError } from "@/lib/pto-actions";
import { InvalidAvailabilityError } from "@/lib/availability";
import { InvalidEmployeeError } from "@/lib/employees-admin";
import { InvalidDepartmentError } from "@/lib/departments-admin";
import { DocumentNotFoundError, InvalidDocumentError, DocumentFolderNotFoundError } from "@/lib/documents";
import { DocumentUploadError, AvatarUploadError } from "@/lib/storage";
import { OnboardingNotFoundError, InvalidOnboardingError, MissingReturnReasonError } from "@/lib/onboarding";
import { AnnouncementNotFoundError, InvalidAnnouncementError } from "@/lib/announcements";
import { InvalidPayrollRangeError } from "@/lib/payroll";
import { CertificationNotFoundError, InvalidCertificationError } from "@/lib/certification";
import { InvalidProfileError } from "@/lib/profile";
import { InvalidTeamNoteError, TeamNoteNotFoundError } from "@/lib/team-notes";
import { InvalidDateTaskError, DateTaskNotFoundError } from "@/lib/date-tasks";
import { InvalidDirectMessageError, DirectMessageNotFoundError } from "@/lib/direct-messages";
import { InvalidShiftError, ShiftNotFoundError } from "@/lib/shifts";
import { WeeklyHourCapExceededError } from "@/lib/hour-cap";

/** Maps our typed domain errors to the right HTTP status instead of leaking a 500 + stack. */
export function toErrorResponse(err: unknown) {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  // CB, Nov 2026: a weekly-cap violation isn't a hard validation failure like the plain
  // InvalidXError 400s below — it's a real conflict the admin gets to resolve in the moment
  // ("Approve anyway" or back off), same 409 "needs a decision" status as a clock-action
  // conflict. `code` + `violations` ride alongside the plain `error` message so the UI can show
  // the real numbers and offer that override without re-parsing message text.
  if (err instanceof WeeklyHourCapExceededError) {
    return NextResponse.json(
      { error: err.message, code: "WEEKLY_CAP_EXCEEDED", violations: err.violations },
      { status: 409 }
    );
  }
  if (err instanceof InvalidClockActionError || err instanceof InvalidReviewActionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (
    err instanceof DocumentNotFoundError ||
    err instanceof DocumentFolderNotFoundError ||
    err instanceof OnboardingNotFoundError ||
    err instanceof AnnouncementNotFoundError ||
    err instanceof CertificationNotFoundError ||
    err instanceof TeamNoteNotFoundError ||
    err instanceof DateTaskNotFoundError ||
    err instanceof DirectMessageNotFoundError ||
    err instanceof ShiftNotFoundError
  ) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (
    err instanceof MissingReturnCommentError ||
    err instanceof MissingReturnReasonError ||
    err instanceof InvalidCorrectionError ||
    err instanceof InvalidTimeEntryDeleteError ||
    err instanceof InvalidPtoRequestError ||
    err instanceof InvalidAvailabilityError ||
    err instanceof InvalidEmployeeError ||
    err instanceof InvalidDepartmentError ||
    err instanceof InvalidDocumentError ||
    err instanceof AvatarUploadError ||
    err instanceof DocumentUploadError ||
    err instanceof InvalidOnboardingError ||
    err instanceof InvalidAnnouncementError ||
    err instanceof InvalidPayrollRangeError ||
    err instanceof InvalidCertificationError ||
    err instanceof InvalidProfileError ||
    err instanceof InvalidTeamNoteError ||
    err instanceof InvalidDateTaskError ||
    err instanceof InvalidDirectMessageError ||
    err instanceof InvalidShiftError ||
    err instanceof MissingExceptionReasonError
  ) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again or contact HR." },
    { status: 500 }
  );
}
