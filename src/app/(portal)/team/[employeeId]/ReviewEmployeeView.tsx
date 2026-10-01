"use client";

import { useState } from "react";
import TeamNotesThread from "@/components/TeamNotesThread";
import ReviewTimesheetView from "./ReviewTimesheetView";
import TeamPtoSection from "./TeamPtoSection";
import TeamAvailabilitySection from "./TeamAvailabilitySection";

type TabKey = "timesheet" | "timeoff" | "availability" | "notes";

const TABS: { key: TabKey; label: string }[] = [
  { key: "timesheet", label: "Timesheet" },
  { key: "timeoff", label: "Time Off" },
  { key: "availability", label: "Availability" },
  { key: "notes", label: "Notes" },
];

// Same local-copy convention every other consumer of "initials from a name" already follows in
// this app (see TeamScheduleGlance.tsx's own doc comment on this exact choice, there for an RSC
// boundary reason) — kept local here too for consistency, even though this file itself is
// already a client component, so nothing about where initialsOf lives needs to change if a
// future edit moves pieces of this view back onto the server.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * Oct 2026 (CB, circling this whole page: "it's too wordy... I want it to be widgetized and I
 * want it to be clean"): Timesheet, Time Off, Availability, and Notes are each already a real,
 * separate widget — ReviewTimesheetView / TeamPtoSection / TeamAvailabilitySection /
 * TeamNotesThread, each with its own card chrome and its own load/empty/error states — but
 * page.tsx used to render all four stacked top to bottom under a plain text label, so a
 * supervisor who opened this page to approve one pending timesheet scrolled past three other
 * widgets' worth of content to get there, every time. This view shows exactly one of the four
 * at a time, picked from the tab row in the banner below.
 *
 * The banner itself is the same shell as ProfileView.tsx's own identity card (that file's own
 * doc comment: "mirroring the reference CB shared") — reused here rather than invented fresh, so
 * a supervisor reviewing a team member's page and an employee editing their own Profile page see
 * the same visual language for "here's a person, here are the things about them." Unlike
 * ProfileView's tabs, which all edit one shared form (see that file's own doc comment on why),
 * these four tabs are fully independent widgets with their own state — switching tabs here never
 * risks losing an edit, since there's nothing shared across tabs to lose. Each widget simply
 * mounts fresh the moment its tab is selected, the same fetch-on-mount behavior it already had
 * when every widget rendered at once; the only thing that changed is how many are mounted at a
 * time.
 */
export default function ReviewEmployeeView({
  employeeId,
  employeeName,
  jobTitle,
  avatarUrl,
  viewerId,
}: {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  avatarUrl: string | null;
  viewerId: string;
}) {
  const [tab, setTab] = useState<TabKey>("timesheet");

  return (
    <div>
      <div className="rounded-2xl overflow-hidden shadow-sm mb-6 bg-accent">
        <div className="px-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex items-start gap-4 flex-wrap">
            <span className="h-16 w-16 rounded-xl bg-white shrink-0 overflow-hidden flex items-center justify-center">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-accent-ink text-lg font-semibold">
                  {initialsOf(employeeName) || "?"}
                </span>
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-serif text-xl sm:text-2xl font-bold text-white truncate">{employeeName}</p>
              <p className="text-sm text-white/85">{jobTitle}</p>
            </div>
          </div>

          <div className="flex gap-1 mt-6 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                  tab === t.key ? "bg-surface text-accent-ink" : "text-white/80 hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "timesheet" && <ReviewTimesheetView employeeId={employeeId} />}
      {tab === "timeoff" && <TeamPtoSection employeeId={employeeId} />}
      {tab === "availability" && <TeamAvailabilitySection employeeId={employeeId} />}
      {/* CB, Sept 2026: "say I accept it, then I would be able to, like, add notes, add
          documents... so we could communicate through there." Same thread whichever side you
          view it from — this employee, reviewing it here, sees the exact messages the person
          themselves sees on their own /notes page. */}
      {tab === "notes" && <TeamNotesThread employeeId={employeeId} viewerId={viewerId} />}
    </div>
  );
}
