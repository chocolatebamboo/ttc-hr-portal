import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { getOnboardingAttention } from "@/lib/onboarding";
import { navForRole } from "@/lib/nav";
import { ChevronRightIcon } from "@/components/icons";

export default async function MorePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const { primary, extra } = navForRole(employee.role);
  // Home/My Time/Documents already live in the bottom bar — this screen is everything
  // past those, plus the admin section for roles that have one.
  const rest = primary.filter((i) => !["/dashboard", "/time", "/documents"].includes(i.href));

  // Same live attention flag BottomNav puts a dot on "More" for — repeated here on the actual
  // Onboarding row, since this is the screen that dot is pointing at.
  const { needsAttention: needsOnboardingAttention } = await getOnboardingAttention(employee);

  return (
    <div className="max-w-md md:hidden pb-4">
      <h1 className="page-title text-2xl mb-4">More</h1>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {rest.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="flex items-center justify-between px-4 py-3.5">
              <span className="flex items-center gap-3 text-sm">
                <Icon className="h-[18px] w-[18px] text-muted shrink-0" />
                {item.label}
                {item.href === "/onboarding" && needsOnboardingAttention && (
                  <span aria-label="Needs attention" className="h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </span>
              <ChevronRightIcon className="h-4 w-4 text-muted" />
            </Link>
          );
        })}
      </div>

      {extra.length > 0 && (
        <>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted/70 mt-6 mb-2 px-1">
            Administration
          </h2>
          <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
            {extra.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="flex items-center justify-between px-4 py-3.5">
                  <span className="flex items-center gap-3 text-sm">
                    <Icon className="h-[18px] w-[18px] text-muted shrink-0" />
                    {item.label}
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-muted" />
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
