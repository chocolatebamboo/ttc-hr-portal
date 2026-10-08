import type { PayrollHoursReportDTO } from "@/types";
import { PdfDocument, type PdfColor } from "@/lib/pdf";
import { formatWeekRange } from "@/lib/week";

const CSV_HEADER = [
  "Employee Code",
  "Name",
  "Department",
  "Regular Hours",
  "Vacation Hours",
  "Sick Hours",
  "Personal Hours",
  "Other Approved Leave Hours",
  "Total Hours",
];

function csvCell(value: string | number): string {
  const s = String(value);
  // Quote whenever the value contains anything a comma-separated reader would otherwise
  // misparse — a comma, a quote (doubled per the CSV spec), or a newline.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds the actual downloadable file — same numbers the preview table shows, just as CSV
 *  text. No wage or tax math happens here or anywhere upstream; this is hours, full stop. */
export function toPayrollCsv(report: PayrollHoursReportDTO): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const row of report.rows) {
    lines.push(
      [
        row.employeeCode,
        row.name,
        row.department ?? "",
        row.regularHours,
        row.vacationHours,
        row.sickHours,
        row.personalHours,
        row.otherLeaveHours,
        row.totalHours,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // \r\n per the CSV spec (RFC 4180) — some payroll import tools are picky about this.
  return lines.join("\r\n") + "\r\n";
}

/** employeeLabel, when given, is the filtered employee's code — folded into the filename so a
 *  single-employee export doesn't land in Downloads looking identical to the full-company one. */
export function payrollCsvFilename(report: PayrollHoursReportDTO, employeeLabel?: string): string {
  const suffix = employeeLabel ? `_${employeeLabel.replace(/[^a-zA-Z0-9-]+/g, "-")}` : "";
  return `ttc-payroll-hours_${report.startDate}_to_${report.endDate}${suffix}.csv`;
}

/** Same filename convention as payrollCsvFilename, just .pdf. */
export function payrollPdfFilename(report: PayrollHoursReportDTO, employeeLabel?: string): string {
  const suffix = employeeLabel ? `_${employeeLabel.replace(/[^a-zA-Z0-9-]+/g, "-")}` : "";
  return `ttc-payroll-hours_${report.startDate}_to_${report.endDate}${suffix}.pdf`;
}

// Brand palette, as 0–1 RGB — same hex values as globals.css's --ttc-pink/--ttc-pink-ink/
// --foreground/--muted/--border, just converted for the PDF writer's own color format.
const TTC_PINK_INK: PdfColor = [0.722, 0, 0.435];
const FOREGROUND: PdfColor = [0.125, 0.102, 0.133];
const MUTED: PdfColor = [0.42, 0.396, 0.376];
const BORDER: PdfColor = [0.894, 0.878, 0.839];
const WHITE: PdfColor = [1, 1, 1];

// Left-aligned column x-offsets (relative to the page margin) — see pdf.ts's own doc comment on
// why these are left- rather than right-aligned.
const COLUMNS: { key: keyof PayrollHoursReportDTO["rows"][number]; label: string; x: number }[] = [
  { key: "name", label: "Team Member", x: 0 },
  { key: "department", label: "Department", x: 125 },
  { key: "regularHours", label: "Regular", x: 230 },
  { key: "vacationHours", label: "Vacation", x: 282 },
  { key: "sickHours", label: "Sick", x: 334 },
  { key: "personalHours", label: "Personal", x: 376 },
  { key: "otherLeaveHours", label: "Other Leave", x: 428 },
  { key: "totalHours", label: "Total", x: 498 },
];

function cellText(row: PayrollHoursReportDTO["rows"][number], key: (typeof COLUMNS)[number]["key"]): string {
  const value = row[key];
  if (key === "department") return (value as string | null) ?? "—";
  if (typeof value === "number") return value.toFixed(2);
  return String(value);
}

/** The full-company (or full-department/-status-filtered, but always multi-row) layout — a
 *  plain title, the period, the same unapproved-entries note the in-app banner shows, and the
 *  table itself, paginating with a repeated header row whenever a period runs long enough to
 *  spill past one page. */
function renderTablePdf(doc: PdfDocument, report: PayrollHoursReportDTO): void {
  const left = doc.margin;
  const right = doc.pageWidth - doc.margin;
  let y = doc.margin;

  doc.text(left, y, "TTC HR Portal", { size: 9, color: MUTED });
  y += 22;
  doc.text(left, y, "Payroll Hours", { bold: true, size: 18, color: TTC_PINK_INK });
  y += 20;
  doc.text(left, y, `Period: ${formatWeekRange(report.startDate, report.endDate)}`, { size: 10, color: FOREGROUND });
  y += 26;

  if (report.unapprovedEntryCount > 0) {
    const n = report.unapprovedEntryCount;
    doc.text(
      left,
      y,
      `${n} time ${n === 1 ? "entry" : "entries"} in this period ${n === 1 ? "isn't" : "aren't"} approved yet — ${n === 1 ? "its" : "their"} hours aren't included below.`,
      { size: 8.5, color: TTC_PINK_INK }
    );
    y += 22;
  }

  const drawHeaderRow = () => {
    for (const col of COLUMNS) {
      doc.text(left + col.x, y, col.label, { bold: true, size: 8.5, color: MUTED });
    }
    y += 8;
    doc.line(left, y, right, { color: BORDER, width: 1 });
    y += 14;
  };

  drawHeaderRow();

  for (const row of report.rows) {
    if (y > doc.pageHeight - doc.margin - 20) {
      doc.addPage();
      y = doc.margin;
      drawHeaderRow();
    }
    for (const col of COLUMNS) {
      doc.text(left + col.x, y, cellText(row, col.key), { size: 8.5, color: FOREGROUND });
    }
    y += 18;
  }

  if (report.rows.length === 0) {
    doc.text(left, y, "No approved hours in this period.", { size: 9, color: MUTED });
  }
}

/** The single-employee layout — mirrors the Reports page's own "full report" screen (identity
 *  banner + a labeled breakdown) rather than a one-row version of the table above, since a
 *  wide 8-column table reads badly once it's carrying just one person's numbers. */
function renderSingleEmployeePdf(doc: PdfDocument, report: PayrollHoursReportDTO): void {
  const left = doc.margin;
  const right = doc.pageWidth - doc.margin;
  const width = right - left;
  const row = report.rows[0];
  let y = doc.margin;

  doc.text(left, y, "TTC HR Portal · Payroll Hours", { size: 9, color: MUTED });
  y += 22;

  const bannerTop = y;
  const bannerHeight = 56;
  doc.rect(left, bannerTop, width, bannerHeight, { fill: TTC_PINK_INK });
  doc.text(left + 16, bannerTop + 24, row.name, { bold: true, size: 15, color: WHITE });
  doc.text(left + 16, bannerTop + 42, `${row.employeeCode}${row.department ? ` · ${row.department}` : ""}`, {
    size: 9.5,
    color: WHITE,
  });
  doc.text(right - 16 - 150, bannerTop + 24, "Period", { size: 8, color: WHITE });
  doc.text(right - 16 - 150, bannerTop + 40, formatWeekRange(report.startDate, report.endDate), {
    bold: true,
    size: 9.5,
    color: WHITE,
  });
  y = bannerTop + bannerHeight + 24;

  if (report.unapprovedEntryCount > 0) {
    const n = report.unapprovedEntryCount;
    doc.text(
      left,
      y,
      `${n} time ${n === 1 ? "entry" : "entries"} for this person in this period ${n === 1 ? "isn't" : "aren't"} approved yet — ${n === 1 ? "its" : "their"} hours aren't included below.`,
      { size: 8.5, color: TTC_PINK_INK }
    );
    y += 22;
  }

  const breakdown: { label: string; value: number; total?: boolean }[] = [
    { label: "Regular", value: row.regularHours },
    { label: "Vacation", value: row.vacationHours },
    { label: "Sick", value: row.sickHours },
    { label: "Personal", value: row.personalHours },
    { label: "Other Leave", value: row.otherLeaveHours },
    { label: "Total", value: row.totalHours, total: true },
  ];
  for (const line of breakdown) {
    doc.text(left, y, line.label, {
      size: line.total ? 10.5 : 10,
      bold: !!line.total,
      color: line.total ? TTC_PINK_INK : MUTED,
    });
    doc.text(right - 60, y, line.value.toFixed(2), {
      size: line.total ? 11 : 10,
      bold: !!line.total,
      color: line.total ? TTC_PINK_INK : FOREGROUND,
    });
    y += 20;
    if (!line.total) doc.line(left, y - 6, right, { color: BORDER, width: 0.75 });
  }
}

/** Builds the actual downloadable file — same numbers the preview (and the CSV export) shows,
 *  laid out as a one- or two-page PDF instead. employeeLabel follows the exact same convention
 *  as payrollCsvFilename's own — the filtered employee's code, present only when this report is
 *  scoped to one person — and is what picks the single-employee layout over the table. */
export function toPayrollPdf(report: PayrollHoursReportDTO, employeeLabel?: string): Buffer {
  const doc = new PdfDocument({ margin: 50 });
  if (employeeLabel && report.rows.length === 1) {
    renderSingleEmployeePdf(doc, report);
  } else {
    renderTablePdf(doc, report);
  }
  return doc.toBuffer();
}
