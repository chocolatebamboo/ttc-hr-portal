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

// Must exist in Supabase as a PUBLIC bucket — see README "Profile photo bucket" setup step.
// Deliberately the opposite choice from `documents` above: a profile photo isn't a
// confidential HR record, and it needs to render as a plain <img src> in lists (Employees
// admin, and eventually Directory/Team) without minting a fresh signed URL per employee on
// every page load. The only thing gating who can SET someone's photo is the app-level
// assertIsAdmin() check in the /api/admin/employees/[id]/photo route — this bucket itself
// grants no upload access, only public read.
const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class AvatarUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarUploadError";
  }
}

/**
 * Uploads a profile photo to public storage and returns the storage key to save on the
 * Employee row. Callers must already have confirmed (via assertIsAdmin) that the caller may
 * set this employee's photo — this function performs no authorization of its own, same
 * convention as uploadDocumentFile above.
 */
export async function uploadAvatarFile(file: File, employeeId: string): Promise<string> {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new AvatarUploadError("Please upload a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError("That image is too large — please use one under 5MB.");
  }

  const admin = createSupabaseAdminClient();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  // Timestamped key (not a fixed "<employeeId>/avatar.<ext>" path) so a freshly-uploaded photo
  // doesn't collide with the old one still cached under the previous public URL — every
  // replacement gets its own URL instead of quietly serving a stale browser-cached image at
  // the same address.
  const storageKey = `${employeeId}/${Date.now()}.${extension}`;

  const bytes = await file.arrayBuffer();
  const { error } = await admin.storage.from(AVATAR_BUCKET).upload(storageKey, bytes, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new AvatarUploadError(`Couldn't upload the photo: ${error.message}`);
  }
  return storageKey;
}

/** Synchronous — just assembles a URL from the project's storage host, no network round trip. */
export function getAvatarPublicUrl(storageKey: string): string {
  const admin = createSupabaseAdminClient();
  return admin.storage.from(AVATAR_BUCKET).getPublicUrl(storageKey).data.publicUrl;
}

/** Best-effort cleanup when a photo is replaced or removed — failures here are logged, not
 *  thrown, since leaving an orphaned file in storage is harmless (nothing still points to it)
 *  and shouldn't block the employee record itself from updating. */
export async function deleteAvatarFile(storageKey: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(AVATAR_BUCKET).remove([storageKey]);
  if (error) {
    console.error(`Couldn't delete old avatar ${storageKey}:`, error.message);
  }
}
