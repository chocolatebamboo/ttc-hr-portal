import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getDocumentForDownload } from "@/lib/documents";
import { getSignedDownloadUrl } from "@/lib/storage";
import { fileNameFromStorageKey } from "@/lib/documents-format";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/documents/[id]/download — returns a short-lived signed URL, it never redirects or
 * streams the file itself. getDocumentForDownload() resolves the row under the caller's own
 * RLS identity FIRST; only a document that read actually returns ever reaches storage.ts.
 *
 * CB, Oct 2026: "view the document internally and... download that document as well" — two
 * distinct actions on the same file, so this route now serves both off one query flag rather
 * than splitting into two routes. `?download=1` mints the URL with Content-Disposition:
 * attachment (named after the original upload, via fileNameFromStorageKey) so opening it saves
 * the file; omitted, the URL is the same inline-rendering link this route always returned, which
 * DocumentsView.tsx's preview modal loads into an <iframe>/<img>. `fileName` is returned either
 * way so the client can tell a previewable PDF/image apart from something it has to fall back to
 * "download instead" for, without this route needing to know anything about rendering.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/download">) {
  try {
    const employee = await requireEmployee();
    const { id } = await ctx.params;
    const document = await getDocumentForDownload(employee, id);
    const fileName = fileNameFromStorageKey(document.storageKey);
    const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
    const url = await getSignedDownloadUrl(document.storageKey, wantsDownload ? { download: fileName } : undefined);
    return NextResponse.json({ url, fileName });
  } catch (err) {
    return toErrorResponse(err);
  }
}
