import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { assertIsAdmin } from "@/lib/authorization";
import { createDocument, listAllDocumentsForAdmin, InvalidDocumentError } from "@/lib/documents";
import { uploadDocumentFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";
import type { DocumentCategory, DocumentVisibility } from "@/types";

const VALID_CATEGORIES: DocumentCategory[] = [
  "EMPLOYEE_HANDBOOK",
  "HR_POLICY",
  "JOB_DESCRIPTION",
  "OFFER_LETTER",
  "PERFORMANCE_REVIEW",
  "TRAINING",
  "EMPLOYEE_FORM",
  "CONFIDENTIAL_EMPLOYEE_DOCUMENT",
  "OTHER",
];

const VALID_VISIBILITIES: DocumentVisibility[] = ["GLOBAL", "DEPARTMENT", "INDIVIDUAL", "CONFIDENTIAL_HR"];

/** GET /api/documents/manage — HR/Super Admin only. The full management list. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);
    const documents = await listAllDocumentsForAdmin(employee);
    return NextResponse.json({ documents });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/documents/manage — HR/Super Admin only. Multipart upload: title, category,
 * visibility, requiresAcknowledgment, an optional assignee, and the file itself. The id is
 * generated here (before upload) so the storage key can be namespaced by document id.
 */
export async function POST(request: Request) {
  try {
    const employee = await requireEmployee();
    assertIsAdmin(employee);

    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim();
    const category = form.get("category");
    const visibility = form.get("visibility");
    const requiresAcknowledgment = form.get("requiresAcknowledgment") === "true";
    const assigneeEmployeeId = form.get("assigneeEmployeeId");
    const assigneeDepartmentId = form.get("assigneeDepartmentId");
    const file = form.get("file");

    if (!title) throw new InvalidDocumentError("Title is required.");
    if (!VALID_CATEGORIES.includes(category as DocumentCategory)) {
      throw new InvalidDocumentError("Choose a valid document category.");
    }
    if (!VALID_VISIBILITIES.includes(visibility as DocumentVisibility)) {
      throw new InvalidDocumentError("Choose who this document is visible to.");
    }
    if (!(file instanceof File) || file.size === 0) {
      throw new InvalidDocumentError("Choose a file to upload.");
    }

    const documentId = randomUUID();
    const storageKey = await uploadDocumentFile(file, documentId);

    const document = await createDocument(employee, {
      id: documentId,
      title,
      category: category as DocumentCategory,
      visibility: visibility as DocumentVisibility,
      storageKey,
      requiresAcknowledgment,
      assigneeEmployeeId:
        typeof assigneeEmployeeId === "string" && assigneeEmployeeId ? assigneeEmployeeId : undefined,
      assigneeDepartmentId:
        typeof assigneeDepartmentId === "string" && assigneeDepartmentId ? assigneeDepartmentId : undefined,
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
