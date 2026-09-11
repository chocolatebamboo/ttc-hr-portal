"use client";

import { useState } from "react";
import Link from "next/link";
import { SlidersIcon, GripIcon } from "@/components/icons";
import { DragReorderList } from "@/components/DragReorderList";
import { availableQuickActions, resolveQuickActions, type QuickActionDef, type QuickActionTone } from "@/lib/quick-actions";
import type { Role } from "@/types";

const CHIP_TONE: Record<QuickActionTone, string> = {
  blue: "bg-[color-mix(in_srgb,var(--ttc-blue)_12%,white)] text-[var(--ttc-blue-ink)]",
  pink: "bg-[color-mix(in_srgb,var(--ttc-pink)_12%,white)] text-[var(--ttc-pink-ink)]",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  violet: "bg-violet-100 text-violet-800",
};

/**
 * The dashboard's "Quick actions" card, plus the picker that customizes it — CB, round five:
 * "I should be able to customize what quick actions is there... based off of what's available
 * in the more tab," confirmed as an icon opening a checklist, saved per person. `variant` swaps
 * between the two visual treatments this card already had (a 4-across colored-circle grid on
 * mobile, a plain icon-over-label grid on desktop) without duplicating the picker itself — two
 * instances of this component sit side by side in the dashboard page (one per breakpoint,
 * toggled by Tailwind's responsive `hidden` classes exactly as the old static markup was), so
 * only the one actually on screen is ever interacted with even though both are mounted.
 *
 * CB, Sept 2026, two follow-ups on this same picker: (1) the gear icon "is too similar to one
 * of the icons for another platform" — swapped for SlidersIcon, a customize/adjust glyph rather
 * than a generic settings gear (see icons.tsx). (2) "I should be able to click and hold to
 * reorganize the different actions" — the picker is now two sections instead of one flat
 * checklist: "Your quick actions" is the current selection, in the order it actually renders on
 * the dashboard, each row press-and-hold draggable via DragReorderList; "Add more" is everything
 * else still available to add. Splitting them (rather than one list of checkboxes) is what makes
 * "the order of what's checked" a distinct, draggable thing instead of tangled up with "which
 * ones are checked" — you can't meaningfully drag-reorder a flat list where most rows are
 * unchecked filler between the ones that matter.
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
  const byKey = new Map(available.map((a) => [a.key, a]));

  function openPicker() {
    setDraftKeys(keys.length > 0 ? keys : actions.map((a) => a.key));
    setPickerOpen(true);
  }

  // The two lists below are just draftKeys' order re-derived, never the other way around — so
  // there's exactly one source of truth for "which ones, in what order" and no risk of the
  // selected list and the checked state drifting out of sync.
  const draftActions = draftKeys.map((k) => byKey.get(k)).filter((a): a is QuickActionDef => !!a);
  const addableActions = available.filter((a) => !draftKeys.includes(a.key));

  function addAction(key: string) {
    setDraftKeys((d) => [...d, key]);
  }

  function removeAction(key: string) {
    setDraftKeys((d) => d.filter((k) => k !== key));
  }

  function reorderDraft(nextOrder: QuickActionDef[]) {
    setDraftKeys(nextOrder.map((a) => a.key));
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
          <SlidersIcon className="h-4 w-4" />
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
            <p className="text-xs text-muted mb-3">Choose what shows here, and drag to reorder — anything in More is fair game.</p>

            {draftActions.length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted/70 mb-1.5 px-0.5">
                  Your quick actions
                </p>
                <DragReorderList
                  items={draftActions}
                  keyFn={(a) => a.key}
                  onReorder={reorderDraft}
                  className="space-y-1"
                  renderItem={(action, { dragging, dragHandleProps }) => (
                    <div
                      className={`flex items-center gap-2 rounded-xl px-2 py-2 bg-surface ${dragging ? "shadow-lg" : ""}`}
                    >
                      <button
                        type="button"
                        {...dragHandleProps}
                        aria-label={`Drag to reorder ${action.label}`}
                        className="h-7 w-7 shrink-0 flex items-center justify-center text-muted/50"
                      >
                        <GripIcon className="h-4 w-4" />
                      </button>
                      <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${CHIP_TONE[action.tone]}`}>
                        <action.icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm flex-1 min-w-0 truncate">{action.label}</span>
                      <button
                        type="button"
                        onClick={() => removeAction(action.key)}
                        aria-label={`Remove ${action.label}`}
                        className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-muted/60 hover:text-accent hover:bg-black/[0.04] text-sm leading-none"
                      >
                        ×
                      </button>
                    </div>
                  )}
                />
              </div>
            )}

            {addableActions.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted/70 mb-1.5 px-0.5">Add more</p>
                <div className="space-y-1">
                  {addableActions.map((action) => (
                    <button
                      type="button"
                      key={action.key}
                      onClick={() => addAction(action.key)}
                      className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-black/[0.03] text-left"
                    >
                      <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${CHIP_TONE[action.tone]}`}>
                        <action.icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm flex-1">{action.label}</span>
                      <span className="text-lg leading-none text-muted/50">+</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

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
