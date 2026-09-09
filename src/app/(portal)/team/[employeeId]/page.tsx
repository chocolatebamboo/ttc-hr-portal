import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentEmployee } from "@/lib/auth";
import { canAccessEmployeeRecords } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import TeamNotesThread from "@/components/TeamNotesThread";
import ReviewTimesheetView from "./ReviewTimesheetView";
import TeamPtoSection from "./TeamPtoSection";
import TeamAvailabilitySection from "./TeamAvailabilitySection";

/** Hand-declared rather than relying on inference through withRlsContext's callback — same
 *  convention src/lib/availability.ts's AvailabilityRow and dashboard/week/page.tsx's
 *  WeekEntryRow follow — narrowed to just the fields this page's select actually reads. */
type ReviewTarget = { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: string };

export default async function ReviewEmployeePage(
  props: PageProps<"/team/[employeeId]">
) {
  const { employeeId } = await props.params;

  const reviewer = await getCurrentEmployee();
  if (!reviewer) redirect("/login");

  if (!(await canAccessEmployeeRecords(reviewer, employeeId))) {
    // Same response whether the id doesn't exist or the reviewer just isn't allowed to see
    // it — a supervisor probing other ids by guessing learns nothing either way.
    notFound();
  }

  const target: ReviewTarget | null = await withRlsContext(
    { employeeId: reviewer.id, role: reviewer.role },
    async (tx) => {
      return tx.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: true },
      });
    }
  );
  if (!target) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/team" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
        ← My Team
      </Link>
      <h1 className="page-title text-2xl">
        {target.preferredName || target.firstName} {target.lastName}
      </h1>
      <p className="text-sm text-muted mb-5">{target.jobTitle}</p>

      <h2 className="text-sm font-medium text-muted mb-2">Timesheet</h2>
      <ReviewTimesheetView employeeId={target.id} />

      <h2 className="text-sm font-medium text-muted mb-2 mt-8">Time Off</h2>
      <TeamPtoSection employeeId={target.id} />

      <h2 className="text-sm font-medium text-muted mb-2 mt-8">Availability</h2>
      <TeamAvailabilitySection employeeId={target.id} />

      {/* CB, Sept 2026: "say I accept it, then I would be able to, like, add notes, add
          documents... so we could communicate through there." Same thread whichever side you
          view it from — this employee, reviewing it here, sees the exact messages the person
          themselves sees on their own /notes page. */}
      <h2 className="text-sm font-medium text-muted mb-2 mt-8">Notes</h2>
      <TeamNotesThread employeeId={target.id} viewerId={reviewer.id} />
    </div>
  );
}
