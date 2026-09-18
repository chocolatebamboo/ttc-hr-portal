"use client";

import { useLayoutEffect, useRef } from "react";

/** One revealed button's full config — the shape `actionLabel`/`actionIcon`/`onAction`/`busy`/
 *  `actionClassName`/`actionWidth` already describe for the primary action, reused as-is for
 *  `secondaryAction` below so a caller with two actions doesn't learn a second vocabulary. */
export interface SwipeRevealAction {
  label: string;
  icon?: React.ReactNode;
  onAction: () => void | Promise<void>;
  busy?: boolean;
  className?: string;
  width?: number;
}

/**
 * Reveals a fixed-width action button by horizontally swiping a row — built on native CSS
 * scroll-snap rather than hand-rolled touch/pointer-event math, which can't be visually
 * verified in this sandbox (no browser here); a horizontally-scrollable flex container handles
 * the swipe gesture correctly on every device with zero extra event-handling code.
 *
 * CB, round four: "I should be able to slide to the left... and delete it" (Time Off requests)
 * and "I should be able to clear it by... swiping to the right" (Messages). `actionSide` picks
 * which edge the action lives on and which swipe direction reveals it:
 *   - "right": the familiar swipe-left-to-delete. Action(s) sit after the content in DOM order,
 *     hidden off the right edge at rest (scrollLeft 0); swiping left reveals them.
 *   - "left": swipe-right-to-reveal. Action(s) sit before the content in DOM order; the row
 *     starts scrolled past them (scrollLeft = total action width) so they're hidden at rest, and
 *     swiping right (scrollLeft back toward 0) reveals them.
 * Either way the row snaps cleanly to "hidden" or "revealed" — no in-between resting position.
 *
 * Correction brief #10 (Sept 2026): a Decided availability card needs both "Clear" (Correction
 * brief #9's dismiss) and the new administrative "Remove/Delete" behind the SAME swipe — two
 * genuinely different actions, not a second gesture, since the brief is explicit that the whole
 * app swipes one consistent direction. `secondaryAction` is optional and additive: every existing
 * single-action caller is unaffected, and a caller that passes it gets a second button revealed
 * alongside the first, always further from the content edge than the primary one (so on the
 * far-more-common one-action cards, nothing about the reveal changes).
 */
export default function SwipeReveal({
  actionSide,
  actionLabel,
  actionIcon,
  onAction,
  busy = false,
  actionClassName = "bg-accent text-white",
  actionWidth = 88,
  secondaryAction,
  children,
}: {
  actionSide: "left" | "right";
  actionLabel: string;
  actionIcon?: React.ReactNode;
  onAction: () => void | Promise<void>;
  busy?: boolean;
  actionClassName?: string;
  actionWidth?: number;
  secondaryAction?: SwipeRevealAction;
  children: React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const secondaryWidth = secondaryAction?.width ?? actionWidth;
  const totalActionWidth = actionWidth + (secondaryAction ? secondaryWidth : 0);

  // Starts scrolled past the left-side action(s) so they're hidden until swiped open — a
  // right-side action needs no offset since it already sits after the content in DOM order.
  useLayoutEffect(() => {
    if (actionSide === "left" && scrollerRef.current) {
      scrollerRef.current.scrollLeft = totalActionWidth;
    }
  }, [actionSide, totalActionWidth]);

  function resetScroll() {
    scrollerRef.current?.scrollTo({ left: actionSide === "left" ? totalActionWidth : 0, behavior: "smooth" });
  }

  async function handleAction(run: () => void | Promise<void>) {
    await run();
    resetScroll();
  }

  const primaryButton = (
    <button
      type="button"
      onClick={() => handleAction(onAction)}
      disabled={busy}
      style={{ width: actionWidth }}
      className={`snap-start shrink-0 flex flex-col items-center justify-center gap-1 text-xs font-medium disabled:opacity-60 ${actionClassName}`}
    >
      {actionIcon}
      {busy ? "…" : actionLabel}
    </button>
  );

  const secondaryButton = secondaryAction && (
    <button
      type="button"
      onClick={() => handleAction(secondaryAction.onAction)}
      disabled={secondaryAction.busy}
      style={{ width: secondaryWidth }}
      className={`snap-start shrink-0 flex flex-col items-center justify-center gap-1 text-xs font-medium disabled:opacity-60 ${
        secondaryAction.className ?? "bg-accent text-white"
      }`}
    >
      {secondaryAction.icon}
      {secondaryAction.busy ? "…" : secondaryAction.label}
    </button>
  );

  return (
    <div
      ref={scrollerRef}
      className="flex overflow-x-auto snap-x snap-mandatory"
      style={{ scrollbarWidth: "none" }}
    >
      {actionSide === "left" && secondaryButton}
      {actionSide === "left" && primaryButton}
      <div className="snap-start shrink-0 w-full min-w-full">{children}</div>
      {actionSide === "right" && primaryButton}
      {actionSide === "right" && secondaryButton}
    </div>
  );
}
