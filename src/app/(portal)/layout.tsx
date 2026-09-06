import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { resolveEffectiveEmployee } from "@/lib/preview";
import { getOnboardingAttention } from "@/lib/onboarding";
import RoleNav from "@/components/RoleNav";
import BottomNav from "@/components/BottomNav";
import ProfileMenu from "@/components/ProfileMenu";
import PreviewBanner from "@/components/PreviewBanner";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Middleware already redirects signed-out visitors, but every server render re-checks —
  // a layout that trusted middleware alone would be a single point of failure for auth.
  const real = await getCurrentEmployee();
  if (!real) redirect("/login");

  // `employee` below is deliberately the EFFECTIVE identity, not `real` — while a Super Admin
  // has a "View as" preview active (src/lib/preview.ts), everything from here down (nav,
  // header, the page content children render) renders exactly as the previewed employee would
  // see it. `real` is only used for the banner itself, which is what makes it possible to
  // tell the difference and get back out.
  const { effective: employee, isPreviewing } = await resolveEffectiveEmployee(real);

  const displayName = employee.preferredName || employee.firstName;
  const initials = `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase();

  // Live, not persisted — see getOnboardingAttention's doc comment in src/lib/onboarding.ts.
  // Computed on every portal page load, same as the auth check above.
  const { needsAttention: needsOnboardingAttention } = await getOnboardingAttention(employee);

  return (
    // md:h-screen + md:overflow-hidden turn this into a fixed-height app shell on desktop, so
    // the two md:overflow-y-auto regions below (the nav, and the header+main column) each get
    // their own independent scrollbar instead of the whole document scrolling as one unit —
    // that's what keeps RoleNav on screen while a long page like Time or Availability scrolls.
    // Deliberately md: only: on mobile the page still scrolls normally, which is what
    // BottomNav's own `fixed` positioning (see BottomNav.tsx) is already built to sit on top of.
    //
    // md:min-h-0 on this row and on the header/main column below (CB, Sept 2026, after the
    // first version of this still went blank/wrong once Availability's long calendar was
    // scrolled): without it, a flex item defaults to never shrinking below its own content's
    // height, so main's long calendar content was quietly forcing this whole row taller than
    // the 100vh above actually intends, and md:overflow-hidden had nothing to contain — the
    // document just scrolled as one piece instead of main scrolling on its own. RoleNav also
    // now pins itself independently (see its own doc comment) so it stays correct even if this
    // containment ever slips again.
    <div className="flex-1 flex flex-col md:flex-row md:h-screen md:min-h-0 md:overflow-hidden">
      {/* RoleNav resolves the nav list itself from `role` — nav items carry icon component
          references, and a Server Component can't pass functions as props into a Client
          Component (RSC serialization boundary), so the computed {primary, extra} arrays
          can't cross from here. needsOnboardingAttention is a plain boolean, so it crosses fine. */}
      <RoleNav role={employee.role} needsOnboardingAttention={needsOnboardingAttention} />

      {/* md:min-h-0 overrides the browser's default "a flex item won't shrink below its own
          content's height" behavior. Without it, this column (and main below) could be forced
          taller than the 100vh this row actually has to give them, which is what let a long
          page's content escape md:overflow-hidden's containment and turn into ordinary
          whole-page scroll instead of scrolling inside main — see RoleNav's doc comment for
          what that looked like from CB's side. */}
      <div className="flex-1 flex flex-col min-w-0 md:min-h-0 md:overflow-hidden">
        {isPreviewing && (
          <PreviewBanner
            name={employee.preferredName || `${employee.firstName} ${employee.lastName}`}
            role={employee.role}
          />
        )}
        <header className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3 md:shrink-0">
          <div className="flex items-center gap-2.5">
            <Image src="/ttc-logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-full" priority />
            <span className="font-serif font-bold text-accent hidden sm:inline">HR Portal</span>
          </div>
          <ProfileMenu
            displayName={displayName}
            jobTitle={employee.jobTitle}
            initials={initials}
            avatarUrl={employee.avatarUrl}
          />
        </header>

        <main className="flex-1 px-4 md:px-6 py-6 pb-24 md:pb-6 md:min-h-0 md:overflow-y-auto">{children}</main>
      </div>

      <BottomNav needsOnboardingAttention={needsOnboardingAttention} />
    </div>
  );
}
