import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * A Supabase client for use in Server Components, Route Handlers, and Server Actions.
 * Supabase Auth owns password hashing, session tokens, and password-reset flows — this
 * app never touches credentials directly (see the brief's "no custom auth crypto" rule).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies — middleware.ts
            // refreshes the session on every request, so this is safe to ignore.
          }
        },
      },
    }
  );
}
