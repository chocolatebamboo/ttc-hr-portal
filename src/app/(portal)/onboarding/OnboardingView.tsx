"use client";

import { useEffect, useState } from "react";
import { CheckCircleIcon } from "@/components/icons";
import type { EmployeeOnboardingDTO, OnboardingAdminSummaryDTO, OnboardingItemDTO } from "@/types";

type LoadState = "loading" | "ready" | "error";

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Same two-tab pattern as the Documents page: one route, "My Onboarding" for everyone and a
 *  "Manage" tab admins also get, since both views are the same underlying checklist concept. */
export default function OnboardingView({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"mine" | "manage">("mine");

  return (
    <div className="max-w-2xl">
      <h1 className="page-title text-2xl mb-4">Onboarding</h1>

      {canManage && (
        <div className="flex gap-1.5 mb-5 border-b border-border">
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
            My Onboarding
          </TabButton>
          <TabButton active={tab === "manage"} onClick={() => setTab("manage")}>
            Manage
          </TabButton>
        </div>
      )}

      {tab === "mine" ? <MyOnboarding /> : <AdminOnboardingPanel />}
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
// Employee-facing: My Onboarding
// ---------------------------------------------------------------------------

function MyOnboarding() {
  const [onboarding, setOnboarding] = useState<EmployeeOnboardingDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/onboarding");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setOnboarding(data.onboarding);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function toggle(itemId: string) {
    setBusyItemId(itemId);
    try {
      await fetch(`/api/onboarding/items/${itemId}/toggle`, { method: "POST" });
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 rounded-xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load your onboarding checklist. Please try again or contact HR.
      </div>
    );
  }

  if (!onboarding) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        Your onboarding checklist hasn&apos;t been set up yet. Check back soon, or ask HR.
      </div>
    );
  }

  const completedCount = onboarding.items.filter((i) => i.status === "COMPLETED").length;

  return (
    <div>
      {onboarding.completedAt ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 mb-4">
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
          Onboarding complete — nice work!
        </div>
      ) : (
        <p className="text-sm text-muted mb-4">
          {completedCount} of {onboarding.items.length} items complete.
        </p>
      )}

      <ChecklistItems items={onboarding.items} busyItemId={busyItemId} onToggle={toggle} />
    </div>
  );
}

function ChecklistItems({
  items,
  busyItemId,
  onToggle,
}: {
  items: OnboardingItemDTO[];
  busyItemId: string | null;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        No checklist items yet.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
      {items.map((item) => {
        const done = item.status === "COMPLETED";
        return (
          <label
            key={item.id}
            className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-black/[0.02] transition-colors"
          >
            <input
              type="checkbox"
              checked={done}
              disabled={busyItemId === item.id}
              onChange={() => onToggle(item.id)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ttc-pink)]"
            />
            <div className="min-w-0">
              <p className={`text-sm ${done ? "text-muted line-through" : "text-foreground"}`}>{item.label}</p>
              {done && item.completedAt ? (
                <p className="text-xs text-muted mt-0.5">Completed {formatDueDate(item.completedAt)}</p>
              ) : item.dueDate ? (
                <p className="text-xs text-muted mt-0.5">Due {formatDueDate(item.dueDate)}</p>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: Manage
// ---------------------------------------------------------------------------

function AdminOnboardingPanel() {
  const [roster, setRoster] = useState<OnboardingAdminSummaryDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  async function loadRoster() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/onboarding/manage");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRoster(data.roster);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRoster();
  }, []);

  async function startChecklist(employeeId: string) {
    setStartingId(employeeId);
    try {
      await fetch(`/api/onboarding/manage/${employeeId}/start`, { method: "POST" });
      await loadRoster();
      setSelectedEmployeeId(employeeId);
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted mb-4">
        Start a new hire&apos;s checklist, or manage an existing one — items check off the same way
        whether the employee does it themselves or you do it for them.
      </p>

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load the employee roster. Please try again.
        </div>
      )}

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {roster.map((row) => {
            const started = row.onboardingId !== null;
            const isSelected = selectedEmployeeId === row.employeeId;
            return (
              <div key={row.employeeId}>
                <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{row.employeeName}</p>
                    <p className="text-xs text-muted">
                      {row.jobTitle}
                      {started ? ` · ${row.completedItems} / ${row.totalItems} complete` : " · Not started"}
                    </p>
                  </div>
                  {started ? (
                    <button
                      onClick={() => setSelectedEmployeeId(isSelected ? null : row.employeeId)}
                      aria-label={`${isSelected ? "Close" : "Manage"} ${row.employeeName}'s checklist`}
                      className="btn-neutral text-xs px-3 py-1.5 shrink-0"
                    >
                      {isSelected ? "Close" : "Manage"}
                    </button>
                  ) : (
                    <button
                      onClick={() => startChecklist(row.employeeId)}
                      disabled={startingId === row.employeeId}
                      aria-label={`Start ${row.employeeName}'s checklist`}
                      className="btn-primary text-xs px-3 py-1.5 shrink-0"
                    >
                      {startingId === row.employeeId ? "Starting…" : "Start Checklist"}
                    </button>
                  )}
                </div>
                {isSelected && (
                  <div className="px-4 pb-4">
                    <EmployeeChecklistDetail employeeId={row.employeeId} onChanged={loadRoster} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmployeeChecklistDetail({ employeeId, onChanged }: { employeeId: string; onChanged: () => void }) {
  const [onboarding, setOnboarding] = useState<EmployeeOnboardingDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/onboarding/manage/${employeeId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setOnboarding(data.onboarding);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the selected employee changes, not on every render `load` is redefined
  }, [employeeId]);

  async function toggle(itemId: string) {
    setBusyItemId(itemId);
    try {
      await fetch(`/api/onboarding/items/${itemId}/toggle`, { method: "POST" });
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!onboarding || !newLabel.trim()) return;
    setAdding(true);
    try {
      await fetch(`/api/onboarding/manage/${employeeId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingId: onboarding.id, label: newLabel, dueDate: newDueDate || undefined }),
      });
      setNewLabel("");
      setNewDueDate("");
      await load();
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  if (loadState === "loading") {
    return <div className="h-24 rounded-xl border border-border bg-background animate-pulse" />;
  }
  if (loadState === "error" || !onboarding) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-sm text-accent">
        Unable to load this checklist.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-4">
      <ChecklistItems items={onboarding.items} busyItemId={busyItemId} onToggle={toggle} />

      <form onSubmit={addItem} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          required
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add a checklist item…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <button type="submit" disabled={adding} className="btn-neutral text-sm px-4 py-2 whitespace-nowrap">
          {adding ? "Adding…" : "Add Item"}
        </button>
      </form>
    </div>
  );
}
