import { createClient } from "@supabase/supabase-js";

/**
 * A Supabase client authenticated with the SERVICE ROLE key — it bypasses Supabase Storage's
 * own access rules entirely, so it must never reach the browser and must never be called
 * without an authorization check happening first. Used only by src/lib/storage.ts, for the
 * two operations that genuinely need elevated access: uploading a document file, and minting
 * a short-lived signed URL to read one back. This client enforces nothing on its own — every
 * caller is gated by the RLS-backed read in src/lib/documents.ts, which is the actual
 * authorization chokepoint (see that file's doc comments).
 */
export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — required for the Document Center. See .env.example."
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
