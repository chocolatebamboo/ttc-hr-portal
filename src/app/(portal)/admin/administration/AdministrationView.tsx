"use client";

import { useEffect, useMemo, useState } from "react";
import type { DepartmentAdminRowDTO } from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/**
 * Administration (`/admin/administration`) — department management, the one system-level
 * setting this app actually needs an admin UI for today. Departments already exist as an
 * entity referenced throughout the app (Employee.departmentId, the Attendance/PTO department
 * filters, Document/Announcement targeting); this is where they're managed directly instead
 * of only ever being created implicitly by typing a new name into the Employees form.
 *
 * Deliberately doesn't invent settings nothing else in the app reads yet (a company name, a
 * timezone, a pay-period start day) — those would be decoration with no effect until
 * something actually consumes them. See README.md's Roadmap for what else might land here.
 */
export default function AdministrationView() {
  const [departments, setDepartments] = useState<DepartmentAdminRowDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/departments");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDepartments(data.departments);
      setLoadState(data.departments.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const sorted = useMemo(() => [...departments].sort((a, b) => a.name.localeCompare(b.name)), [departments]);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusyId("__create__");
    setFormError("");
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "Unable to add this department. Please try again.");
        return;
      }
      setNewName("");
      setAddOpen(false);
      await load();
    } catch {
      setFormError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitRename(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id, message: data.error ?? "Unable to rename this department. Please try again." });
        return;
      }
      setEditingId(null);
      await load();
    } catch {
      setRowError({ id, message: "Unable to reach the server. Check your connection and try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(dept: DepartmentAdminRowDTO) {
    setBusyId(dept.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/departments/${dept.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id: dept.id, message: data.error ?? "Unable to delete this department. Please try again." });
        return;
      }
      await load();
    } catch {
      setRowError({ id: dept.id, message: "Unable to reach the server. Check your connection and try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="page-title text-2xl mb-4">Administration</h1>

      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold">Departments</h2>
        <button
          onClick={() => {
            setAddOpen((o) => !o);
            setEditingId(null);
            setFormError("");
          }}
          className={addOpen ? "btn-neutral text-sm px-4 py-2 shrink-0" : "btn-primary text-sm px-4 py-2 shrink-0"}
        >
          {addOpen ? "Cancel" : "Add Department"}
        </button>
      </div>
      <p className="text-sm text-muted mb-4">
        Departments used across Employees, Attendance, PTO, Documents, and Announcements.
        Renaming here updates everywhere a department is shown; deleting one only works while
        nothing — no employee, document, or announcement — is still assigned to it.
      </p>

      {addOpen && (
        <form
          onSubmit={submitCreate}
          className="mb-5 bg-black/[0.02] border border-border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-end gap-3"
        >
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium mb-1.5">Department name</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="submit" disabled={busyId === "__create__"} className="btn-primary text-sm px-5 py-2">
              {busyId === "__create__" ? "Adding…" : "Add Department"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false);
                setFormError("");
              }}
              className="btn-neutral text-sm px-5 py-2"
            >
              Cancel
            </button>
          </div>
          {formError && (
            <p role="alert" className="text-sm text-accent w-full">
              {formError}
            </p>
          )}
        </form>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load departments. Please try again.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No departments yet — add one above, or one will be created automatically the first
          time it's typed into the Employees form.
        </div>
      )}

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {sorted.map((dept) => (
            <div key={dept.id} className="px-4 py-3.5">
              {editingId === dept.id ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => submitRename(dept.id)}
                      disabled={busyId === dept.id}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      {busyId === dept.id ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingId(null)} className="btn-neutral text-xs px-3 py-1.5">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{dept.name}</p>
                    <p className="text-xs text-muted truncate">
                      {dept.employeeCount} {dept.employeeCount === 1 ? "employee" : "employees"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(dept.id);
                        setEditName(dept.name);
                        setAddOpen(false);
                        setRowError(null);
                      }}
                      disabled={busyId === dept.id}
                      className="btn-neutral text-xs px-3 py-1.5"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => remove(dept)}
                      disabled={busyId === dept.id || dept.employeeCount > 0}
                      title={
                        dept.employeeCount > 0
                          ? "Reassign every employee in this department before deleting it."
                          : undefined
                      }
                      className="btn-neutral text-xs px-3 py-1.5"
                    >
                      {busyId === dept.id ? "Working…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
              {rowError?.id === dept.id && (
                <p role="alert" className="text-xs text-accent mt-2">
                  {rowError.message}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
