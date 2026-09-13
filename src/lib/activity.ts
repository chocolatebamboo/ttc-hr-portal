import { withRlsContext } from "@/lib/db";
import { assertIsAdmin } from "@/lib/authorization";
import type { ActivityLogEntryDTO, CurrentEmployee } from "@/types";

function nameOf(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

const EMP_SELECT = { firstName: true, lastName: true, preferredName: true } as const;

export interface ActivityFilters {
  /** Inclusive "YYYY-MM-DD" bounds, same shape every other date-range filter in this app uses
   *  (ReportsView's own start/end, for instance) — resolved to real Date boundaries below since
   *  AuditLog.createdAt is a timestamp, not a date. */
  startDate?: string;
  endDate?: string;
  /** Who performed the action — not which employee's record it's about (that would need a
   *  per-targetType join; left out of scope for this first pass, same "keep the first version
   *  simple" call the client spec's own "at a minimum" phrasing for reports leaves room for). */
  actorId?: string;
  /** Exact match on AuditLog.action (e.g. "SHIFT_CANCELLED") — the UI offers a fixed dropdown
   *  built from ACTIVITY_ACTION_LABELS below rather than free text, so this never needs a
   *  partial/ILIKE match. */
  action?: string;
}

/**
 * Phase 4 (client spec, Sept 2026): "Reports and Activity History views." Admin-only reading of
 * the AuditLog table every phase since phase 1 has been writing to (src/lib/shifts.ts originally;
 * phase 4 widens that to availability/PTO/date-task decisions too — see src/lib/audit-log.ts).
 * Capped at 200 rows per call — a real "load more"/pagination UI is a reasonable future
 * enhancement once this history has grown past what fits usefully on one page, but isn't what
 * blocks the client spec's own bar for this view today.
 */
export async function listActivity(actor: CurrentEmployee, filters: ActivityFilters): Promise<ActivityLogEntryDTO[]> {
  assertIsAdmin(actor);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: {
        actorId: filters.actorId || undefined,
        action: filters.action || undefined,
        createdAt: {
          gte: filters.startDate ? new Date(`${filters.startDate}T00:00:00.000Z`) : undefined,
          // End-of-day (23:59:59.999) so a same-day start/end filter still includes the whole
          // selected end date, not just its first instant.
          lte: filters.endDate ? new Date(`${filters.endDate}T23:59:59.999Z`) : undefined,
        },
      },
      include: { actor: { select: EMP_SELECT } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Batch-resolve target labels by grouping ids per targetType, rather than one query per
    // row — this view can easily show 100+ rows, and N+1 queries against a review-facing admin
    // page is exactly the kind of thing that's cheap to avoid up front.
    const idsByType = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!idsByType.has(r.targetType)) idsByType.set(r.targetType, new Set());
      idsByType.get(r.targetType)!.add(r.targetId);
    }

    const labels = new Map<string, string>(); // `${targetType}:${targetId}` -> label

    const shiftIds = [...(idsByType.get("Shift") ?? [])];
    if (shiftIds.length > 0) {
      const shiftRows = await tx.shift.findMany({
        where: { id: { in: shiftIds } },
        select: { id: true, date: true, employee: { select: EMP_SELECT } },
      });
      for (const s of shiftRows) labels.set(`Shift:${s.id}`, `${nameOf(s.employee)}'s shift (${s.date})`);
    }

    const availabilityIds = [...(idsByType.get("AvailabilitySubmission") ?? [])];
    if (availabilityIds.length > 0) {
      const availRows = await tx.availabilitySubmission.findMany({
        where: { id: { in: availabilityIds } },
        select: { id: true, employee: { select: EMP_SELECT } },
      });
      for (const a of availRows) labels.set(`AvailabilitySubmission:${a.id}`, `${nameOf(a.employee)}'s availability`);
    }

    const ptoIds = [...(idsByType.get("PtoRequest") ?? [])];
    if (ptoIds.length > 0) {
      const ptoRows = await tx.ptoRequest.findMany({
        where: { id: { in: ptoIds } },
        select: { id: true, type: true, employee: { select: EMP_SELECT } },
      });
      for (const p of ptoRows) labels.set(`PtoRequest:${p.id}`, `${nameOf(p.employee)}'s ${p.type.toLowerCase()} request`);
    }

    const taskIds = [...(idsByType.get("DateTask") ?? [])];
    if (taskIds.length > 0) {
      const taskRows = await tx.dateTask.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, taskDate: true, employee: { select: EMP_SELECT } },
      });
      for (const t of taskRows) labels.set(`DateTask:${t.id}`, `${nameOf(t.employee)}'s task (${t.taskDate})`);
    }

    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: nameOf(r.actor),
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      // Falls back to the bare targetType when the target row is gone (deleted) or isn't one of
      // the four kinds resolved above — never a broken/blank cell, just a less specific one.
      targetLabel: labels.get(`${r.targetType}:${r.targetId}`) ?? r.targetType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
