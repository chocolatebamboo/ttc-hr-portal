"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import type { DirectReportDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

export default function TeamListView() {
  const [reports, setReports] = useState<DirectReportDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    fetch("/api/team/reports")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setReports(data.reports);
        setLoadState(data.reports.length === 0 ? "empty" : "ready");
      })
      .catch(() => setLoadState("error"));
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">My Team</h1>
      <p className="text-sm text-muted mb-5">Review and approve timesheets for the people you supervise.</p>

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your team. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No one is currently assigned to you as their supervisor.
        </div>
      )}

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {reports.map((r) => (
            <Link
              key={r.id}
              href={`/team/${r.id}`}
              className="flex items-center justify-between px-4 py-3.5 hover:bg-black/[0.02]"
            >
              <div>
                <p className="text-sm font-medium">
                  {r.preferredName || r.firstName} {r.lastName}
                </p>
                <p className="text-xs text-muted">{r.jobTitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {r.awaitingApprovalCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
                    {r.awaitingApprovalCount} timesheet{r.awaitingApprovalCount === 1 ? "" : "s"}
                  </span>
                )}
                {r.pendingPtoCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
                    {r.pendingPtoCount} PTO
                  </span>
                )}
                <ChevronRightIcon className="h-4 w-4 text-muted" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
