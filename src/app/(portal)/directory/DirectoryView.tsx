"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon, MailIcon, PhoneIcon, UserCircleIcon } from "@/components/icons";
import type { DirectoryEntryDTO, Role } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Team Member",
};

/**
 * Every active team member, searchable client-side — a company this size (see the eligible-count
 * math on the Documents Manage tab, capped at a few dozen people) doesn't need server-side
 * pagination, and a directory people actually use should feel instant while typing.
 */
export default function DirectoryView() {
  const [entries, setEntries] = useState<DirectoryEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function load() {
      setLoadState("loading");
      try {
        const res = await fetch("/api/directory");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setEntries(data.directory);
        setLoadState(data.directory.length === 0 ? "empty" : "ready");
      } catch {
        setLoadState("error");
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.name, e.jobTitle, e.department ?? "", e.email].some((field) => field.toLowerCase().includes(q))
    );
  }, [entries, query]);

  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-1">Directory</h1>
      <p className="text-sm text-muted mb-4">Everyone currently at TTC — search by name, title, or department.</p>

      {loadState !== "loading" && loadState !== "error" && (
        <div className="relative mb-4">
          <SearchIcon className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the directory…"
            className="w-full rounded-full border border-border bg-surface pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load the directory. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No team members to show yet.
        </div>
      )}

      {loadState === "ready" && filtered.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No one matches &ldquo;{query}&rdquo;.
        </div>
      )}

      {loadState === "ready" && filtered.length > 0 && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {filtered.map((entry) => (
            <div key={entry.id} className="px-4 py-3.5 flex items-center gap-3">
              <UserCircleIcon className="h-9 w-9 text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{entry.name}</p>
                <p className="text-xs text-muted truncate">
                  {entry.jobTitle}
                  {entry.department ? ` · ${entry.department}` : ""}
                  {entry.role !== "EMPLOYEE" ? ` · ${ROLE_LABEL[entry.role]}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={`mailto:${entry.email}`}
                  aria-label={`Email ${entry.name}`}
                  className="btn-neutral text-xs px-2.5 py-1.5 flex items-center gap-1"
                >
                  <MailIcon className="h-3.5 w-3.5" />
                </a>
                {entry.workPhone && (
                  <a
                    href={`tel:${entry.workPhone}`}
                    aria-label={`Call ${entry.name}`}
                    className="btn-neutral text-xs px-2.5 py-1.5 flex items-center gap-1"
                  >
                    <PhoneIcon className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
