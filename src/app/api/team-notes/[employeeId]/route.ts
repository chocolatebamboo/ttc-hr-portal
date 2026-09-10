import { NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth";
import { listTeamNotes, postTeamNote, InvalidTeamNoteError, type TeamNoteTopic } from "@/lib/team-notes";
import { uploadTeamNoteFile } from "@/lib/storage";
import { toErrorResponse } from "@/lib/api-errors";
import type { TeamNoteTopicType } from "@/types";

function readTopic(topicType: string | null, topicId: string | null, topicDate: string | null): TeamNoteTopic | undefined {
  if (!topicType) return undefined;
  if (topicType !== "AVAILABILITY_DATE" && topicType !== "PTO_REQUEST") {
    throw new InvalidTeamNoteError("Unrecognized conversation type.");
  }
  if (!topicId) {
    throw new InvalidTeamNoteError("A conversation needs to know which record it's about.");
  }
  const type: TeamNoteTopicType = topicType;
  return type === "AVAILABILITY_DATE"
    ? { type, id: topicId, date: topicDate ?? undefined }
    : { type, id: topicId };
}

/** GET /api/team-notes/[employeeId] — a thread. Self, that employee's supervisor, or an admin
 *  only (listTeamNotes itself enforces this via assertCanAccessEmployeeRecords). With no
 *  ?topicType, this is the general thread; with ?topicType=AVAILABILITY_DATE&topicId=...
 *  &topicDate=... or ?topicType=PTO_REQUEST&topicId=..., it's the narrower conversation about
 *  just that one selected date or PTO request (TeamAvailabilityCards / TeamPtoCards). */
export async function GET(request: Request, ctx: RouteContext<"/api/team-notes/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;

    const params = new URL(request.url).searchParams;
    const topic = readTopic(params.get("topicType"), params.get("topicId"), params.get("topicDate"));

    const notes = await listTeamNotes(employee, employeeId, topic);
    return NextResponse.json({ notes });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/team-notes/[employeeId] — post one message. Multipart: `body` (text, may be empty
 * if a file is attached), an optional `file`, and the same optional `topicType`/`topicId`/
 * `topicDate` fields GET accepts, scoping this one message to a specific conversation instead
 * of the general thread. Same access rule as GET.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/team-notes/[employeeId]">) {
  try {
    const employee = await requireEmployee();
    const { employeeId } = await ctx.params;

    const form = await request.formData();
    const body = String(form.get("body") ?? "");
    const file = form.get("file");
    const topic = readTopic(
      (form.get("topicType") as string | null) ?? null,
      (form.get("topicId") as string | null) ?? null,
      (form.get("topicDate") as string | null) ?? null
    );

    if (file !== null && !(file instanceof File)) {
      throw new InvalidTeamNoteError("That file couldn't be read — please try attaching it again.");
    }

    const attachment =
      file instanceof File && file.size > 0
        ? { key: await uploadTeamNoteFile(file, employeeId), name: file.name }
        : undefined;

    const note = await postTeamNote(employee, employeeId, body, attachment, topic);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
