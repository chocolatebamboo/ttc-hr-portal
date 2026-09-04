import { withRlsContext } from "@/lib/db";
import { getAvatarPublicUrl, deleteAvatarFile } from "@/lib/storage";
import type { CurrentEmployee, MyProfileDTO, UpdateMyProfileInput } from "@/types";

export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProfileError";
  }
}

/** No isAdmin() gate anywhere in this file, deliberately — My Profile is every employee's own
 *  record, scoped to actor.id throughout, so any signed-in employee (requireEmployee() at the
 *  route level is the only check that applies) may read and edit their OWN row through here.
 *  What actually keeps this from becoming "edit anything about yourself" is prisma/rls.sql's
 *  employee_self_update policy + enforce_employee_self_update() trigger: the field list below
 *  is the app-layer half of that same boundary, not the only thing enforcing it. */

const SELECT = {
  id: true,
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
  department: { select: { name: true } },
  supervisor: { select: { firstName: true, lastName: true, preferredName: true } },
  hireDate: true,
  avatarStorageKey: true,
  reports: {
    select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: true },
    orderBy: { firstName: "asc" },
  },
} as const;

type SelectedEmployee = {
  id: string;
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
  department: { name: string } | null;
  supervisor: { firstName: string; lastName: string; preferredName: string | null } | null;
  hireDate: Date;
  avatarStorageKey: string | null;
  reports: { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: string }[];
};

function toDTO(e: SelectedEmployee): MyProfileDTO {
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
    role: e.role as MyProfileDTO["role"],
    employmentStatus: e.employmentStatus as MyProfileDTO["employmentStatus"],
    departmentName: e.department?.name ?? null,
    supervisorName: e.supervisor
      ? `${e.supervisor.preferredName || e.supervisor.firstName} ${e.supervisor.lastName}`
      : null,
    hireDate: e.hireDate.toISOString(),
    directReports: e.reports.map((r) => ({
      id: r.id,
      name: `${r.preferredName || r.firstName} ${r.lastName}`,
      jobTitle: r.jobTitle,
    })),
  };
}

export async function getMyProfile(actor: CurrentEmployee): Promise<MyProfileDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const employee = await tx.employee.findUniqueOrThrow({ where: { id: actor.id }, select: SELECT });
    return toDTO(employee);
  });
}

/** Every field here is optional-and-trimmed-to-null, same convention as updateEmployee in
 *  employees-admin.ts — an empty string in the form means "clear this," not "leave it." */
export async function updateMyProfile(
  actor: CurrentEmployee,
  input: UpdateMyProfileInput
): Promise<MyProfileDTO> {
  if (input.personalEmail && !input.personalEmail.includes("@")) {
    throw new InvalidProfileError("That doesn't look like a valid email address.");
  }

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const updated = await tx.employee.update({
      where: { id: actor.id },
      data: {
        preferredName: input.preferredName?.trim() || null,
        workPhone: input.workPhone?.trim() || null,
        personalPhone: input.personalPhone?.trim() || null,
        personalEmail: input.personalEmail?.trim() || null,
        emergencyContactName: input.emergencyContactName?.trim() || null,
        emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
        emergencyContactRelation: input.emergencyContactRelation?.trim() || null,
      },
      select: SELECT,
    });
    return toDTO(updated);
  });
}

export async function setMyAvatar(actor: CurrentEmployee, storageKey: string): Promise<MyProfileDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUniqueOrThrow({
      where: { id: actor.id },
      select: { avatarStorageKey: true },
    });
    const updated = await tx.employee.update({
      where: { id: actor.id },
      data: { avatarStorageKey: storageKey },
      select: SELECT,
    });
    if (existing.avatarStorageKey) await deleteAvatarFile(existing.avatarStorageKey);
    return toDTO(updated);
  });
}

export async function removeMyAvatar(actor: CurrentEmployee): Promise<MyProfileDTO> {
  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.employee.findUniqueOrThrow({
      where: { id: actor.id },
      select: { avatarStorageKey: true },
    });
    const updated = await tx.employee.update({
      where: { id: actor.id },
      data: { avatarStorageKey: null },
      select: SELECT,
    });
    if (existing.avatarStorageKey) await deleteAvatarFile(existing.avatarStorageKey);
    return toDTO(updated);
  });
}
