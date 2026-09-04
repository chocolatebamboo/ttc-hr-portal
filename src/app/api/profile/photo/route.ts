import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { setMyAvatar, removeMyAvatar } from "@/lib/profile";
import { InvalidEmployeeError } from "@/lib/employees-admin";
import { uploadAvatarFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/profile/photo — any signed-in employee, sets their OWN photo. Multipart form
 *  upload (field name "file"), same convention as the admin equivalent
 *  (/api/admin/employees/[id]/photo) this mirrors — see AvatarEditor.tsx, which now takes an
 *  `endpoint` prop so the same upload widget drives both routes. */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new InvalidEmployeeError("Choose an image to upload.");
    }

    const storageKey = await uploadAvatarFile(file, employee.id);
    const profile = await setMyAvatar(employee, storageKey);
    return NextResponse.json({ profile });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/profile/photo — clears the caller's own photo back to the initials placeholder. */
export async function DELETE() {
  try {
    const employee = await requireEmployee();
    const profile = await removeMyAvatar(employee);
    return NextResponse.json({ profile });
  } catch (err) {
    return toErrorResponse(err);
  }
}
