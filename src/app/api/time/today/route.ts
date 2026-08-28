import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { getTodayEntry } from "@/lib/time-actions";
import { toErrorResponse } from "@/lib/api-errors";

export async function GET() {
  try {
    const employee = await requireEmployee();
    const entry = await getTodayEntry(employee);
    return NextResponse.json({ entry });
  } catch (err) {
    return toErrorResponse(err);
  }
}
