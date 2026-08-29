import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { createNewDocumentVersion, InvalidDocumentError } from "@/lib/documents";
import { uploadDocumentFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/documents/[id]/version — HR/Super Admin only. Multipart upload: just `file`. The
 * replacement is stored under the same documentId namespace as the original upload
 * (uploadDocumentFile keys by documentId, not by version), then the Document row's version is
 * bumped and its storageKey swapped to point at the new file.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/version">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new InvalidDocumentError("Choose a file to upload.");
    }

    const storageKey = await uploadDocumentFile(file, id);
    const document = await createNewDocumentVersion(employee, id, storageKey);

    return NextResponse.json({ document });
  } catch (err) {
    return toErrorResponse(err);
  }
}
