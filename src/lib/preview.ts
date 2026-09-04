import { cookies } from "next/headers";
import { withRlsContext } from "@/lib/db";
import { getAvatarPublicUrl } from "@/lib/storage";
import { ForbiddenError } from "@/lib/authorization";
import type { CurrentEmployee } from "@/types";

/**
 * "View as [role]" — lets a Super Admin temporarily see the app exactly as one specific real
 * employee would (their nav, their dashboard, their data), without creating a throwaway
 * account or ever actually changing anyone's session/identity. Built for the Aug 2026 request
 * to sanity-check the Mentor/Supervisor experience against the admin's own before handing the
 * portal off to a director.
 *
 * Design, and why it's safe:
 *  - The cookie below carries only a target employeeId — nothing that grants access on its
 *    own. Every time it's honored (resolveEffectiveEmployee), the REAL caller is re-resolved
 *    fresh from their actual Supabase session and re-checked as SUPER_ADMIN before the cookie
 *    is trusted at all. A forged or stale cookie on a non-Super-Admin session, or one left
 *    over after a different person signs in on the same browser, is simply ignored — it can
 *    never grant access beyond what that real session already has. No HMAC/signing needed.
 *  - It's strictly read-only. src/proxy.ts blocks every non-GET/HEAD request to /api/* while
 *    the cookie is set (except the stop-preview route itself), so nothing can ever be
 *    submitted, approved, clocked in, or graded "as" the previewed employee. See proxy.ts's
 *    own comment for why that check lives there instead of being duplicated across every
 *    mutating route.
 *  - requireEmployee() (src/lib/auth.ts) is the ONE place this substitution happens, so every
 *    existing route/page that already calls it sees the previewed identity for reads with no
 *    code changes needed anywhere else. requireRealEmployee() is the deliberate escape hatch
 *    for the two control routes below, which must always act on the actual signed-in admin
 *    regardless of whatever preview is currently active.
 */

const PREVIEW_COOKIE = "ttc_preview_employee_id";
// A preview is meant for a single sanity-check session, not a standing mode someone forgets
// they left on — capped short so a forgotten tab can't sit "as" someone else all week.
const PREVIEW_MAX_AGE_SECONDS = 60 * 60 * 4;

export interface EffectiveEmployeeResult {
  /** The real, actually-signed-in employee — always this, never the preview target. */
  real: CurrentEmployee;
  /** What every existing requireEmployee() call site now receives: the preview target while
   *  previewing, otherwise identical to `real`. */
  effective: CurrentEmployee;
  isPreviewing: boolean;
}

function toCurrentEmployee(employee: {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  role: CurrentEmployee["role"];
  employmentStatus: CurrentEmployee["employmentStatus"];
  jobTitle: string;
  departmentId: string | null;
  supervisorId: string | null;
  avatarStorageKey: string | null;
}): CurrentEmployee {
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

/**
 * Given the REAL, already-resolved employee, returns who every read in this request should
 * act as. Never throws — a stale/invalid/unauthorized preview cookie just falls back to
 * `real` rather than breaking the request, since a forgotten cookie shouldn't be able to lock
 * a Super Admin out of their own account.
 */
export async function resolveEffectiveEmployee(real: CurrentEmployee): Promise<EffectiveEmployeeResult> {
  const notPreviewing: EffectiveEmployeeResult = { real, effective: real, isPreviewing: false };

  if (real.role !== "SUPER_ADMIN") return notPreviewing;

  const cookieStore = await cookies();
  const targetId = cookieStore.get(PREVIEW_COOKIE)?.value;
  if (!targetId || targetId === real.id) return notPreviewing;

  const target = await withRlsContext({ employeeId: real.id, role: real.role }, (tx) =>
    tx.employee.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        role: true,
        employmentStatus: true,
        jobTitle: true,
        departmentId: true,
        supervisorId: true,
        avatarStorageKey: true,
        deactivatedAt: true,
      },
    })
  );

  if (!target || target.deactivatedAt) return notPreviewing;

  return { real, effective: toCurrentEmployee(target), isPreviewing: true };
}

/** Super-Admin-only. Validates the target is a real, active, different employee, then sets
 *  the preview cookie. Always called with the REAL actor (requireRealEmployee), never the
 *  possibly-already-previewed one — starting a new preview always replaces any existing one. */
export async function startPreview(actor: CurrentEmployee, targetEmployeeId: string): Promise<void> {
  if (actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only a Super Admin can preview another role.");
  }
  if (targetEmployeeId === actor.id) {
    throw new ForbiddenError("You're already viewing your own account.");
  }

  const target = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employee.findUnique({ where: { id: targetEmployeeId }, select: { id: true, deactivatedAt: true } })
  );
  if (!target || target.deactivatedAt) {
    throw new ForbiddenError("That team member doesn't exist or is deactivated.");
  }

  const cookieStore = await cookies();
  cookieStore.set(PREVIEW_COOKIE, targetEmployeeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_MAX_AGE_SECONDS,
  });
}

/** Clears the preview cookie. Deliberately has no role check beyond being signed in at all —
 *  exiting a preview must always work, even for the (impossible in practice, but never worth
 *  relying on) case of a stale cookie outliving the admin's own role. */
export async function endPreview(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PREVIEW_COOKIE);
}
