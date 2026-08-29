import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listDirectory } from "@/lib/directory";
import { toErrorResponse } from "@/lib/api-errors";

/** GET /api/directory — every active employee, open to any authenticated employee. See
 *  src/lib/directory.ts for why this is safe: RLS decides which employee ROWS are visible,
 *  the query's own `select` decides which COLUMNS ever leave the database. */
export async function GET() {
  try {
    const employee = await requireEmployee();
    const directory = await listDirectory(employee);
    return NextResponse.json({ directory });
  } catch (err) {
    return toErrorResponse(err);
  }
}
