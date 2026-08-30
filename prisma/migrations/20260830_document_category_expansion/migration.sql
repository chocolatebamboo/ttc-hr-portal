-- AlterEnum
-- Splits the "NDA + Code of Conduct + Media Release" concept into distinct, selectable
-- DocumentCategory values so each can be uploaded/labeled/reported on individually, rather than
-- being lumped under OTHER or EMPLOYEE_FORM. Additive only — no existing rows reference these
-- values yet (the Document table is currently empty), so nothing needs a backfill.
ALTER TYPE "DocumentCategory" ADD VALUE 'NDA_AGREEMENT';
ALTER TYPE "DocumentCategory" ADD VALUE 'CODE_OF_CONDUCT';
ALTER TYPE "DocumentCategory" ADD VALUE 'MEDIA_RELEASE';
