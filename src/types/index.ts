// Shared types. Kept close to the Prisma enums so the UI and API agree on vocabulary.

export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "SUPERVISOR" | "EMPLOYEE";

export type EmploymentStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE" | "FORMER_EMPLOYEE";

export type TimeEntryStatus =
  | "IN_PROGRESS"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "RETURNED"
  | "MISSING_ENTRY";

/** The four buttons on the time clock card, derived from what timestamps are already set. */
export type TimeClockState = "BEFORE_WORK" | "CLOCKED_IN" | "ON_LUNCH" | "AFTER_LUNCH" | "CLOCKED_OUT";

export interface CurrentEmployee {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  role: Role;
  employmentStatus: EmploymentStatus;
  jobTitle: string;
  departmentId: string | null;
  supervisorId: string | null;
}

export interface TimeEntryDTO {
  id: string;
  workDate: string; // ISO date, e.g. "2026-08-28"
  clockIn: string | null;
  lunchStart: string | null;
  lunchEnd: string | null;
  clockOut: string | null;
  totalMinutes: number | null;
  status: TimeEntryStatus;
  /** Set only when status is RETURNED — the supervisor/HR comment explaining the issue. */
  reviewComment?: string | null;
}

export interface DirectReportDTO {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  jobTitle: string;
  employmentStatus: EmploymentStatus;
  awaitingApprovalCount: number;
  pendingPtoCount: number;
}

export type PtoType = "VACATION" | "SICK" | "PERSONAL" | "OTHER_APPROVED_LEAVE";
export type PtoStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";

export interface PtoRequestDTO {
  id: string;
  type: PtoType;
  startDate: string; // ISO date
  endDate: string; // ISO date
  hours: number;
  reason: string | null;
  status: PtoStatus;
  reviewComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
