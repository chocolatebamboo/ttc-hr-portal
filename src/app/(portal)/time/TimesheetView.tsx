"use client";

import { useEffect, useState } from "react";
import type { Month } from "@/lib/month";
import TimesheetCalendar, { type PtoQuickRequestValues } from "@/components/TimesheetCalendar";
import type { CorrectionValues } from "@/components/TimesheetTable";
import PtoStatusPill from "@/components/PtoStatusPill";
import TeamNotesThread from "@/components/TeamNotesThread";
import { ChatIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoRequestDTO, PtoType, TeamNoteTopicCountDTO, TimeEntryDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

const PTO_TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

export default function TimesheetView({ employeeId }: { employeeId: string }) {
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | undefined>();
  // Bumped after a correction is resubmitted so TimesheetCalendar (which now owns which months'
  // entries are loaded) re-fetches everything it already has in memory — see its own comment.
  const [refreshKey, setRefreshKey] = useState(0);

  // TimesheetCalendar decides which months to ask for (it owns the infinite-scroll list); this
  // page only knows how to fetch one, since it's the one that knows the API route.
  async function loadEntriesForMonth(month: Month): Promise<TimeEntryDTO[]> {
    const res = await fetch(`/api/time/timesheet?start=${month.start}&end=${month.end}`);
    if (!res.ok) throw new Error("Failed to load timesheet");
    const data = await res.json();
    return data.entries as TimeEntryDTO[];
  }

  // PTO requests aren't month-scoped on the server (GET /api/pto/requests returns the whole
  // history, same as the old separate Time Off page did) — loaded once on mount and refreshed
  // after any request/cancel, independent of which month the calendar is currently showing.
  // This same state backs both the calendar's day panel AND the "Your requests" list below it,
  // so the two stay in sync without a second fetch.
  const [ptoRequests, setPtoRequests] = useState<PtoRequestDTO[]>([]);
  const [ptoLoadState, setPtoLoadState
