// Shared types. Kept close to the Prisma enums so the UI and API agree on vocabulary.

export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "SUPERVISOR" | "EMPLOYEE";

export type EmploymentStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE" | "FORMER_EMPLOYEE";

export type TimeEntryStatus =
  | "IN_PROGRESS"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "RETURNED"
  | "MISSING_ENTRY";

/** The one button on the time clock card, derived from whether today has an open session
 *  (a TimeSession with no clockOut yet). Clocking out no longer ends the day for good —
 *  CLOCKED_OUT just means "no open session right now," and Clock In is offered again from
 *  there, same as BEFORE_WORK. */
export type TimeClockState = "BEFORE_WORK" | "CLOCKED_IN" | "CLOCKED_OUT";

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
  avatarUrl: string | null;
  /** Which Quick Actions tiles this person has chosen for their own dashboard — see
   *  src/lib/quick-actions.ts. Empty means "never customized," not "chose none." */
  quickActionKeys: string[];
}

/** One clock-in/clock-out pair. clockOut is null exactly while this is the day's currently
 *  open session — see TimeSession in schema.prisma. */
export interface TimeSessionDTO {
  id: string;
  clockIn: string; // ISO datetime
  clockOut: string | null;
}

export interface TimeEntryDTO {
  id: string;
  workDate: string; // ISO date, e.g. "2026-08-28"
  /** Every clock-in/clock-out pair logged this day, oldest first. Any number of these,
   *  including zero (a day that exists only because it's being displayed, not because
   *  anything was clocked). */
  sessions: TimeSessionDTO[];
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
  avatarUrl: string | null;
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
  /** True until this person has actually confirmed their Supabase invite (set a password, or
   *  signed in with Google using the invited email) at least once — see resendInvite in
   *  employees-admin.ts. Drives the Employees page's "Invite pending" badge and Resend Invite
   *  button. */
  pendingInvite: boolean;
  /** When the most recent invite email went out — the original invite, or the latest Resend
   *  Invite click, whichever was last (Supabase Auth updates the same timestamp for both). Null
   *  only if the lookup against Supabase Auth failed (see getInviteStatus). CB: "let us know
   *  when was the last time we sent an invite." */
  inviteSentAt: string | null;
  /** When this person actually confirmed their account (set a password, or signed in with
   *  Google using the invited email). Null while pendingInvite is true. */
  inviteAcceptedAt: string | null;
}

/** My Profile (src/app/(portal)/profile) — an employee's own view of their record. Deliberately
 *  a separate shape from EmployeeAdminRowDTO above rather than reusing it: fields like
 *  deactivatedAt/pendingInvite are meaningless from your own view (you couldn't be looking at
 *  this page if either were true), and department/supervisor come through as plain ids-dropped
 *  display strings here since My Profile never lets you change either. */
export interface MyProfileDTO {
  id: string;
  avatarUrl: string | null;
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
  departmentName: string | null;
  supervisorName: string | null;
  hireDate: string;
  /** Employees who report to YOU (Employee.supervisorId = your id) — empty for anyone who
   *  doesn't supervise others. Sidebar-only, read-only; My Profile has no path to reassign a
   *  report's supervisor (that's the Employees admin page). */
  directReports: { id: string; name: string; jobTitle: string }[];
}

/** The fields My Profile actually lets you change — see enforce_employee_self_update() in
 *  prisma/rls.sql for the database-layer enforcement of this exact same field list. */
export interface UpdateMyProfileInput {
  preferredName?: string;
  workPhone?: string;
  personalPhone?: string;
  personalEmail?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
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

/** GET /api/admin/pto's response — a pending queue for HR to act on, and everything already
 *  decided (Approved or Denied), most recent first. Mirrors AdminAvailabilityDTO's own
 *  pending/decided split (Sept 2026 admin card redesign) so both admin views share one shape
 *  — Approved requests still double as "who's already cleared to be out," the same purpose
 *  the old `upcoming` field served, just no longer limited to future dates only: a reviewer
 *  can now Undo a recent Denied decision too, which needs it visible here to act on. */
export interface AdminPtoSummaryDTO {
  pending: AdminPtoRequestDTO[];
  decided: AdminPtoRequestDTO[];
}

export type AvailabilityStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";

/** One specific calendar date a team member marked themselves available, with a start/end
 *  time for that day — tapped directly on the Availability calendar, same "HH:MM" 24-hour
 *  convention PTO/timesheet fields already use. Not a recurring weekday pattern: every entry
 *  is a real date, and a single submission can bundle several (not necessarily consecutive)
 *  dates at once. */
export interface AvailabilitySlot {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM", 24-hour
  endTime: string; // "HH:MM", 24-hour, after startTime
}

/** One submitted-availability record (see AvailabilitySubmission in prisma/schema.prisma) —
 *  a team member can have many of these over time, same as PtoRequestDTO; approving or
 *  denying one never overwrites another, so the full list is a real history. */
export interface AvailabilityDTO {
  id: string;
  slots: AvailabilitySlot[];
  note: string | null;
  status: AvailabilityStatus;
  submittedAt: string;
  reviewComment: string | null;
  reviewedAt: string | null;
}

/** Same shape as AvailabilityDTO plus who it belongs to — for the supervisor/HR-wide
 *  availability views (TeamAvailabilitySection, AvailabilityAdminView). */
export interface AdminAvailabilityDTO extends AvailabilityDTO {
  employeeId: string;
  employeeName: string;
}

/** One message in a team member's notes/messaging thread (src/lib/team-notes.ts) — see
 *  TeamNote in prisma/schema.prisma for the full "why one thread per person" reasoning.
 *  attachmentName is shown to the client; the underlying storage key never is — downloading
 *  goes through /api/team-notes/[employeeId]/[noteId]/download, which re-checks access and
 *  mints a short-lived signed URL rather than exposing the key itself. */
export type TeamNoteTopicType = "AVAILABILITY_DATE" | "PTO_REQUEST";

export interface TeamNoteDTO {
  id: string;
  employeeId: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  createdAt: string; // ISO
  /** All three null = the general thread (src/app/(portal)/team/[employeeId], /notes) —
   *  unchanged from before. See TeamNote's doc comment in prisma/schema.prisma for what each
   *  topicType pairs topicId/topicDate with. */
  topicType: TeamNoteTopicType | null;
  topicId: string | null;
  topicDate: string | null;
}

/**
 * How many messages exist for one specific date/request conversation — CB, Sept 2026: "I send
 * it to Sean, I don't see where Sean could see those messages... it needs to kinda read
 * cleanly," so both sides need a visible signal for which chip/date/request actually has a
 * conversation on it, not just the ability to open one blind. `total` badges the chip itself
 * (src/components/TeamAvailabilityCards.tsx, TeamPtoCards.tsx, AvailabilityCalendar.tsx,
 * TimesheetView.tsx) so a conversation is discoverable at a glance. `fromOthers` is the count
 * authored by anyone other than the viewer — used for the home-page notification
 * (src/app/(portal)/dashboard/page.tsx) as a "someone said something to you" signal. Neither
 * one is true read/unread tracking (nothing records when a viewer last opened a thread) — a
 * count that's already been read stays counted until the conversation moves again.
 */
export interface TeamNoteTopicCountDTO {
  employeeId: string;
  // Added for the Messages inbox (src/app/(portal)/messages) — CB, Sept 2026: "an icon on
  // the home dashboard... a messages portal similar to where we could see all the different
  // messages for its respective day." Existing chip-badge callers (TeamAvailabilityCards,
  // TeamPtoCards, AvailabilityCalendar, TimesheetView) already know whose row they're
  // rendering and simply ignore this field.
  employeeName: string;
  topicType: TeamNoteTopicType;
  topicId: string;
  topicDate: string | null;
  total: number;
  fromOthers: number;
}

/**
 * A task an admin/supervisor pushes for one specific calendar date — CB, Sept 2026: "I like
 * how we have a texting feature but I feel like we should be also able to push different
 * tasks within that specific day... on the receiving end, they would see it on their main
 * dashboard." Two-way, not a plain checklist: PENDING (assigned) → COMPLETED (the employee
 * marked their part done) → APPROVED (an admin/supervisor confirmed it) — same submit/review
 * shape availability and PTO already use.
 */
export type DateTaskStatus = "PENDING" | "COMPLETED" | "APPROVED";

export interface DateTaskDTO {
  id: string;
  employeeId: string;
  employeeName: string;
  createdById: string;
  createdByName: string;
  taskDate: string; // "YYYY-MM-DD"
  description: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  status: DateTaskStatus;
  completedAt: string | null; // ISO
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null; // ISO
  createdAt: string; // ISO
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
  | "NDA_AGREEMENT"
  | "CODE_OF_CONDUCT"
  | "MEDIA_RELEASE"
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

// NOT_STARTED covers both "locked" and "available" — see OnboardingItemDTO.locked, computed
// separately from this status by src/lib/onboarding.ts.
export type OnboardingItemStatus = "NOT_STARTED" | "AWAITING_APPROVAL" | "RETURNED" | "COMPLETED";
export type OnboardingItemType = "TASK" | "DOCUMENT" | "TRAINING" | "MEETING" | "CERTIFICATION";

export interface OnboardingItemDTO {
  id: string;
  label: string;
  description: string | null;
  itemType: OnboardingItemType;
  /** TASK completes directly on check; DOCUMENT/TRAINING/MEETING route through
   *  AWAITING_APPROVAL first. Derived from itemType, sent precomputed so the UI never has to
   *  duplicate that mapping. */
  requiresApproval: boolean;
  status: OnboardingItemStatus;
  /** True when an earlier item (by sortOrder) isn't COMPLETED yet — this item isn't actionable
   *  regardless of its own `status`. Computed at read time, never stored. */
  locked: boolean;
  dueDate: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  returnReason: string | null;
  documentId: string | null;
  documentTitle: string | null;
  sortOrder: number;
}

export interface EmployeeOnboardingDTO {
  id: string;
  startedAt: string;
  completedAt: string | null;
  /** The one item the employee should focus on right now — the first item, in sortOrder,
   *  that isn't COMPLETED. Null once everything is done. */
  currentItemId: string | null;
  items: OnboardingItemDTO[];
}

/** One glance-able reason label for the admin/supervisor roster — see OnboardingAdminSummaryDTO.
 *  Priority order (first match wins, computed in listOnboardingForManager): ACTION_NEEDED
 *  (something the reviewer must act on) beats UPCOMING (a 30/60/90-day checkpoint due within the
 *  next week) beats COMPLETED (checklist finished, nothing due soon) beats WAITING_ON_EMPLOYEE
 *  (checklist started, ball's in the employee's court) beats NOT_STARTED (no checklist yet). */
export type OnboardingAdminStatus =
  | "ACTION_NEEDED"
  | "UPCOMING"
  | "WAITING_ON_EMPLOYEE"
  | "NOT_STARTED"
  | "COMPLETED";

/** Admin/supervisor roster view — one row per employee the caller may manage (every active
 *  employee for an admin, direct reports only for a supervisor), whether or not their
 *  checklist has been started yet. */
export interface OnboardingAdminSummaryDTO {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  onboardingId: string | null;
  totalItems: number;
  completedItems: number;
  /** Items sitting in AWAITING_APPROVAL right now — surfaced separately from totalItems/
   *  completedItems so "needs your attention" is a glance, not a click into every row. */
  awaitingApprovalCount: number;
  completedAt: string | null;
  /** Purely derived from the fields above (see listOnboardingForManager) — not stored. */
  status: OnboardingAdminStatus;
}

export type OnboardingCheckpointStatus = "PENDING" | "COMPLETED";

/** One 30/60/90-day onboarding follow-up — see OnboardingCheckpoint in the schema. Admin/
 *  supervisor-only, like OnboardingReadinessItemDTO; not shown on the employee's own onboarding
 *  view. trainingMilestones/developmentGoals are both optional freeform fields, filled in only
 *  where applicable — this is a lightweight follow-up, not a performance review form. */
export interface OnboardingCheckpointDTO {
  id: string;
  milestone: string;
  dueDate: string;
  status: OnboardingCheckpointStatus;
  notes: string | null;
  followUpNeeded: boolean;
  trainingMilestones: string | null;
  developmentGoals: string | null;
  completedAt: string | null;
}

/** A reusable starting checklist HR builds once per role and picks from when starting a new
 *  hire's checklist — see src/lib/onboarding-templates.ts. Applying one just copies its items
 *  into a fresh checklist; the template is never referenced again afterward. */
export interface OnboardingTemplateSummaryDTO {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

export interface OnboardingTemplateItemDTO {
  id: string;
  label: string;
  description: string | null;
  itemType: OnboardingItemType;
  sortOrder: number;
  documentId: string | null;
  documentTitle: string | null;
  /** Due date, once applied, = the new checklist's start date + this many days. Null = no
   *  deadline for this step. */
  dueOffsetDays: number | null;
}

/** One internal readiness task (background check, TTC email created, equipment issued, etc.) —
 *  see OnboardingReadinessItem in the schema and src/lib/onboarding-readiness.ts. Admin/
 *  supervisor-only; never returned to, or fetched by, an employee's own onboarding view. */
export interface OnboardingReadinessItemDTO {
  id: string;
  label: string;
  completed: boolean;
  completedAt: string | null;
  sortOrder: number;
}

export interface OnboardingTemplateDTO {
  id: string;
  name: string;
  description: string | null;
  items: OnboardingTemplateItemDTO[];
}

// ---------------------------------------------------------------------------
// Certification (Aug 2026 document gap analysis, item 5) — see src/lib/certification.ts
// ---------------------------------------------------------------------------

export type CertificationQuestionType =
  | "MULTIPLE_CHOICE"
  | "FILL_IN_BLANK"
  | "CHECKBOX_ALL"
  | "LIST_MATCH"
  | "SHORT_ANSWER";

export type CertificationAttemptStatus = "SUBMITTED" | "PASSED" | "FAILED";

export type CertificationReviewOutcome = "MEETS" | "DOES_NOT_MEET";

export interface CertificationOptionDTO {
  key: string;
  label: string;
}

/** What an employee sees while taking the test, or reviewing their own past answers — NEVER
 *  includes the answer key (correctOptionKeys/acceptedAnswers) regardless of who's viewing; see
 *  getCertificationQuestionsForTaking in src/lib/certification.ts. rubric is included since it's
 *  reviewer guidance, not the key itself — low sensitivity either way. */
export interface CertificationQuestionDTO {
  id: string;
  number: number;
  section: string;
  sortOrder: number;
  prompt: string;
  type: CertificationQuestionType;
  points: number;
  options: CertificationOptionDTO[] | null;
  /** LIST_MATCH only — how many entries the employee should fill in. */
  requiredMatchCount: number | null;
}

/** Admin-only — the question bank editor's view, with the answer key included. See
 *  listCertificationQuestionsForAdmin in src/lib/certification.ts. */
export interface CertificationQuestionAdminDTO extends CertificationQuestionDTO {
  correctOptionKeys: string[];
  acceptedAnswers: string[];
  rubric: string | null;
  active: boolean;
}

/** One graded (or awaiting-grading) answer within an attempt — shared by the employee's own
 *  results view and the HR/supervisor review panel; see listCertificationAttempts. Never
 *  includes the question's own answer key, only this response's outcome. */
export interface CertificationResponseDTO {
  id: string;
  questionId: string;
  number: number;
  section: string;
  prompt: string;
  type: CertificationQuestionType;
  options: CertificationOptionDTO[] | null;
  rubric: string | null;
  answerText: string | null;
  selectedKeys: string[];
  isAutoScored: boolean;
  isCorrect: boolean | null;
  pointsEarned: number | null;
  pointsPossible: number;
  needsManualReview: boolean;
  reviewOutcome: CertificationReviewOutcome | null;
  reviewComment: string | null;
  reviewedAt: string | null;
}

export interface CertificationAttemptDTO {
  id: string;
  status: CertificationAttemptStatus;
  submittedAt: string;
  objectivePointsEarned: number;
  objectivePointsPossible: number;
  totalPointsPossible: number;
  manualPointsEarned: number | null;
  /** Null until every needsManualReview response has been graded. */
  finalScorePercent: number | null;
  passThresholdPercent: number;
  reviewedAt: string | null;
  responses: CertificationResponseDTO[];
}

/** One answer the employee is submitting for a single question — see submitCertificationAttempt.
 *  Which of answerText/selectedKeys is used depends on the question's type (MULTIPLE_CHOICE/
 *  CHECKBOX_ALL use selectedKeys; FILL_IN_BLANK/SHORT_ANSWER use answerText; LIST_MATCH reuses
 *  selectedKeys to hold each free-text list entry — see CertificationResponse's doc comment in
 *  schema.prisma). */
export interface CertificationAnswerInput {
  questionId: string;
  answerText?: string;
  selectedKeys?: string[];
}

/** Live "does anything need this person's attention right now" summary — see
 *  getOnboardingAttention in src/lib/onboarding.ts. Not a notification feed: there's nothing to
 *  mark read, it's always just the current truth, recomputed on every page load. */
export interface OnboardingAttentionDTO {
  needsAttention: boolean;
  label: string | null;
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
