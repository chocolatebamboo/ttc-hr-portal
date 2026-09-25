"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import ShiftStatusPill from "@/components/ShiftStatusPill";
import DateTasksPanel from "@/components/DateTasksPanel";
import SwipeReveal from "@/components/SwipeReveal";
import { ChecklistIcon, CheckCircleIcon, CalendarIcon, TrashIcon, ChatIcon } from "@/components/icons";
import { slotChips, formatReviewedAt, type SlotChip } from "@/lib/availability-format";
import { toneForStatus, YOU_TONE } from "@/lib/status-tone";
import type { AdminAvailabilityDTO, AdminShiftDTO, AvailabilityDateDecision } from "@/types";

type LoadState = "loading" | "ready" | "error";

/** Exported (redesign follow-up, Sept 2026) alongside useTeamAvailabilityQueue and Card below so
 *  TeamAvailabilityRequestsSection's own compact dashboard rows can show the same two-letter
 *  avatar badge as the full card, instead of a slightly different one drifting in from a second
 *  copy of this one-liner. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/** True once every date on a submission has moved off PENDING — mirrors
 *  src/lib/availability.ts's own allDatesDecided, kept as a tiny local copy since this file has
 *  no server-side import boundary to share it across (client component). */
function allDatesDecided(decisions: AvailabilityDateDecision[]): boolean {
  return decisions.length > 0 && decisions.every((d) => d.status !== "PENDING");
}

/** True once any date has been decided individually — see AvailabilitySubmission.dateDecisions'
 *  own doc comment in prisma/schema.prisma for the full either/or reasoning this mirrors: once
 *  true, the whole-submission bulk actions (Approve all / Deny all / Adjust time for everyone)
 *  step aside in favor of finishing the remaining dates one at a time. */
function isInPerDateMode(decisions: AvailabilityDateDecision[]): boolean {
  return decisions.some((d) => d.status !== "PENDING");
}

/**
 * All the fetch/decide/deny/remove/undo state and handlers a card list needs — pulled out of
 * TeamAvailabilityCards itself (redesign follow-up, Sept 2026, CB: "it should be able to expand
 * so we could see and approve from the homepage as well. Basically the same experience that you
 * would have done in the availability tab") so TeamAvailabilityRequestsSection (the dashboard's
 * compact preview widget) can drive the exact same Card component with the exact same behavior,
 * instead of a second, drifting implementation of "what does approving a request actually do."
 * Same "extract the interaction into a hook, export it, let a second caller reuse it" shape
 * useAvailabilityPanel already established in AvailabilityCalendar.tsx.
 *
 * `initialPending` (dashboard widget only): dashboard/page.tsx already fetches this admin's
 * pending queue server-side for the page's very first paint — seeding state from it here means
 * the widget shows real rows immediately instead of a loading skeleton flash while this hook's
 * own client-side `load()` catches up in the background. TeamAvailabilityCards itself (the full
 * /availability page) doesn't have anything to seed from, so it just omits this and starts from
 * the same "loading" state it always has.
 */
function useTeamAvailabilityQueue(opts?: { initialPending?: AdminAvailabilityDTO[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<AdminAvailabilityDTO[]>(opts?.initialPending ?? []);
  const [decided, setDecided] = useState<AdminAvailabilityDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>(opts?.initialPending ? "ready" : "loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyComment, setDenyComment] = useState("");
  const [openDate, setOpenDate] = useState<{ submissionId: string; date: string } | null>(null);
  // Real, server-surfaced errors from a decide/decide-date attempt — same shape as
  // removeError/removeErrorId below, keyed to whichever card most recently failed so a stale
  // error from one card never bleeds onto another. Fixes a real bug: this used to fetch()
  // without ever checking res.ok, so a failed Approve/Deny silently reloaded the same
  // still-Pending data with no visible error at all — CB: "even when I click on the approve,
  // it's not changing the color."
  const [decideError, setDecideError] = useState<string | undefined>();
  const [decideErrorId, setDecideErrorId] = useState<string | null>(null);
  // Phase 1 of the scheduling workflow rebuild (client spec, Sept 2026): whether a given
  // date-chip on an APPROVED card has already been converted into a real confirmed Shift —
  // "Scheduling" is a deliberate second step after "Approve," not something Approve does by
  // itself (see Shift's own doc comment in prisma/schema.prisma). Keyed "submissionId:date".
  const [shiftsByDate, setShiftsByDate] = useState<Map<string, AdminShiftDTO>>(new Map());
  // CB, Sept 2026: "[approve/deny] with no way to close out afterward" — once a card has been
  // decided, swiping it away clears it from view, same SwipeReveal "Clear" pattern Messages
  // uses (CheckCircleIcon). Correction brief #9 (this round): dismissal is now real server state
  // (src/lib/dashboard-dismissals.ts + /api/admin/availability/[id]/dismiss), not client-only —
  // the server's own listAdminAvailability already excludes dismissed rows from `decided`, so
  // this component doesn't track dismissal state itself; a swipe removes the row locally for an
  // instant response, then persists it in the background. A fresh decision (even re-approving
  // the same submission after Undo) always reappears — see decidedDismissalKey's own comment.
  // Only ever applies to Decided cards: a Pending one still needs an actual Approve/Deny, not a
  // way to make it disappear unactioned.

  // Correction brief #10 (Sept 2026): which card (if any) has its "Remove this availability
  // request?" confirmation open — tapping the swipe-revealed Remove button on either a Pending
  // or Decided card sets this rather than removing immediately, same two-step shape Deny already
  // uses (denyingId opens a confirm block; the actual decide only fires from a second, explicit
  // tap) — see this component's own doc comment above for why "swipe, then a second tap, then a
  // typed confirmation" is deliberate here, not accidental extra friction.
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Mirrors LoggedHoursSection.tsx's deleteError/deleteErrorEntryId pair — an error shown inline
  // on the one card it belongs to, not a page-wide banner, and cleared the moment a new attempt
  // (on any card) starts.
  const [removeError, setRemoveError] = useState<string | undefined>();
  const [removeErrorId, setRemoveErrorId] = useState<string | null>(null);
  // Correction brief #11 (Sept 2026): DM total/unread per team member, keyed by employeeId — the
  // chat bubble's own badge, same /api/messages/conversations the unified My Messages inbox uses
  // for its own DM rows. Best-effort like shiftsByDate below: a missing badge isn't worth failing
  // the card list over.
  const [dmCounts, setDmCounts] = useState<Map<string, { total: number; unread: number }>>(new Map());

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/availability");
      if (!res.ok) throw new Error();
      const data: { pending: AdminAvailabilityDTO[]; decided: AdminAvailabilityDTO[] } = await res.json();
      setPending(data.pending);
      setDecided(data.decided);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  // Best-effort, same fire-and-forget convention DashboardNotifications.tsx's dismissBanner
  // uses — the local removal above already gives the admin their instant response; worst case
  // this POST fails silently and the card reappears the next time this list reloads.
  async function dismissDecided(submissionId: string) {
    try {
      await fetch(`/api/admin/availability/${submissionId}/dismiss`, { method: "POST" });
    } catch {
      // ignored — see comment above
    }
  }

  // Correction brief #9's swipe-to-clear on a Decided card — removes the row from view instantly
  // and persists the dismissal in the background. Named for what a caller is doing (clearing a
  // decided card off the list), not for the two things it happens to do underneath — same
  // behavior as the inline onAction this replaces on the original TeamAvailabilityCards render.
  function clearDecided(submissionId: string) {
    setDecided((prev) => prev.filter((x) => x.id !== submissionId));
    dismissDecided(submissionId);
  }

  // Correction brief #10 (Sept 2026): the actual removal, only ever called from the "Remove
  // request" button inside the confirmation block below — never from the swipe action itself.
  // Unlike dismissDecided's fire-and-forget, this is a real, permanent change the admin is
  // waiting on, so it's awaited properly and surfaces a real error inline (via removeError/
  // removeErrorId) rather than swallowing a failure silently.
  async function removeSubmission(submissionId: string) {
    setBusyId(submissionId);
    setRemoveError(undefined);
    setRemoveErrorId(null);
    try {
      const res = await fetch(`/api/availability/${submissionId}/remove`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRemoveError(data.error ?? "Unable to remove this request. Please try again.");
        setRemoveErrorId(submissionId);
        return;
      }
      setRemovingId(null);
      load();
    } catch {
      setRemoveError("Unable to reach the server. Check your connection and try again.");
      setRemoveErrorId(submissionId);
    } finally {
      setBusyId(null);
    }
  }

  function cancelRemove() {
    setRemovingId(null);
    setRemoveError(undefined);
    setRemoveErrorId(null);
  }

  // Best-effort — a chip missing its "already scheduled" badge isn't worth failing the card
  // list over, so a failed fetch here just leaves it empty instead of throwing.
  async function loadShifts() {
    try {
      const res = await fetch("/api/admin/shifts");
      if (!res.ok) return;
      const data: { shifts: AdminShiftDTO[] } = await res.json();
      const map = new Map<string, AdminShiftDTO>();
      for (const s of data.shifts) {
        if (s.sourceAvailabilitySubmissionId && s.status !== "CANCELLED") {
          map.set(`${s.sourceAvailabilitySubmissionId}:${s.date}`, s);
        }
      }
      setShiftsByDate(map);
    } catch {
      // ignored — see comment above
    }
  }

  // Best-effort — same reasoning as loadShifts above, a missing DM badge isn't worth failing the
  // card list over.
  async function loadDmCounts() {
    try {
      const res = await fetch("/api/messages/conversations");
      if (!res.ok) return;
      const data: { conversations: { employeeId: string; total: number; unread: number }[] } = await res.json();
      const map = new Map<string, { total: number; unread: number }>();
      for (const c of data.conversations) map.set(c.employeeId, { total: c.total, unread: c.unread });
      setDmCounts(map);
    } catch {
      // ignored — see comment above
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadShifts();
    loadDmCounts();
  }, []);

  // Correction brief #11 (Sept 2026): navigates to the unified My Messages inbox with this team
  // member's DM conversation pre-opened. `employeeName` only seeds the row's label for a
  // conversation that doesn't exist yet — once real messages exist, the fetched
  // DirectConversationSummaryDTO's own employeeName takes over, same as NewMessagePicker's flow.
  function openChat(employeeId: string, employeeName: string) {
    router.push(`/messages?dm=${employeeId}&name=${encodeURIComponent(employeeName)}`);
  }

  // Phase 5d (CB, Sept 2026): "chat icons on availability requests linked to specific dates" —
  // same navigation as openChat above, but pre-attaches a reference to this one date (see
  // DirectMessageThread's own initialRef prop) so the first message sent from there carries an
  // "Availability · <date>" reference card, same reference-card system a task comment already
  // mirrors into Messages (see addDateTaskComment's own doc comment in src/lib/date-tasks.ts) —
  // just started from the date's own side instead of arriving there from a comment.
  function openChatForDate(employeeId: string, employeeName: string, submissionId: string, date: string) {
    router.push(
      `/messages?dm=${employeeId}&name=${encodeURIComponent(employeeName)}&refType=AVAILABILITY_DATE&refId=${submissionId}&refDate=${date}`
    );
  }

  // Bulk decide — "I have the option to approve everything at one time." Only ever called while
  // nothing on the submission has been decided individually yet (the button row that calls this
  // is itself hidden once isInPerDateMode is true — see Card below), but the server enforces the
  // same rule independently, so this can't silently override a partially-decided request even if
  // the client got out of sync.
  async function decide(submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(submissionId);
    setDecideError(undefined);
    setDecideErrorId(null);
    try {
      const res = await fetch(`/api/availability/${submissionId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecideError(data.error ?? "Unable to save that decision. Please try again.");
        setDecideErrorId(submissionId);
        return;
      }
      setDenyingId(null);
      setDenyComment("");
      load();
    } catch {
      setDecideError("Couldn't reach the server. Check your connection and try again.");
      setDecideErrorId(submissionId);
    } finally {
      setBusyId(null);
    }
  }

  // Per-date decide — "you have to approve each thing, like each date one at a time." Same
  // error-surfacing discipline as bulk decide above.
  async function decideDate(submissionId: string, date: string, decision: "APPROVED" | "DENIED", comment?: string) {
    setBusyId(submissionId);
    setDecideError(undefined);
    setDecideErrorId(null);
    try {
      const res = await fetch(`/api/availability/${submissionId}/decide-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, decision, comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecideError(data.error ?? "Unable to save that decision. Please try again.");
        setDecideErrorId(submissionId);
        return;
      }
      load();
    } catch {
      setDecideError("Couldn't reach the server. Check your connection and try again.");
      setDecideErrorId(submissionId);
    } finally {
      setBusyId(null);
    }
  }

  // CB, Sept 2026: a minus right on each date chip — tucked behind an Edit/Done toggle on the
  // card so it's opt-in, not sitting there by default — for pulling just one date out of a
  // multi-date request without a full Deny or opening the per-date panel. Same error-surfacing
  // discipline as decide/decideDate above.
  async function removeDate(submissionId: string, date: string) {
    setBusyId(submissionId);
    setDecideError(undefined);
    setDecideErrorId(null);
    try {
      const res = await fetch(`/api/admin/availability/${submissionId}/dates/${date}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecideError(data.error ?? "Unable to remove that date. Please try again.");
        setDecideErrorId(submissionId);
        return;
      }
      load();
    } catch {
      setDecideError("Couldn't reach the server. Check your connection and try again.");
      setDecideErrorId(submissionId);
    } finally {
      setBusyId(null);
    }
  }

  async function undo(submissionId: string) {
    setBusyId(submissionId);
    try {
      await fetch(`/api/availability/${submissionId}/undecide`, { method: "POST" });
    } finally {
      setBusyId(null);
      load();
    }
  }

  // CB, Sept 2026: "even if it's approved, I should still be able to make adjustments... it's
  // not just final" — the per-date counterpart to undo() above. Reopens just ONE date's own
  // decision (the rest of a multi-date submission stays exactly as decided), for the case undo()
  // can't reach: a date decided individually while its submission is still sitting in the
  // Pending queue because other dates on it aren't decided yet (see
  // undecideAvailabilityDate's own doc comment in src/lib/availability.ts).
  async function undoDate(submissionId: string, date: string) {
    setBusyId(submissionId);
    setDecideError(undefined);
    setDecideErrorId(null);
    try {
      const res = await fetch(`/api/availability/${submissionId}/undecide-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecideError(data.error ?? "Unable to reopen that date. Please try again.");
        setDecideErrorId(submissionId);
        return;
      }
    } catch {
      setDecideError("Couldn't reach the server. Check your connection and try again.");
      setDecideErrorId(submissionId);
    } finally {
      setBusyId(null);
      load();
    }
  }

  // CB, Sept 2026, replacing the original "propose new date/time, wait for the team member to
  // confirm" flow: "we shouldn't have to wait on the team member... once we set it, then that
  // becomes the new schedule." Per-date, same granularity as decideDate below — sets a new
  // date/time for ONE date and approves it immediately, in one call, no separate accept step.
  // See changeAvailabilityDate's own doc comment in src/lib/availability.ts.
  async function changeDate(
    submissionId: string,
    date: string,
    newDate: string,
    newStartTime: string,
    newEndTime: string,
    comment?: string
  ) {
    setBusyId(submissionId);
    setDecideError(undefined);
    setDecideErrorId(null);
    try {
      const res = await fetch(`/api/availability/${submissionId}/change-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, newDate, newStartTime, newEndTime, comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecideError(data.error ?? "Unable to save that change. Please try again.");
        setDecideErrorId(submissionId);
        return;
      }
    } catch {
      setDecideError("Couldn't reach the server. Check your connection and try again.");
      setDecideErrorId(submissionId);
    } finally {
      setBusyId(null);
      load();
    }
  }

  return {
    pending,
    decided,
    loadState,
    busyId,
    denyingId,
    setDenyingId,
    denyComment,
    setDenyComment,
    openDate,
    setOpenDate,
    decideError,
    decideErrorId,
    shiftsByDate,
    dmCounts,
    removingId,
    setRemovingId,
    removeError,
    removeErrorId,
    cancelRemove,
    clearDecided,
    removeSubmission,
    openChat,
    openChatForDate,
    decide,
    decideDate,
    removeDate,
    undo,
    undoDate,
    changeDate,
  };
}

export type TeamAvailabilityQueue = ReturnType<typeof useTeamAvailabilityQueue>;
export { useTeamAvailabilityQueue };

/** One employee's row(s) within a single section (Pending or Decided) — almost always exactly
 *  one submission (see groupByEmployee below), in which case Card renders it identically to how
 *  a single row always has; only a genuinely merged group (the same employee with more than one
 *  submission in this section) changes anything visible — see Card's own doc comment. */
export type FolderGroup = {
  employeeId: string;
  employeeName: string;
  submissions: AdminAvailabilityDTO[];
};

/**
 * Folder-card grouping (CB, Sept 2026): "I shouldn't see multiple cards with the same name...
 * I want that card to kind of represent almost like a folder for everything... we see everybody
 * at all at one time." Groups every row within ONE section's list (Pending or Decided — confirmed
 * scope: "merge within each section only," never across both) by employeeId, so a team member
 * with several separate submissions in the same section shows up as one card instead of one card
 * per submission. Preserves that list's own existing order by the position of that employee's
 * FIRST row in it (Pending stays oldest-submitted-first, Decided stays most-recently-reviewed-
 * first — see listAdminAvailability's own orderBy in src/lib/availability.ts). A person with
 * only one submission in this section — the normal case — produces a group of exactly one.
 *
 * Exported (round two, Sept 2026) so TeamAvailabilityRequestsSection's dashboard widget can
 * group its own Pending rows the same way — CB: "I'm still seeing a separate card for each
 * schedule [on the homepage widget]. These should be grouped into one card, similar to how they
 * appear on the Availability page." The first pass only reached this file's own render below.
 */
export function groupByEmployee(rows: AdminAvailabilityDTO[]): FolderGroup[] {
  const order: string[] = [];
  const byEmployee = new Map<string, AdminAvailabilityDTO[]>();
  for (const row of rows) {
    if (!byEmployee.has(row.employeeId)) {
      byEmployee.set(row.employeeId, []);
      order.push(row.employeeId);
    }
    byEmployee.get(row.employeeId)!.push(row);
  }
  return order.map((employeeId) => {
    const submissions = byEmployee.get(employeeId)!;
    return { employeeId, employeeName: submissions[0].employeeName, submissions };
  });
}

/**
 * The HR-wide availability roster's actual card list — fetch, Approve/Deny/Undo,
 * Pending/Decided sections, and a per-date task list on each card — extracted from
 * AvailabilityAdminView (Sept 2026) so it can be dropped straight onto the dashboard's own
 * Availability widget page for admins, not just the standalone /admin/availability page.
 *
 * Round two (Sept 2026): CB, on the first version — "I see approved... but each scheduled day
 * may have different requests. I wanted to make comments under each day that was selected."
 * Tapping the card header no longer opens one shared thread for the whole submission; tapping
 * a specific date chip opens that date's own task list (DateTasksPanel), since a four-date
 * submission can need four different sets of tasks. At most one date is open per card at a time
 * (`openDate`).
 *
 * Correction brief #2 (Sept 2026): "Remove the large standalone 'Conversation' section currently
 * underneath the tasks... Communication should instead be contextual to each task." The
 * per-date TeamNotesThread that used to sit below DateTasksPanel here (topicType=
 * "AVAILABILITY_DATE") — and the per-chip message-count badge that existed only to flag activity
 * in that now-removed thread — are both gone; every task opened via DateTasksPanel now carries
 * its own comment thread instead (see DateTaskRow).
 *
 * `viewerId` is the signed-in admin/supervisor viewing this list — passed down to DateTasksPanel
 * so its own task rows know which side of a comment they're rendering. Not used for any access
 * decision here; the API routes each card talks to re-check authorization themselves.
 *
 * Correction brief #10 (Sept 2026): every card here — Pending or Decided — now also swipes to
 * reveal an administrative "Remove" action, distinct from Deny (see removeSubmission below and
 * removeAvailabilitySubmission's own comment in src/lib/availability.ts for exactly how). A
 * Decided card's swipe therefore reveals two actions side by side: "Clear" (Correction brief #9's
 * local dismiss, unchanged) and "Remove" (this round's real, permanent removal) — SwipeReveal's
 * new secondaryAction prop makes that one swipe instead of two different gestures. Folder-card
 * grouping (below) scopes both gestures to a card that still represents exactly one submission —
 * see the render below for why a genuinely merged card renders without either.
 *
 * Correction brief #11 (Sept 2026): "The chat bubble on an availability request should take the
 * user into My Messages... open the relevant conversation/thread for that specific team member/
 * request rather than only opening the generic Messages landing page." This is a direct message,
 * not a revival of the old AVAILABILITY_DATE topic thread Correction brief #2 already removed
 * from this card — per-request communication now lives on each task's own comment thread
 * (DateTaskRow), so "message this team member about their availability" means the same
 * peer-to-peer DM every other person-to-person conversation in this app uses
 * (src/lib/direct-messages.ts). One bubble per card, not per date, since a DM isn't scoped to a
 * single date the way a task is. See openChat below and MessagesInboxView's own doc comment for
 * the other half of this (reading `dm`/`name` off the URL on mount).
 *
 * Correction round (Sept 2026), CB: "each scheduled day may have different requests... you have
 * to approve each thing, like each date one at a time, or I have the option to approve everything
 * at one time." Approve/Deny is now the same either/or as the backend (see
 * AvailabilitySubmission.dateDecisions' doc comment in prisma/schema.prisma): the Pending/Decided
 * bulk buttons stay available for a submission nothing's been decided on yet; opening a date chip
 * whose own decision is still Pending shows that date's own Approve/Deny (and — CB: "click on the
 * date that I want to adjust and... change the date and the time from there" — a "Change
 * date/time" control scoped to that one date, letting the date itself move, not just its time,
 * approved immediately once set)
 * and the moment any date is decided that way
 * the bulk buttons step aside so the rest get finished one at a time. Each chip now also carries
 * a small tone dot showing that date's own decision at a glance.
 *
 * Redesign follow-up (Sept 2026): the state/fetch/decide machinery this component used to own
 * directly now lives in useTeamAvailabilityQueue above — this component is a thin renderer over
 * that hook, unchanged in behavior, so the dashboard's own TeamAvailabilityRequestsSection can
 * drive the exact same Card component off the exact same hook instead of duplicating any of it.
 *
 * Folder-card grouping (CB, Sept 2026): each section's flat rows are grouped by employee
 * (groupByEmployee above) before rendering — see Card's own doc comment for what changes on an
 * actually-merged card. Swipe-to-remove (Pending) and Swipe-to-clear/Remove (Decided) both target
 * exactly one submission, so they're only offered while a group still represents exactly one —
 * `soleId` below is that submission's id, or null once a card has genuinely merged more than one.
 */
export default function TeamAvailabilityCards({ viewerId }: { viewerId: string }) {
  const q = useTeamAvailabilityQueue();

  if (q.loadState === "loading") {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (q.loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load availability. Please try again or contact support.
      </div>
    );
  }

  return (
    <>
      {/* Redesign follow-up (Sept 2026), CB: "I don't like how there's pending zero, decided
          zero... like, we shouldn't see those things if there's nothing in there." Each section
          — heading and all — now disappears entirely once its own count hits zero, rather than
          showing an empty "(0)" heading plus a "Nothing pending/decided" placeholder; if both are
          empty, this whole queue just renders nothing. */}
      {q.pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
            Pending ({q.pending.length})
          </h2>
          <div className="space-y-3">
            {groupByEmployee(q.pending).map((group) => {
              const soleId = group.submissions.length === 1 ? group.submissions[0].id : null;
              const card = (
                <Card
                  submissions={group.submissions}
                  viewerId={viewerId}
                  busy={group.submissions.some((s) => s.id === q.busyId)}
                  denying={soleId !== null && q.denyingId === soleId}
                  denyComment={q.denyComment}
                  decideError={group.submissions.some((s) => s.id === q.decideErrorId) ? q.decideError : undefined}
                  removing={soleId !== null && q.removingId === soleId}
                  removeError={group.submissions.some((s) => s.id === q.removeErrorId) ? q.removeError : undefined}
                  openDate={q.openDate}
                  shiftsByDate={q.shiftsByDate}
                  dmCounts={q.dmCounts}
                  onToggleDate={(submissionId, date) =>
                    q.setOpenDate(
                      q.openDate?.submissionId === submissionId && q.openDate.date === date ? null : { submissionId, date }
                    )
                  }
                  onDenyToggle={() => soleId && q.setDenyingId(q.denyingId === soleId ? null : soleId)}
                  onDenyCommentChange={q.setDenyComment}
                  onDecide={q.decide}
                  onDecideDate={q.decideDate}
                  onUndo={q.undo}
                  onUndoDate={q.undoDate}
                  onChangeDate={q.changeDate}
                  onRemoveConfirm={q.removeSubmission}
                  onRemoveCancel={q.cancelRemove}
                  onOpenChat={q.openChat}
                  onMessageAboutDate={q.openChatForDate}
                  onRemoveDate={q.removeDate}
                />
              );
              // Swipe-to-remove targets ONE submission (removeAvailabilitySubmission takes a
              // single submissionId) — offered only while this card still represents exactly
              // one, same as the bulk Approve/Deny row inside Card itself. A genuinely merged
              // card has no single submission for a card-wide swipe to mean "remove," so it
              // renders without the gesture; an admin who wants to clean up one of several
              // merged requests still can, date by date, via that card's own Edit/Done per-date
              // remove (see Card's own canEditDates).
              return soleId !== null ? (
                <SwipeReveal
                  key={group.employeeId}
                  actionSide="right"
                  actionLabel="Remove"
                  actionIcon={<TrashIcon className="h-4 w-4" />}
                  actionClassName="bg-rose-600 text-white rounded-3xl"
                  onAction={() => q.setRemovingId(soleId)}
                >
                  {card}
                </SwipeReveal>
              ) : (
                <div key={group.employeeId}>{card}</div>
              );
            })}
          </div>
        </section>
      )}

      {q.decided.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2.5">
            Decided ({q.decided.length})
          </h2>
          <div className="space-y-3">
            {groupByEmployee(q.decided).map((group) => {
              const soleId = group.submissions.length === 1 ? group.submissions[0].id : null;
              const card = (
                <Card
                  submissions={group.submissions}
                  viewerId={viewerId}
                  busy={group.submissions.some((s) => s.id === q.busyId)}
                  denying={false}
                  denyComment=""
                  decideError={undefined}
                  removing={soleId !== null && q.removingId === soleId}
                  removeError={group.submissions.some((s) => s.id === q.removeErrorId) ? q.removeError : undefined}
                  openDate={q.openDate}
                  shiftsByDate={q.shiftsByDate}
                  dmCounts={q.dmCounts}
                  onToggleDate={(submissionId, date) =>
                    q.setOpenDate(
                      q.openDate?.submissionId === submissionId && q.openDate.date === date ? null : { submissionId, date }
                    )
                  }
                  onDenyToggle={() => {}}
                  onDenyCommentChange={() => {}}
                  onDecide={() => {}}
                  onDecideDate={() => {}}
                  onUndo={q.undo}
                  onUndoDate={q.undoDate}
                  onChangeDate={() => {}}
                  onRemoveConfirm={q.removeSubmission}
                  onRemoveCancel={q.cancelRemove}
                  onOpenChat={q.openChat}
                  onMessageAboutDate={q.openChatForDate}
                  onRemoveDate={q.removeDate}
                />
              );
              return soleId !== null ? (
                <SwipeReveal
                  key={group.employeeId}
                  actionSide="right"
                  actionLabel="Clear"
                  actionIcon={<CheckCircleIcon className="h-4 w-4" />}
                  actionClassName="bg-black/[0.06] text-accent-ink rounded-3xl"
                  onAction={() => q.clearDecided(soleId)}
                  secondaryAction={{
                    label: "Remove",
                    icon: <TrashIcon className="h-4 w-4" />,
                    className: "bg-rose-600 text-white rounded-3xl",
                    onAction: () => q.setRemovingId(soleId),
                  }}
                >
                  {card}
                </SwipeReveal>
              ) : (
                <div key={group.employeeId}>{card}</div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

/** Small tone dot rendered on a date chip showing that date's own individual decision — the
 *  at-a-glance "3 of 4 approved" reading CB asked for without redesigning the chip itself. */
function DateDecisionDot({ status }: { status: AvailabilityDateDecision["status"] }) {
  if (status === "PENDING") return null;
  const color = status === "APPROVED" ? "#10b981" : "#f43f5e"; // emerald-500 / rose-500
  return (
    <span
      className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-white"
      style={{ background: color }}
      title={status === "APPROVED" ? "This date is approved" : "This date is denied"}
    />
  );
}

/** One merged date chip — everything SlotChip already carries, plus which underlying submission
 *  it came from and that submission's own decision for this date (folder-card grouping, CB, Sept
 *  2026 — see Card's own doc comment below). */
type FolderChip = SlotChip & { submissionId: string; decision?: AvailabilityDateDecision };

/**
 * One team member's card within a section — Approve/Deny, per-date decisions, Edit/remove-date,
 * the chat bubble, and each date's own task list. Exported (redesign follow-up, Sept 2026)
 * alongside useTeamAvailabilityQueue above so TeamAvailabilityRequestsSection can render this
 * exact same component when a dashboard-widget row is expanded — see that file's own doc comment.
 *
 * Folder-card grouping (CB, Sept 2026): `submissions` is now always an array — almost always of
 * length 1 (a person with one request in this section), in which case every branch below gated on
 * `solo` takes the exact same path it always did and nothing changes. Only when the SAME employee
 * has more than one submission in this section (merged by groupByEmployee above) does this card
 * actually do anything new: every date across all of them renders as one merged, sorted row of
 * chips (each chip still remembers which underlying submission it came from, so Approve/Deny/
 * Change date time/the chat bubble/tasks all still act on the right one), the card-wide Approve
 * all/Deny all/Undo/reviewer-name line disappear in favor of a plain "N dates · M requests" badge
 * (CB's own confirmed mockup: approving several different REQUESTS' dates in one tap is too easy
 * to get wrong once they're not all the same request), and the swipe-to-remove/Clear gestures —
 * which only ever target one submission — step aside too (see the two call sites above for
 * exactly why). Per-date Approve/Deny/Change date/time, the chat bubble, and each date's own task
 * list are completely unaffected either way, since those were already scoped by submissionId+date
 * rather than by "the" card.
 */
export function Card({
  submissions,
  viewerId,
  busy,
  denying,
  denyComment,
  decideError,
  removing,
  removeError,
  openDate,
  shiftsByDate,
  dmCounts,
  onToggleDate,
  onDenyToggle,
  onDenyCommentChange,
  onDecide,
  onDecideDate,
  onUndo,
  onUndoDate,
  onChangeDate,
  onRemoveConfirm,
  onRemoveCancel,
  onOpenChat,
  onMessageAboutDate,
  onRemoveDate,
}: {
  submissions: AdminAvailabilityDTO[];
  viewerId: string;
  busy: boolean;
  denying: boolean;
  denyComment: string;
  decideError?: string;
  removing: boolean;
  removeError?: string;
  openDate: { submissionId: string; date: string } | null;
  shiftsByDate: Map<string, AdminShiftDTO>;
  dmCounts: Map<string, { total: number; unread: number }>;
  onToggleDate: (submissionId: string, date: string) => void;
  onDenyToggle: () => void;
  onDenyCommentChange: (v: string) => void;
  onDecide: (submissionId: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onDecideDate: (submissionId: string, date: string, decision: "APPROVED" | "DENIED", comment?: string) => void;
  onUndo: (submissionId: string) => void;
  /** CB, Sept 2026: replaces the old "propose new date/time, wait for confirmation" flow — sets
   *  ONE date's new date/time and approves it immediately, same per-date granularity as
   *  onDecideDate. See changeAvailabilityDate's own doc comment in src/lib/availability.ts. */
  onChangeDate: (submissionId: string, date: string, newDate: string, newStartTime: string, newEndTime: string, comment?: string) => void;
  onUndoDate: (submissionId: string, date: string) => void;
  onRemoveConfirm: (submissionId: string) => void;
  onRemoveCancel: () => void;
  onOpenChat: (employeeId: string, employeeName: string) => void;
  /** Phase 5d: same navigation as onOpenChat, scoped to one date — see openChatForDate's own
   *  doc comment above for what it pre-attaches. */
  onMessageAboutDate: (employeeId: string, employeeName: string, submissionId: string, date: string) => void;
  onRemoveDate: (submissionId: string, date: string) => void;
}) {
  const { employeeId, employeeName } = submissions[0];
  const isSelf = employeeId === viewerId;
  // Every date across every submission in this group, sorted together and each still tagged with
  // which submission it actually belongs to — see this component's own doc comment above.
  const chips: FolderChip[] = submissions
    .flatMap((s) =>
      slotChips(s.slots).map((c) => ({
        ...c,
        submissionId: s.id,
        decision: s.dateDecisions.find((d) => d.date === c.date),
      }))
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const isPending = submissions.every((s) => s.status === "PENDING");
  // "solo" is the ordinary, unmerged case (see this component's own doc comment) — every branch
  // gated on it behaves exactly as it did before this card could ever hold more than one
  // submission.
  const solo = submissions.length === 1 ? submissions[0] : null;
  const perDateMode = solo ? isInPerDateMode(solo.dateDecisions) : false;
  const fullyDecided = solo ? allDatesDecided(solo.dateDecisions) : false;

  const [editingDates, setEditingDates] = useState(false);
  // Carries which submission the date belongs to, not just the date — a merged card can have
  // the same calendar date on more than one underlying request in principle, and removeDate
  // needs to know exactly which one this confirmation is acting on.
  const [confirmRemoveDate, setConfirmRemoveDate] = useState<{ submissionId: string; date: string } | null>(null);
  // Per-date deny's own comment box — mirrors the bulk denyComment/denying pair above, just
  // scoped to whichever date is currently open rather than the whole card.
  const [denyingDate, setDenyingDate] = useState<string | null>(null);
  const [denyDateComment, setDenyDateComment] = useState("");
  // Per-date "Change date/time" — CB: "click on the date that I want to adjust and... change
  // the date and the time from there," and (QA pass, Sept 2026) confirmed this should let the
  // DATE itself change too, not just the time window on the same day. CB, later: "we shouldn't
  // have to wait on the team member... once we set it, then that becomes the new schedule" —
  // onChangeDate approves this one date immediately with the edited date/time, no separate
  // confirmation step (see its own doc comment above). `adjustingDate` still tracks by the
  // ORIGINAL date (which chip/panel is open), even after `adjustDate` itself is edited to
  // something else.
  const [adjustingDate, setAdjustingDate] = useState<string | null>(null);
  const [adjustDate, setAdjustDate] = useState("");
  const [adjustStart, setAdjustStart] = useState("");
  const [adjustEnd, setAdjustEnd] = useState("");
  const [adjustDateComment, setAdjustDateComment] = useState("");

  // CB, Sept 2026, round three: "instead of the yellow background, I want the pink
  // background" (Approved) / "I think the pending color should be that yellow as well" —
  // confirmed this replaces the old per-employee tone entirely: color now signals the
  // decision itself (Pending/Approved/Denied), same everywhere, not who or what it's about.
  // CB, round five: the viewer's own card always reads in brand blue, regardless of status —
  // see YOU_TONE's doc comment in src/lib/status-tone.ts. Folder-card grouping: a merged card
  // can hold submissions with different outcomes (Decided) — picks Approved over Denied the
  // same way aggregateStatus itself resolves "at least one date approved" in
  // src/lib/availability.ts, falling back to the first submission's own tone for anything else
  // (Cancelled, Adjustment Requested) rather than inventing a new precedence rule for those.
  const tone = isSelf
    ? YOU_TONE
    : solo
      ? toneForStatus(solo.status)
      : submissions.some((s) => s.status === "APPROVED")
        ? toneForStatus("APPROVED")
        : submissions.some((s) => s.status === "DENIED")
          ? toneForStatus("DENIED")
          : toneForStatus(submissions[0].status);
  const openChip = openDate ? chips.find((c) => c.submissionId === openDate.submissionId && c.date === openDate.date) : undefined;
  const openSubmission = openChip ? submissions.find((s) => s.id === openChip.submissionId) : undefined;
  const openDecision = openChip?.decision;
  // Correction brief #10 (Sept 2026): "if an already-approved availability request has
  // generated or affected an actual schedule, handle the schedule relationship explicitly" —
  // this doesn't change whether Remove is allowed (removeAvailabilitySubmission never touches
  // the Shift table either way), just whether the confirmation below says so, so the admin isn't
  // surprised later. shiftsByDate is the same admin-wide map the "Scheduled as a shift" section
  // further down already uses, keyed "submissionId:date". Only meaningful for `solo` — Remove is
  // only ever offered on an unmerged card (see this component's own doc comment).
  const hasLinkedShift = solo ? chips.some((c) => shiftsByDate.has(`${solo.id}:${c.date}`)) : false;
  // Correction brief #11 (Sept 2026): the chat bubble's own unread badge — see this component's
  // top-level doc comment for why this is a DM count, not a topic-thread count.
  const dmCount = dmCounts.get(employeeId);
  // CB, Sept 2026: the per-date minus lives behind an Edit/Done toggle so it's opt-in, not
  // sitting on every card by default. Eligible on the same PENDING/DENIED requests
  // removeAvailabilityDateForReview allows — a Decided-but-Approved card never gets this.
  // Folder-card grouping, correction (Sept 2026): each chip already remembers which submission
  // it belongs to (FolderChip.submissionId) and onRemoveDate already takes a submissionId, so a
  // merged card can offer this per-chip exactly like a solo one does — there's no real ambiguity
  // once the button lives on the individual chip. `editableSubmissionIds` is which of this
  // card's underlying submissions are eligible at all; the Edit toggle itself shows once at
  // least one chip qualifies, and the "−" only renders on chips that do.
  const editableSubmissionIds = new Set(
    submissions.filter((s) => s.status === "PENDING" || s.status === "DENIED").map((s) => s.id)
  );
  const canEditDates = chips.length > 1 && chips.some((c) => editableSubmissionIds.has(c.submissionId));

  function startAdjustDate(date: string, seedStart: string, seedEnd: string) {
    setAdjustingDate(date);
    setAdjustDate(date);
    setAdjustStart(seedStart);
    setAdjustEnd(seedEnd);
    setAdjustDateComment("");
  }

  function submitAdjustDate() {
    if (!adjustingDate || !openSubmission) return;
    const newDate = adjustDate || adjustingDate;
    onChangeDate(openSubmission.id, adjustingDate, newDate, adjustStart, adjustEnd, adjustDateComment.trim() || undefined);
    setAdjustingDate(null);
    setAdjustDateComment("");
  }

  return (
    <div
      className="rounded-3xl shadow-lg overflow-hidden p-4 sm:p-5"
      style={{ background: `linear-gradient(150deg, ${tone.from} 0%, ${tone.to} 100%)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="h-10 w-10 rounded-full bg-white/25 border border-white/40 flex items-center justify-center text-sm font-semibold text-white shrink-0">
            {initialsOf(employeeName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-base font-semibold text-white truncate">{employeeName}</p>
              {isSelf && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white bg-white/25 border border-white/40 rounded-full px-1.5 py-0.5">
                  You
                </span>
              )}
              {/* Folder badge (CB's own confirmed mockup, Sept 2026): replaces the single status
                  pill/reviewer-name line below once more than one of this person's submissions
                  are merged into this card — there's no longer one status or one reviewer to
                  summarize at the card level; each date still shows its own further down. */}
              {!solo && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white bg-white/20 border border-white/35 rounded-full px-2 py-0.5">
                  {chips.length} dates · {submissions.length} requests
                </span>
              )}
            </div>
            {solo && (
              <>
                <div className="flex items-center gap-2 mt-0.5">
                  {isPending ? (
                    <span className="text-xs font-medium text-white/80">
                      {perDateMode && !fullyDecided ? "Some dates decided — finish the rest below" : "Awaiting your decision"}
                    </span>
                  ) : (
                    <>
                      <AvailabilityStatusPill status={solo.status} />
                      <button onClick={() => onUndo(solo.id)} disabled={busy} className="text-xs font-medium text-white/85 hover:text-white underline underline-offset-2">
                        Undo
                      </button>
                    </>
                  )}
                </div>
                {/* CB, Sept 2026: "I need to see that directly on the card itself once it's
                    approved... so I don't have to go all the way to the reports in order for me
                    to find that." reviewedByName was already resolved server-side for Activity
                    History — see its own doc comment in src/types/index.ts — just never surfaced
                    here. Only set once decide() actually runs (APPROVED/DENIED), so this
                    naturally stays hidden for CANCELLED/ADJUSTMENT_REQUESTED without a separate
                    status check. */}
                {solo.reviewedByName && (
                  <p className="text-xs font-medium text-white mt-0.5">
                    {solo.status === "APPROVED" ? "Approved" : "Denied"} by {solo.reviewedByName}
                    {/* CB, Sept 2026: "I need to know the time and the date that it was approved
                        as well" — right under the reviewer's name, deliberately lighter/smaller
                        than the name line above so the name stays the primary read. */}
                    {solo.reviewedAt && (
                      <span className="block text-[11px] font-normal text-white/75 mt-0.5">
                        {formatReviewedAt(solo.reviewedAt)}
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Correction brief #11 (Sept 2026): "The chat bubble on an availability request
              should take the user into My Messages... open the relevant conversation/thread for
              that specific team member." Not shown on the viewer's own card — messaging yourself
              isn't a real conversation. */}
          {!isSelf && (
            <button
              type="button"
              onClick={() => onOpenChat(employeeId, employeeName)}
              className="relative h-8 w-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
              title={`Message ${employeeName}`}
            >
              <ChatIcon className="h-4 w-4 text-white" />
              {!!dmCount?.unread && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                  style={{ background: "#8b5cf6" }}
                >
                  {dmCount.unread > 9 ? "9+" : dmCount.unread}
                </span>
              )}
            </button>
          )}
          <span className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center" title="Tap a date below to see its tasks">
            <ChecklistIcon className="h-4 w-4 text-white" />
          </span>
          {canEditDates && (
            <button
              type="button"
              onClick={() => {
                setEditingDates((v) => !v);
                setConfirmRemoveDate(null);
              }}
              className={`h-8 rounded-full px-3 text-xs font-bold transition-colors ${
                editingDates ? "bg-white" : "bg-white/20 hover:bg-white/30 text-white"
              }`}
              style={editingDates ? { color: tone.to } : undefined}
            >
              {editingDates ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = openDate?.submissionId === c.submissionId && openDate?.date === c.date;
            return (
              <div key={`${c.submissionId}:${c.date}`} className="relative">
                <button
                  type="button"
                  onClick={() => onToggleDate(c.submissionId, c.date)}
                  className={`relative flex flex-col items-start rounded-xl px-2.5 py-1.5 leading-tight transition-colors ${
                    active ? "bg-white" : "bg-white/15 hover:bg-white/25 border border-white/25"
                  } ${editingDates ? "border-white/55" : ""}`}
                  style={active ? { color: tone.to } : undefined}
                >
                  {c.decision && <DateDecisionDot status={c.decision.status} />}
                  <span className={`text-xs font-semibold ${active ? "" : "text-white"}`}>{c.dateLabel}</span>
                  <span className={`text-[11px] ${active ? "opacity-70" : "text-white/80"}`}>{c.timeLabel}</span>
                </button>
                {editingDates && editableSubmissionIds.has(c.submissionId) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmRemoveDate({ submissionId: c.submissionId, date: c.date });
                    }}
                    aria-label={`Remove ${c.dateLabel}`}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-rose-600 text-white text-xs leading-none flex items-center justify-center border-2 shadow-sm"
                    style={{ borderColor: tone.to }}
                  >
                    &minus;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-white/80 mt-2">No dates marked available.</p>
      )}

      {editingDates && confirmRemoveDate && (
        <div className="mt-2.5 bg-black/20 rounded-xl p-3">
          <p className="text-sm font-semibold text-white">
            Remove{" "}
            {
              chips.find((c) => c.submissionId === confirmRemoveDate.submissionId && c.date === confirmRemoveDate.date)
                ?.dateLabel
            }{" "}
            from this request?
          </p>
          <p className="text-xs text-white/80 mt-1">
            Just this date drops off, the rest of the request stays exactly as it is. {employeeName} isn&apos;t notified.
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              type="button"
              onClick={() => setConfirmRemoveDate(null)}
              disabled={busy}
              className="rounded-full bg-white/15 border border-white/35 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onRemoveDate(confirmRemoveDate.submissionId, confirmRemoveDate.date);
                setConfirmRemoveDate(null);
              }}
              disabled={busy}
              className="rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
            >
              Remove date
            </button>
          </div>
        </div>
      )}

      {solo?.note && <p className="text-sm text-white/85 italic mt-2.5">&ldquo;{solo.note}&rdquo;</p>}
      {solo && !isPending && solo.reviewComment && (
        <p className="text-sm text-white/85 italic mt-2">Reviewer note: &ldquo;{solo.reviewComment}&rdquo;</p>
      )}

      {/* Bulk actions — "I have the option to approve everything at one time." Hidden the
          moment any date has been decided individually (perDateMode), and — folder-card
          grouping — hidden entirely once more than one submission is merged into this card
          (see this component's own doc comment for why). */}
      {solo && isPending && !perDateMode && (
        <div className="flex items-center gap-2 mt-3.5 flex-wrap">
          <button
            onClick={() => onDecide(solo.id, "APPROVED")}
            disabled={busy}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:brightness-95 disabled:opacity-60"
            style={{ color: tone.to }}
          >
            {chips.length > 1 ? "Approve all" : "Approve"}
          </button>
          <button
            onClick={onDenyToggle}
            disabled={busy}
            className="rounded-full bg-white/15 border border-white/35 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-60"
          >
            {chips.length > 1 ? "Deny all" : "Deny"}
          </button>
        </div>
      )}

      {decideError && <p className="text-xs font-medium text-rose-50 mt-2">{decideError}</p>}

      {denying && solo && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 bg-white/15 rounded-xl p-3">
          <textarea
            value={denyComment}
            onChange={(e) => onDenyCommentChange(e.target.value)}
            placeholder="Optional note for the team member…"
            rows={2}
            className="flex-1 rounded-md border border-white/30 bg-white/90 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white placeholder:text-muted"
          />
          <button
            onClick={() => onDecide(solo.id, "DENIED", denyComment.trim() || undefined)}
            disabled={busy}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold self-start shadow-sm"
            style={{ color: tone.to }}
          >
            Confirm deny
          </button>
        </div>
      )}

      {/* Correction brief #10 (Sept 2026): the confirmation the brief explicitly asks for —
          "Use a confirmation before destructive removal, such as: 'Remove this availability
          request?'" — opened by the swipe-revealed Remove button above, not by the swipe itself,
          so a swipe alone never removes anything. Distinct from Deny: this never notifies the
          team member and never records a decision on the request's merits, only that HR cleaned
          it up (see removeAvailabilitySubmission's own comment for the full reasoning). Only
          ever reachable on an unmerged card (see this component's own doc comment), so `solo` is
          always set here in practice — the guard just keeps this branch type-safe. */}
      {removing && solo && (
        <div className="mt-3.5 flex flex-col gap-2.5 bg-white/15 rounded-xl p-3">
          <p className="text-sm font-semibold text-white">Remove this availability request?</p>
          <p className="text-xs text-white/80">
            This is administrative cleanup, not a decision — it won&rsquo;t notify{" "}
            {isSelf ? "you" : employeeName}, and HR keeps an internal record even after it&rsquo;s
            removed.
            {hasLinkedShift &&
              " A shift already scheduled from this request stays exactly as it is — removing the request will not cancel or change it."}
          </p>
          {removeError && <p className="text-xs font-medium text-rose-50">{removeError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRemoveCancel}
              disabled={busy}
              className="rounded-full bg-white/15 border border-white/35 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onRemoveConfirm(solo.id)}
              disabled={busy}
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
            >
              {busy ? "Removing…" : "Remove request"}
            </button>
          </div>
        </div>
      )}

      {openChip && openSubmission && (
        <div className="mt-3.5 space-y-3.5">
          {/* This one date's own decision — approve/deny it individually, propose a different
              time for just this date, or (once decided) see the outcome. Only offered while the
              date's OWN submission is still Pending; a Decided card's dates are all already
              resolved. */}
          {openSubmission.status === "PENDING" && openDecision && (
            <div className="bg-white/15 rounded-xl p-3 space-y-2.5">
              {openDecision.status === "PENDING" ? (
                adjustingDate === openChip.date ? (
                  <div className="space-y-2.5">
                    {/* QA pass (Sept 2026), CB: "there's no way to change the date" — this used
                        to only let the TIME move; the date itself is now editable right here
                        too, seeded from the original date but free to change. */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="date"
                        value={adjustDate}
                        onChange={(e) => setAdjustDate(e.target.value)}
                        className="rounded-md border border-white/30 bg-white/90 px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-white"
                      />
                      <input
                        type="time"
                        value={adjustStart}
                        onChange={(e) => setAdjustStart(e.target.value)}
                        className="rounded-md border border-white/30 bg-white/90 px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-white"
                      />
                      <span className="text-xs text-white/80">to</span>
                      <input
                        type="time"
                        value={adjustEnd}
                        onChange={(e) => setAdjustEnd(e.target.value)}
                        className="rounded-md border border-white/30 bg-white/90 px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-white"
                      />
                    </div>
                    <textarea
                      value={adjustDateComment}
                      onChange={(e) => setAdjustDateComment(e.target.value)}
                      placeholder="Optional note explaining the change…"
                      rows={2}
                      className="w-full rounded-md border border-white/30 bg-white/90 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white placeholder:text-muted"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAdjustingDate(null)}
                        disabled={busy}
                        className="rounded-full bg-white/15 border border-white/35 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submitAdjustDate}
                        disabled={busy}
                        className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold shadow-sm"
                        style={{ color: tone.to }}
                      >
                        Save change
                      </button>
                    </div>
                  </div>
                ) : denyingDate === openChip.date ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea
                      value={denyDateComment}
                      onChange={(e) => setDenyDateComment(e.target.value)}
                      placeholder="Optional note for the team member…"
                      rows={2}
                      className="flex-1 rounded-md border border-white/30 bg-white/90 px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-white placeholder:text-muted"
                    />
                    <button
                      onClick={() => {
                        onDecideDate(openSubmission.id, openChip.date, "DENIED", denyDateComment.trim() || undefined);
                        setDenyingDate(null);
                        setDenyDateComment("");
                      }}
                      disabled={busy}
                      className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold self-start shadow-sm"
                      style={{ color: tone.to }}
                    >
                      Confirm deny
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onDecideDate(openSubmission.id, openChip.date, "APPROVED")}
                      disabled={busy}
                      className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold shadow-sm hover:brightness-95 disabled:opacity-60"
                      style={{ color: tone.to }}
                    >
                      Approve this date
                    </button>
                    <button
                      type="button"
                      onClick={() => setDenyingDate(openChip.date)}
                      disabled={busy}
                      className="rounded-full bg-white/15 border border-white/35 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                    >
                      Deny this date
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const original = openSubmission.slots.find((s) => s.date === openChip.date);
                        startAdjustDate(openChip.date, original?.startTime ?? "09:00", original?.endTime ?? "17:00");
                      }}
                      disabled={busy}
                      className="rounded-full bg-white/15 border border-white/35 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                    >
                      Change date/time
                    </button>
                    {/* Phase 5d (CB, Sept 2026): "chat icons on availability requests linked to
                        specific dates" — opens My Messages with this date already attached as a
                        reference (openChatForDate's own doc comment above). Not shown on the
                        viewer's own card, same reasoning the card-level chat button above already
                        gives — messaging yourself isn't a real conversation. */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => onMessageAboutDate(employeeId, employeeName, openSubmission.id, openChip.date)}
                        className="flex items-center gap-1.5 rounded-full bg-white/15 border border-white/35 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
                      >
                        <ChatIcon className="h-3.5 w-3.5" />
                        Message about this date
                      </button>
                    )}
                  </div>
                )
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-medium text-white/90">
                    {openDecision.status === "APPROVED" ? "This date is approved." : "This date is denied."}
                    {/* CB, Sept 2026: "I need to see that directly on the card itself once it's
                        approved" — same reviewer-name surfacing as the card-level status above,
                        just the per-date counterpart (decidedByName, src/types/index.ts). */}
                    {openDecision.decidedByName && (
                      <span className="block text-white mt-0.5">
                        {openDecision.status === "APPROVED" ? "Approved" : "Denied"} by {openDecision.decidedByName}
                        {/* Same date/time line as the submission-level "Approved/Denied by" above
                            — CB, Sept 2026: "I need to know the time and the date." */}
                        {openDecision.decidedAt && (
                          <span className="block text-[11px] font-normal text-white/75 mt-0.5">
                            {formatReviewedAt(openDecision.decidedAt)}
                          </span>
                        )}
                      </span>
                    )}
                    {openDecision.comment && <span className="block italic text-white/80 mt-1">&ldquo;{openDecision.comment}&rdquo;</span>}
                  </p>
                  {/* CB, Sept 2026: "even if it's approved, I should still be able to make
                      adjustments... it's not just final." This date's own decision was already
                      made while the rest of the submission is still waiting, so the whole-card
                      Undo above (only shown once the ENTIRE submission is Decided) can't reach
                      it — this reopens just this one date, leaving every other date's decision
                      untouched. Hidden once a real shift already exists for this date (task
                      pushed) — see undecideAvailabilityDate's own doc comment for why that case
                      goes through Team Schedule instead. */}
                  {!shiftsByDate.has(`${openSubmission.id}:${openChip.date}`) && (
                    <button
                      type="button"
                      onClick={() => onUndoDate(openSubmission.id, openChip.date)}
                      disabled={busy}
                      className="text-xs font-medium text-white/85 hover:text-white underline underline-offset-2 disabled:opacity-50"
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Two-step approval workflow (CB, Sept 2026, from the real meeting with Daijour):
              approving a date doesn't finish anything by itself — it pings the admin who pushes
              a task for that date, and THAT push is what confirms the shift, in one action.
              There's deliberately no manual "Confirm as Shift" button here anymore (that used to
              skip the task requirement entirely) — this row is read-only: either the shift's
              already confirmed (a task was pushed), or it's sitting in the admin's own "needs a
              task" queue, and DateTasksPanel right below is where that actually happens. */}
          {openDecision?.status === "APPROVED" && (() => {
            const existingShift = shiftsByDate.get(`${openSubmission.id}:${openChip.date}`);
            return (
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
                <CalendarIcon className="h-3.5 w-3.5 text-white/80 shrink-0" />
                {existingShift ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white/85">Scheduled as a shift</span>
                    <ShiftStatusPill status={existingShift.displayStatus} />
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-white/85">
                    Approved — push a task below to confirm the shift
                  </span>
                )}
              </div>
            );
          })()}

          {/* CB, Sept 2026: "I like how we have a texting feature but I feel like we should be
              also able to push different tasks within that specific day" — a discrete,
              checkable item per date, with its own two-way approval (DateTasksPanel pushes it,
              the employee's dashboard marks it done, this panel confirms it). Correction brief
              #2: each task now carries its own comment thread (DateTaskRow) instead of sharing
              one standalone conversation with every other task on this date — see this
              component's own doc comment for what that replaced. */}
          <div>
            <p className="text-xs font-semibold text-white/80 mb-1.5 flex items-center gap-1.5">
              <ChecklistIcon className="h-3.5 w-3.5 text-white/80" />
              {openChip.dateLabel} — tasks
            </p>
            <DateTasksPanel employeeId={employeeId} taskDate={openChip.date} viewerId={viewerId} />
          </div>
        </div>
      )}
    </div>
  );
}
