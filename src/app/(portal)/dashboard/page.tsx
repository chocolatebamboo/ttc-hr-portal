import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";
import { withRlsContext } from "@/lib/db";
import { listDocumentsForEmployee } from "@/lib/documents";
import { listAnnouncementsForEmployee } from "@/lib/announcements";
import { getOnboardingAttention } from "@/lib/onboarding";
import { listMyAvailability, listAdminAvailability } from "@/lib/availability";
import { formatSlotDate } from "@/lib/availability-format";
import TimeClockCard from "@/components/TimeClockCard";
import PtoStatusPill from "@/components/PtoStatusPill";
import AvailabilityStatusPill from "@/components/AvailabilityStatusPill";
import { ClockIcon, CalendarIcon, FolderIcon, ChecklistIcon, MegaphoneIcon, ChartIcon, BellIcon } from "@/components/icons";
import { PTO_TYPE_LABEL, formatDateRange, formatHoursCompact } from "@/lib/time";
import type { AnnouncementDTO, AvailabilityDTO, AvailabilitySlot, DocumentDTO, PtoStatus, PtoType } from "@/types";

/** recentPto is read straight off Prisma (tx.ptoRequest.findMany below), not converted to a
 *  DTO — it never leaves the server, so the extra round-trip through a string-dates shape
 *  buys nothing. This is that raw row's shape, just narrowed to the fields TimeOffSection
 *  actually reads. */
type RecentPtoRow = { id: string; type: PtoType; status: PtoStatus; startDate: Date; endDate: Date };

// CB, Sept 2026: "we need the availability to show up there... we need the my time, and we
// need the reports to be on there as well" — Request Time Off and View Timesheet both already
// pointed at /time (a leftover from before Time Off was merged into My Time), so that pair
// collapses into one "My Time" entry rather than keeping two links to the same page; Availability
// and Reports are new. Reports has no employee-facing view (see admin/reports/page.tsx's own
// redirect) so it's appended only for admins — see quickActions below — instead of living in
// this shared base list everyone gets.
const QUICK_ACTIONS = [
  { label: "My Time", href: "/time", icon: ClockIcon, tone: "blue" as const },
  { label: "Availability", href: "/availability", icon: CalendarIcon, tone: "pink" as const },
  { label: "View Documents", href: "/documents", icon: FolderIcon, tone: "amber" as const },
  { label: "View Onboarding", href: "/onboarding", icon: ChecklistIcon, tone: "emerald" as const },
];

const ADMIN_QUICK_ACTION = { label: "Reports", href: "/admin/reports", icon: ChartIcon, tone: "violet" as const };

const CHIP_TONE: Record<string, string> = {
  blue: "bg-[color-mix(in_srgb,var(--ttc-blue)_12%,white)] text-[var(--ttc-blue-ink)]",
  pink: "bg-[color-mix(in_srgb,var(--ttc-pink)_12%,white)] text-[var(--ttc-pink-ink)]",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  violet: "bg-violet-100 text-violet-800",
};

function formatAnnouncementDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Thu, Sep 17" for a single-date submission, "Thu, Sep 17 +2 more" for a multi-date one —
 *  compact enough for one line next to a status pill (AvailabilityStatusSection below), same
 *  spirit as TimeOffSection's PTO_TYPE_LABEL + formatDateRange pairing just without a fixed
 *  end date to range against, since a submission's dates aren't necessarily consecutive
 *  (see AvailabilitySlot's doc comment in src/types/index.ts). */
function summarizeSlots(slots: AvailabilitySlot[]): string {
  const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
  const first = formatSlotDate(sorted[0].date);
  return sorted.length === 1 ? first : `${first} +${sorted.length - 1} more`;
}

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const quickActions = isAdmin(employee) ? [...QUICK_ACTIONS, ADMIN_QUICK_ACTION] : QUICK_ACTIONS;

  // CB, Sept 2026: "on the administrator [side] that is approving, that should be a
  // notification... saying that this person wants to have that time approved. Once that
  // person approves it, then they would be able to see that on their main dashboard." Two
  // separate reads for two separate audiences — recentAvailability is every employee's own
  // submission history (mirrors recentPto below), pendingAvailabilityCount is HR-wide and
  // only ever fetched for an admin (listAdminAvailability itself throws ForbiddenError for
  // anyone else, same guard admin/availability/page.tsx already relies on).
  const recentAvailability = (await listMyAvailability(employee)).slice(0, 3);
  const pendingAvailabilityCount = isAdmin(employee)
