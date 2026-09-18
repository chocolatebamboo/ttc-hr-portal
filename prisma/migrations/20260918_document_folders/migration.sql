-- Correction brief #4 (Sept 2026): "Consolidate My Documents" — HR/Admin can now organize the
-- shared document library into folders instead of one flat list. Write access matches Document
-- itself (is_admin() only, see document_write below) — folders are an admin/HR organizing
-- device, not a new per-employee personal-file feature; the existing employee-assignment/
-- acknowledgment tables (DocumentAssignment, DocumentAcknowledgment) are completely untouched.
--
-- Informational only — already applied directly to the live Supabase project via the Supabase
-- MCP tool, same convention as every other migration in this folder (Render's own build never
-- runs `prisma migrate deploy`; see the project handoff docs).
CREATE TABLE "DocumentFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentFolder_parentFolderId_idx" ON "DocumentFolder"("parentFolderId");

ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "DocumentFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document" ADD COLUMN "folderId" TEXT;
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

alter table "DocumentFolder" enable row level security;
alter table "DocumentFolder" force row level security;

drop policy if exists document_folder_select on "DocumentFolder";
create policy document_folder_select on "DocumentFolder" for select using (is_admin());

drop policy if exists document_folder_write on "DocumentFolder";
create policy document_folder_write on "DocumentFolder" for all using (is_admin()) with check (is_admin());
