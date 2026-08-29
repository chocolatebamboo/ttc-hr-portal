import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { updateEmployee, InvalidEmployeeError } from "@/lib/employees-admin";
import { toErrorResponse } from "@/lib/api-errors";
import type { EmploymentStatus, Role } from "@/types";

const VALID_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "SUPERVISOR", "EMPLOYEE"];
const VALID_STATUSES: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE", "INACTIVE", "FORMER_EMPLOYEE"];

/** PATCH /api/admin/employees/[id] — HR/Super Admin only. Edits everything about an employee
 *  except their login email and active/deactivated state — see updateEmployee's doc comment. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/employees/[id]">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    if (!VALID_ROLES.includes(body.role)) {
      throw new InvalidEmployeeError("Choose a valid role.");
    }
    if (!VALID_STATUSES.includes(body.employmentStatus)) {
      throw new InvalidEmployeeError("Choose a valid employment status.");
    }
    const hireDate = new Date(body.hireDate);
    if (Number.isNaN(hireDate.getTime())) {
      throw new InvalidEmployeeError("Choose a valid hire date.");
    }

    const updated = await updateEmployee(employee, id, {
      firstName: String(body.firstName ?? ""),
      lastName: String(body.lastName ?? ""),
      preferredName: typeof body.preferredName === "string" ? body.preferredName : undefined,
      jobTitle: String(body.jobTitle ?? ""),
      role: body.role,
      employmentStatus: body.employmentStatus,
      departmentName: typeof body.departmentName === "string" ? body.departmentName : undefined,
      supervisorId: typeof body.supervisorId === "string" && body.supervisorId ? body.supervisorId : undefined,
      hireDate,
      workPhone: typeof body.workPhone === "string" ? body.workPhone : undefined,
      personalPhone: typeof body.personalPhone === "string" ? body.personalPhone : undefined,
      personalEmail: typeof body.personalEmail === "string" ? body.personalEmail : undefined,
      emergencyContactName: typeof body.emergencyContactName === "string" ? body.emergencyContactName : undefined,
      emergencyContactPhone: typeof body.emergencyContactPhone === "string" ? body.emergencyContactPhone : undefined,
      emergencyContactRelation:
        typeof body.emergencyContactRelation === "string" ? body.emergencyContactRelation : undefined,
    });

    return NextResponse.json({ employee: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
