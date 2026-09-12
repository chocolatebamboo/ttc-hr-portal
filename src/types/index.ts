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

/** Phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): a CONFIRMED shift,
 *  deliberately its own record — see Shift in prisma/schema.prisma for the full "why this isn't
 *  just AvailabilityStatus.APPROVED" reasoning. CHANGE_REQUESTED/CANCELLATION_REQUESTED exist in
 *  the enum from this migration on, but nothing in phase 1's UI produces them yet — that's
 *  phase 2 (Request Shift Change / Request Cancellation). MISSED is never written directly; it's
 *  one of the possible results of deriveShiftDisplayStatus (src/lib/shifts.ts) layered on top of
 *  whatever the stored `status` actually is. */
export type ShiftStatus =
  | "UPCOMING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CHANGE_REQUESTED"
  | "CANCELLATION_REQUESTED"
  | "CANCELLED"
  | "REASSIGNED"
  | "MISSED";

/** One confirmed shift — src/lib/shifts.ts's toDTO(). `status` is the raw, STORED workflow
 *  status (what a supervisor/admin actually decided: still on, cancelled, reassigned away, or —
 *  starting phase 2 — a pending change/cancellation request). `displayStatus` is
 *  deriveShiftDisplayStatus's read-time computed value layered on top, which is what every UI
 *  should actually show: for an UPCOMING shift it resolves to Upcoming/In Progress/Completed/
 *  Missed depending on today's date and the current time against date/startTime/endTime; for
 *  every other stored status (CANCELLED, REASSIGNED, a phase-2 *_REQUESTED state) displayStatus
 *  is just the stored status unchanged, since those are real decisions, not something to
 *  re-derive from the clock. */
export interface ShiftDTO {
  id: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  status: ShiftStatus;
  displayStatus: ShiftStatus;
  note: string | null;
  sourceAvailabilitySubmissionId: string | null;
  changeReason: string | null;
  requestedDate: string | null;
  requestedStartTime: string | null;
  requestedEndTime: string | null;
  cancelReason: string | null;
  reassignedFromShiftId: string | null;
  createdAt: string;
}

/** Same shape as ShiftDTO plus who it belongs to and who created it — for the supervisor/HR-wide
 *  Team Schedule view (src/app/(portal)/admin/schedule). departmentName mirrors
 *  EmployeeAdminRowDTO's own convention so the Team Schedule filters can reuse the same
 *  department dropdown the Employees admin page already builds. */
export interface AdminShiftDTO extends ShiftDTO {
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  createdById: string;
  createdByName: string;
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

/** What a DM references, once one is attached — see DirectMessage's doc comment in
 *  prisma/schema.prisma. `label` is resolved server-side (src/lib/direct-messages.ts) so the
 *  UI never has to re-fetch the referenced record just to render the card. */
export type DirectMessageRefType = "AVAILABILITY_DATE" | "PTO_REQUEST" | "DATE_TASK";

export interface DirectMessageRefDTO {
  type: DirectMessageRefType;
  id: string;
  date: string | null;
  label: string;
}

/**
 * One message in a peer-to-peer conversation — CB, Sept 2026: "instead of notes, I want it to
 * be messages... I should be able to look up members and send them individual messages." Unlike
 * TeamNoteDTO (always about one employee's own HR-facing thread), a DirectMessage is between
 * any two people; `senderId`/`recipientId` are just who sent it, not whose "thread" it is.
 */
export interface DirectMessageDTO {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  createdAt: string; // ISO
  ref: DirectMessageRefDTO | null;
}

/** One row per DM conversation, most-recent-activity-first — same total/fromOthers shape as
 *  TeamNoteTopicCountDTO above, folded down from the message rows the same way
 *  aggregateTopicCounts does, so the unified My Messages inbox can sort/badge every kind of
 *  conversation identically. `employeeId`/`employeeName` here is always the OTHER person, never
 *  the viewer. */
export interface DirectConversationSummaryDTO {
  employeeId: string;
  employeeName: string;
  lastMessage: string;
  lastMessageAt: string; // ISO
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
