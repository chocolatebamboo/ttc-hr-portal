import { createBrowserClient } from "@supabase/ssr";

/** A Supabase client for use in Client Components (e.g. the login form). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
