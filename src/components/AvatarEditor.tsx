"use client";

import { useRef, useState } from "react";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
}

/**
 * Photo upload/remove control for one employee's Employee.avatarStorageKey, used from the
 * Employees admin edit form. Only meaningful for an EXISTING employee (needs a real id to
 * upload against) — the create form has nowhere to render this until the record exists.
 * Uploads immediately on file selection rather than waiting for the surrounding form's Save,
 * since a photo isn't part of that form's own field state — it's already saved server-side
 * the moment this succeeds.
 */
export default function AvatarEditor({
  employeeId,
  name,
  avatarUrl,
  onChange,
}: {
  employeeId: string;
  name: string;
  avatarUrl: string | null;
  onChange: (avatarUrl: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/admin/employees/${employeeId}/photo`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to upload that photo. Please try again.");
        return;
      }
      onChange(data.employee.avatarUrl);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/employees/${employeeId}/photo`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to remove that photo. Please try again.");
        return;
      }
      onChange(data.employee.avatarUrl);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">Profile photo</label>
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public storage URL, not worth wiring next/image's remotePatterns for
          <img
            src={avatarUrl}
            alt=""
            className="h-14 w-14 rounded-full object-cover border border-border shrink-0"
          />
        ) : (
          <span className="h-14 w-14 rounded-full bg-accent-ink text-white text-base font-semibold flex items-center justify-center shrink-0">
            {initialsOf(name) || "?"}
          </span>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn-neutral text-xs px-3 py-1.5"
            >
              {busy ? "Working…" : avatarUrl ? "Change photo" : "Upload photo"}
            </button>
            {avatarUrl && (
              <button type="button" onClick={handleRemove} disabled={busy} className="btn-neutral text-xs px-3 py-1.5">
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-muted">JPEG, PNG, or WebP, up to 5MB.</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-accent mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
