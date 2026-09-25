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
 * peer-to-peer DM every other
