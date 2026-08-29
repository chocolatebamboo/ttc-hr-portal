"use client";

import { useEffect, useState } from "react";
import {
  CheckCircleIcon,
  ChecklistIcon,
  FolderIcon,
  GraduationCapIcon,
  UsersIcon,
  LockIcon,
} from "@/components/icons";
import type {
  DocumentAdminSummaryDTO,
  EmployeeOnboardingDTO,
  OnboardingAdminSummaryDTO,
  OnboardingItemDTO,
  OnboardingItemType,
} from "@/types";

type LoadState = "loading" | "ready" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TYPE_ICON: Record<OnboardingItemType, (props: { className?: string }) => React.ReactElement> = {
  TASK: ChecklistIcon,
  DOCUMENT: FolderIcon,
  TRAINING: GraduationCapIcon,
  MEETING: UsersIcon,
};

const TYPE_LABEL: Record<OnboardingItemType, string> = {
  TASK: "Task",
  DOCUMENT: "Document",
  TRAINING: "Training",
  MEETING: "Meeting",
};

// "What happens after" copy for the current-step card — answers the second of the three
// questions this redesign is built around, without the employee having to guess or ask HR.
const AFTER_COPY: Record<OnboardingItemType, string> = {
  TASK: "This finishes the moment you check it off — the next step unlocks right away.",
  DOCUMENT:
    "Once you acknowledge this document, it goes to HR or your supervisor for approval before the next step unlocks.",
  TRAINING: "Once you mark this done, it goes to HR or your supervisor for approval before the next step unlocks.",
  MEETING: "Once you confirm this happened, it goes to HR or your supervisor for approval before the next step unlocks.",
};

/** Same two-tab pattern as the Documents page: one route, "My Onboarding" for everyone and a
 *  "Manage" tab admins/supervisors also get, since both views are the same underlying
 *  checklist concept. `canStart` is narrower than `canManage` — only HR/Super Admin may start
 *  a brand-new checklist; a supervisor can review one already in progress but shouldn't be the
 *  one kicking off a new hire's record. */
export default function OnboardingView({ canManage, canStart }: { canManage: boolean; canStart: boolean }) {
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

      {tab === "mine" ? <MyOnboarding /> : <AdminOnboardingPanel canStart={canStart} />}
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

function StatusBadge({ item }: { item: OnboardingItemDTO }) {
  if (item.locked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-black/5 text-muted">
        <LockIcon className="h-3 w-3" /> Locked
      </span>
    );
  }
  switch (item.status) {
    case "COMPLETED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800">
          <CheckCircleIcon className="h-3 w-3" /> Completed
        </span>
      );
    case "AWAITING_APPROVAL":
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
          Awaiting approval
        </span>
      );
    case "RETURNED":
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-100 text-rose-800">
          Needs attention
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
          Up next
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Employee-facing: My Onboarding (guided, one-step-at-a-time)
// ---------------------------------------------------------------------------

function MyOnboarding() {
  const [onboarding, setOnboarding] = useState<EmployeeOnboardingDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

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

  async function advance(itemId: string) {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/advance`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to update this step. Please try again.");
        return;
      }
      await load();
    } catch {
      setActionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
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
  const currentItem = onboarding.items.find((i) => i.id === onboarding.currentItemId) ?? null;

  return (
    <div>
      {onboarding.completedAt ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 mb-5">
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
          Onboarding complete — nice work!
        </div>
      ) : (
        <p className="text-sm text-muted mb-4">
          Step {completedCount + 1} of {onboarding.items.length}
        </p>
      )}

      {currentItem && (
        <CurrentStepCard item={currentItem} busy={busy} error={actionError} onAdvance={() => advance(currentItem.id)} />
      )}

      <h2 className="text-sm font-medium text-muted mb-2 mt-5">All steps</h2>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {onboarding.items.map((item) => {
          const Icon = TYPE_ICON[item.itemType];
          const isCurrent = item.id === onboarding.currentItemId;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-4 py-3 ${item.locked ? "opacity-50" : ""} ${
                isCurrent ? "bg-black/[0.02]" : ""
              }`}
            >
              <Icon className="h-4 w-4 text-muted shrink-0" />
              <p className={`text-sm min-w-0 flex-1 truncate ${item.status === "COMPLETED" ? "text-muted line-through" : "text-foreground"}`}>
                {item.label}
              </p>
              <StatusBadge item={item} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentStepCard({
  item,
  busy,
  error,
  onAdvance,
}: {
  item: OnboardingItemDTO;
  busy: boolean;
  error: string;
  onAdvance: () => void;
}) {
  const Icon = TYPE_ICON[item.itemType];
  const [viewError, setViewError] = useState("");

  async function viewDocument() {
    if (!item.documentId) return;
    setViewError("");
    try {
      const res = await fetch(`/api/documents/${item.documentId}/download`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setViewError(data.error ?? "Unable to open that document right now.");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setViewError("Unable to reach the server. Check your connection and try again.");
    }
  }

  return (
    <div className="rounded-2xl border-2 border-accent/25 bg-surface p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-accent-ink uppercase tracking-wide mb-2">
        <Icon className="h-3.5 w-3.5" />
        {TYPE_LABEL[item.itemType]} · What you need to do right now
      </div>
      <p className="text-base font-semibold mb-1">{item.label}</p>
      {item.description && <p className="text-sm text-muted mb-3">{item.description}</p>}
      {item.dueDate && <p className="text-xs text-muted mb-3">Due {formatDate(item.dueDate)}</p>}

      {item.status === "RETURNED" && item.returnReason && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-sm text-rose-800 mb-3.5">
          <p className="font-medium mb-0.5">This was sent back</p>
          <p>{item.returnReason}</p>
        </div>
      )}

      {item.status === "AWAITING_APPROVAL" ? (
        <p className="text-sm text-muted">
          Submitted — waiting on HR or your supervisor to approve this step. You&apos;ll see the next
          step here as soon as it&apos;s approved.
        </p>
      ) : (
        <>
          {item.itemType === "DOCUMENT" && (
            <div className="mb-3">
              <button type="button" onClick={viewDocument} className="text-sm text-accent-ink font-medium hover:underline">
                View {item.documentTitle ?? "document"} →
              </button>
              {viewError && <p className="text-xs text-accent mt-1">{viewError}</p>}
            </div>
          )}

          <button onClick={onAdvance} disabled={busy} className="btn-primary text-sm px-5 py-2.5">
            {busy
              ? "Working…"
              : item.itemType === "TASK"
                ? "Mark Complete"
                : item.itemType === "DOCUMENT"
                  ? item.status === "RETURNED"
                    ? "Acknowledge & Resubmit"
                    : "Acknowledge & Submit"
                  : item.status === "RETURNED"
                    ? "Resubmit"
                    : item.itemType === "MEETING"
                      ? "Confirm It Happened"
                      : "Mark as Done"}
          </button>

          {item.itemType === "DOCUMENT" && (
            <p className="text-xs text-muted mt-2">
              Clicking this confirms you&apos;ve read the document — it&apos;s a record for HR, not a
              legal electronic signature.
            </p>
          )}
          {item.requiresApproval && item.itemType !== "DOCUMENT" && (
            <p className="text-xs text-muted mt-2">{AFTER_COPY[item.itemType]}</p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-accent mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin / Supervisor: Manage
// ---------------------------------------------------------------------------

function AdminOnboardingPanel({ canStart }: { canStart: boolean }) {
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
        {canStart
          ? "Start a new hire's checklist, or manage one already in progress — approve or send back a step, and add more as needed."
          : "Review your direct reports' onboarding — approve or send back a step awaiting your approval."}
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

      {loadState === "ready" && roster.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          {canStart ? "No active employees yet." : "You don't have any direct reports yet."}
        </div>
      )}

      {loadState === "ready" && roster.length > 0 && (
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
                  <div className="flex items-center gap-2 shrink-0">
                    {row.awaitingApprovalCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
                        {row.awaitingApprovalCount} awaiting your approval
                      </span>
                    )}
                    {started ? (
                      <button
                        onClick={() => setSelectedEmployeeId(isSelected ? null : row.employeeId)}
                        aria-label={`${isSelected ? "Close" : "Manage"} ${row.employeeName}'s checklist`}
                        className="btn-neutral text-xs px-3 py-1.5"
                      >
                        {isSelected ? "Close" : "Manage"}
                      </button>
                    ) : canStart ? (
                      <button
                        onClick={() => startChecklist(row.employeeId)}
                        disabled={startingId === row.employeeId}
                        aria-label={`Start ${row.employeeName}'s checklist`}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        {startingId === row.employeeId ? "Starting…" : "Start Checklist"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted">Not started</span>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <div className="px-4 pb-4">
                    <EmployeeChecklistDetail employeeId={row.employeeId} canAddItems={canStart} onChanged={loadRoster} />
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

function EmployeeChecklistDetail({
  employeeId,
  canAddItems,
  onChanged,
}: {
  employeeId: string;
  canAddItems: boolean;
  onChanged: () => void;
}) {
  const [onboarding, setOnboarding] = useState<EmployeeOnboardingDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [actionError, setActionError] = useState("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the selected employee changes
  }, [employeeId]);

  async function toggleTask(itemId: string) {
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/advance`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError(data.error ?? "Unable to update this step.");
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  async function approve(itemId: string) {
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/approve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError(data.error ?? "Unable to approve this step.");
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  async function submitReturn(itemId: string) {
    if (!returnReason.trim()) return;
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: returnReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to return this step.");
      } else {
        setReturningId(null);
        setReturnReason("");
      }
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
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
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      {actionError && (
        <p role="alert" className="text-sm text-accent">
          {actionError}
        </p>
      )}

      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {onboarding.items.map((item) => {
          const Icon = TYPE_ICON[item.itemType];
          const busy = busyItemId === item.id;
          return (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${item.status === "COMPLETED" ? "text-muted line-through" : "text-foreground"}`}>
                    {item.label}
                  </p>
                  {item.status === "RETURNED" && item.returnReason && (
                    <p className="text-xs text-rose-700 mt-0.5">Returned: {item.returnReason}</p>
                  )}
                </div>
                <StatusBadge item={item} />
                {!item.locked && item.itemType === "TASK" && (
                  <button
                    onClick={() => toggleTask(item.id)}
                    disabled={busy}
                    className="btn-neutral text-xs px-2.5 py-1 shrink-0"
                  >
                    {item.status === "COMPLETED" ? "Undo" : "Mark Done"}
                  </button>
                )}
                {!item.locked && item.status === "AWAITING_APPROVAL" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => approve(item.id)} disabled={busy} className="btn-primary text-xs px-2.5 py-1">
                      Approve
                    </button>
                    <button
                      onClick={() => setReturningId(returningId === item.id ? null : item.id)}
                      disabled={busy}
                      className="btn-neutral text-xs px-2.5 py-1"
                    >
                      Return
                    </button>
                  </div>
                )}
              </div>
              {returningId === item.id && (
                <div className="mt-2.5 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="Why is this being sent back?"
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={() => submitReturn(item.id)}
                    disabled={busy || !returnReason.trim()}
                    className="btn-neutral text-xs px-3 py-1.5 whitespace-nowrap"
                  >
                    Send Back
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canAddItems && (
        <AddItemForm
          employeeId={employeeId}
          onboardingId={onboarding.id}
          onAdded={() => {
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function AddItemForm({
  employeeId,
  onboardingId,
  onAdded,
}: {
  employeeId: string;
  onboardingId: string;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("");
  const [itemType, setItemType] = useState<OnboardingItemType>("TASK");
  const [documentId, setDocumentId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [documents, setDocuments] = useState<DocumentAdminSummaryDTO[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (itemType !== "DOCUMENT" || documents.length > 0) return;
    fetch("/api/documents/manage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setDocuments(data.documents.filter((d: DocumentAdminSummaryDTO) => !d.archivedAt));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once, the first time Document is selected
  }, [itemType]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    if (itemType === "DOCUMENT" && !documentId) {
      setError("Choose a document for this step.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`/api/onboarding/manage/${employeeId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingId,
          label,
          itemType,
          documentId: itemType === "DOCUMENT" ? documentId : undefined,
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to add this step.");
        return;
      }
      setLabel("");
      setItemType("TASK");
      setDocumentId("");
      setDueDate("");
      onAdded();
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={addItem} className="space-y-2 pt-1">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a step…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={itemType}
          onChange={(e) => setItemType(e.target.value as OnboardingItemType)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="TASK">Task</option>
          <option value="DOCUMENT">Document</option>
          <option value="TRAINING">Training</option>
          <option value="MEETING">Meeting</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <button type="submit" disabled={adding} className="btn-neutral text-sm px-4 py-2 whitespace-nowrap">
          {adding ? "Adding…" : "Add Step"}
        </button>
      </div>
      {itemType === "DOCUMENT" && (
        <select
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">— Choose a document —</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}
    </form>
  );
}
