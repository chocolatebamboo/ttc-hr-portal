import { withUserIdContext } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentEmployee } from "@/types";

/**
 * Resolves the caller's Employee record from their verified Supabase session — never from
 * a client-supplied id/role. Returns null for: no session, no matching Employee row, or an
 * employee HR has deactivated. That last check is what makes deactivation immediate: the
 * very next request after HR flips deactivatedAt, this returns null and every route below
 * treats the caller as logged out, regardless of whether their browser session is still
 * technically valid.
 *
 * This is the one lookup in the app that can't run through withRlsContext() — employeeId is
 * exactly what this function is trying to discover, so there's nothing to pass it yet. It
 * goes through withUserIdContext() instead (see db.ts and employee_select in prisma/rls.sql),
 * which is what makes this a real RLS-scoped read rather than the bare, unscoped Prisma call
 * it used to be — that version relied on no session identity being set at all, which is not
 * the same thing as being safely readable, and would have silently returned nothing for
 * every user against a real Postgres connection.
 */
export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const employee = await withUserIdContext(user.id, (tx) =>
    tx.employee.findUnique({ where: { userId: user.id } })
  );

  if (!employee) return null;
  if (employee.deactivatedAt) return null;
  if (employee.employmentStatus === "FORMER_EMPLOYEE" || employee.employmentStatus === "INACTIVE") {
    return null;
  }

  return {
    id: employee.id,
    userId: employee.userId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    preferredName: employee.preferredName,
    role: employee.role,
    employmentStatus: employee.employmentStatus,
    jobTitle: employee.jobTitle,
    departmentId: employee.departmentId,
    supervisorId: employee.supervisorId,
  };
}

/** For API routes: resolves the current employee or throws a 401-shaped error. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in, or your account no longer has access.");
    this.name = "UnauthenticatedError";
  }
}

export async function requireEmployee(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) throw new UnauthenticatedError();
  return employee;
}
