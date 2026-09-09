import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import TeamNotesThread from "@/components/TeamNotesThread";

/**
 * CB, Sept 2026: "we would be able to communicate back and forth" — the employee's own side
 * of the same thread an admin/their supervisor sees on /team/[employeeId]. Always their own
 * employeeId; there's no picker here, unlike the admin side which can open anyone's.
 */
export default async function NotesPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  return (
    <div className="max-w-2xl">
      <h1 className="page-title text-2xl mb-1">Notes</h1>
      <p className="text-sm text-muted mb-4">Messages and files from your supervisor or HR.</p>
      <TeamNotesThread employeeId={employee.id} viewerId={employee.id} />
    </div>
  );
}
