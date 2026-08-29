import { withRlsContext } from "@/lib/db";
import type { CurrentEmployee, DirectoryEntryDTO, Role } from "@/types";

/**
 * The company directory. Every active employee is a visible ROW to every other authenticated
 * employee — see the comment on the widened employee_select policy in prisma/rls.sql for why
 * that's the right place to draw that line. What keeps this from leaking anything sensitive is
 * this function's own `select`: it asks the database for exactly six columns, and nothing else
 * about Employee — not personalPhone, personalEmail, emergencyContact*, employeeCode, hireDate,
 * or deactivatedAt — is ever fetched here, regardless of what RLS would otherwise allow through.
 */
export async function listDirectory(actor: CurrentEmployee): Promise<DirectoryEntryDTO[]> {
  const employees = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employee.findMany({
      where: { deactivatedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        jobTitle: true,
        role: true,
        ttcEmail: true,
        workPhone: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    })
  );

  return employees.map((e) => ({
    id: e.id,
    name: `${e.preferredName || e.firstName} ${e.lastName}`,
    jobTitle: e.jobTitle,
    department: e.department?.name ?? null,
    role: e.role as Role,
    email: e.ttcEmail,
    workPhone: e.workPhone,
  }));
}
