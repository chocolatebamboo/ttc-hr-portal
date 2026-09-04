"use client";

import { useEffect, useState } from "react";
import { MegaphoneIcon, TrashIcon } from "@/components/icons";
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

/** Same tabbed-page pattern as Documents and Onboarding: one page, "Announcements" for
 *  everyone and an admin-only "Manage" tab for composing/removing posts. */
export default function AnnouncementsView({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"feed" | "manage">("feed");

  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-4">Announcements</h1>

      {canManage && (
        <div className="flex gap-1.5 mb-5 border-b border-border">
          <TabButton active={tab === "feed"} onClick={() => setTab("feed")}>
            Announcements
          </TabButton>
          <TabButton active={tab === "manage"} onClick={() => setTab("manage")}>
            Manage
          </TabButton>
        </div>
      )}

      {tab === "feed" ? <AnnouncementFeed /> : <AdminAnnouncementsPanel />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-accent text-accent-ink" : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Employee-facing feed
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
// Admin: Manage
// ---------------------------------------------------------------------------

function AdminAnnouncementsPanel() {
  const [announcements, setAnnouncements] = useState<AnnouncementAdminDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted max-w-md">
          Post a company-wide, department, or individual announcement.
        </p>
        <button
          onClick={() => setFormOpen((o) => !o)}
          className={formOpen ? "btn-neutral text-sm px-4 py-2 shrink-0" : "btn-primary text-sm px-4 py-2 shrink-0"}
        >
          {formOpen ? "Cancel" : "New Announcement"}
        </button>
      </div>

      {formOpen && (
        <ComposeAnnouncementForm
          onCreated={() => {
            setFormOpen(false);
            load();
          }}
        />
      )}

      {loadState === "loading" && (
        <div className="space-y-2 mt-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent mt-4">
          Unable to load announcements. Please try again.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted mt-4">
          No announcements have been posted yet.
        </div>
      )}

      {loadState === "ready" && (
        <div className="mt-4 bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {announcements.map((a) => (
            <div key={a.id} className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  {!a.isActive && (
                    <span className="text-[10px] uppercase tracking-wide font-medium text-muted bg-black/[0.04] rounded-full px-2 py-0.5 shrink-0">
                      {new Date(a.publishDate) > new Date() ? "Scheduled" : "Expired"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted truncate">
                  {a.audienceType === "EVERYONE" ? "Everyone" : a.audienceLabel} · Posted{" "}
                  {formatAnnouncementDate(a.publishDate)} · {a.authorName}
                </p>
              </div>
              <button
                onClick={() => removeAnnouncement(a.id)}
                disabled={busyId === a.id}
                aria-label={`Delete "${a.title}"`}
                className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {busyId === a.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeAnnouncementForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
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

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/announcements/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          message,
          expirationDate: expirationDate || undefined,
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

      <div className="grid grid-cols-2 gap-3">
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
        <div>
          <label className="block text-sm font-medium mb-1.5">Expires (optional)</label>
          <input
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
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
