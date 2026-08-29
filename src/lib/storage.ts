import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Must exist in Supabase as a PRIVATE bucket (not public) — see README "Document storage
// bucket" setup step. A public bucket would make every document readable by URL guessing,
// bypassing every authorization check in this app entirely.
const BUCKET = "documents";

// Long enough that a slow connection can still open the file, short enough that a link
// pasted somewhere it shouldn't be is useless within minutes.
const SIGNED_URL_TTL_SECONDS = 5 * 60;

export class DocumentUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentUploadError";
  }
}

/**
 * Uploads a document file to private storage and returns the storage key to save on the
 * Document row. Callers must already have confirmed (via assertIsAdmin) that the caller may
 * upload documents at all — this function performs no authorization of its own.
 */
export async function uploadDocumentFile(file: File, documentId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
  const storageKey = `${documentId}/${Date.now()}-${safeName}`;

  const bytes = await file.arrayBuffer();
  const { error } = await admin.storage.from(BUCKET).upload(storageKey, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw new DocumentUploadError(`Couldn't upload the file: ${error.message}`);
  }
  return storageKey;
}

/**
 * Mints a short-lived signed URL for a document's file. Callers MUST resolve the Document
 * row through withRlsContext (src/lib/documents.ts) first and confirm it's visible to the
 * caller — that read is the actual authorization check; this function trusts its input
 * completely and will happily sign a URL for any storage key it's given.
 */
export async function getSignedDownloadUrl(storageKey: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    throw new DocumentUploadError(
      `Couldn't generate a download link: ${error?.message ?? "unknown error"}`
    );
  }
  return data.signedUrl;
}
