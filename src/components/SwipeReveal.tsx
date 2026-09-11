"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Reveals a fixed-width action button by horizontally swiping a row — built on native CSS
 * scroll-snap rather than hand-rolled touch/pointer-event math, which can't be visually
 * verified in this sandbox (no browser here); a horizontally-scrollable flex container handles
 * the swipe gesture correctly on every device with zero extra event-handling code.
 *
 * CB, round four: "I should be able to slide to the left... and delete it" (Time Off requests)
 * and "I should be able to clear it by... swiping to the right" (Messages). `actionSide` picks
 * which edge the action lives on and which swipe direction reveals it:
 *   - "right": the familiar swipe-left-to-delete. Action sits after the content in DOM order,
 *     hidden off the right edge at rest (scrollLeft 0); swiping left reveals it.
 *   - "left": swipe-right-to-reveal. Action sits before the content in DOM order; the row
 *     starts scrolled past it (scrollLeft = actionWidth) so it's hidden at rest, and swiping
 *     right (scrollLeft back toward 0) reveals it.
 * Either way the row snaps cleanly to "hidden" or "revealed" — no in-between resting position.
 */
export default function SwipeReveal({
  actionSide,
  actionLabel,
  actionIcon,
  onAction,
  busy = false,
  actionClassName = "bg-accent text-white",
  actionWidth = 88,
  children,
}: {
  actionSide: "left" | "right";
  actionLabel: string;
  actionIcon?: React.ReactNode;
  onAction: () => void | Promise<void>;
  busy?: boolean;
  actionClassName?: string;
  actionWidth?: number;
  children: React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Starts scrolled past a left-side action so it's hidden until swiped open — a right-side
  // action needs no offset since it already sits after the content in DOM order.
  useLayoutEffect(() => {
    if (actionSide === "left" && scrollerRef.current) {
      scrollerRef.current.scrollLeft = actionWidth;
    }
  }, [actionSide, actionWidth]);

  function resetScroll() {
    scrollerRef.current?.scrollTo({ left: actionSide === "left" ? actionWidth : 0, behavior: "smooth" });
  }

  async function handleAction() {
    await onAction();
    resetScroll();
  }

  const button = (
    <button
      type="button"
      onClick={handleAction}
      disabled={busy}
      style={{ width: actionWidth }}
      className={`snap-start shrink-0 flex flex-col items-center justify-center gap-1 text-xs font-medium disabled:opacity-60 ${actionClassName}`}
    >
      {actionIcon}
      {busy ? "…" : actionLabel}
    </button>
  );

  return (
    <div
      ref={scrollerRef}
      className="flex overflow-x-auto snap-x snap-mandatory"
      style={{ scrollbarWidth: "none" }}
    >
      {actionSide === "left" && button}
      <div className="snap-start shrink-0 w-full min-w-full">{children}</div>
      {actionSide === "right" && button}
    </div>
  );
}
