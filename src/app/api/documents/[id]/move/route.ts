import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { moveDocumentToFolder } from "@/lib/documents";
import { toErrorResponse } from "@/lib/api-errors";

/** POST /api/documents/[id]/move — HR/Super Admin only. Body { folderId: string | null } — the
 *  Document Library's drag-a-document-onto-a-folder interaction (DocumentsView.tsx). null (or
 *  omitted) moves it back to the library root, same meaning folderId already carries everywhere
 *  else in this feature (createDocument, listDocumentFolderContents). */
export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/move">) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const folderId = typeof body.folderId === "string" && body.folderId ? body.folderId : null;

    const document = await moveDocumentToFolder(employee, id, folderId);
    return NextResponse.json({ document });
  } catch (err) {
    return toErrorResponse(err);
  }
}
