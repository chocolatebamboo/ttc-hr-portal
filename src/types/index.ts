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

/** One row in the HR-wide attendance dashboard (src/app/(portal)/admin/attendance) — every
 *  active employee, not just one supervisor's team, for a selected week. */
export interface AdminAttendanceRowDTO {
  employeeId: string;
  name: string;
  jobTitle: string;
  department: string | null;
  awaitingApprovalCount: number;
  /** Entries with a clockIn but no clockOut yet, within the selected week — the "missing
   *  clock-outs" the admin attendance dashboard is meant to surface. */
  missingClockOutCount: number;
}

/** One row in the Employees admin page (src/app/(portal)/admin/employees) — every employee,
 *  active or deactivated, with the full HR record (unlike DirectoryEntryDTO, which deliberately
 *  omits personal contact info). Only ever returned to an admin — see src/lib/employees-admin.ts. */
export interface EmployeeAdminRowDTO {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ttcEmail: string;
  workPhone: string | null;
  personalPhone: string | null;
  personalEmail: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  jobTitle: string;
  role: Role;
  employmentStatus: EmploymentStatus;
  departmentId: string | null;
  departmentName: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  deactivatedAt: string | null;
  hireDate: string;
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

/** Same shape as PtoRequestDTO plus who it belongs to — for the HR-wide PTO dashboard
 *  (src/app/(portal)/admin/pto), which lists requests across every employee at once rather
 *  than one supervisor's team. */
export interface AdminPtoRequestDTO extends PtoRequestDTO {
  employeeId: string;
  employeeName: string;
}

/** GET /api/admin/pto's response — a pending queue for HR to act on, and a forward-looking
 *  view of who's already approved to be out, so HR can see coverage gaps before they happen. */
export interface AdminPtoSummaryDTO {
  pending: AdminPtoRequestDTO[];
  upcoming: AdminPtoRequestDTO[];
}

export type DocumentCategory =
  | "EMPLOYEE_HANDBOOK"
  | "HR_POLICY"
  | "JOB_DESCRIPTION"
  | "OFFER_LETTER"
  | "PERFORMANCE_REVIEW"
  | "TRAINING"
  | "EMPLOYEE_FORM"
  | "CONFIDENTIAL_EMPLOYEE_DOCUMENT"
  | "OTHER";

export type DocumentVisibility = "GLOBAL" | "DEPARTMENT" | "INDIVIDUAL" | "CONFIDENTIAL_HR";

/** What an employee sees on their own Documents page — RLS already filtered this to only
 *  what they're allowed to see, so there's no visibility/assignment info here at all. */
export interface DocumentDTO {
  id: string;
  title: string;
  category: DocumentCategory;
  version: number;
  requiresAcknowledgment: boolean;
  /** Set only when the ack is for the document's CURRENT version — a re-upload requires a
   *  fresh acknowledgment, so an ack of a superseded version reports as null here. */
  acknowledgedAt: string | null;
  createdAt: string;
}

/** What HR/Super Admin sees in the management table — includes assignment + rollout info a
 *  regular employee should never see about a document that isn't theirs. */
export interface DocumentAdminSummaryDTO {
  id: string;
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  version: number;
  requiresAcknowledgment: boolean;
  archivedAt: string | null;
  createdAt: string;
  assignedToLabel: string;
  acknowledgedCount: number;
  eligibleCount: number;
}

export interface DepartmentDTO {
  id: string;
  name: string;
}

/** One row in the Administration page's Departments section (src/app/(portal)/admin/administration)
 *  — unlike the bare DepartmentDTO above (an assignment-picker option elsewhere), this carries
 *  the employeeCount that decides whether Delete is even allowed. See src/lib/departments-admin.ts. */
export interface DepartmentAdminRowDTO {
  id: string;
  name: string;
  employeeCount: number;
  createdAt: string;
}

/** Shared by any admin form that assigns something to a department or an employee (document
 *  uploads, announcement audiences) — see src/lib/roster.ts. */
export interface AssignmentOptionsDTO {
  departments: DepartmentDTO[];
  employees: { id: string; name: string }[];
}

export type OnboardingItemStatus = "NOT_STARTED" | "COMPLETED";

export interface OnboardingItemDTO {
  id: string;
  label: string;
  status: OnboardingItemStatus;
  dueDate: string | null;
  completedAt: string | null;
  sortOrder: number;
}

export interface EmployeeOnboardingDTO {
  id: string;
  startedAt: string;
  completedAt: string | null;
  items: OnboardingItemDTO[];
}

/** Admin's roster view — one row per active employee, whether or not they have a checklist
 *  started yet. */
export interface OnboardingAdminSummaryDTO {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  onboardingId: string | null;
  totalItems: number;
  completedItems: number;
  completedAt: string | null;
}

/** One row in the company directory. Deliberately narrow — see src/lib/directory.ts for why
 *  this list of fields is the entire contract: nothing else is ever selected from Employee for
 *  this feature, so there's nothing sensitive to accidentally widen later. */
export interface DirectoryEntryDTO {
  id: string;
  name: string;
  jobTitle: string;
  department: string | null;
  role: Role;
  email: string;
  workPhone: string | null;
}

export type AnnouncementAudienceType = "EVERYONE" | "DEPARTMENTS" | "EMPLOYEES";

/** What every employee sees on the Announcements page — already filtered by publish/expiration
 *  window and audience match, so there's nothing here to decide client-side. */
export interface AnnouncementDTO {
  id: string;
  title: string;
  message: string;
  authorName: string;
  publishDate: string;
  expirationDate: string | null;
  createdAt: string;
}

/** Admin management view — includes drafts/future/expired posts and who they targeted, which a
 *  regular employee should never see about a post that isn't (yet, or anymore) theirs. */
export interface AnnouncementAdminDTO {
  id: string;
  title: string;
  message: string;
  authorName: string;
  publishDate: string;
  expirationDate: string | null;
  createdAt: string;
  audienceType: AnnouncementAudienceType;
  audienceLabel: string;
  isActive: boolean;
}

/** One row of the payroll hours export — everything TTC's payroll company needs to run pay
 *  for one employee in the chosen period, and nothing more: no rate, no dollar amount, no tax
 *  withholding. See src/lib/payroll.ts for exactly what counts toward each column. */
export interface PayrollHoursRowDTO {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  regularHours: number;
  vacationHours: number;
  sickHours: number;
  personalHours: number;
  otherLeaveHours: number;
  totalHours: number;
}

export interface PayrollHoursReportDTO {
  startDate: string; // ISO date, e.g. "2026-08-01"
  endDate: string;
  rows: PayrollHoursRowDTO[];
  /** Time entries that overlap the period but aren't Approved yet — their hours are excluded
   *  from every row above, so a nonzero count here means the export is likely incomplete. */
  unapprovedEntryCount: number;
}
