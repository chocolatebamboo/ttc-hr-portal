import { withUserIdContext } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAvatarPublicUrl } from "@/lib/storage";
import { resolveEffectiveEmployee } from "@/lib/preview";
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
    avatarUrl: employee.avatarStorageKey ? getAvatarPublicUrl(employee.avatarStorageKey) : null,
  };
}

/** For API routes: resolves the current employee or throws a 401-shaped error. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in, or your account no longer has access.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The identity nearly every route/page in this app resolves as "who's asking." Transparently
 * substitutes in a Super Admin's active "View as" preview target when one is set (see
 * src/lib/preview.ts for the full design and why this is the one place that substitution
 * happens) — every existing call site gets preview support for free, no changes needed. Use
 * requireRealEmployee() below instead, deliberately, anywhere that must always act on the
 * actual signed-in person regardless of preview state (starting/stopping a preview itself,
 * or a persistent "who am I really" banner).
 */
export async function requireEmployee(): Promise<CurrentEmployee> {
  const real = await getCurrentEmployee();
  if (!real) throw new UnauthenticatedError();
  const { effective } = await resolveEffectiveEmployee(real);
  return effective;
}

/** Always the real, actually-signed-in employee — never a "View as" preview target. */
export async function requireRealEmployee(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) throw new UnauthenticatedError();
  return employee;
}
