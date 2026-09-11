"use client";

import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 160;
const MOVE_SLOP_PX = 6;

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  style: React.CSSProperties;
}

/**
 * Press-and-hold drag reordering for a short on-screen list — hand-rolled with Pointer Events
 * rather than a drag-and-drop library. This app is deployed by CB pasting each file's full text
 * into GitHub's web editor (see this codebase's file-by-file "round" deliveries), so a new npm
 * dependency would mean also hand-pasting a multi-thousand-line package-lock.json, which isn't
 * practical here — same "avoid pulling in a library for this" reasoning
 * src/components/icons.tsx already uses for icons.
 *
 * CB, Sept 2026: "I should be able to click and hold to reorganize the different actions" (the
 * Quick Actions picker — src/components/QuickActionsCard.tsx), then the same request for the
 * dashboard's This week/Availability/Reports stat row — both are thin wrappers around this one
 * component rather than two separate implementations.
 *
 * A short hold (LONG_PRESS_MS) has to elapse, with the pointer still roughly where it started
 * (MOVE_SLOP_PX), before a drag actually arms — so a plain tap/click on whatever's inside a row
 * (a checkbox, a Link) still behaves normally; only a deliberate hold hijacks the gesture.
 *
 * Reordering is threshold-crossing, one neighbor at a time: the dragged row's visual position is
 * tracked as (its current slot's on-screen position) + an accumulated pointer offset. Every time
 * that offset passes the halfway point into a neighboring slot, the two swap places in the
 * underlying array and the offset is corrected by exactly one slot's size, so the dragged row
 * keeps following the pointer smoothly with no jump when the swap happens. Same feel as
 * iOS/Android home-screen icon reordering.
 */
export function DragReorderList<T>({
  items,
  keyFn,
  onReorder,
  renderItem,
  orientation = "vertical",
  className,
}: {
  items: T[];
  keyFn: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, opts: { dragging: boolean; dragHandleProps: DragHandleProps }) => React.ReactNode;
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pressTimer = useRef<number | null>(null);
  const cleanupEarly = useRef<(() => void) | null>(null);
  const drag = useRef<{ key: string; index: number; lastPos: number; slotSize: number } | null>(null);

  function axis(e: { clientX: number; clientY: number }) {
    return orientation === "vertical" ? e.clientY : e.clientX;
  }

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (cleanupEarly.current) {
      cleanupEarly.current();
      cleanupEarly.current = null;
    }
  }

  useEffect(() => () => clearPressTimer(), []);

  // Distance between this row's start and its neighbor's start — measured off the actual
  // rendered positions rather than assumed from a class name, so it works whether the gap
  // between rows comes from a flex/grid `gap` or from plain margins.
  function measureSlotSize(index: number): number {
    const el = rowRefs.current.get(keyFn(items[index]));
    if (!el) return 1;
    const neighborIndex = index + 1 < items.length ? index + 1 : index - 1;
    const neighborEl = neighborIndex >= 0 ? rowRefs.current.get(keyFn(items[neighborIndex])) : undefined;
    const a = el.getBoundingClientRect();
    if (!neighborEl) return (orientation === "vertical" ? a.height : a.width) || 1;
    const b = neighborEl.getBoundingClientRect();
    const distance = orientation === "vertical" ? Math.abs(b.top - a.top) : Math.abs(b.left - a.left);
    return distance || (orientation === "vertical" ? a.height : a.width) || 1;
  }

  function handlePointerDown(key: string, index: number, e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    clearPressTimer();

    function onEarlyMove(ev: PointerEvent) {
      if (Math.abs(ev.clientX - startX) > MOVE_SLOP_PX || Math.abs(ev.clientY - startY) > MOVE_SLOP_PX) {
        clearPressTimer();
      }
    }
    function onEarlyUp() {
      clearPressTimer();
    }
    window.addEventListener("pointermove", onEarlyMove);
    window.addEventListener("pointerup", onEarlyUp, { once: true });
    cleanupEarly.current = () => {
      window.removeEventListener("pointermove", onEarlyMove);
      window.removeEventListener("pointerup", onEarlyUp);
    };

    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      if (cleanupEarly.current) {
        cleanupEarly.current();
        cleanupEarly.current = null;
      }
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Capture is a nicety (keeps the drag tracking even if the pointer leaves this
        // element) — not required for correctness, so a failure here isn't worth surfacing.
      }
      drag.current = { key, index, lastPos: axis({ clientX: startX, clientY: startY }), slotSize: measureSlotSize(index) };
      setDraggingKey(key);
      setDragOffset(0);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const state = drag.current;
    if (!state || state.key !== draggingKey) return;
    const pos = axis(e);
    const delta = pos - state.lastPos;
    state.lastPos = pos;

    setDragOffset((prev) => {
      let next = prev + delta;
      const slot = state.slotSize || 1;

      while (next > slot / 2 && state.index < items.length - 1) {
        const reordered = items.slice();
        const [moved] = reordered.splice(state.index, 1);
        reordered.splice(state.index + 1, 0, moved);
        state.index += 1;
        next -= slot;
        onReorder(reordered);
      }
      while (next < -slot / 2 && state.index > 0) {
        const reordered = items.slice();
        const [moved] = reordered.splice(state.index, 1);
        reordered.splice(state.index - 1, 0, moved);
        state.index -= 1;
        next += slot;
        onReorder(reordered);
      }
      return next;
    });
  }

  function endDrag() {
    clearPressTimer();
    drag.current = null;
    setDraggingKey(null);
    setDragOffset(0);
  }

  return (
    <div className={className} onPointerMove={handlePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {/* The lint rule below (react-hooks/refs) flags this whole block because handlePointerDown
          — referenced further down as an event-handler prop, never called during render itself
          — reads ref values. Refs are only ever actually touched inside real event handlers and
          the commit-phase ref callback just below, never synchronously while rendering; the rule
          can't distinguish "defined here, runs later" from "runs now," so this is a scoped
          disable rather than a real bug — same convention this codebase already uses elsewhere
          (e.g. TimesheetView.tsx's react-hooks/set-state-in-effect) for a case the rule
          over-flags. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {items.map((item, index) => {
        const key = keyFn(item);
        const dragging = key === draggingKey;
        const style: React.CSSProperties = dragging
          ? {
              transform: orientation === "vertical" ? `translateY(${dragOffset}px)` : `translateX(${dragOffset}px)`,
              position: "relative",
              zIndex: 10,
            }
          : { position: "relative", transition: "transform 150ms ease" };

        return (
          <div
            key={key}
            ref={(el) => {
              if (el) rowRefs.current.set(key, el);
              else rowRefs.current.delete(key);
            }}
            style={style}
          >
            {renderItem(item, {
              dragging,
              dragHandleProps: {
                onPointerDown: (e) => handlePointerDown(key, index, e),
                style: { touchAction: "none", cursor: "grab" },
              },
            })}
          </div>
        );
      })}
    </div>
  );
}
