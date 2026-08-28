import { prisma } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentEmployee } from "@/types";

/**
 * Resolves the caller's Employee record from their verified Supabase session — never from
 * a client-supplied id/role. Returns null for: no session, no matching Employee row, or an
 * employee HR has deactivated. That last check is what makes deactivation immediate: the
 * very next request after HR flips deactivatedAt, this returns null and every route below
 * treats the caller as logged out, regardless of whether their browser session is still
 * technically valid.
 */
export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const employee = await prisma.employee.findUnique({
    where: { userId: user.id },
  });

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
