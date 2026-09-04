"use client";

import { useEffect, useState } from "react";
import AvatarEditor from "@/components/AvatarEditor";
import type { EmploymentStatus, MyProfileDTO, Role, UpdateMyProfileInput } from "@/types";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved";

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Employee",
};

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  INACTIVE: "Inactive",
  FORMER_EMPLOYEE: "Former Employee",
};

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

function formatHireDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Every editable field, kept as one object of plain strings for the form — same "empty string
 *  means clear it" convention updateMyProfile (src/lib/profile.ts) already uses server-side. */
type FormValues = {
  preferredName: string;
  workPhone: string;
  personalPhone: string;
  personalEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
};

function toFormValues(p: MyProfileDTO): FormValues {
  return {
    preferredName: p.preferredName ?? "",
    workPhone: p.workPhone ?? "",
    personalPhone: p.personalPhone ?? "",
    personalEmail: p.personalEmail ?? "",
    emergencyContactName: p.emergencyContactName ?? "",
    emergencyContactPhone: p.emergencyContactPhone ?? "",
    emergencyContactRelation: p.emergencyContactRelation ?? "",
  };
}

export default function ProfileView() {
  const [profile, setProfile] = useState<MyProfileDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [form, setForm] = useState<FormValues | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProfile(data.profile);
      setForm(toFormValues(data.profile));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaveState("idle");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveState("saving");
    setError("");
    try {
      const body: UpdateMyProfileInput = { ...form };
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to save your changes. Please try again.");
        setSaveState("idle");
        return;
      }
      setProfile(data.profile);
      setForm(toFormValues(data.profile));
      setSaveState("saved");
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
      setSaveState("idle");
    }
  }

  if (loadState === "loading") {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="h-28 rounded-2xl border border-border bg-surface animate-pulse" />
        <div className="h-64 rounded-2xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  if (loadState === "error" || !profile || !form) {
    return (
      <div className="max-w-2xl rounded-xl border border-border bg-surface p-6 text-sm text-accent">
        Unable to load your profile. Please try again or contact HR.
      </div>
    );
  }

  const fullName = `${profile.preferredName || profile.firstName} ${profile.lastName}`;

  return (
    <div className="max-w-2xl">
      <h1 className="page-title text-2xl mb-1">My Profile</h1>
      <p className="text-sm text-muted mb-5">
        Your contact info and photo — keep these current so HR and your team can reach you.
        Everything else here (name, title, department, role) is set by HR; contact them for a
        change.
      </p>

      {/* Header card: photo + identity, all read-only except the photo itself. */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm mb-6">
        <div className="flex items-start gap-4 flex-wrap">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
            <img
              src={profile.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover border border-border shrink-0"
            />
          ) : (
            <span className="h-16 w-16 rounded-full bg-accent-ink text-white text-lg font-semibold flex items-center justify-center shrink-0">
              {initialsOf(profile.firstName, profile.lastName) || "?"}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-lg font-semibold truncate">{fullName}</p>
            <p className="text-sm text-muted">{profile.jobTitle}</p>
            <p className="text-xs text-muted mt-1">
              {profile.employeeCode}
              {profile.departmentName ? ` · ${profile.departmentName}` : ""}
              {profile.role !== "EMPLOYEE" ? ` · ${ROLE_LABEL[profile.role]}` : ""}
              {profile.employmentStatus !== "ACTIVE" ? ` · ${STATUS_LABEL[profile.employmentStatus]}` : ""}
            </p>
            <p className="text-xs text-muted mt-1">
              Hired {formatHireDate(profile.hireDate)}
              {profile.supervisorName ? ` · Reports to ${profile.supervisorName}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-border">
          <AvatarEditor
            employeeId={profile.id}
            name={fullName}
            avatarUrl={profile.avatarUrl}
            endpoint="/api/profile/photo"
            responseKey="profile"
            onChange={(avatarUrl) => setProfile((p) => (p ? { ...p, avatarUrl } : p))}
          />
        </div>
      </div>

      <form onSubmit={handleSave} className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6">
        <div>
          <h2 className="text-sm font-semibold mb-3">Contact info</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label="Preferred name"
              value={form.preferredName}
              onChange={(v) => set("preferredName", v)}
              placeholder={profile.firstName}
            />
            <TextField label="Work email" value={profile.ttcEmail} readOnly />
            <TextField label="Work phone" value={form.workPhone} onChange={(v) => set("workPhone", v)} type="tel" />
            <TextField
              label="Personal phone"
              value={form.personalPhone}
              onChange={(v) => set("personalPhone", v)}
              type="tel"
            />
            <TextField
              label="Personal email"
              value={form.personalEmail}
              onChange={(v) => set("personalEmail", v)}
              type="email"
            />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-3">Emergency contact</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label="Name"
              value={form.emergencyContactName}
              onChange={(v) => set("emergencyContactName", v)}
            />
            <TextField
              label="Phone"
              value={form.emergencyContactPhone}
              onChange={(v) => set("emergencyContactPhone", v)}
              type="tel"
            />
            <TextField
              label="Relationship"
              value={form.emergencyContactRelation}
              onChange={(v) => set("emergencyContactRelation", v)}
              placeholder="e.g. Spouse, Parent"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saveState === "saving"} className="btn-primary text-sm px-5 py-2">
            {saveState === "saving" ? "Saving…" : "Save changes"}
          </button>
          {saveState === "saved" && <span className="text-sm text-emerald-700">Saved.</span>}
        </div>
      </form>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={
          readOnly
            ? "w-full rounded-lg border border-border bg-black/[0.03] px-3 py-2.5 text-base text-muted outline-none"
            : "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        }
      />
    </div>
  );
}
