import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDocumentForDownload } from "@/lib/documents";
import { getSignedDownloadUrl } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/documents/[id]/download — returns a short-lived signed URL, it never redirects or
 * streams the file itself. getDocumentForDownload() resolves the row under the caller's own
 * RLS identity FIRST; only a document that read actually returns ever reaches storage.ts.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]/download">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const document = await getDocumentForDownload(employee, id);
    const url = await getSignedDownloadUrl(document.storageKey);
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
