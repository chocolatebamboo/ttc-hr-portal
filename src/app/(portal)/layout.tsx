import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import RoleNav from "@/components/RoleNav";
import BottomNav from "@/components/BottomNav";
import ProfileMenu from "@/components/ProfileMenu";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Middleware already redirects signed-out visitors, but every server render re-checks —
  // a layout that trusted middleware alone would be a single point of failure for auth.
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const displayName = employee.preferredName || employee.firstName;
  const initials = `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase();

  return (
    <div className="flex-1 flex flex-col md:flex-row">
      {/* RoleNav resolves the nav list itself from `role` — nav items carry icon component
          references, and a Server Component can't pass functions as props into a Client
          Component (RSC serialization boundary), so the computed {primary, extra} arrays
          can't cross from here. */}
      <RoleNav role={employee.role} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
          <div className="flex items-center gap-2.5">
            <Image src="/ttc-logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-full" priority />
            <span className="font-serif font-bold text-accent hidden sm:inline">HR Portal</span>
          </div>
          <ProfileMenu displayName={displayName} jobTitle={employee.jobTitle} initials={initials} />
        </header>

        <main className="portal-main-glow flex-1 px-4 md:px-6 py-6 pb-24 md:pb-6">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
