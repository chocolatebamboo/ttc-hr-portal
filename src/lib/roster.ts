import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import type { CurrentEmployee, AssignmentOptionsDTO } from "@/types";

/**
 * Departments + active employees, for any admin form that assigns something to one of them —
 * the Document upload form's assignee picker and the Announcement composer's audience picker
 * both need exactly this same list, so it lives here once rather than in either feature's own
 * lib file (which would mean one importing from the other for no real reason).
 */
export async function listAssignmentOptions(
  actor: CurrentEmployee
): Promise<AssignmentOptionsDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const [departments, employees] = await Promise.all([
      tx.department.findMany({ orderBy: { name: "asc" } }),
      tx.employee.findMany({
        where: { deactivatedAt: null },
        select: { id: true, firstName: true, lastName: true, preferredName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);

    return {
      departments: departments.map((d) => ({ id: d.id, name: d.name })),
      employees: employees.map((e) => ({
        id: e.id,
        name: `${e.preferredName || e.firstName} ${e.lastName}`,
      })),
    };
  });
}
