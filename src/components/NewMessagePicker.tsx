"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon, UserCircleIcon } from "@/components/icons";
import type { DirectoryEntryDTO } from "@/types";

/**
 * CB, Sept 2026: "I should be able to look up members and send them individual messages...
 * have an internal, I guess, conversation there." Reuses the same /api/directory list the
 * Directory page already renders (src/app/(portal)/directory/DirectoryView.tsx) rather than a
 * separate "message search" endpoint — it's already every active employee, already open to any
 * authenticated employee, and this company's small enough that no server-side search is needed
 * (same reasoning DirectoryView's own doc comment gives). `viewerId` is filtered out — you can't
 * start a conversation with yourself (direct-messages.ts's postMessage rejects it server-side
 * too; this just keeps it off the list in the first place).
 */
export default function NewMessagePicker({
  viewerId,
  onPick,
  onClose,
}: {
  viewerId: string;
  onPick: (entry: DirectoryEntryDTO) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<DirectoryEntryDTO[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function load() {
      setLoadState("loading");
      try {
        const res = await fetch("/api/directory");
        if (!res.ok) throw new Error();
        const data: { directory: DirectoryEntryDTO[] } = await res.json();
        setEntries(data.directory.filter((e) => e.id !== viewerId));
        setLoadState("ready");
      } catch {
        setLoadState("error");
      }
    }
    load();
  }, [viewerId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => [e.name, e.jobTitle, e.department ?? ""].some((f) => f.toLowerCase().includes(q)));
  }, [entries, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-sm bg-surface rounded-3xl sm:rounded-2xl p-5 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold mb-3">New message</p>

        <div className="relative mb-3 shrink-0">
          <SearchIcon className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates…"
            className="w-full rounded-full border border-border bg-surface pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="overflow-y-auto -mx-1 px-1">
          {loadState === "loading" && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-black/[0.04] animate-pulse" />
              ))}
            </div>
          )}

          {loadState === "error" && <p className="text-sm text-accent py-2">Unable to load teammates. Please try again.</p>}

          {loadState === "ready" && filtered.length === 0 && (
            <p className="text-sm text-muted py-2">No one matches &ldquo;{query}&rdquo;.</p>
          )}

          {loadState === "ready" && filtered.length > 0 && (
            <div className="divide-y divide-border">
              {filtered.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onPick(entry)}
                  className="w-full flex items-center gap-3 py-2.5 px-1 hover:bg-black/[0.03] rounded-lg text-left"
                >
                  <UserCircleIcon className="h-8 w-8 text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{entry.name}</p>
                    <p className="text-xs text-muted truncate">{entry.jobTitle}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" onClick={onClose} className="btn-neutral text-sm px-4 py-2 mt-4 shrink-0">
          Cancel
        </button>
      </div>
    </div>
  );
}
