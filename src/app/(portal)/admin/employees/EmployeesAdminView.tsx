"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import AvatarEditor from "@/components/AvatarEditor";
import type { EmployeeAdminRowDTO, EmploymentStatus, Role } from "@/types";

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

type LoadState = "loading" | "ready" | "error" | "empty";

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Employee",
};
const ROLE_OPTIONS: Role[] = ["EMPLOYEE", "SUPERVISOR", "HR_ADMIN", "SUPER_ADMIN"];

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  INACTIVE: "Inactive",
  FORMER_EMPLOYEE: "Former Employee",
};
const STATUS_OPTIONS: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE", "INACTIVE", "FORMER_EMPLOYEE"];

function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  preferredName: string;
  ttcEmail: string;
  jobTitle: string;
  role: Role;
  employmentStatus: EmploymentStatus;
  departmentName: string;
  supervisorId: string;
  hireDate: string;
  workPhone: string;
  personalPhone: string;
  personalEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
}

function blankValues(): EmployeeFormValues {
  return {
    firstName: "",
    lastName: "",
    preferredName: "",
    ttcEmail: "",
    jobTitle: "",
    role: "EMPLOYEE",
    employmentStatus: "ACTIVE",
    departmentName: "",
    supervisorId: "",
    hireDate: todayDateKey(),
    workPhone: "",
    personalPhone: "",
    personalEmail: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
  };
}

function valuesFromRow(row: EmployeeAdminRowDTO): EmployeeFormValues {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName ?? "",
    ttcEmail: row.ttcEmail,
    jobTitle: row.jobTitle,
    role: row.role,
    employmentStatus: row.employmentStatus,
    departmentName: row.departmentName ?? "",
    supervisorId: row.supervisorId ?? "",
    hireDate: row.hireDate.slice(0, 10),
    workPhone: row.workPhone ?? "",
    personalPhone: row.personalPhone ?? "",
    personalEmail: row.personalEmail ?? "",
    emergencyContactName: row.emergencyContactName ?? "",
    emergencyContactPhone: row.emergencyContactPhone ?? "",
    emergencyContactRelation: row.emergencyContactRelation ?? "",
  };
}

/**
 * The Employees admin page — add, edit, deactivate/reactivate every employee record. Unlike
 * Directory (read-only, active employees only, six safe columns), this is the full HR record
 * for everyone including deactivated accounts, so it's admin-only end to end (page.tsx's guard,
 * every /api/admin/employees route, and prisma/rls.sql's employee_write policy all agree).
 */
export default function EmployeesAdminView({
  currentEmployeeId,
  currentEmployeeRole,
}: {
  currentEmployeeId: string;
  currentEmployeeRole: Role;
}) {
  const [employees, setEmployees] = useState<EmployeeAdminRowDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const router = useRouter();

  const canGrantSuperAdmin = currentEmployeeRole === "SUPER_ADMIN";
  // "View as" is deliberately Super Admin only (see src/lib/preview.ts) — an HR Admin
  // previewing a Supervisor's view isn't a meaningfully different vantage point the way it is
  // for a Super Admin checking what a Mentor/Supervisor sees compared to their own full access.
  const canPreview = currentEmployeeRole === "SUPER_ADMIN";

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/admin/employees");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEmployees(data.employees);
      setLoadState(data.employees.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const departmentNames = useMemo(
    () => [...new Set(employees.map((e) => e.departmentName).filter((n): n is string => !!n))].sort(),
    [employees]
  );
  const activeEmployees = useMemo(() => employees.filter((e) => !e.deactivatedAt), [employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [
        `${e.firstName} ${e.lastName}`,
        e.preferredName ?? "",
        e.ttcEmail,
        e.jobTitle,
        e.departmentName ?? "",
        e.employeeCode,
      ].some((field) => field.toLowerCase().includes(q))
    );
  }, [employees, query]);

  async function submitCreate(values: EmployeeFormValues) {
    setBusyId("__create__");
    setFormError("");
    try {
      const res = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "Unable to add this employee. Please try again.");
        return;
      }
      setAddOpen(false);
      await load();
    } catch {
      setFormError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitEdit(id: string, values: EmployeeFormValues) {
    setBusyId(id);
    setFormError("");
    try {
      const res = await fetch(`/api/admin/employees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? "Unable to save changes. Please try again.");
        return;
      }
      setEditingId(null);
      await load();
    } catch {
      setFormError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  /** Starts a read-only "View as" preview of this employee — see PreviewBanner and
   *  src/lib/preview.ts. Redirecting to /dashboard (rather than just refreshing in place) is
   *  deliberate: this page is admin-only, and the moment the preview takes effect the nav and
   *  every subsequent page render as this employee's role, which for most roles can't reach
   *  this page at all — better to land somewhere every role can see than on a page about to
   *  become inaccessible out from under them. */
  async function viewAs(row: EmployeeAdminRowDTO) {
    setBusyId(row.id);
    setActionError("");
    try {
      const res = await fetch("/api/admin/preview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to start previewing this employee.");
        setBusyId(null);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setActionError("Unable to reach the server. Check your connection and try again.");
      setBusyId(null);
    }
  }

  async function toggleActive(row: EmployeeAdminRowDTO) {
    setBusyId(row.id);
    setActionError("");
    try {
      const action = row.deactivatedAt ? "reactivate" : "deactivate";
      const res = await fetch(`/api/admin/employees/${row.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to complete that action. Please try again.");
        return;
      }
      await load();
    } catch {
      setActionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="page-title text-2xl">Employees</h1>
        <button
          onClick={() => {
            setAddOpen((o) => !o);
            setEditingId(null);
            setFormError("");
          }}
          className={addOpen ? "btn-neutral text-sm px-4 py-2 shrink-0" : "btn-primary text-sm px-4 py-2 shrink-0"}
        >
          {addOpen ? "Cancel" : "Add Employee"}
        </button>
      </div>
      <p className="text-sm text-muted mb-4">
        Every employee record, active and deactivated. Adding someone sends them a real Supabase
        invite email to set their own password — nobody here ever sees or sets it for them.
      </p>

      {addOpen && (
        <div className="mb-5">
          <EmployeeForm
            mode="create"
            initial={blankValues()}
            departmentNames={departmentNames}
            supervisorOptions={activeEmployees}
            excludeSupervisorId={null}
            canGrantSuperAdmin={canGrantSuperAdmin}
            busy={busyId === "__create__"}
            error={formError}
            onCancel={() => setAddOpen(false)}
            onSubmit={submitCreate}
          />
        </div>
      )}

      {actionError && (
        <p className="mb-3 text-sm text-accent" role="alert">
          {actionError}
        </p>
      )}

      {loadState !== "loading" && loadState !== "error" && employees.length > 0 && (
        <div className="relative mb-4">
          <SearchIcon className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees…"
            className="w-full rounded-full border border-border bg-surface pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load employees. Please try again.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No employee records yet.
        </div>
      )}

      {loadState === "ready" && filtered.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No one matches &ldquo;{query}&rdquo;.
        </div>
      )}

      {loadState === "ready" && filtered.length > 0 && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {filtered.map((row) => (
            <div key={row.id} className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {row.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                    <img
                      src={row.avatarUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
                    />
                  ) : (
                    <span className="h-9 w-9 rounded-full bg-accent-ink text-white text-xs font-semibold flex items-center justify-center shrink-0">
                      {initialsOf(row.firstName, row.lastName)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {row.preferredName || row.firstName} {row.lastName}
                      {row.deactivatedAt && (
                        <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-black/5 text-muted">
                          Deactivated
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {row.jobTitle}
                      {row.departmentName ? ` · ${row.departmentName}` : ""}
                      {row.role !== "EMPLOYEE" ? ` · ${ROLE_LABEL[row.role]}` : ""}
                      {row.employmentStatus !== "ACTIVE" ? ` · ${STATUS_LABEL[row.employmentStatus]}` : ""}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {row.ttcEmail} · {row.employeeCode}
                      {row.supervisorName ? ` · reports to ${row.supervisorName}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canPreview && row.id !== currentEmployeeId && !row.deactivatedAt && (
                    <button
                      onClick={() => viewAs(row)}
                      disabled={busyId === row.id}
                      title="See exactly what this employee sees — read-only, you can exit any time"
                      className="btn-neutral text-xs px-3 py-1.5"
                    >
                      View as
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingId(editingId === row.id ? null : row.id);
                      setAddOpen(false);
                      setFormError("");
                    }}
                    disabled={busyId === row.id}
                    className="btn-neutral text-xs px-3 py-1.5"
                  >
                    {editingId === row.id ? "Cancel" : "Edit"}
                  </button>
                  <button
                    onClick={() => toggleActive(row)}
                    disabled={busyId === row.id || row.id === currentEmployeeId}
                    title={row.id === currentEmployeeId ? "You can't deactivate your own account." : undefined}
                    className="btn-neutral text-xs px-3 py-1.5"
                  >
                    {busyId === row.id
                      ? "Working…"
                      : row.deactivatedAt
                        ? "Reactivate"
                        : "Deactivate"}
                  </button>
                </div>
              </div>

              {editingId === row.id && (
                <div className="mt-3">
                  <EmployeeForm
                    mode="edit"
                    initial={valuesFromRow(row)}
                    photo={{
                      employeeId: row.id,
                      name: `${row.firstName} ${row.lastName}`,
                      avatarUrl: row.avatarUrl,
                      onChange: load,
                    }}
                    departmentNames={departmentNames}
                    supervisorOptions={activeEmployees}
                    excludeSupervisorId={row.id}
                    canGrantSuperAdmin={canGrantSuperAdmin}
                    busy={busyId === row.id}
                    error={formError}
                    roleLockReason={
                      row.id === currentEmployeeId
                        ? "You can't change your own admin access — ask another admin to do it."
                        : row.role === "SUPER_ADMIN" && !canGrantSuperAdmin
                          ? "Only a Super Admin can change another Super Admin's role."
                          : null
                    }
                    onCancel={() => setEditingId(null)}
                    onSubmit={(values) => submitEdit(row.id, values)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeForm({
  mode,
  initial,
  photo,
  departmentNames,
  supervisorOptions,
  excludeSupervisorId,
  canGrantSuperAdmin,
  roleLockReason = null,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: EmployeeFormValues;
  /** Only present in edit mode — the photo control needs a real employee id to upload
   *  against, so there's nowhere for it to live on the create form until the record exists. */
  photo?: { employeeId: string; name: string; avatarUrl: string | null; onChange: () => void };
  departmentNames: string[];
  supervisorOptions: EmployeeAdminRowDTO[];
  excludeSupervisorId: string | null;
  canGrantSuperAdmin: boolean;
  /** Non-null disables the Role field entirely, with this message shown underneath — either
   *  "this is your own row" or "this row is already a Super Admin and you aren't one". */
  roleLockReason?: string | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (values: EmployeeFormValues) => void;
}) {
  const [values, setValues] = useState(initial);

  function set<K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // The row's CURRENT role always stays a selectable option even if canGrantSuperAdmin is
  // false — otherwise editing an existing Super Admin as an HR Admin would silently drop
  // their role out of the dropdown's option list. roleLockReason is what actually prevents a
  // change in that case, not hiding the option.
  const roleOptions = ROLE_OPTIONS.filter((r) => r !== "SUPER_ADMIN" || canGrantSuperAdmin || r === initial.role);
  const supervisorChoices = supervisorOptions.filter((e) => e.id !== excludeSupervisorId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-black/[0.02] border border-border rounded-xl p-4 space-y-3.5">
      {photo && (
        <AvatarEditor
          employeeId={photo.employeeId}
          name={photo.name}
          avatarUrl={photo.avatarUrl}
          onChange={photo.onChange}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="First name" required value={values.firstName} onChange={(v) => set("firstName", v)} />
        <TextField label="Last name" required value={values.lastName} onChange={(v) => set("lastName", v)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Preferred name" value={values.preferredName} onChange={(v) => set("preferredName", v)} />
        <TextField label="Job title" required value={values.jobTitle} onChange={(v) => set("jobTitle", v)} />
      </div>

      {mode === "create" ? (
        <TextField
          label="Email"
          required
          type="email"
          value={values.ttcEmail}
          onChange={(v) => set("ttcEmail", v)}
          hint="A real invite email goes here as soon as this is submitted."
        />
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1.5">Email</label>
          <p className="text-sm text-muted rounded-lg border border-border bg-background px-3 py-2">
            {values.ttcEmail}
          </p>
          <p className="text-xs text-muted mt-1">
            Not editable here — changing a login email also means updating their Supabase Auth
            account to match.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Role</label>
          <select
            value={values.role}
            onChange={(e) => set("role", e.target.value as Role)}
            disabled={!!roleLockReason}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {roleLockReason ? (
            <p className="text-xs text-muted mt-1">{roleLockReason}</p>
          ) : (
            !canGrantSuperAdmin && (
              <p className="text-xs text-muted mt-1">Only a Super Admin can grant the Super Admin role.</p>
            )
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Employment status</label>
          <select
            value={values.employmentStatus}
            onChange={(e) => set("employmentStatus", e.target.value as EmploymentStatus)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Department</label>
          <input
            list="department-suggestions"
            value={values.departmentName}
            onChange={(e) => set("departmentName", e.target.value)}
            placeholder="Type an existing or new department…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <datalist id="department-suggestions">
            {departmentNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Supervisor</label>
          <select
            value={values.supervisorId}
            onChange={(e) => set("supervisorId", e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">— None —</option>
            {supervisorChoices.map((e) => (
              <option key={e.id} value={e.id}>
                {e.preferredName || e.firstName} {e.lastName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TextField label="Hire date" required type="date" value={values.hireDate} onChange={(v) => set("hireDate", v)} />

      <div className="border-t border-border pt-3.5">
        <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2.5">
          Contact &amp; emergency (optional)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <TextField label="Work phone" value={values.workPhone} onChange={(v) => set("workPhone", v)} />
          <TextField label="Personal phone" value={values.personalPhone} onChange={(v) => set("personalPhone", v)} />
        </div>
        <TextField
          label="Personal email"
          type="email"
          value={values.personalEmail}
          onChange={(v) => set("personalEmail", v)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <TextField
            label="Emergency contact name"
            value={values.emergencyContactName}
            onChange={(v) => set("emergencyContactName", v)}
          />
          <TextField
            label="Emergency contact phone"
            value={values.emergencyContactPhone}
            onChange={(v) => set("emergencyContactPhone", v)}
          />
          <TextField
            label="Relationship"
            value={values.emergencyContactRelation}
            onChange={(v) => set("emergencyContactRelation", v)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary text-sm px-5 py-2">
          {busy ? "Saving…" : mode === "create" ? "Add Employee" : "Save Changes"}
        </button>
        <button type="button" onClick={onCancel} className="btn-neutral text-sm px-5 py-2">
          Cancel
        </button>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">
        {label}
        {required ? "" : " (optional)"}
      </label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
      />
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}
