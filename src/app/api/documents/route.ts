import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDocumentsForEmployee } from "@/lib/documents";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/documents — the caller's own visible, active documents (RLS-filtered). */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const documents = await listDocumentsForEmployee(employee);
    return NextResponse.json({ documents });
  } catch (err) {
    return toErrorResponse(err);
  }
}
