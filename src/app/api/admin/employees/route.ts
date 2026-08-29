import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listEmployeesForAdmin, createEmployee, InvalidEmployeeError } from "@/lib/employees-admin";
import { toErrorResponse } from "@/lib/api-errors";
import type { EmploymentStatus, Role } from "@/types";

const VALID_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "SUPERVISOR", "EMPLOYEE"];
const VALID_STATUSES: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE", "INACTIVE", "FORMER_EMPLOYEE"];

/** GET /api/admin/employees — HR/Super Admin only. Every employee, active and deactivated. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const employees = await listEmployeesForAdmin(employee);
    return NextResponse.json({ employees });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/admin/employees — HR/Super Admin only. Adds a new employee and sends them a
 *  real Supabase invite email — see createEmployee in src/lib/employees-admin.ts. */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const body = await request.json().catch(() => ({}));

    if (!VALID_ROLES.includes(body.role)) {
      throw new InvalidEmployeeError("Choose a valid role.");
    }
    const hireDate = new Date(body.hireDate);
    if (Number.isNaN(hireDate.getTime())) {
      throw new InvalidEmployeeError("Choose a valid hire date.");
    }

    const created = await createEmployee(employee, {
      firstName: String(body.firstName ?? ""),
      lastName: String(body.lastName ?? ""),
      preferredName: typeof body.preferredName === "string" ? body.preferredName : undefined,
      ttcEmail: String(body.ttcEmail ?? ""),
      jobTitle: String(body.jobTitle ?? ""),
      role: body.role,
      employmentStatus: VALID_STATUSES.includes(body.employmentStatus) ? body.employmentStatus : undefined,
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

    return NextResponse.json({ employee: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
