import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton so hot-reload doesn't open a new pool every save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Runs `fn` inside a Postgres transaction with the caller's identity set as session
 * variables that prisma/rls.sql's policies key off of. This is what makes Row-Level
 * Security an actual backstop rather than decoration: every query inside `fn` runs on a
 * connection the database itself restricts to rows this employeeId/role may see, fully
 * independent of whatever the calling API route's own authorization check decided.
 *
 * IMPORTANT: this only provides real protection if DATABASE_URL connects as the
 * restricted `app_user` Postgres role created in prisma/rls.sql (NOSUPERUSER, NOBYPASSRLS)
 * — not the default superuser/owner connection string Supabase gives you for migrations.
 * See README.md "Database roles" before deploying.
 *
 * Every authenticated API route should read its data through this helper, not through the
 * bare `prisma` export above.
 */
export async function withRlsContext<T>(
  identity: { employeeId: string; role: string },
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // set_config(..., true) scopes the setting to this transaction only (like SET LOCAL),
    // so it can never leak onto a pooled connection reused by a different request.
    await tx.$executeRaw`select set_config('app.current_employee_id', ${identity.employeeId}, true)`;
    await tx.$executeRaw`select set_config('app.current_role', ${identity.role}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

/**
 * The one query that can't use withRlsContext() above: getCurrentEmployee() (src/lib/auth.ts)
 * resolving a verified Supabase session into an Employee row for the first time in a request.
 * At that point the app doesn't know employeeId yet — that's the whole point of the query — so
 * there's nothing to pass withRlsContext(). The one piece of identity that DOES exist already
 * is the Supabase Auth user id, which this sets as its own session variable; employee_select's
 * userId clause (prisma/rls.sql) is what makes that enough to read exactly one row: the
 * caller's own. Every other query in the app, once employeeId is known, goes through
 * withRlsContext() as normal — this helper exists for this one bootstrapping step only.
 */
export async function withUserIdContext<T>(
  userId: string,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
