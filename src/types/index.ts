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
  /** Phase 3 (client spec, Sept 2026): which scheduled Shift this clock-in matched at the
   *  moment it happened, if any — null when there was nothing scheduled that day at all. Set
   *  once, at clock-in, and never revised afterward — see TimeSession.shiftId's own doc
   *  comment in prisma/schema.prisma. */
  shiftId: string | null;
  /** True when this clock-in fell outside CLOCK_IN_WINDOW_MINUTES of a scheduled shift's start
   *  time, or there was no scheduled shift to match at all. */
  isException: boolean;
  /** The team member's own stated reason for an exception clock-in — required whenever
   *  isException is true, null otherwise. */
  exceptionReason: string | null;
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

// REMOVED (Correction brief #10, Sept 2026) is a real status in the database — see
// AvailabilityStatus's own doc comment in prisma/schema.prisma — but every list this type flows
// through (listMyAvailability/listAvailabilityForEmployee/listAdminAvailability) filters those
// rows out server-side before they're ever turned into a DTO. It's included in this union so the
// two exhaustive status maps that touch it (AvailabilityStatusPill's STYLE/LABEL,
// AvailabilityCalendar's STATUS_CHIP) stay real TypeScript checks rather than needing an "as any"
// escape hatch — same reasoning those files already document for why CANCELLED is listed there
// even though some of their own call sites filter it out too.
export type AvailabilityStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED" | "ADJUSTMENT_REQUESTED" | "REMOVED";

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

/** One date's own individual decision within a submission — see
 *  AvailabilitySubmission.dateDecisions's doc comment in prisma/schema.prisma for the full
 *  either/or relationship with the existing whole-submission bulk actions. `comment` is that
 *  date's own reviewer note, separate from the submission-level `reviewComment` a bulk
 *  decide/deny still uses. */
export interface AvailabilityDateDecision {
  date: string; // "YYYY-MM-DD" — matches one entry in this submission's `slots`
  status: "PENDING" | "APPROVED" | "DENIED";
  decidedAt: string | null;
  decidedById: string | null;
  /** CB, Sept 2026: "we need to also know who approved the request" — resolved server-side
   *  (resolveReviewerNames in src/lib/availability.ts) from decidedById, same "pre-resolve so the
   *  client never looks anyone up itself" convention DirectMessageRefDTO's own `label` uses. Null
   *  exactly when decidedById is null (still PENDING, or reopened via Undo). */
  decidedByName: string | null;
  comment: string | null;
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
  /** CB, Sept 2026: "we need to also know who approved the request" — the whole-submission
   *  reviewer's name (bulk decide, or whichever per-date decide most recently completed every
   *  date). Null until reviewedAt is set, same as reviewComment. See AvailabilityDateDecision's
   *  own decidedByName for the per-date counterpart, which is the one that matters while a
   *  multi-date request is still being finished one date at a time. */
  reviewedByName: string | null;
  /** Set only alongside status ADJUSTMENT_REQUESTED — the reviewer's counter-proposed times for
   *  each date in `slots` above (client spec, phase 2: "Adjust the proposed time and send it to
   *  the team member for confirmation"). See AvailabilitySubmission.adjustedSlots's own doc
   *  comment in prisma/schema.prisma for why this is kept even after the employee responds. */
  adjustedSlots: AvailabilitySlot[] | null;
  /** One entry per date in `slots`, always present and always the same length/dates as `slots` —
   *  see decideAvailabilityDate in src/lib/availability.ts for how each entry moves off PENDING,
   *  and this submission's own doc comment above for the either/or with bulk decide/deny. */
  dateDecisions: AvailabilityDateDecision[];
  /** Display-only hint, set only by listMyAvailability (src/lib/availability.ts): true when
   *  status is APPROVED but at least one approved date on this submission doesn't have a
   *  confirmed Shift yet. CB, Sept 2026, two-step approval workflow: approving a date pings the
   *  admin who pushes tasks, and it's THAT push that actually confirms the shift — until then
   *  the team member's own card keeps reading as "still in progress," not "done," even though
   *  the underlying status already flipped to Approved. Never set on the admin-facing DTOs. */
  awaitingTask?: boolean;
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
  /** When the still-active (or most recently active) change/cancellation request was submitted
   *  — see Shift.requestedAt's own doc comment in prisma/schema.prisma. */
  requestedAt: string | null;
  /** When a supervisor/admin last resolved a request (or acted on the shift directly) — paired
   *  with reviewComment below. Null until the first resolution. */
  reviewedAt: string | null;
  /** The reviewer's own note back to the team member — set on decline (why), and optionally on
   *  approval too. Distinct from changeReason, which is always the team member's own reason. */
  reviewComment: string | null;
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
  /** Who resolved the most recent request (or acted on the shift directly) — null to match
   *  reviewedAt. */
  reviewedByName: string | null;
}

/** One message in a team member's notes/messaging thread (src/lib/team-notes.ts) — see
 *  TeamNote in prisma/schema.prisma for the full "why one thread per person" reasoning.
 *  attachmentName is shown to the client; the underlying storage key never is — downloading
 *  goes through /api/team-notes/[employeeId]/[noteId]/download, which re-checks access and
 *  mints a short-lived signed URL rather than exposing the key itself. */
// SHIFT (Phase 3, client spec, Sept 2026): "tasks/messages re-pointed onto shifts" — topicId is
// a Shift id, topicDate stays null (same shape as PTO_REQUEST) since a Shift is already exactly
// one date. Additive, not a replacement: AVAILABILITY_DATE keeps working for conversations about
// a submission that hasn't (or hasn't yet) become a confirmed shift.
export type TeamNoteTopicType = "AVAILABILITY_DATE" | "PTO_REQUEST" | "SHIFT";

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
 * authored by anyone other than the viewer, read or not — kept for those same existing chip
 * callers, unchanged.
 *
 * `unread` (Correction brief #1, Sept 2026: "genuinely unread messages") IS real read/unread
 * tracking — messages from others posted after the viewer's own MessageReadState.lastReadAt for
 * this specific topic (src/lib/message-read-state.ts), reset to now every time listTeamNotes
 * fetches this exact thread. This is what the dashboard banner/badge and the My Messages inbox
 * badge use; `fromOthers` above is left alone for the older chip callers that were never asked
 * to become unread-aware.
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
  unread: number;
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

/** CB, Sept 2026: "I should have the options to include emojis to react to other people's
 *  replies" — confirmed scope: a fixed quick-react set rather than a full emoji picker. Order
 *  here is also the display order of a message's reaction pills (see summarizeReactions in
 *  src/lib/direct-messages.ts), so it's deliberately NOT alphabetical — roughly "positive → ...
 *  → negative", the same rough shape iMessage's own tapback set uses. */
export const QUICK_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type QuickReactionEmoji = (typeof QUICK_REACTION_EMOJIS)[number];

/** One emoji's tally on one message — CB, Sept 2026: "include the options to include emojis to
 *  react to other people's replies." `reactedByMe` is precomputed server-side (same reasoning as
 *  every other viewer-relative flag in this file, e.g. DateTaskDTO's own status fields) so the
 *  client never has to cross-reference its own employeeId against a raw list of reactor ids. */
export interface DirectMessageReactionSummaryDTO {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

/** The small quoted-preview card a reply renders above itself — CB, Sept 2026: "I should be able
 *  to reply to a specific message within the message thread." Deliberately thin (no full
 *  DirectMessageDTO, no reactions-on-the-reply-target) since this is only ever rendered as a
 *  glance-back preview, same spirit as DirectMessageRefDTO's own pre-resolved `label`. */
export interface DirectMessageReplyPreviewDTO {
  id: string;
  senderName: string;
  body: string;
  hasAttachment: boolean;
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
  /** The message this one is quoting, if any — CB's "reply to a specific message" (Sept 2026). */
  replyTo: DirectMessageReplyPreviewDTO | null;
  /** Quick-reaction tallies on this message, one entry per emoji actually used — never all six,
   *  never zero-count placeholders. Empty array, not null, when nobody's reacted. */
  reactions: DirectMessageReactionSummaryDTO[];
}

/** The GET /api/messages/dm/[employeeId] response shape — CB, Sept 2026: "I should be able to
 *  see also when they read the message on their side." `otherLastReadAt` is the OTHER
 *  participant's own lastReadAt for this one thread (null if they've never opened it), enabled by
 *  message_read_state_select_dm_peer's narrow RLS widening (see prisma/rls.sql) — never any
 *  other thread's read state, and never the viewer's own (that's implicit in having just loaded
 *  the thread). The client uses it to show a "Seen" mark under the last message the viewer sent
 *  that's at or before that timestamp, same idea as iMessage's own read receipt. */
export interface DirectMessageThreadDTO {
  messages: DirectMessageDTO[];
  otherLastReadAt: string | null; // ISO
}

/** One row per DM conversation, most-recent-activity-first — same total/fromOthers/unread shape
 *  as TeamNoteTopicCountDTO above, folded down from the message rows the same way
 *  aggregateTopicCounts does, so the unified My Messages inbox can sort/badge every kind of
 *  conversation identically. `employeeId`/`employeeName` here is always the OTHER person, never
 *  the viewer. `unread` is real read/unread tracking (Correction brief #1) — see
 *  TeamNoteTopicCountDTO's own comment above for what distinguishes it from `fromOthers`. */
export interface DirectConversationSummaryDTO {
  employeeId: string;
  employeeName: string;
  lastMessage: string;
  lastMessageAt: string; // ISO
  total: number;
  fromOthers: number;
  unread: number;
}

/**
 * A task an admin/supervisor assigns for one specific calendar date — see DateTask's own doc
 * comment in prisma/schema.prisma for the full history. Correction brief (Sept 2026,
 * "Correction & Refinement Brief" #2) redesigned this from a 3-state PENDING/COMPLETED/APPROVED
 * checkbox into a real per-task workflow: "Assigned → In Progress → Submitted/Completed →
 * Awaiting Review → Approved," with IN_PROGRESS as a purely self-reported "I've started this"
 * signal (nothing gates on it — an employee may submit directly from ASSIGNED too) and
 * "Submitted"/"Awaiting Review" collapsed into one AWAITING_REVIEW status, matching how every
 * other submit-then-decide workflow in this app (AvailabilitySubmission, OnboardingItem) already
 * uses one status for that moment. RETURNED replaces the old bare "send back to PENDING" —
 * the brief specifically asks for "Return/Reopen with a note" (see DateTaskDTO.returnNote).
 */
export type DateTaskStatus = "ASSIGNED" | "IN_PROGRESS" | "AWAITING_REVIEW" | "APPROVED" | "RETURNED";

/** QA pass (Sept 2026): a simple priority flag set at assignment time — see DateTaskPriority's
 *  own doc comment in prisma/schema.prisma. */
export type DateTaskPriority = "NORMAL" | "URGENT";

export interface DateTaskDTO {
  id: string;
  employeeId: string; // the assignee
  employeeName: string;
  createdById: string;
  createdByName: string;
  taskDate: string; // "YYYY-MM-DD"
  /** The short list-row label — correction brief #2: "task title" and "instructions/details" as
   *  two distinct fields, where before there was only one combined `description`. */
  title: string;
  /** The longer instructions/details, shown once a task is expanded. */
  description: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  status: DateTaskStatus;
  priority: DateTaskPriority;
  startedAt: string | null; // ISO — set on ASSIGNED/RETURNED -> IN_PROGRESS
  submittedAt: string | null; // ISO — set on -> AWAITING_REVIEW (was `completedAt`)
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null; // ISO
  returnedById: string | null;
  returnedByName: string | null;
  returnedAt: string | null; // ISO
  /** The reviewer's note explaining why — required by returnDateTask, cleared implicitly by the
   *  next submit (see DateTask.returnNote's own comment in prisma/schema.prisma). */
  returnNote: string | null;
  /** Total comments on this task — lets a collapsed row show "3 comments" without a second
   *  fetch; the comments themselves are fetched separately (see DateTaskCommentDTO below) only
   *  once a task is actually expanded. */
  commentCount: number;
  createdAt: string; // ISO
}

/**
 * One comment/update on a single task — correction brief #2: "Opening/expanding a task should
 * reveal its... comments/updates. This prevents users from having a generic conversation where
 * it becomes unclear which task is being discussed." Replaces the standalone per-date TeamNote
 * "Conversation" section that used to sit next to the task list on TeamAvailabilityCards,
 * AvailabilityCalendar, TeamScheduleView, and ScheduleView — discussion now lives scoped to the
 * one task it's actually about. Same shape as TeamNoteDTO/DirectMessageDTO (attachmentName shown
 * to the client, the underlying key never is — downloading goes through
 * /api/date-tasks/[taskId]/comments/[commentId]/download, which re-checks access and mints a
 * short-lived signed URL rather than exposing the key itself).
 */
export interface DateTaskCommentDTO {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
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
  // Correction brief #4 (Sept 2026) — which library folder this document lives in, null for the
  // library root. Absent from the plain DocumentDTO above: an employee's own "shared with me"
  // list has no concept of folders at all.
  folderId: string | null;
}

/** One folder in the HR/Admin document library (correction brief #4, Sept 2026) — see
 *  DocumentFolder in prisma/schema.prisma. Never shown to a regular employee. */
export interface DocumentFolderDTO {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
}

/** GET /api/documents/manage/folders response — one level of the library at a time: the current
 *  folder (null = root), its ancestor chain for a breadcrumb, its direct subfolders, and the
 *  documents filed directly in it. */
export interface DocumentFolderContentsDTO {
  folder: DocumentFolderDTO | null;
  breadcrumb: DocumentFolderDTO[];
  folders: DocumentFolderDTO[];
  documents: DocumentAdminSummaryDTO[];
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

/** Phase 4 (client spec, Sept 2026): "a real in-app notification feed" — see Notification's own
 *  doc comment in prisma/schema.prisma for the full list and why each one exists. */
export type NotificationType =
  | "SHIFT_CREATED"
  | "SHIFT_CANCELLED"
  | "SHIFT_REASSIGNED"
  | "SHIFT_CHANGE_APPROVED"
  | "SHIFT_REQUEST_DECLINED"
  | "SHIFT_REQUEST_RECEIVED"
  | "AVAILABILITY_APPROVED"
  | "AVAILABILITY_DENIED"
  | "AVAILABILITY_ADJUSTMENT_PROPOSED"
  | "PTO_APPROVED"
  | "PTO_DENIED"
  | "DATE_TASK_ASSIGNED"
  | "DATE_TASK_APPROVED"
  | "DATE_TASK_RETURNED";

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  targetType: string;
  targetId: string;
  read: boolean;
  createdAt: string; // ISO
}

/** One row of Reports > Activity History (client spec, Sept 2026: "Reports and Activity History
 *  views") — admin-only reading of the existing AuditLog table (prisma/schema.prisma), which
 *  every phase from 1 onward has already been writing to. `actorName`/`targetLabel` are resolved
 *  server-side (src/lib/activity.ts) so the UI never has to re-fetch the actor or target record
 *  just to render a readable row. */
export interface ActivityLogEntryDTO {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  /** A short human label for what targetId actually refers to, when it can be resolved (e.g. a
   *  Shift's own employee name + date) — falls back to targetType if the target row is gone or
   *  isn't a type this view knows how to label yet. */
  targetLabel: string;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: string; // ISO
}
