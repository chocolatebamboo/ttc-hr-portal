import type { DocumentCategory, DocumentVisibility } from "@/types";

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  EMPLOYEE_HANDBOOK: "Employee Handbook",
  HR_POLICY: "HR Policy",
  JOB_DESCRIPTION: "Job Description",
  OFFER_LETTER: "Offer Letter",
  PERFORMANCE_REVIEW: "Performance Review",
  TRAINING: "Training",
  EMPLOYEE_FORM: "Employee Form",
  CONFIDENTIAL_EMPLOYEE_DOCUMENT: "Confidential Employee Document",
  NDA_AGREEMENT: "NDA / Non-Compete Agreement",
  CODE_OF_CONDUCT: "Code of Conduct",
  MEDIA_RELEASE: "Media Release",
  OTHER: "Other",
};

export const DOCUMENT_VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  GLOBAL: "Everyone",
  DEPARTMENT: "One department",
  INDIVIDUAL: "One employee",
  CONFIDENTIAL_HR: "Confidential — HR/Admin only",
};

export function formatDocumentDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
