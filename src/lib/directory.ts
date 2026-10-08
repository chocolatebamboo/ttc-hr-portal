import { withRlsContext } from "@/lib/db";
import { getAvatarPublicUrl } from "@/lib/storage";
import type { CurrentEmployee, DirectoryEntryDTO, Role } from "@/types";

/**
 * The company directory. Every active employee is a visible ROW to every other authenticated
 * employee — see the comment on the widened employee_select policy in prisma/rls.sql for why
 * that's the right place to draw that line. What keeps this from leaking anything sensitive is
 * this function's own `select`: it asks the database for exactly six columns, and nothing else
 * about Employee — not personalPhone, personalEmail, emergencyContact*, employeeCode, hireDate,
 * or deactivatedAt — is ever fetched here, regardless of what RLS would otherwise allow through.
 *
 * avatarStorageKey (Oct 2026, CB: "also make sure the profile pictures are consistant if they
 * changed it throughout") is a deliberate addition to that otherwise-narrow select, not an
 * oversight of the comment above: a profile photo isn't PII the way the fields that comment is
 * actually guarding against are — it's already shown company-wide in every other admin view, and
 * nothing about it is sensitive the way personalPhone/personalEmail/emergencyContact* are.
 *
 * Oct 2026, CB: "the team member shouldn't be able to see my name as far as like reaching out to
 * me at all... I'm just the overseeing eye." A SUPER_ADMIN row is hidden from every OTHER viewer
 * (own row still shows to the SUPER_ADMIN themselves, which is harmless and keeps this one rule
 * simple rather than special-casing "except mine") — confirmed to apply across the board, not
 * just to plain Team Members, so this is a plain role check rather than something scoped to
 * actor.role. This is the single source every contact surface reads from (the Directory page
 * itself, Messages' "New message" picker, and its @mention lookup all call listDirectory()), so
 * hiding the row here is what makes all three disappear at once. postMessage (in
 * src/lib/direct-messages.ts) backs this up server-side for anyone who already has a stale deep
 * link or an old @mention — the UI not offering a path in isn't itself an access control.
 */
export async function listDirectory(actor: CurrentEmployee): Promise<DirectoryEntryDTO[]> {
  const employees = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.employee.findMany({
      where: {
        deactivatedAt: null,
        OR: [{ role: { not: "SUPER_ADMIN" } }, { id: actor.id }],
      },
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
        avatarStorageKey: true,
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
    avatarUrl: e.avatarStorageKey ? getAvatarPublicUrl(e.avatarStorageKey) : null,
  }));
}
