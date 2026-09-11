import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { withRlsContext } from "@/lib/db";
import { availableQuickActions } from "@/lib/quick-actions";
import { toErrorResponse } from "@/lib/api-errors";

/** PATCH /api/me/quick-actions — saves which Quick Actions tiles the signed-in person wants on
 *  their own dashboard. Body: { keys: string[] }. Keys are filtered down to whatever this
 *  person's own role can actually see (availableQuickActions) rather than trusting the client
 *  list outright — role is what makes a key a legitimate destination for them. */
export async function PATCH(request: Request) {
  try {
    const employee = await requireEmployee();
    const body: unknown = await request.json().catch(() => ({}));
    const requested = (body as { keys?: unknown }).keys;
    if (!Array.isArray(requested) || !requested.every((k) => typeof k === "string")) {
      return NextResponse.json({ error: "keys must be a list of strings." }, { status: 400 });
    }

    const validKeys = new Set(availableQuickActions(employee.role).map((a) => a.key));
    const keys = requested.filter((k) => validKeys.has(k));

    await withRlsContext({ employeeId: employee.id, role: employee.role }, (tx) =>
      tx.employee.update({ where: { id: employee.id }, data: { quickActionKeys: keys } })
    );

    return NextResponse.json({ keys });
  } catch (err) {
    return toErrorResponse(err);
  }
}
