import type { OnboardingAdminStatus } from "@/types";

// Same solid-fill pattern as PtoStatusPill — no dark: variants (this app has no dark-mode
// toggle; see that component's note on why dark: classes caused problems here).
const STYLE: Record<OnboardingAdminStatus, string> = {
  ACTION_NEEDED: "bg-rose-100 text-rose-800",
  UPCOMING: "bg-sky-100 text-sky-800",
  WAITING_ON_EMPLOYEE: "bg-amber-100 text-amber-800",
  NOT_STARTED: "bg-black/5 text-muted",
  COMPLETED: "bg-emerald-100 text-emerald-800",
};

const LABEL: Record<OnboardingAdminStatus, string> = {
  ACTION_NEEDED: "Action Needed",
  UPCOMING: "Upcoming",
  WAITING_ON_EMPLOYEE: "Waiting on Team Member",
  NOT_STARTED: "Not Started",
  COMPLETED: "Completed",
};

export default function OnboardingStatusPill({ status }: { status: OnboardingAdminStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
