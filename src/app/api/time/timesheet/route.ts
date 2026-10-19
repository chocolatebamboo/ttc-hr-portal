import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertCanAccessEmployeeRecords } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { toErrorResponse } from "@/lib/api-errors";

// Same local-copy convention every other consumer of "display name from an Employee row"
// already follows in this app (see TeamScheduleGlance.tsx's own doc comment on this exact
// choice) — used below for a correction's "Corrected by [name]" line.
function nameOf(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`;
}

/**
 * GET /api/time/timesheet?employeeId=...&start=YYYY-MM-DD&end=YYYY-MM-DD
 * employeeId defaults to the caller. Requesting anyone else's requires the caller to be
 * that employee's supervisor or an HR/Super Admin — checked server-side against the
 * database relationship, then enforced again by Postgres RLS inside withRlsContext.
 */
export async function GET(request: NextRequest) {
  try {
    const employee = await requireEmployee();
    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") ?? employee.id;

    await assertCanAccessEmployeeRecords(employee, targetEmployeeId);

    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (!start || !end) {
      return NextResponse.json({ error: "start and end query params are required." }, { status: 400 });
    }

    const entries = await withRlsContext({ employeeId: employee.id, role: employee.role }, async (tx) => {
      const rows = await tx.timeEntry.findMany({
        where: {
          employeeId: targetEmployeeId,
          workDate: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T23:59:59.999Z`) },
        },
        // The shift relation is included here (and only here — see TimeSessionDTO's own doc
        // comment) so the Timesheet page can show what was actually scheduled right next to what
        // got recorded, not just flag a mismatch without saying what it was a mismatch against.
        include: { sessions: { orderBy: { clockIn: "asc" }, include: { shift: { select: { startTime: true, endTime: true } } } } },
        orderBy: { workDate: "asc" },
      });

      // Surface the reason a returned entry was returned — pulled from the audit trail
      // (the single source of truth for review history) rather than duplicated onto
      // TimeEntry itself.
      //
      // Round twelve (CB, Oct 2026, pointing at Haile's own corrected entry: "I'm still not
      // seeing like who also corrected the time and stuff and when they did it... we should
      // still be seeing the flagged [reason]"): same idea, for whether a reviewer has ever used
      // "Edit times" on this entry (submitReviewerCorrection's own HR_CORRECTION audit event).
      // The flag reason itself comes from a DIFFERENT, earlier audit event — whichever CLOCK_IN
      // or AUTO_CLOCK_OUT event(s) carried a comment before that correction happened — since the
      // correction replaces the actual TimeSession rows (and their isException/exceptionReason)
      // wholesale; the audit trail is the only place that reason still exists afterward.
      return Promise.all(
        rows.map(async (row) => {
          const sessions = row.sessions.map(({ shift, ...session }) => ({
            ...session,
            scheduledStartTime: shift?.startTime ?? null,
            scheduledEndTime: shift?.endTime ?? null,
          }));

          const reviewComment =
            row.status === "RETURNED"
              ? (
                  await tx.timeEntryAuditEvent.findFirst({
                    where: { timeEntryId: row.id, action: "TIMESHEET_RETURNED" },
                    orderBy: { createdAt: "desc" },
                  })
                )?.comment ?? null
              : null;

          const lastCorrection = await tx.timeEntryAuditEvent.findFirst({
            where: { timeEntryId: row.id, action: "HR_CORRECTION" },
            orderBy: { createdAt: "desc" },
            include: { actor: { select: { firstName: true, lastName: true, preferredName: true } } },
          });

          let correction: { reviewerName: string; correctedAt: string; originalFlagReason: string | null } | null = null;
          if (lastCorrection) {
            const flagEvents = await tx.timeEntryAuditEvent.findMany({
              where: {
                timeEntryId: row.id,
                action: { in: ["CLOCK_IN", "AUTO_CLOCK_OUT"] },
                comment: { not: null },
                createdAt: { lt: lastCorrection.createdAt },
              },
              orderBy: { createdAt: "asc" },
              select: { comment: true },
            });
            const reasons = flagEvents.map((e) => e.comment).filter((c): c is string => !!c);
            correction = {
              reviewerName: lastCorrection.actor ? nameOf(lastCorrection.actor) : "a reviewer",
              correctedAt: lastCorrection.createdAt.toISOString(),
              originalFlagReason: reasons.length > 0 ? reasons.join("; ") : null,
            };
          }

          return { ...row, sessions, reviewComment, correction };
        })
      );
    });

    return NextResponse.json({ entries });
  } catch (err) {
    return toErrorResponse(err);
  }
}
