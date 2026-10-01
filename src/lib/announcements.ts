import { withRlsContext } from "@/lib/db";
import { isAdmin, ForbiddenError } from "@/lib/authorization";
import type {
  CurrentEmployee,
  AnnouncementDTO,
  AnnouncementAdminDTO,
  AnnouncementAudienceType,
} from "@/types";

export class AnnouncementNotFoundError extends Error {
  constructor() {
    super("That announcement doesn't exist.");
    this.name = "AnnouncementNotFoundError";
  }
}

export class InvalidAnnouncementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnnouncementError";
  }
}

type AnnouncementWithAudience = {
  id: string;
  title: string;
  message: string;
  publishDate: Date;
  expirationDate: Date | null;
  createdAt: Date;
  author: { firstName: string; lastName: string; preferredName: string | null };
  audiences: { departmentId: string | null; employeeId: string | null; department: { name: string } | null }[];
};

/** Announcement/AnnouncementAudience carry no RLS (prisma/rls.sql says why: low-sensitivity,
 *  read-mostly reference data) — so unlike every other list function in this app, the
 *  publish-window and audience-match filtering below is genuinely this function's own job, not
 *  a restatement of a database policy. */
function authorName(a: AnnouncementWithAudience): string {
  return `${a.author.preferredName || a.author.firstName} ${a.author.lastName}`;
}

function matchesAudience(a: AnnouncementWithAudience, actor: CurrentEmployee): boolean {
  if (a.audiences.length === 0) return true; // "Everyone" = no audience rows, per the schema comment.
  return a.audiences.some(
    (aud) => aud.employeeId === actor.id || (aud.departmentId && aud.departmentId === actor.departmentId)
  );
}

/** Employee-facing feed: only posts that have started, haven't expired, and are targeted at
 *  this employee (their department, them individually, or Everyone). */
export async function listAnnouncementsForEmployee(actor: CurrentEmployee): Promise<AnnouncementDTO[]> {
  const now = new Date();
  const announcements = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.announcement.findMany({
      where: { publishDate: { lte: now } },
      include: {
        author: { select: { firstName: true, lastName: true, preferredName: true } },
        audiences: { include: { department: { select: { name: true } } } },
      },
      orderBy: { publishDate: "desc" },
    })
  );

  return announcements
    .filter((a) => !a.expirationDate || a.expirationDate >= now)
    .filter((a) => matchesAudience(a, actor))
    .map((a) => ({
      id: a.id,
      title: a.title,
      message: a.message,
      authorName: authorName(a),
      publishDate: a.publishDate.toISOString(),
      expirationDate: a.expirationDate ? a.expirationDate.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    }));
}

function audienceTypeOf(a: AnnouncementWithAudience): AnnouncementAudienceType {
  if (a.audiences.length === 0) return "EVERYONE";
  return a.audiences.some((aud) => aud.departmentId) ? "DEPARTMENTS" : "EMPLOYEES";
}

/** Admin management list: every post, including future-dated and expired ones, with who it
 *  targeted — an employee should never see this about a post that isn't (yet, or anymore)
 *  theirs, which is exactly what makes this a separate function/DTO from the one above. */
export async function listAnnouncementsForAdmin(actor: CurrentEmployee): Promise<AnnouncementAdminDTO[]> {
  if (!isAdmin(actor)) throw new ForbiddenError();

  const now = new Date();
  const announcements = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.announcement.findMany({
      include: {
        author: { select: { firstName: true, lastName: true, preferredName: true } },
        audiences: {
          include: {
            department: { select: { name: true } },
            employee: { select: { firstName: true, lastName: true, preferredName: true } },
          },
        },
      },
      orderBy: { publishDate: "desc" },
    })
  );

  return announcements.map((a) => {
    const audienceType = audienceTypeOf(a);
    let audienceLabel = "Everyone";
    if (audienceType === "DEPARTMENTS") {
      audienceLabel = a.audiences.map((aud) => aud.department?.name).filter(Boolean).join(", ") || "—";
    } else if (audienceType === "EMPLOYEES") {
      audienceLabel =
        a.audiences
          .map((aud) => aud.employee)
          .filter((e): e is NonNullable<typeof e> => Boolean(e))
          .map((e) => `${e.preferredName || e.firstName} ${e.lastName}`)
          .join(", ") || "—";
    }

    return {
      id: a.id,
      title: a.title,
      message: a.message,
      authorName: authorName(a),
      publishDate: a.publishDate.toISOString(),
      expirationDate: a.expirationDate ? a.expirationDate.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
      audienceType,
      audienceLabel,
      isActive: a.publishDate <= now && (!a.expirationDate || a.expirationDate >= now),
    };
  });
}

export interface CreateAnnouncementInput {
  title: string;
  message: string;
  publishDate?: Date;
  expirationDate?: Date;
  audienceType: AnnouncementAudienceType;
  departmentIds?: string[];
  employeeIds?: string[];
}

/** CB, Oct 2026, pointing at a "Quick reminder" post that had sat on the Home dashboard since
 *  Sept 27 with no end in sight: "the announcement should always be at the top but should not be
 *  there forever." The "Expires (optional)" field on the compose form (AnnouncementsView.tsx)
 *  already lets an admin set an end date — this post just never had one set — so the fix here
 *  isn't a new capability, it's a default for when that field is left blank: 7 days from publish,
 *  confirmed via AskUserQuestion ("Yes, default to 7 days") rather than left open-ended. An admin
 *  who actually wants something longer-lived (or permanent) still types a later date — or, if the
 *  post genuinely never needs to expire, the UI doesn't currently offer "never" as distinct from
 *  "I forgot," which is a product question for another day, not something this default decides on
 *  its own. */
const DEFAULT_EXPIRATION_DAYS = 7;

/** Admin posts a new announcement. Audience is exactly one of Everyone (no rows), one or more
 *  departments, or one or more specific employees — never a mix, which is what keeps the admin
 *  list's audienceType/audienceLabel derivation above unambiguous. */
export async function createAnnouncement(actor: CurrentEmployee, input: CreateAnnouncementInput) {
  if (!isAdmin(actor)) throw new ForbiddenError();
  if (!input.title.trim()) throw new InvalidAnnouncementError("Title is required.");
  if (!input.message.trim()) throw new InvalidAnnouncementError("Message is required.");
  if (
    input.expirationDate &&
    input.publishDate &&
    input.expirationDate.getTime() <= input.publishDate.getTime()
  ) {
    throw new InvalidAnnouncementError("The expiration date must be after the publish date.");
  }
  if (input.audienceType === "DEPARTMENTS" && !(input.departmentIds && input.departmentIds.length > 0)) {
    throw new InvalidAnnouncementError("Choose at least one department.");
  }
  if (input.audienceType === "EMPLOYEES" && !(input.employeeIds && input.employeeIds.length > 0)) {
    throw new InvalidAnnouncementError("Choose at least one team member.");
  }

  const publishDate = input.publishDate ?? new Date();
  const expirationDate =
    input.expirationDate ?? new Date(publishDate.getTime() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  return withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.announcement.create({
      data: {
        title: input.title.trim(),
        message: input.message.trim(),
        authorId: actor.id,
        publishDate,
        expirationDate,
        audiences:
          input.audienceType === "DEPARTMENTS"
            ? { create: input.departmentIds!.map((departmentId) => ({ departmentId })) }
            : input.audienceType === "EMPLOYEES"
              ? { create: input.employeeIds!.map((employeeId) => ({ employeeId })) }
              : undefined,
      },
    })
  );
}

/** Admin deletes an announcement outright — there's no archivedAt on this model (unlike
 *  Document), so unlike archiveDocument this really does remove the row, audience rows first. */
export async function deleteAnnouncement(actor: CurrentEmployee, announcementId: string) {
  if (!isAdmin(actor)) throw new ForbiddenError();

  return withRlsContext({ employeeId: actor.id, role: actor.role }, async (tx) => {
    const existing = await tx.announcement.findUnique({ where: { id: announcementId } });
    if (!existing) throw new AnnouncementNotFoundError();

    await tx.announcementAudience.deleteMany({ where: { announcementId } });
    await tx.announcement.delete({ where: { id: announcementId } });
  });
}
