"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";

/**
 * Floating "jump back to today" pill, shared by TimesheetCalendar and AvailabilityCalendar —
 * CB pointed at the Airbnb host calendar's own version of this ("make sure... it doesn't look
 * like we're kind of lost") after those two components' month-list already landed on the
 * current month correctly. It shows up once the current month's section (whatever ref is
 * passed in as `targetRef`) scrolls fully out of view, so browsing months up to 6 ahead (or,
 * on My Time, years back) never leaves you unsure how to get back.
 *
 * My Time renders the current month between future months (above it, eagerly loaded) and past
 * history (below it, lazily loaded on scroll) — Availability, since CB's Sept 2026 layout
 * restructure, orders the OPPOSITE way (past above, future below), matching a real scheduling
 * app rather than My Time's original "scroll up for what's ahead" choice. Either way this
 * button doesn't care which direction is which: the direction to point in is derivable purely
 * from which way the target scrolled off screen — above the viewport (its top is negative)
 * means you scrolled past it, so the chevron points up to send you back; below the viewport
 * (top positive) means you haven't reached it yet, so it points down.
 */
export default function JumpToTodayButton({
  targetRef,
  onJump,
  hidden = false,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  onJump: () => void;
  /** Hide even when otherwise visible — used to keep this clear of the day/detail panel, which
   *  occupies the same corner of the screen on a phone when a date is selected. */
  hidden?: boolean;
}) {
  const [state, setState] = useState<{ visible: boolean; direction: "up" | "down" }>({
    visible: false,
    direction: "down",
  });

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState((s) => (s.visible ? { ...s, visible: false } : s));
        } else {
          setState({ visible: true, direction: entry.boundingClientRect.top < 0 ? "up" : "down" });
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetRef]);

  if (!state.visible || hidden) return null;

  return (
    <button
      type="button"
      onClick={onJump}
      className="fixed z-40 bottom-24 right-4 sm:bottom-6 sm:right-6 flex items-center gap-1.5 rounded-full bg-neutral-900 text-white shadow-lg pl-3 pr-4 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors animate-in fade-in"
    >
      <ChevronDownIcon className={`h-4 w-4 ${state.direction === "up" ? "rotate-180" : ""}`} />
      Today
    </button>
  );
}
