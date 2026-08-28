import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { navForRole } from "@/lib/nav";
import RoleNav from "@/components/RoleNav";
import BottomNav from "@/components/BottomNav";
import SignOutButton from "@/components/SignOutButton";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Middleware already redirects signed-out visitors, but every server render re-checks —
  // a layout that trusted middleware alone would be a single point of failure for auth.
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const { primary, extra } = navForRole(employee.role);
  const displayName = employee.preferredName || employee.firstName;

  return (
    <div className="flex-1 flex flex-col md:flex-row">
      <RoleNav primary={primary} extra={extra} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-brand text-white text-xs font-semibold flex items-center justify-center">
              TTC
            </div>
            <span className="text-sm font-medium hidden sm:inline">HR Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted hidden sm:inline">{displayName}</span>
            <SignOutButton />
          </div>
        </header>

        <main className="flex-1 px-4 md:px-6 py-6 pb-24 md:pb-6">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
