import { zonedDateTimeToUtc } from "@/lib/time";

/**
 * Builds a minimal, valid iCalendar (.ics) document for a single event — the "Add to Calendar"
 * feature (CB, Oct 2026: "they could add it to their calendar like if they have the iPhone and
 * they could add it to their calendar"). iOS Safari recognizes the text/calendar MIME type and
 * opens its native "Add to Calendar" confirmation sheet directly from a GET response carrying
 * this content — no app install or account linking needed on TTC's side — and the same file
 * works the same way on Android and desktop calendar apps too, not iPhone-only.
 *
 * Deliberately generic (no Shift-specific typing here, mirroring how src/lib/payroll-format.ts
 * sits beside src/lib/payroll.ts) so it's reusable if another confirmed-event type ever wants
 * the same treatment later — see src/lib/shifts.ts's getShiftForCalendar for the Shift-specific
 * lookup/authorization half of this feature, and
 * src/app/api/shifts/[shiftId]/ics/route.ts for where the two meet.
 */
export interface IcsEventInput {
  /** Must be globally unique and stable for the same real-world event — reused on a repeat
   *  download of the same shift so a calendar app updates the existing event instead of
   *  duplicating it, rather than a fresh random id each time. */
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** "YYYY-MM-DD", read as a wall-clock date in `timeZone`. */
  date: string;
  /** "HH:MM" (24-hour), read as wall-clock times in `timeZone`. */
  startTime: string;
  endTime: string;
  /** Defaults to ORG_TIMEZONE (src/lib/time.ts) — every shift's date/startTime/endTime are
   *  always TTC-local wall-clock values, never UTC, same as everywhere else this app reads them. */
  timeZone?: string;
}

/** RFC 5545 §3.3.11 TEXT escaping — backslash, semicolon, comma, and newline are the only
 *  characters that need it for the plain fields (SUMMARY/DESCRIPTION/LOCATION) this builder
 *  writes. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** A real Date -> "YYYYMMDDTHHMMSSZ", the UTC form every DTSTAMP/DTSTART/DTEND below uses. */
function toIcsUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** One VEVENT wrapped in its own VCALENDAR — every "Add to Calendar" download is for exactly
 *  one shift at a time (CB's own call, via AskUserQuestion: "One shift at a time," not a
 *  whole-week batch), so there's never a reason to build a multi-event file here. */
export function buildIcsEvent(input: IcsEventInput): string {
  const start = zonedDateTimeToUtc(input.date, input.startTime, input.timeZone);
  const end = zonedDateTimeToUtc(input.date, input.endTime, input.timeZone);
  const now = toIcsUtcStamp(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Talented Teen Club//HR Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toIcsUtcStamp(start)}`,
    `DTEND:${toIcsUtcStamp(end)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  // RFC 5545 requires CRLF line endings — plain "\n" renders fine in most calendar apps too,
  // but CRLF is what the spec actually asks for and costs nothing extra to get right.
  return lines.join("\r\n") + "\r\n";
}
