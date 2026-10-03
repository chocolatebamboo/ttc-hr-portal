"use client";

import { useEffect, useState } from "react";
import { MegaphoneIcon, TrashIcon, ClockIcon, ChevronDownIcon } from "@/components/icons";
import type {
  AnnouncementDTO,
  AnnouncementAdminDTO,
  AnnouncementAudienceType,
  AssignmentOptionsDTO,
} from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 3, 9:00 AM" — date + time together, for the admin list's Starts/Ends range (the
 *  employee-facing feed below still only ever shows the bare date via formatAnnouncementDate
 *  above; a team member reading a post doesn't need to know it went up at 9:03 vs 9:00). */
function formatAnnouncementDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

/** CB, Oct 2026, looking at this page with two tabs both basically showing the same list: "I
 *  feel like we could combine the manage with the announcements because I'm seeing like two
 *  announcements and I feel like we could kind of combine it and make it cleaner." There was
 *  never a real reason for an admin to see the plain read-only feed AND a separate "Manage"
 *  list of the same posts — the admin list already shows everything the feed did, plus a
 *  Live/Scheduled/Expired badge and Delete right on the row. So canManage no longer renders a
 *  tab switcher at all: an admin gets the one list (AdminAnnouncementsList, Delete included), a
 *  regular employee still gets the plain read-only AnnouncementFeed, same as before. */
export default function AnnouncementsView({ canManage }: { canManage: boolean }) {
  // CB, Sept 2026: "creating an announcement currently requires going through Manage first" —
  // she wanted that extra step gone. This is the one and only "New Announcement" toggle now
  // (the Manage tab's own separate copy of this same toggle is gone along with the tab itself).
  const [composeOpen, setComposeOpen] = useState(false);
  // Bumped after a successful post so the list below (which owns its own fetch-on-mount state)
  // re-fetches by remounting, rather than this view reaching into its internals.
  const [listKey, setListKey] = useState(0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="page-title text-2xl">Announcements</h1>
        {canManage && (
          <button
            onClick={() => setComposeOpen((o) => !o)}
            className={composeOpen ? "btn-neutral text-sm px-3.5 py-2 shrink-0" : "btn-primary text-sm px-3.5 py-2 shrink-0"}
          >
            {composeOpen ? "Cancel" : "New Announcement"}
          </button>
        )}
      </div>

      {composeOpen && (
        <ComposeAnnouncementForm
          onCreated={() => {
            setComposeOpen(false);
            setListKey((k) => k + 1);
          }}
        />
      )}

      {canManage ? <AdminAnnouncementsList key={listKey} /> : <AnnouncementFeed />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee-facing feed (unchanged — read-only, no manage affordances)
// ---------------------------------------------------------------------------

function AnnouncementFeed() {
  const [announcements, setAnnouncements] = useState<AnnouncementDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    async function load() {
      setLoadState("loading");
      try {
        const res = await fetch("/api/announcements");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setAnnouncements(data.announcements);
        setLoadState(data.announcements.length === 0 ? "empty" : "ready");
      } catch {
        setLoadState("error");
      }
    }
    load();
  }, []);

  if (loadState === "loading") {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load announcements. Please try again or contact HR.
      </div>
    );
  }

  if (loadState === "empty") {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
        <MegaphoneIcon className="h-8 w-8 text-muted/60" />
        No announcements right now — check back later.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {announcements.map((a) => (
        <div key={a.id} className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <h2 className="text-sm font-semibold">{a.title}</h2>
            <span className="text-xs text-muted whitespace-nowrap shrink-0">
              {formatAnnouncementDate(a.publishDate)}
            </span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{a.message}</p>
          <p className="text-xs text-muted mt-2">— {a.authorName}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: the one combined list (was "Manage", formerly a second tab alongside a plain feed)
// ---------------------------------------------------------------------------

function announcementBadge(a: AnnouncementAdminDTO): { label: string; className: string } {
  if (a.isActive) return { label: "Live", className: "bg-emerald-100 text-emerald-800" };
  if (new Date(a.publishDate) > new Date()) return { label: "Scheduled", className: "bg-amber-100 text-amber-800" };
  return { label: "Expired", className: "bg-black/5 text-muted" };
}

function AdminAnnouncementsList() {
  const [announcements, setAnnouncements] = useState<AnnouncementAdminDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  // CB, Oct 2026, on this very list: "I'm not able to click into them to see the full message."
  // The row only ever showed title/badge/dates/audience — the actual message text had nowhere to
  // go. One row open at a time (same "accordion" feel DateTaskRow's own comment-thread toggle
  // already uses elsewhere in this app), rather than every row expanded by default and the list
  // turning into a wall of text.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/announcements/manage");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAnnouncements(data.announcements);
      setLoadState(data.announcements.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function removeAnnouncement(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/announcements/manage/${id}/delete`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load announcements. Please try again.
      </div>
    );
  }

  if (loadState === "empty") {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted flex flex-col items-center gap-2">
        <MegaphoneIcon className="h-8 w-8 text-muted/60" />
        No announcements have been posted yet.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
      {announcements.map((a) => {
        const badge = announcementBadge(a);
        const open = expandedId === a.id;
        return (
          <div key={a.id}>
            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              {/* CB, Oct 2026: "I'm not able to click into them to see the full message." The
                  title/badge/dates/audience block is now a real button that expands this row in
                  place to show the full message below — tap again (or tap another row) to
                  collapse. A sibling of the Delete button, not a parent of it, so the two stay
                  two separate tap targets instead of a button nested inside a button. */}
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : a.id)}
                className="min-w-0 flex-1 text-left"
                aria-expanded={open}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  <span
                    className={`text-[10px] uppercase tracking-wide font-semibold rounded-full px-2 py-0.5 shrink-0 ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </div>
                <p className="text-xs text-muted truncate mt-0.5">
                  {formatAnnouncementDateTime(a.publishDate)} – {a.expirationDate ? formatAnnouncementDateTime(a.expirationDate) : "no end date"}
                </p>
                <p className="text-xs text-muted truncate">
                  {a.audienceType === "EVERYONE" ? "Everyone" : a.audienceLabel} · {a.authorName}
                </p>
              </button>
              <button
                onClick={() => removeAnnouncement(a.id)}
                disabled={busyId === a.id}
                aria-label={`Delete "${a.title}"`}
                className="h-8 w-8 flex items-center justify-center rounded-full text-muted hover:text-rose-600 hover:bg-rose-600/10 transition-colors disabled:opacity-50 shrink-0"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
            {open && (
              <div className="px-4 pb-4 -mt-1">
                <p className="text-sm text-foreground whitespace-pre-wrap break-words bg-black/[0.02] rounded-lg p-3">
                  {a.message}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "YYYY-MM-DDTHH:mm" for an <input type="datetime-local">, in the viewer's own local time —
 *  deliberately NOT toISOString() (that's UTC, and would silently shift the prefilled time by
 *  the viewer's own offset). */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A <input type="datetime-local"> value is parsed by the browser as THIS browser's own local
 *  time (no "Z", no offset) — exactly the pattern combineDateAndTime (src/lib/time.ts) already
 *  relies on for clock-in/out correction. Converting to a real ISO string here, client-side,
 *  before it ever reaches the server means the server (which may run in a different timezone
 *  than the admin filling out this form — Render runs UTC) parses an unambiguous instant rather
 *  than re-interpreting a bare "2026-10-03T09:00" as ITS OWN local time, which would silently
 *  shift the admin's intended time. */
function datetimeLocalToISOString(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function ComposeAnnouncementForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  // CB, Oct 2026: "I want it to be mandatory to schedule how long it is... from this date and
  // this time to this date and this time." Both fields are now required `datetime-local`
  // inputs (date AND time), replacing the old optional date-only "Expires" field. Prefilled to
  // sensible defaults — Starts now, Ends 7 days from now (the same default window this form
  // used to apply silently when the field was left blank) — so posting still takes one click
  // for the common case, but the actual window is always visible and always a deliberate choice
  // rather than an invisible fallback.
  const [publishDate, setPublishDate] = useState(() => toDatetimeLocalValue(new Date()));
  const [expirationDate, setExpirationDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return toDatetimeLocalValue(d);
  });
  const [audienceType, setAudienceType] = useState<AnnouncementAudienceType>("EVERYONE");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [options, setOptions] = useState<AssignmentOptionsDTO | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    fetch("/api/roster/assignable")
      .then((res) => res.json())
      .then(setOptions)
      .catch(() => setOptions({ departments: [], employees: [] }));
  }, []);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (audienceType === "DEPARTMENTS" && departmentIds.length === 0) {
      setStatus("error");
      setErrorMessage("Choose at least one department.");
      return;
    }
    if (audienceType === "EMPLOYEES" && employeeIds.length === 0) {
      setStatus("error");
      setErrorMessage("Choose at least one team member.");
      return;
    }
    if (!publishDate || !expirationDate) {
      setStatus("error");
      setErrorMessage("Choose when this announcement starts and ends.");
      return;
    }
    if (new Date(expirationDate).getTime() <= new Date(publishDate).getTime()) {
      setStatus("error");
      setErrorMessage("The end must be after the start.");
      return;
    }

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/announcements/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          message,
          publishDate: datetimeLocalToISOString(publishDate),
          expirationDate: datetimeLocalToISOString(expirationDate),
          audienceType,
          departmentIds: audienceType === "DEPARTMENTS" ? departmentIds : undefined,
          employeeIds: audienceType === "EMPLOYEES" ? employeeIds : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Unable to post. Please try again.");
        return;
      }
      onCreated();
    } catch {
      setStatus("error");
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-4 mb-5">
      <div>
        <label className="block text-sm font-medium mb-1.5">Title</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Office closed Labor Day"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Message</label>
        <textarea
          required
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent resize-y"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Visible to</label>
        <select
          value={audienceType}
          onChange={(e) => setAudienceType(e.target.value as AnnouncementAudienceType)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="EVERYONE">Everyone</option>
          <option value="DEPARTMENTS">Specific department(s)</option>
          <option value="EMPLOYEES">Specific team member(s)</option>
        </select>
      </div>

      {audienceType === "DEPARTMENTS" && (
        <div>
          <label className="block text-sm font-medium mb-1.5">Departments</label>
          <div className="flex flex-wrap gap-2">
            {options?.departments.map((d) => (
              <label
                key={d.id}
                className={`flex items-center gap-1.5 text-sm rounded-full border px-3 py-1.5 cursor-pointer ${
                  departmentIds.includes(d.id) ? "border-accent bg-accent/5 text-accent-ink" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={departmentIds.includes(d.id)}
                  onChange={() => toggle(departmentIds, setDepartmentIds, d.id)}
                  className="h-3.5 w-3.5 accent-[var(--ttc-pink)]"
                />
                {d.name}
              </label>
            ))}
            {options && options.departments.length === 0 && (
              <p className="text-xs text-muted">No departments set up yet.</p>
            )}
          </div>
        </div>
      )}

      {audienceType === "EMPLOYEES" && (
        <div>
          <label className="block text-sm font-medium mb-1.5">Team Members</label>
          <div className="max-h-48 overflow-y-auto flex flex-wrap gap-2">
            {options?.employees.map((e) => (
              <label
                key={e.id}
                className={`flex items-center gap-1.5 text-sm rounded-full border px-3 py-1.5 cursor-pointer ${
                  employeeIds.includes(e.id) ? "border-accent bg-accent/5 text-accent-ink" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={employeeIds.includes(e.id)}
                  onChange={() => toggle(employeeIds, setEmployeeIds, e.id)}
                  className="h-3.5 w-3.5 accent-[var(--ttc-pink)]"
                />
                {e.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Oct 2026 (CB: "I want it to be mandatory to schedule how long it is... from this date
          and this time to this date and this time, to be honest, so it reads well"): replaces
          the old optional, date-only "Expires" field — Starts and Ends are both required and
          both carry a time, not just a date, so the full window is spelled out up front instead
          of relying on a silent default. Kept in the same highlighted callout treatment
          DocumentsView/AttendanceAdminView already use for something an admin shouldn't skim
          past. */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <ClockIcon className="h-4 w-4 text-accent-ink shrink-0" />
          <span className="text-sm font-semibold text-accent-ink">How long should this run?</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Starts <span className="text-accent-ink">*</span>
            </label>
            <input
              type="datetime-local"
              required
              value={publishDate}
              onChange={(e) => setPublishDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Ends <span className="text-accent-ink">*</span>
            </label>
            <input
              type="datetime-local"
              required
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      </div>

      {status === "error" && (
        <p role="alert" className="text-sm text-accent">
          {errorMessage}
        </p>
      )}

      <button type="submit" disabled={status === "submitting"} className="btn-primary px-5 py-2.5 text-sm">
        {status === "submitting" ? "Posting…" : "Post Announcement"}
      </button>
    </form>
  );
}
