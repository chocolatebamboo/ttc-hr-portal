import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { listDocumentFolderContents, createDocumentFolder, InvalidDocumentError } from "@/lib/documents";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/documents/manage/folders?folderId=… — HR/Super Admin only. Correction brief #4
 * (Sept 2026): one level of the document library at a time. Omit folderId (or pass it empty)
 * for the library root — same folderId-null convention listDocumentFolderContents itself uses.
 */
export async function GET(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const folderId = new URL(request.url).searchParams.get("folderId");
    const contents = await listDocumentFolderContents(employee, folderId || null);
    return NextResponse.json(contents);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/documents/manage/folders — HR/Super Admin only. Body: { name, parentFolderId? }. */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);

    const body = await request.json().catch(() => ({}));
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new InvalidDocumentError("Folder name is required.");
    }

    const folder = await createDocumentFolder(employee, {
      name: body.name,
      parentFolderId: typeof body.parentFolderId === "string" && body.parentFolderId ? body.parentFolderId : null,
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
