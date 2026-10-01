import { notFound } from "next/navigation";
import Link from "next/link";
import { requireEmployeeOrRedirect } from "@/lib/auth";
import { canAccessEmployeeRecords } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { getAvatarPublicUrl } from "@/lib/storage";
import ReviewEmployeeView from "./ReviewEmployeeView";

/** Hand-declared rather than relying on inference through withRlsContext's callback — same
 *  convention src/lib/availability.ts's AvailabilityRow and dashboard/week/page.tsx's
 *  WeekEntryRow follow — narrowed to just the fields this page's select actually reads.
 *  avatarStorageKey added Oct 2026 alongside the banner redesign below — same
 *  avatarStorageKey-to-getAvatarPublicUrl() conversion src/lib/auth.ts and src/lib/profile.ts
 *  already do, so the banner can show a real photo instead of always falling back to initials. */
type ReviewTarget = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  jobTitle: string;
  avatarStorageKey: string | null;
};

export default async function ReviewEmployeePage(
  props: PageProps<"/team/[employeeId]">
) {
  const { employeeId } = await props.params;

  const reviewer = await requireEmployeeOrRedirect();

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
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          jobTitle: true,
          avatarStorageKey: true,
        },
      });
    }
  );
  if (!target) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/team" className="text-sm text-muted hover:text-accent-ink mb-3 inline-block">
        ← My Team
      </Link>
      {/* Oct 2026 (CB, on this page: "it's too wordy... I want it to be widgetized and I want
          it to be clean"): Timesheet/Time Off/Availability/Notes used to stack here as four
          always-open sections, one after another under a plain text label — a long scroll of
          everything at once even though a supervisor is usually here for ONE of those at a
          time. Replaced with the banner-plus-tabs shell CB already approved for her own Profile
          page (ProfileView.tsx's own doc comment: "mirroring the reference CB shared") — one
          widget visible at a time, switched with a tap, instead of all four laid end to end.
          See ReviewEmployeeView's own doc comment for the rest, including the Notes thread's
          own history ("say I accept it, then I would be able to, like, add notes, add
          documents... so we could communicate through there" — CB, Sept 2026). */}
      <ReviewEmployeeView
        employeeId={target.id}
        employeeName={`${target.preferredName || target.firstName} ${target.lastName}`}
        jobTitle={target.jobTitle}
        avatarUrl={target.avatarStorageKey ? getAvatarPublicUrl(target.avatarStorageKey) : null}
        viewerId={reviewer.id}
      />
    </div>
  );
}
