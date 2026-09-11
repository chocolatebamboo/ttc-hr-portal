"use client";

import { useState } from "react";
import Link from "next/link";
import { GearIcon } from "@/components/icons";
import { availableQuickActions, resolveQuickActions, type QuickActionTone } from "@/lib/quick-actions";
import type { Role } from "@/types";

const CHIP_TONE: Record<QuickActionTone, string> = {
  blue: "bg-[color-mix(in_srgb,var(--ttc-blue)_12%,white)] text-[var(--ttc-blue-ink)]",
  pink: "bg-[color-mix(in_srgb,var(--ttc-pink)_12%,white)] text-[var(--ttc-pink-ink)]",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  violet: "bg-violet-100 text-violet-800",
};

/**
 * The dashboard's "Quick actions" card, plus the gear-icon picker that customizes it — CB,
 * round five: "I should be able to customize what quick actions is there... based off of
 * what's available in the more tab," confirmed as a gear icon opening a checklist, saved per
 * person. `variant` swaps between the two visual treatments this card already had (a 4-across
 * colored-circle grid on mobile, a plain icon-over-label grid on desktop) without duplicating
 * the picker itself — two instances of this component sit side by side in the dashboard page
 * (one per breakpoint, toggled by Tailwind's responsive `hidden` classes exactly as the old
 * static markup was), so only the one actually on screen is ever interacted with even though
 * both are mounted.
 */
export default function QuickActionsCard({
  role,
  initialKeys,
  variant,
}: {
  role: Role;
  initialKeys: string[];
  variant: "mobile" | "desktop";
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<string[]>(initialKeys);
  const [saving, setSaving] = useState(false);

  const available = availableQuickActions(role);
  const actions = resolveQuickActions(role, keys);

  function openPicker() {
    setDraftKeys(keys.length > 0 ? keys : actions.map((a) => a.key));
    setPickerOpen(true);
  }

  function toggleDraft(key: string) {
    setDraftKeys((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/me/quick-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: draftKeys }),
      });
      if (res.ok) {
        const data: { keys: string[] } = await res.json();
        setKeys(data.keys);
        setPickerOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted">Quick actions</h2>
        <button
          type="button"
          onClick={openPicker}
          aria-label="Customize quick actions"
          className="h-7 w-7 rounded-full flex items-center justify-center text-muted hover:text-accent-ink hover:bg-black/[0.04] transition-colors"
        >
          <GearIcon className="h-4 w-4" />
        </button>
      </div>

      {variant === "mobile" ? (
        <div className="grid grid-cols-4 gap-2">
          {actions.map((action) => (
            <Link
              key={action.key}
              href={action.href}
              className="flex flex-col items-center text-center gap-2 rounded-xl px-1 py-3 text-muted hover:bg-black/[0.03] transition-colors"
            >
              <span className={`h-10 w-10 rounded-full flex items-center justify-center ${CHIP_TONE[action.tone]}`}>
                <action.icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-medium leading-tight text-foreground">{action.label}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {actions.map((action) => (
            <Link
              key={action.key}
              href={action.href}
              className="flex flex-col items-center text-center gap-2 rounded-xl px-3 py-4 text-muted hover:bg-black/[0.03] hover:text-foreground transition-colors"
            >
              <action.icon className="h-5 w-5" />
              <span className="text-xs font-medium leading-tight text-foreground">{action.label}</span>
            </Link>
          ))}
        </div>
      )}

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-surface rounded-3xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold mb-1">Customize quick actions</p>
            <p className="text-xs text-muted mb-3">Choose what shows here — anything in More is fair game.</p>
            <div className="space-y-1">
              {available.map((action) => {
                const checked = draftKeys.includes(action.key);
                return (
                  <label
                    key={action.key}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-black/[0.03] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDraft(action.key)}
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${CHIP_TONE[action.tone]}`}>
                      <action.icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm">{action.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-2 flex-1 disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setPickerOpen(false)} className="btn-neutral text-sm px-4 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
