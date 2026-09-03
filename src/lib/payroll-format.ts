import type { PayrollHoursReportDTO } from "@/types";

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
