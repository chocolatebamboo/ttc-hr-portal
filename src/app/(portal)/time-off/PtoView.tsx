"use client";

import { useEffect, useState } from "react";
import PtoStatusPill from "@/components/PtoStatusPill";
import { PTO_TYPE_LABEL, formatDateRange } from "@/lib/time";
import type { PtoRequestDTO, PtoType } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

const TYPE_OPTIONS: PtoType[] = ["VACATION", "SICK", "PERSONAL", "OTHER_APPROVED_LEAVE"];

export default function PtoView() {
  const [requests, setRequests] = useState<PtoRequestDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/pto/requests");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRequests(data.requests);
      setLoadState(data.requests.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // Fetch-on-mount: no server-rendered initial state for this client widget.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function cancel(id: string) {
    await fetch(`/api/pto/requests/${id}/cancel`, { method: "POST" });
    load();
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title text-2xl">Time Off</h1>
        <button
          onClick={() => setFormOpen((o) => !o)}
          className={formOpen ? "btn-neutral text-sm px-4 py-2" : "btn-primary text-sm px-4 py-2"}
        >
          {formOpen ? "Cancel" : "Request Time Off"}
        </button>
      </div>

      {formOpen && (
        <PtoRequestForm
          onSubmitted={() => {
            setFormOpen(false);
            load();
          }}
        />
      )}

      <h2 className="text-sm font-medium text-muted mb-2 mt-6">Your requests</h2>

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your time-off requests. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          You haven&apos;t requested any time off yet.
        </div>
      )}

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {requests.map((r) => (
            <div key={r.id} className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {PTO_TYPE_LABEL[r.type]} · {formatDateRange(r.startDate, r.endDate)}
                  </p>
                  <p className="text-xs text-muted">{r.hours} hours{r.reason ? ` — ${r.reason}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <PtoStatusPill status={r.status} />
                  {r.status === "PENDING" && (
                    <button onClick={() => cancel(r.id)} className="text-xs text-muted hover:text-accent underline">
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              {r.status === "DENIED" && r.reviewComment && (
                <p className="text-xs text-accent mt-1.5">Denied: {r.reviewComment}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PtoRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [type, setType] = useState<PtoType>("VACATION");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");
    try {
      const res = await fetch("/api/pto/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, startDate, endDate, hours: Number(hours), reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Unable to submit your request. Please try again.");
        return;
      }
      onSubmitted();
    } catch {
      setStatus("error");
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-4 mb-2">
      <div>
        <label className="block text-sm font-medium mb-1.5">Type of leave</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PtoType)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {PTO_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Start date</label>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">End date</label>
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Number of hours</label>
        <input
          type="number"
          required
          min="0.5"
          step="0.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="e.g. 8"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Reason / comment (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {status === "error" && (
        <p role="alert" className="text-sm text-accent">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="btn-primary px-5 py-2.5 text-sm"
      >
        {status === "submitting" ? "Submitting…" : "Submit Request"}
      </button>
    </form>
  );
}
