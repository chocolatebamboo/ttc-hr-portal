import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import type { CurrentEmployee, DepartmentAdminRowDTO } from "@/types";

export class InvalidDepartmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDepartmentError";
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

/** True for Postgres foreign-key-violation errors surfaced through Prisma (P2003/P2014-family
 *  codes) — used to turn "still referenced by other rows" into a friendly message instead of a
 *  raw constraint error, without having to separately count every table that can reference a
 *  Department (Employee, DocumentAssignment, AnnouncementAudience) before every delete. */
function isForeignKeyConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2003";
}

/** Every department with a live employee count, for the Administration page. Unlike
 *  listAssignmentOptions in src/lib/roster.ts (bare id/name, for picker dropdowns), this is
 *  the admin-only management view — same underlying table, different job. */
export async function listDepartmentsForAdmin(actor: CurrentEmployee): Promise<DepartmentAdminRowDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const departments = await tx.department.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, createdAt: true, _count: { select: { employees: true } } },
    });
    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      employeeCount: d._count.employees,
      createdAt: d.createdAt.toISOString(),
    }));
  });
}

export async function createDepartment(actor: CurrentEmployee, name: string): Promise<DepartmentAdminRowDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();
  const trimmed = name.trim();
  if (!trimmed) throw new InvalidDepartmentError("A department name is required.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    try {
      const created = await tx.department.create({ data: { name: trimmed } });
      return { id: created.id, name: created.name, employeeCount: 0, createdAt: created.createdAt.toISOString() };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new InvalidDepartmentError(`A department named "${trimmed}" already exists.`);
      }
      throw err;
    }
  });
}

/** Renaming here is exactly what the Employees page's free-text department field would do
 *  anyway if you retyped every affected employee one at a time (upsert-by-name) — this just
 *  does it in one place, in one transaction, without touching any Employee row (departmentId
 *  is unchanged; only the Department row's own name column moves). */
export async function renameDepartment(
  actor: CurrentEmployee,
  departmentId: string,
  name: string
): Promise<DepartmentAdminRowDTO> {
  if (!isAdmin(actor)) throw new ForbiddenError();
  const trimmed = name.trim();
  if (!trimmed) throw new InvalidDepartmentError("A department name is required.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.department.findUnique({ where: { id: departmentId } });
    if (!existing) throw new InvalidDepartmentError("That department doesn't exist.");

    try {
      const updated = await tx.department.update({
        where: { id: departmentId },
        data: { name: trimmed },
        select: { id: true, name: true, createdAt: true, _count: { select: { employees: true } } },
      });
      return {
        id: updated.id,
        name: updated.name,
        employeeCount: updated._count.employees,
        createdAt: updated.createdAt.toISOString(),
      };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new InvalidDepartmentError(`A department named "${trimmed}" already exists.`);
      }
      throw err;
    }
  });
}

/** Only allowed while nothing references the department — an employee assigned to it, a
 *  document or announcement targeted at it. Reassign or clear those first (from the Employees
 *  page, or Documents/Announcements' own Manage tabs) rather than this deleting out from under
 *  them. Rather than pre-checking every table that can reference a Department, this just
 *  attempts the delete and turns the resulting foreign-key error into that same explanation —
 *  one code path instead of three separate existence checks that could drift out of sync with
 *  the schema's actual relations. */
export async function deleteDepartment(actor: CurrentEmployee, departmentId: string): Promise<void> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.department.findUnique({ where: { id: departmentId } });
    if (!existing) throw new InvalidDepartmentError("That department doesn't exist.");

    try {
      await tx.department.delete({ where: { id: departmentId } });
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        throw new InvalidDepartmentError(
          `"${existing.name}" is still assigned to at least one team member, document, or announcement — ` +
            "reassign or remove those first, then delete it."
        );
      }
      throw err;
    }
  });
}
