import type { PrismaClient } from "@prisma/client";

/**
 * Phase 4 (client spec, Sept 2026): "Reports and Activity History views." A shared writer for
 * the existing AuditLog table (prisma/schema.prisma — present since phase 1, but only ever
 * written to by src/lib/shifts.ts's own writeShiftAuditLog until now) so availability/PTO/date-
 * task decisions show up in Activity History too, not just shifts. Deliberately a new shared
 * helper rather than exporting/reusing shifts.ts's writeShiftAuditLog: that function is
 * hard-coded to targetType "Shift" and already shipped/working across three phases — leaving it
 * exactly as it is avoids touching proven code for a cosmetic dedup, at the cost of one small
 * duplicate function. Same call shape either way: inside an already-open transaction, right
 * alongside the real mutation, for the same "it never should have happened if the transaction
 * rolled back" reasoning writeNotification's own doc comment (src/lib/notifications.ts) explains.
 *
 * Hotfix (Sept 2026): switched from tx.auditLog.create() to createMany() for the exact same
 * reason writeNotification's own doc comment explains in full — Prisma's create() does
 * `INSERT ... RETURNING`, and audit_log_select (prisma/rls.sql) only allows admins to read
 * AuditLog rows back (`qual: is_admin()`). So this failed with the same "new row violates
 * row-level security policy" error the instant a non-admin (a supervisor who reviews
 * availability/PTO but isn't HR_ADMIN/SUPER_ADMIN — Daijour, specifically) tried to decide
 * anything: the very first write inside that transaction (this one, before writeNotification
 * even runs) threw and rolled the whole action back. createMany() skips RETURNING entirely, so
 * only audit_log_insert's `with check (true)` applies — same row lands either way, same
 * admin-only read access afterward, just no attempt to hand the row back to a non-admin writer
 * who was never allowed to read it in the first place.
 */
export async function writeAuditLog(
  tx: PrismaClient,
  params: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    oldValue?: string;
    newValue?: string;
    comment?: string;
  }
): Promise<void> {
  await tx.auditLog.createMany({
    data: [
      {
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        oldValue: params.oldValue ?? null,
        newValue: params.newValue ?? null,
        comment: params.comment ?? null,
      },
    ],
  });
}
