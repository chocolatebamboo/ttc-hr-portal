import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listDepartmentsForAdmin, createDepartment, InvalidDepartmentError } from "@/lib/departments-admin";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/admin/departments — HR/Super Admin only. Every department with its employee count. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const departments = await listDepartmentsForAdmin(employee);
    return NextResponse.json({ departments });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/admin/departments — HR/Super Admin only. Creates an empty department ahead of
 *  assigning anyone to it (the Employees page can also create one implicitly by typing a new
 *  name there — this is for setting up structure before any employee needs it). */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const body = await request.json().catch(() => ({}));
    if (typeof body.name !== "string") throw new InvalidDepartmentError("A department name is required.");

    const created = await createDepartment(employee, body.name);
    return NextResponse.json({ department: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
