"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ScheduleSomeoneSheet from "@/components/ScheduleSomeoneSheet";

/**
 * Oct 2026 (CB, pointing at the Availability page's admin view alongside a screenshot of the
 * Home hero's own "Schedule someone" button): "for those admin accounts... we need to be able
 * to make our team member's schedule from here." Home already has this exact action
 * (AdminHomeHero's "Schedule someone" button, opening ScheduleSomeoneSheet) and each individual
 * availability card already has its own scoped "+ Add a date" (Card, TeamAvailabilityCards.tsx)
 * for the one employee that card belongs to — but neither of those is a quick, any-employee
 * entry point reachable without first finding their card or leaving this page for Home. This is
 * that: the exact same sheet/action Home and Team Schedule's own "New shift" form both already
 * call (createShiftManually via POST /api/admin/shifts), just a standalone button that can drop
 * onto any admin page's header, starting here. Not a new flow — one more door into the same room.
 */
export default function ScheduleSomeoneButton({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleCreated() {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "btn-primary text-sm px-4 py-2 shrink-0"}
      >
        + Schedule someone
      </button>
      {open && <ScheduleSomeoneSheet onClose={() => setOpen(false)} onCreated={handleCreated} />}
    </>
  );
}
