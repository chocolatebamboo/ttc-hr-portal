import type { DocumentCategory, DocumentVisibility } from "@/types";

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  EMPLOYEE_HANDBOOK: "Team Member Handbook",
  HR_POLICY: "HR Policy",
  JOB_DESCRIPTION: "Job Description",
  OFFER_LETTER: "Offer Letter",
  PERFORMANCE_REVIEW: "Performance Review",
  TRAINING: "Training",
  EMPLOYEE_FORM: "Team Member Form",
  CONFIDENTIAL_EMPLOYEE_DOCUMENT: "Confidential Team Member Document",
  NDA_AGREEMENT: "NDA / Non-Compete Agreement",
  CODE_OF_CONDUCT: "Code of Conduct",
  MEDIA_RELEASE: "Media Release",
  OTHER: "Other",
};

export const DOCUMENT_VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  GLOBAL: "Everyone",
  DEPARTMENT: "One department",
  INDIVIDUAL: "One team member",
  CONFIDENTIAL_HR: "Confidential — HR/Admin only",
};

export function formatDocumentDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * CB, Oct 2026: "view the document internally and... download that document as well" — the
 * in-app preview needs to know a file's real extension (to decide whether it can render a PDF/
 * image inline or has to fall back to "download instead"), and a real download needs the
 * original filename rather than the storage key's own `<documentId>/<timestamp>-<name>` shape
 * (see uploadDocumentFile in src/lib/storage.ts). Pure string parsing — no storage access — so
 * it's safe to call from both a server route (building the download response) and the client
 * (deciding how to render a preview) without duplicating the stripping logic in two places.
 */
export function fileNameFromStorageKey(storageKey: string): string {
  const base = storageKey.split("/").pop() ?? storageKey;
  return base.replace(/^\d+-/, "") || base;
}

export function fileExtensionFromName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}
