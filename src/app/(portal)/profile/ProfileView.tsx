"use client";

import { useEffect, useState } from "react";
import AvatarEditor from "@/components/AvatarEditor";
import type { EmploymentStatus, MyProfileDTO, Role, UpdateMyProfileInput } from "@/types";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved";
type TabKey = "personal" | "job" | "emergency";

const TABS: { key: TabKey; label: string }[] = [
  { key: "personal", label: "Personal" },
  { key: "job", label: "Job" },
  { key: "emergency", label: "Emergency" },
];

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  SUPERVISOR: "Supervisor",
  EMPLOYEE: "Team Member",
};

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  INACTIVE: "Inactive",
  FORMER_EMPLOYEE: "Former Team Member",
};

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

function formatHireDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Every editable field, kept as one object of plain strings for the form — same "empty string
 *  means clear it" convention updateMyProfile (src/lib/profile.ts) already uses server-side.
 *  Deliberately one shared object rather than per-tab state: Personal and Emergency are two tabs
 *  of the SAME form, so switching tabs never drops an edit, and either tab's Save button submits
 *  everything together (the PATCH endpoint always takes the whole shape anyway). */
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
  const [tab, setTab] = useState<TabKey>("personal");

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
      <div className="max-w-4xl space-y-6">
        <div className="h-40 rounded-2xl border border-border bg-surface animate-pulse" />
        <div className="grid md:grid-cols-[220px_1fr] gap-6">
          <div className="h-48 rounded-2xl border border-border bg-surface animate-pulse" />
          <div className="h-64 rounded-2xl border border-border bg-surface animate-pulse" />
        </div>
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
  const metaLine = [
    profile.employeeCode,
    profile.departmentName,
    profile.role !== "EMPLOYEE" ? ROLE_LABEL[profile.role] : null,
    profile.employmentStatus !== "ACTIVE" ? STATUS_LABEL[profile.employmentStatus] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-4xl">
      <h1 className="page-title text-2xl mb-1">My Profile</h1>
      <p className="text-sm text-muted mb-5">
        Your contact info and photo — keep these current so HR and your team can reach you.
        Everything under Job here is set by HR; contact them for a change.
      </p>

      {/* Banner: identity + tabs, mirroring the reference CB shared. Read-only here (name,
          title, meta) — the photo itself is edited from the Personal tab below, not in the
          banner, so AvatarEditor's controls (styled for a white card) never sit on this
          colored background. */}
      <div className="rounded-2xl overflow-hidden shadow-sm mb-6 bg-accent">
        <div className="px-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex items-start gap-4 flex-wrap">
            <span className="h-16 w-16 rounded-xl bg-white shrink-0 overflow-hidden flex items-center justify-center">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-accent-ink text-lg font-semibold">
                  {initialsOf(profile.firstName, profile.lastName) || "?"}
                </span>
              )}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-serif text-xl sm:text-2xl font-bold text-white truncate">{fullName}</p>
              <p className="text-sm text-white/85">{profile.jobTitle}</p>
              {metaLine && <p className="text-xs text-white/70 mt-0.5">{metaLine}</p>}
            </div>
          </div>

          <div className="flex gap-1 mt-6 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                  tab === t.key ? "bg-surface text-accent-ink" : "text-white/80 hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        <aside className="space-y-6">
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Vitals</h2>
            <dl className="space-y-3 text-sm">
              <VitalRow label="Work email" value={profile.ttcEmail} />
              <VitalRow label="Work phone" value={profile.workPhone} />
              <VitalRow label="Personal phone" value={profile.personalPhone} />
            </dl>
          </div>

          {profile.directReports.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Direct Reports</h2>
              <ul className="space-y-3 text-sm">
                {profile.directReports.map((r) => (
                  <li key={r.id}>
                    <p className="font-medium leading-snug">{r.name}</p>
                    <p className="text-xs text-muted">{r.jobTitle}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <div>
          {tab === "personal" && (
            <form onSubmit={handleSave} className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6">
              <AvatarEditor
                employeeId={profile.id}
                name={fullName}
                avatarUrl={profile.avatarUrl}
                endpoint="/api/profile/photo"
                responseKey="profile"
                onChange={(avatarUrl) => setProfile((p) => (p ? { ...p, avatarUrl } : p))}
              />

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
                  <TextField
                    label="Work phone"
                    value={form.workPhone}
                    onChange={(v) => set("workPhone", v)}
                    type="tel"
                  />
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

              <SaveFooter saveState={saveState} error={error} />
            </form>
          )}

          {tab === "job" && (
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <h2 className="text-sm font-semibold mb-1">Job details</h2>
              <p className="text-xs text-muted mb-4">Set by HR — contact them for a change.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <ReadOnlyField label="Team Member #" value={profile.employeeCode} />
                <ReadOnlyField label="Status" value={STATUS_LABEL[profile.employmentStatus]} />
                <ReadOnlyField label="Job title" value={profile.jobTitle} />
                <ReadOnlyField label="Role" value={ROLE_LABEL[profile.role]} />
                <ReadOnlyField label="Department" value={profile.departmentName ?? "—"} />
                <ReadOnlyField label="Supervisor" value={profile.supervisorName ?? "—"} />
                <ReadOnlyField label="Hire date" value={formatHireDate(profile.hireDate)} />
              </div>
            </div>
          )}

          {tab === "emergency" && (
            <form onSubmit={handleSave} className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6">
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

              <SaveFooter saveState={saveState} error={error} />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function VitalRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate">{value || "—"}</dd>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="block text-sm font-medium mb-1.5">{label}</p>
      <p className="w-full rounded-lg border border-border bg-black/[0.03] px-3 py-2.5 text-base text-muted">
        {value}
      </p>
    </div>
  );
}

function SaveFooter({ saveState, error }: { saveState: SaveState; error: string }) {
  return (
    <>
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
    </>
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
