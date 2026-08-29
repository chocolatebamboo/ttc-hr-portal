import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { setEmployeeAvatar, removeEmployeeAvatar, InvalidEmployeeError } from "@/lib/employees-admin";
import { uploadAvatarFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/admin/employees/[id]/photo — HR/Super Admin only. Multipart form upload (field
 *  name "file") rather than JSON like the rest of this admin API, since this is the one field
 *  on the employee record that's a binary file rather than text. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/employees/[id]/photo">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new InvalidEmployeeError("Choose an image to upload.");
    }

    const storageKey = await uploadAvatarFile(file, id);
    const updated = await setEmployeeAvatar(employee, id, storageKey);
    return NextResponse.json({ employee: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/admin/employees/[id]/photo — clears the photo back to the initials placeholder. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/employees/[id]/photo">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const updated = await removeEmployeeAvatar(employee, id);
    return NextResponse.json({ employee: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
