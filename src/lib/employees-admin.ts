import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAvatarPublicUrl, deleteAvatarFile } from "@/lib/storage";
import type { CurrentEmployee, EmployeeAdminRowDTO, EmploymentStatus, Role } from "@/types";
import type { User } from "@supabase/supabase-js";

export class InvalidEmployeeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmployeeError";
  }
}

type EmployeeWithRelations = {
  id: string;
  userId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ttcEmail: string;
  workPhone: string | null;
  personalPhone: string | null;
  personalEmail: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  jobTitle: string;
  role: string;
  employmentStatus: string;
  departmentId: string | null;
  department: { name: string } | null;
  supervisorId: string | null;
  supervisor: { firstName: string; lastName: string; preferredName: string | null } | null;
  deactivatedAt: Date | null;
  hireDate: Date;
  avatarStorageKey: string | null;
};

/** The three invite-lifecycle facts the Employees page tracks per person: whether they're still
 *  pending, when the most recent invite email went out (initial send OR a later Resend Invite —
 *  Supabase Auth doesn't keep separate history, just the latest), and when they actually
 *  confirmed. Computed from a Supabase Auth `User` in inviteStatusFromAuthUser below, or via a
 *  single getInviteStatus lookup when only the userId is on hand. */
interface InviteStatus {
  pendingInvite: boolean;
  inviteSentAt: string | null;
  inviteAcceptedAt: string | null;
}

const UNKNOWN_INVITE_STATUS: InviteStatus = { pendingInvite: false, inviteSentAt: null, inviteAcceptedAt: null };

/** `invited_at` is what Supabase Auth's own admin API docs show getting set by
 *  inviteUserByEmail; `confirmation_sent_at` is the fallback for the rare case a user exists
 *  without it (e.g. never actually invited through this flow). Both update again on a Resend
 *  Invite, since that's the same inviteUserByEmail call re-run — there's no separate "first
 *  sent" vs "last sent" field to preserve, so this is always just the latest. */
function inviteStatusFromAuthUser(u: User): InviteStatus {
  const inviteAcceptedAt = u.email_confirmed_at ?? null;
  return {
    pendingInvite: !inviteAcceptedAt,
    inviteSentAt: u.invited_at ?? u.confirmation_sent_at ?? null,
    inviteAcceptedAt,
  };
}

function toDTO(e: EmployeeWithRelations, invite: InviteStatus): EmployeeAdminRowDTO {
  return {
    id: e.id,
    avatarUrl: e.avatarStorageKey ? getAvatarPublicUrl(e.avatarStorageKey) : null,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName,
    ttcEmail: e.ttcEmail,
    workPhone: e.workPhone,
    personalPhone: e.personalPhone,
    personalEmail: e.personalEmail,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    emergencyContactRelation: e.emergencyContactRelation,
    jobTitle: e.jobTitle,
    role: e.role as Role,
    employmentStatus: e.employmentStatus as EmploymentStatus,
    departmentId: e.departmentId,
    departmentName: e.department?.name ?? null,
    supervisorId: e.supervisorId,
    supervisorName: e.supervisor
      ? `${e.supervisor.preferredName || e.supervisor.firstName} ${e.supervisor.lastName}`
      : null,
    deactivatedAt: e.deactivatedAt ? e.deactivatedAt.toISOString() : null,
    hireDate: e.hireDate.toISOString(),
    pendingInvite: invite.pendingInvite,
    inviteSentAt: invite.inviteSentAt,
    inviteAcceptedAt: invite.inviteAcceptedAt,
  };
}

const RELATIONS_SELECT = {
  id: true,
  userId: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  ttcEmail: true,
  workPhone: true,
  personalPhone: true,
  personalEmail: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  jobTitle: true,
  role: true,
  employmentStatus: true,
  departmentId: true,
  department: { select: { name: true } },
  supervisorId: true,
  supervisor: { select: { firstName: true, lastName: true, preferredName: true } },
  deactivatedAt: true,
  hireDate: true,
  avatarStorageKey: true,
} as const;

/** Fetches every Supabase Auth user (paginating listUsers — there's no direct "get by email" or
 *  "get all" in the admin SDK, just pages of up to 1000). Shared by every place in this file
 *  that needs to cross-reference an Employee row against its linked Auth account: looking one
 *  up by email (ensureAuthUser), or checking whether every employee has actually confirmed
 *  their invite yet (listEmployeesForAdmin's pendingInvite flag, resendInvite's guard below). */
async function listAllAuthUsers(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>) {
  // Typed directly against the SDK's exported `User`, rather than derived via
  // Awaited<ReturnType<...>>["data"]["users"] — listUsers()'s return type is a discriminated
  // union (a success branch typed `User[]` and an error branch typed `[]`), and indexing
  // through that union to pull out an element type doesn't always resolve cleanly across SDK
  // versions. Explicit is more robust than clever here.
  const users: User[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new InvalidEmployeeError(`Couldn't look up existing accounts: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) break;
    page += 1;
  }
  return users;
}

/** Single, cheap lookup (no pagination needed — Employee.userId already IS the Supabase Auth
 *  user id) for one employee's full invite status. Used by every mutation below whose response
 *  DTO needs to be accurate, even though the frontend always re-fetches the whole roster right
 *  after anyway (see EmployeesAdminView's load() calls) — this keeps the API response itself
 *  honest, not just what ends up on screen. A lookup failure fails toward UNKNOWN_INVITE_STATUS
 *  (pendingInvite: false, no dates) rather than pending, matching the existing precedent in
 *  listEmployeesForAdmin below of hiding Resend Invite over showing it wrongly. */
async function getInviteStatus(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>, userId: string): Promise<InviteStatus> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) return UNKNOWN_INVITE_STATUS;
  return inviteStatusFromAuthUser(data.user);
}

/** Admin roster — every employee, active AND deactivated (unlike Directory/roster.ts, which
 *  both deliberately show active employees only), with the full HR record. This is the one
 *  place in the app that reads personalPhone/personalEmail/emergencyContact* and
 *  employeeCode/hireDate/deactivatedAt — fields Directory's own six-column select never asks
 *  the database for at all (see src/lib/directory.ts). Also cross-references Supabase Auth
 *  (one listAllAuthUsers call, not one lookup per employee) so each row can carry
 *  pendingInvite — whether this person has ever actually confirmed their invite/set a password
 *  — which is what the UI uses to decide whether "Resend Invite" makes sense for them. */
export async function listEmployeesForAdmin(actor: CurrentEmployee): Promise<EmployeeAdminRowDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const authUsers = await listAllAuthUsers(createSupabaseAdminClient());
  const inviteStatusByEmail = new Map(authUsers.map((u) => [u.email?.toLowerCase(), inviteStatusFromAuthUser(u)]));

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employees = await tx.employee.findMany({
      select: RELATIONS_SELECT,
      orderBy: [{ deactivatedAt: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    });
    // Absent from inviteStatusByEmail entirely (shouldn't normally happen — every Employee row
    // is created alongside its Auth account) falls back to UNKNOWN_INVITE_STATUS ("not
    // pending", no dates) rather than "pending", so a lookup hiccup fails toward hiding the
    // Resend Invite button rather than showing it for someone who may already be signed in.
    // Explicit param type: the previous line was the point-free `employees.map(toDTO)`, which
    // never needed employees' own inferred element type to check out — toDTO's declared
    // parameter type carried the checking either way. Passing a second argument here requires
    // wrapping in an arrow function, which does need employees' element type inferable; annotate
    // it directly against EmployeeWithRelations (same type toDTO already declares) instead of
    // relying on that inference.
    return employees.map((e: EmployeeWithRelations) =>
      toDTO(e, inviteStatusByEmail.get(e.ttcEmail.toLowerCase()) ?? UNKNOWN_INVITE_STATUS)
    );
  });
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

/** Finds an existing Supabase Auth user by email, or invites a new one. Mirrors
 *  scripts/create-pilot-accounts.mjs's ensureAuthUser exactly, just reachable from the app
 *  itself instead of a one-off script — re-adding someone whose Auth account already exists
 *  (e.g. a previously deactivated employee) reuses it rather than erroring or double-inviting. */
async function ensureAuthUser(email: string, fullName: string) {
  const supabaseAdmin = createSupabaseAdminClient();

  const existingUsers = await listAllAuthUsers(supabaseAdmin);
  const match = existingUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (match) return { user: match, invited: false };

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (error) throw new InvalidEmployeeError(`Couldn't send the invite email: ${error.message}`);
  return { user: data.user, invited: true };
}

/**
 * Re-sends the Supabase invite email for someone who hasn't set a password yet — their first
 * invite bounced, landed in spam, or they just lost it. This is deliberately NOT available for
 * someone who has already confirmed their account (signed in at least once): resending an
 * "invite" to a returning user isn't the right tool for a lost password, and could be
 * confusing, so this refuses with a clear pointer to "Forgot your password?" instead — the
 * UI's Resend Invite button already only shows up for pendingInvite rows (see
 * listEmployeesForAdmin), but this check protects the API route itself, not just the button.
 */
export async function resendInvite(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");

    const supabaseAdmin = createSupabaseAdminClient();
    const authUsers = await listAllAuthUsers(supabaseAdmin);
    const authUser = authUsers.find((u) => u.email?.toLowerCase() === existing.ttcEmail.toLowerCase());
    if (!authUser) {
      throw new InvalidEmployeeError("Couldn't find their account to resend an invite to.");
    }
    if (authUser.email_confirmed_at) {
      throw new InvalidEmployeeError(
        'This person already signed in and set a password. Resending an invite won’t help — if they’re locked out, tell them to use "Forgot your password?" on the login page instead.'
      );
    }

    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(existing.ttcEmail, {
      data: { full_name: `${existing.firstName} ${existing.lastName}` },
    });
    if (error) throw new InvalidEmployeeError(`Couldn't resend the invite: ${error.message}`);
  });
}

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  ttcEmail: string;
  jobTitle: string;
  role: Role;
  employmentStatus?: EmploymentStatus;
  departmentName?: string;
  supervisorId?: string;
  hireDate: Date;
  workPhone?: string;
  personalPhone?: string;
  personalEmail?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

/**
 * Adds a new employee: invites them via Supabase Auth (a real email with a link to set their
 * own password — nobody, including the admin running this, ever sees or sets it), then creates
 * their Employee row. This is scripts/create-pilot-accounts.mjs's exact flow, built into the
 * app itself instead of a one-off script an admin has to run from a terminal. The invite is
 * sent BEFORE the database write (outside withRlsContext, since it's a Supabase Auth API call,
 * not a Postgres one) — if the Employee row creation then fails, the Auth account is left
 * invited-but-unlinked rather than silently uninvited; re-submitting the same email reuses that
 * account (ensureAuthUser) rather than erroring.
 */
export async function createEmployee(actor: CurrentEmployee, input: CreateEmployeeInput) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const ttcEmail = input.ttcEmail.trim().toLowerCase();
  const jobTitle = input.jobTitle.trim();

  if (!firstName || !lastName) throw new InvalidEmployeeError("First and last name are required.");
  if (!ttcEmail || !ttcEmail.includes("@")) throw new InvalidEmployeeError("A valid email address is required.");
  if (!jobTitle) throw new InvalidEmployeeError("Job title is required.");
  if (Number.isNaN(input.hireDate.getTime())) throw new InvalidEmployeeError("Choose a valid hire date.");
  if (input.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new InvalidEmployeeError("Only a Super Admin can grant the Super Admin role.");
  }

  const { user } = await ensureAuthUser(ttcEmail, `${firstName} ${lastName}`);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const departmentName = input.departmentName?.trim();
    const department = departmentName
      ? await tx.department.upsert({ where: { name: departmentName }, update: {}, create: { name: departmentName } })
      : null;

    const employeeCount = await tx.employee.count();
    const employeeCode = `EMP-${String(employeeCount + 1).padStart(4, "0")}`;

    try {
      const created = await tx.employee.create({
        data: {
          userId: user.id,
          employeeCode,
          firstName,
          lastName,
          preferredName: input.preferredName?.trim() || null,
          ttcEmail,
          jobTitle,
          role: input.role,
          employmentStatus: input.employmentStatus ?? "ACTIVE",
          departmentId: department?.id ?? null,
          supervisorId: input.supervisorId || null,
          hireDate: input.hireDate,
          workPhone: input.workPhone?.trim() || null,
          personalPhone: input.personalPhone?.trim() || null,
          personalEmail: input.personalEmail?.trim() || null,
          emergencyContactName: input.emergencyContactName?.trim() || null,
          emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
          emergencyContactRelation: input.emergencyContactRelation?.trim() || null,
        },
        select: RELATIONS_SELECT,
      });
      return toDTO(created, inviteStatusFromAuthUser(user));
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new InvalidEmployeeError(
          "That email (or employee code) is already in use by another employee record."
        );
      }
      throw err;
    }
  });
}

export interface UpdateEmployeeInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  jobTitle: string;
  role: Role;
  employmentStatus: EmploymentStatus;
  departmentName?: string;
  supervisorId?: string;
  hireDate: Date;
  workPhone?: string;
  personalPhone?: string;
  personalEmail?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

/**
 * Edits everything about an employee EXCEPT their login email and their active/deactivated
 * state — email changes would also need to update the linked Supabase Auth account to stay in
 * sync (out of scope for now, see ADMINISTRATOR_INSTRUCTIONS.md), and deactivation is its own
 * dedicated action below so it can't be fat-fingered inside a big edit form. Two lockout guards:
 * an admin can't use this to grant themselves Super Admin from HR Admin (only an existing Super
 * Admin can), and can't use it to demote/remove their OWN admin access (someone else has to do
 * that) — both are about preventing a single admin from accidentally locking the org out of
 * admin access, not about distrust of any particular admin.
 */
export async function updateEmployee(
  actor: CurrentEmployee,
  employeeId: string,
  input: UpdateEmployeeInput
) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const jobTitle = input.jobTitle.trim();

  if (!firstName || !lastName) throw new InvalidEmployeeError("First and last name are required.");
  if (!jobTitle) throw new InvalidEmployeeError("Job title is required.");
  if (Number.isNaN(input.hireDate.getTime())) throw new InvalidEmployeeError("Choose a valid hire date.");
  if (input.supervisorId === employeeId) {
    throw new InvalidEmployeeError("An employee can't be their own supervisor.");
  }
  const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN"];
  if (employeeId === actor.id && !ADMIN_ROLES.includes(input.role)) {
    throw new InvalidEmployeeError("You can't remove your own admin access — ask another admin to do it.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");

    // Only block an actual CHANGE onto/around the Super Admin role for a non-Super-Admin actor
    // — comparing against the row's current role (not just the submitted value) means an
    // HR Admin editing a colleague who already IS a Super Admin can still save an unrelated
    // change (job title, phone, etc.) without that colleague's role in the payload being
    // mistaken for a fresh grant attempt.
    if (input.role !== existing.role && (input.role === "SUPER_ADMIN" || existing.role === "SUPER_ADMIN") && actor.role !== "SUPER_ADMIN") {
      throw new InvalidEmployeeError("Only a Super Admin can change another Super Admin's role.");
    }

    const departmentName = input.departmentName?.trim();
    const department = departmentName
      ? await tx.department.upsert({ where: { name: departmentName }, update: {}, create: { name: departmentName } })
      : null;

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: {
        firstName,
        lastName,
        preferredName: input.preferredName?.trim() || null,
        jobTitle,
        role: input.role,
        employmentStatus: input.employmentStatus,
        departmentId: department?.id ?? null,
        supervisorId: input.supervisorId || null,
        hireDate: input.hireDate,
        workPhone: input.workPhone?.trim() || null,
        personalPhone: input.personalPhone?.trim() || null,
        personalEmail: input.personalEmail?.trim() || null,
        emergencyContactName: input.emergencyContactName?.trim() || null,
        emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
        emergencyContactRelation: input.emergencyContactRelation?.trim() || null,
      },
      select: RELATIONS_SELECT,
    });
    const invite = await getInviteStatus(createSupabaseAdminClient(), updated.userId);
    return toDTO(updated, invite);
  });
}

/** Revokes login access immediately (see getCurrentEmployee's deactivatedAt check) — separate
 *  from employmentStatus, which stays whatever it was; use the edit form for that. Self-
 *  deactivation is blocked so an admin can never accidentally lock themselves out. */
export async function deactivateEmployee(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (employeeId === actor.id) throw new InvalidEmployeeError("You can't deactivate your own account.");

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { deactivatedAt: new Date() },
      select: RELATIONS_SELECT,
    });
    const invite = await getInviteStatus(createSupabaseAdminClient(), updated.userId);
    return toDTO(updated, invite);
  });
}

export async function reactivateEmployee(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { deactivatedAt: null },
      select: RELATIONS_SELECT,
    });
    const invite = await getInviteStatus(createSupabaseAdminClient(), updated.userId);
    return toDTO(updated, invite);
  });
}

/**
 * Saves a newly-uploaded photo's storage key onto the employee's row, replacing whichever one
 * was there before. The route handler has already done the actual upload (storage.ts's
 * uploadAvatarFile) by the time this runs — this is only the database half. The old file (if
 * any) is deleted after the row update succeeds, not before, so a failed update never leaves
 * the employee pointing at a key that's already gone.
 */
export async function setEmployeeAvatar(actor: CurrentEmployee, employeeId: string, storageKey: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { avatarStorageKey: storageKey },
      select: RELATIONS_SELECT,
    });

    if (existing.avatarStorageKey) await deleteAvatarFile(existing.avatarStorageKey);
    const invite = await getInviteStatus(createSupabaseAdminClient(), updated.userId);
    return toDTO(updated, invite);
  });
}

/** Clears an employee's photo back to the initials placeholder. */
export async function removeEmployeeAvatar(actor: CurrentEmployee, employeeId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!existing) throw new InvalidEmployeeError("That employee record doesn't exist.");

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { avatarStorageKey: null },
      select: RELATIONS_SELECT,
    });

    if (existing.avatarStorageKey) await deleteAvatarFile(existing.avatarStorageKey);
    const invite = await getInviteStatus(createSupabaseAdminClient(), updated.userId);
    return toDTO(updated, invite);
  });
}
