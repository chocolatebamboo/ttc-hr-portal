"use client";

import { useEffect, useRef, useState } from "react";
import {
  DOCUMENT_CATEGORY_LABEL,
  DOCUMENT_VISIBILITY_LABEL,
  formatDocumentDate,
  fileExtensionFromName,
} from "@/lib/documents-format";
import {
  DownloadIcon,
  EyeIcon,
  CheckCircleIcon,
  ArchiveIcon,
  FolderIcon,
  ChevronRightIcon,
  GripIcon,
  XIcon,
} from "@/components/icons";
import type {
  DocumentDTO,
  DocumentAdminSummaryDTO,
  DocumentFolderContentsDTO,
  AssignmentOptionsDTO,
  DocumentCategory,
  DocumentVisibility,
} from "@/types";

type LoadState = "loading" | "ready" | "error" | "empty";

/**
 * Correction brief #4 (Sept 2026): "the separate My Documents and Manage experiences are
 * unnecessarily fragmented... create one cohesive My Documents workspace" — one page, no tabs.
 * Every employee sees "Shared with you" (their own assigned documents, unchanged from before);
 * anyone with manage permission ALSO sees the Document Library folder browser directly beneath
 * it on the same page, instead of a second tab they had to click into. The HR-assigned
 * document/acknowledgment workflow (DocumentDTO/MyDocuments below) is completely untouched —
 * only the library an admin organizes gained folders.
 */
export default function DocumentsView({ canManage }: { canManage: boolean }) {
  return (
    <div className="max-w-3xl">
      <h1 className="page-title text-2xl mb-4">My Documents</h1>
      <MyDocuments />
      {canManage && <DocumentLibrary />}
    </div>
  );
}

/**
 * CB, Oct 2026: "view the document internally and... download that document as well" — pulls a
 * signed URL carrying Content-Disposition: attachment (see getSignedDownloadUrl's own doc
 * comment in src/lib/storage.ts) and opens it, same "resolve a URL then window.open it" shape
 * the view actions already use, just with `download=1` so the browser saves the file instead of
 * rendering it. A module-level function rather than something tied to one component's state
 * since both MyDocuments and the Document Library's DocumentTable need the exact same call.
 */
async function triggerDownload(documentId: string) {
  try {
    const res = await fetch(`/api/documents/${documentId}/download?download=1`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
  } catch {
    // best-effort — same silent-fail shape the existing "View" open already had
  }
}

const PREVIEWABLE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

/**
 * CB, Oct 2026: "I should be able to... have an option to view the document internally" — an
 * in-app preview instead of handing off to a new browser tab. Shared by both MyDocuments and the
 * Document Library's DocumentTable so there's exactly one preview surface in this app, not two
 * near-identical ones. Only PDFs and common image types can actually render inline in an
 * <iframe>/<img> (the signed URL is a storage link with no server-side conversion behind it) —
 * everything else (Word docs, spreadsheets, etc.) falls back to a plain "download instead"
 * prompt rather than a blank or broken frame.
 */
function DocumentViewerModal({
  documentId,
  title,
  onClose,
}: {
  documentId: string;
  title: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/documents/${documentId}/download`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.url) {
          setState("error");
          return;
        }
        setUrl(data.url);
        setFileName(data.fileName ?? "");
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const ext = fileExtensionFromName(fileName);
  const isPdf = ext === "pdf";
  const isImage = PREVIEWABLE_IMAGE_EXTENSIONS.has(ext);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl h-[85vh] bg-surface rounded-2xl flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => triggerDownload(documentId)}
              className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted hover:bg-black/[0.05] transition-colors"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-black/[0.03] flex items-center justify-center overflow-auto">
          {state === "loading" && <p className="text-sm text-muted">Loading…</p>}
          {state === "error" && <p className="text-sm text-accent px-6 text-center">Couldn&apos;t load this document.</p>}
          {state === "ready" && isPdf && <iframe src={url} title={title} className="w-full h-full border-0" />}
          {state === "ready" && isImage && (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not a static asset
            <img src={url} alt={title} className="max-w-full max-h-full object-contain" />
          )}
          {state === "ready" && !isPdf && !isImage && (
            <div className="text-center px-6">
              <p className="text-sm text-muted mb-3">Preview isn&apos;t available for this file type.</p>
              <button
                type="button"
                onClick={() => triggerDownload(documentId)}
                className="btn-primary text-sm px-4 py-2"
              >
                Download instead
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee-facing: documents shared with you by HR (unchanged by brief #4)
// ---------------------------------------------------------------------------

function MyDocuments() {
  const [documents, setDocuments] = useState<DocumentDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<{ id: string; title: string } | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDocuments(data.documents);
      setLoadState(data.documents.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/documents/${id}/acknowledge`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const needsAckCount = documents.filter((d) => d.requiresAcknowledgment && !d.acknowledgedAt).length;

  return (
    <div>
      <p className="text-sm text-muted mb-4">
        Documents shared with you by HR. Clicking &ldquo;Acknowledge&rdquo; confirms you&apos;ve read a
        document — it&apos;s a record for HR, not a legal electronic signature.
      </p>

      {needsAckCount > 0 && loadState === "ready" && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent-ink mb-4">
          {needsAckCount} document{needsAckCount === 1 ? "" : "s"} still need{needsAckCount === 1 ? "s" : ""} your
          acknowledgment.
        </div>
      )}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load your documents. Please try again or contact HR.
        </div>
      )}

      {loadState === "empty" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No documents have been shared with you yet.
        </div>
      )}

      {loadState === "ready" && (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {documents.map((doc) => (
            <div key={doc.id} className="px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{doc.title}</p>
                <p className="text-xs text-muted">
                  {DOCUMENT_CATEGORY_LABEL[doc.category as DocumentCategory]} · Added{" "}
                  {formatDocumentDate(doc.createdAt)}
                  {doc.version > 1 ? ` · v${doc.version}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setViewingDoc({ id: doc.id, title: doc.title })}
                  className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <EyeIcon className="h-3.5 w-3.5" />
                  View
                </button>
                <button
                  onClick={() => triggerDownload(doc.id)}
                  className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  Download
                </button>
                {doc.requiresAcknowledgment &&
                  (doc.acknowledgedAt ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-700 font-medium whitespace-nowrap">
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      Acknowledged
                    </span>
                  ) : (
                    <button
                      onClick={() => acknowledge(doc.id)}
                      disabled={busyId === doc.id}
                      className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap"
                    >
                      {busyId === doc.id ? "Saving…" : "Acknowledge"}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewingDoc && (
        <DocumentViewerModal
          documentId={viewingDoc.id}
          title={viewingDoc.title}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HR/Admin: Document Library (correction brief #4) — folded directly into this page instead of
// living behind a separate "Manage" tab. Folder create/open/organize/upload/view/archive/
// version, all gated the same way the old Manage tab already was (canManage / is_admin()).
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS: DocumentCategory[] = [
  "EMPLOYEE_HANDBOOK",
  "HR_POLICY",
  "JOB_DESCRIPTION",
  "OFFER_LETTER",
  "PERFORMANCE_REVIEW",
  "TRAINING",
  "EMPLOYEE_FORM",
  "CONFIDENTIAL_EMPLOYEE_DOCUMENT",
  "NDA_AGREEMENT",
  "CODE_OF_CONDUCT",
  "MEDIA_RELEASE",
  "OTHER",
];

const VISIBILITY_OPTIONS: DocumentVisibility[] = ["GLOBAL", "DEPARTMENT", "INDIVIDUAL", "CONFIDENTIAL_HR"];

// CB, Oct 2026: "I should be able to click and hold and drag documents into a folder" — same
// press-and-hold tuning DragReorderList.tsx already settled on for this app's other drag
// interaction (a deliberate hold, not an instant grab, so a plain tap/click elsewhere on the row
// still behaves normally).
const DRAG_LONG_PRESS_MS = 160;
const DRAG_MOVE_SLOP_PX = 6;

// The attribute every valid drop target (a folder tile, a breadcrumb crumb) carries, holding
// that folder's id — or "" for the library root. elementFromPoint + closest() during the drag is
// what actually finds the hovered one; see the pointer handlers below.
const DROP_TARGET_ATTR = "data-drop-target";

function DocumentLibrary() {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [contents, setContents] = useState<DocumentFolderContentsDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [showUpload, setShowUpload] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<{ id: string; title: string } | null>(null);
  const [versioningId, setVersioningId] = useState<string | null>(null);
  const [versionError, setVersionError] = useState("");

  // Drag-to-move state — see the pointer handlers below (handleGripPointerDown etc.) for how
  // these get set. draggingDoc is also what the floating "ghost" chip near the pointer renders
  // from; dragOverKey ("" = root, a folder id, or null = not over a valid target) drives the
  // highlight on whichever drop target the pointer is currently over.
  const [draggingDoc, setDraggingDoc] = useState<{ id: string; title: string } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const pressTimer = useRef<number | null>(null);
  const cleanupEarly = useRef<(() => void) | null>(null);

  async function load(id: string | null) {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/documents/manage/folders${id ? `?folderId=${id}` : ""}`);
      if (!res.ok) throw new Error();
      const data: DocumentFolderContentsDTO = await res.json();
      setContents(data);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(folderId);
  }, [folderId]);

  function openFolder(id: string | null) {
    setShowNewFolder(false);
    setFolderError("");
    setFolderId(id);
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    setFolderBusy(true);
    setFolderError("");
    try {
      const res = await fetch("/api/documents/manage/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName, parentFolderId: folderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create that folder.");
      setShowNewFolder(false);
      setNewFolderName("");
      await load(folderId);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Couldn't create that folder.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function archive(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/documents/${id}/archive`, { method: "POST" });
      await load(folderId);
    } finally {
      setBusyId(null);
    }
  }

  async function uploadNewVersion(id: string, file: File) {
    setBusyId(id);
    setVersionError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/documents/${id}/version`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVersionError(data.error ?? "Unable to upload a new version. Please try again.");
        return;
      }
      setVersioningId(null);
      await load(folderId);
    } catch {
      setVersionError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function moveDocument(documentId: string, targetFolderId: string | null) {
    setMoveError("");
    try {
      const res = await fetch(`/api/documents/${documentId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMoveError(data.error ?? "Couldn't move that document. Please try again.");
        return;
      }
      await load(folderId);
    } catch {
      setMoveError("Unable to reach the server. Check your connection and try again.");
    }
  }

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (cleanupEarly.current) {
      cleanupEarly.current();
      cleanupEarly.current = null;
    }
  }

  // Armed from a document row's grip handle (DocumentTable below). A short hold has to elapse,
  // with the pointer still roughly where it started, before a drag actually starts — otherwise a
  // plain tap on the handle would hijack every click. Same shape DragReorderList.tsx already
  // uses for its own press-and-hold, just ending in a cross-list drop instead of an in-list swap.
  function handleGripPointerDown(doc: DocumentAdminSummaryDTO, e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    clearPressTimer();

    function onEarlyMove(ev: PointerEvent) {
      if (Math.abs(ev.clientX - startX) > DRAG_MOVE_SLOP_PX || Math.abs(ev.clientY - startY) > DRAG_MOVE_SLOP_PX) {
        clearPressTimer();
      }
    }
    function onEarlyUp() {
      clearPressTimer();
    }
    window.addEventListener("pointermove", onEarlyMove);
    window.addEventListener("pointerup", onEarlyUp, { once: true });
    cleanupEarly.current = () => {
      window.removeEventListener("pointermove", onEarlyMove);
      window.removeEventListener("pointerup", onEarlyUp);
    };

    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      if (cleanupEarly.current) {
        cleanupEarly.current();
        cleanupEarly.current = null;
      }
      setMoveError("");
      setDraggingDoc({ id: doc.id, title: doc.title });
      setDragPos({ x: startX, y: startY });
    }, DRAG_LONG_PRESS_MS);
  }

  useEffect(() => () => clearPressTimer(), []);

  // Live while a drag is armed — tracks the pointer for the floating ghost chip and, via
  // elementFromPoint + closest(DROP_TARGET_ATTR), which drop target (if any) it's currently over.
  // Global listeners rather than per-element handlers because the pointer routinely moves faster
  // than it stays over any one row once a drag starts, same reasoning NotificationBell's own
  // outside-click effect already documents for why this has to be a window-level listener.
  useEffect(() => {
    if (!draggingDoc) return;

    function targetKeyAt(x: number, y: number): string | null {
      const el = document.elementFromPoint(x, y);
      const target = el?.closest(`[${DROP_TARGET_ATTR}]`) as HTMLElement | null;
      return target ? target.getAttribute(DROP_TARGET_ATTR) ?? "" : null;
    }

    function onMove(e: PointerEvent) {
      setDragPos({ x: e.clientX, y: e.clientY });
      setDragOverKey(targetKeyAt(e.clientX, e.clientY));
    }

    function finish(e: PointerEvent) {
      const key = targetKeyAt(e.clientX, e.clientY);
      if (key !== null && draggingDoc) {
        void moveDocument(draggingDoc.id, key === "" ? null : key);
      }
      setDraggingDoc(null);
      setDragPos(null);
      setDragOverKey(null);
    }

    function cancel() {
      setDraggingDoc(null);
      setDragPos(null);
      setDragOverKey(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    // moveDocument closes over folderId/load, which don't need to retrigger this effect — only
    // starting/stopping a drag should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingDoc]);

  const active = (contents?.documents ?? []).filter((d) => !d.archivedAt);
  const archived = (contents?.documents ?? []).filter((d) => d.archivedAt);
  const isEmpty =
    loadState === "ready" && contents !== null && active.length === 0 && archived.length === 0 && contents.folders.length === 0;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold mb-1">Document Library</h2>
      <p className="text-sm text-muted mb-4 max-w-md">
        Organize the shared library into folders, upload documents, and track acknowledgment.
        Press and hold a document to drag it into a folder. Acknowledgment here is a
        read-and-confirm record for HR — not a legal e-signature.
      </p>

      <div className="flex items-center flex-wrap gap-1 text-sm mb-4">
        <button
          type="button"
          onClick={() => openFolder(null)}
          {...{ [DROP_TARGET_ATTR]: "" }}
          className={`font-medium rounded-md px-1 -mx-1 transition-colors ${
            folderId === null ? "text-accent-ink" : "text-muted hover:text-foreground"
          } ${dragOverKey === "" ? "bg-accent/15 ring-2 ring-accent" : ""}`}
        >
          Library
        </button>
        {contents?.breadcrumb.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRightIcon className="h-3.5 w-3.5 text-muted/60" />
            <button
              type="button"
              onClick={() => openFolder(f.id)}
              {...{ [DROP_TARGET_ATTR]: f.id }}
              className={`font-medium text-muted hover:text-foreground rounded-md px-1 -mx-1 transition-colors ${
                dragOverKey === f.id ? "bg-accent/15 ring-2 ring-accent" : ""
              }`}
            >
              {f.name}
            </button>
          </span>
        ))}
        {contents?.folder && (
          <span className="flex items-center gap-1">
            <ChevronRightIcon className="h-3.5 w-3.5 text-muted/60" />
            <span className="font-medium text-accent-ink">{contents.folder.name}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setShowNewFolder((v) => !v);
            setFolderError("");
          }}
          className={showNewFolder ? "btn-neutral text-sm px-4 py-2" : "btn-outline text-sm px-4 py-2"}
        >
          {showNewFolder ? "Cancel" : "+ New Folder"}
        </button>
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          className={showUpload ? "btn-neutral text-sm px-4 py-2" : "btn-primary text-sm px-4 py-2"}
        >
          {showUpload ? "Cancel" : "Upload Document"}
        </button>
      </div>

      {showNewFolder && (
        <div className="rounded-xl border border-border bg-surface p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-2 items-start">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="flex-1 w-full sm:w-auto rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={createFolder}
              disabled={folderBusy || !newFolderName.trim()}
              className="btn-primary text-sm px-4 py-2 shrink-0"
            >
              {folderBusy ? "Creating…" : "Create"}
            </button>
          </div>
          {folderError && <p className="text-xs text-accent mt-2">{folderError}</p>}
        </div>
      )}

      {showUpload && (
        <UploadDocumentForm
          folderId={folderId}
          onUploaded={() => {
            setShowUpload(false);
            load(folderId);
          }}
        />
      )}

      {moveError && <p className="text-xs text-accent mb-3">{moveError}</p>}

      {loadState === "loading" && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-accent">
          Unable to load the document library. Please try again.
        </div>
      )}

      {loadState === "ready" && contents && (
        <div className="space-y-6">
          {contents.folders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {contents.folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => openFolder(f.id)}
                  {...{ [DROP_TARGET_ATTR]: f.id }}
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                    dragOverKey === f.id
                      ? "border-accent bg-accent/10 ring-2 ring-accent"
                      : "border-border bg-surface hover:bg-black/[0.02]"
                  }`}
                >
                  <FolderIcon className="h-5 w-5 text-muted shrink-0" />
                  <span className="text-sm font-medium truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}

          {isEmpty && (
            <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
              This folder is empty. Create a subfolder or upload a document to get started.
            </div>
          )}

          {active.length > 0 && (
            <DocumentTable
              rows={active}
              onArchive={archive}
              onView={(id, title) => setViewingDoc({ id, title })}
              busyId={busyId}
              versioningId={versioningId}
              onVersioningToggle={(id) => {
                setVersionError("");
                setVersioningId((current) => (current === id ? null : id));
              }}
              onUploadVersion={uploadNewVersion}
              versionError={versionError}
              draggingId={draggingDoc?.id ?? null}
              onGripPointerDown={handleGripPointerDown}
            />
          )}
          {archived.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted mb-2">Archived</h3>
              <DocumentTable
                rows={archived}
                onArchive={archive}
                onView={(id, title) => setViewingDoc({ id, title })}
                busyId={busyId}
                archived
                draggingId={null}
              />
            </div>
          )}
        </div>
      )}

      {viewingDoc && (
        <DocumentViewerModal
          documentId={viewingDoc.id}
          title={viewingDoc.title}
          onClose={() => setViewingDoc(null)}
        />
      )}

      {draggingDoc && dragPos && (
        <div
          className="fixed z-[60] pointer-events-none rounded-full bg-foreground text-background text-xs font-medium px-3 py-1.5 shadow-lg max-w-[220px] truncate"
          style={{ left: dragPos.x, top: dragPos.y, transform: "translate(-50%, -130%)" }}
        >
          {draggingDoc.title}
        </div>
      )}
    </div>
  );
}

function DocumentTable({
  rows,
  onArchive,
  onView,
  busyId,
  archived = false,
  versioningId = null,
  onVersioningToggle,
  onUploadVersion,
  versionError = "",
  draggingId,
  onGripPointerDown,
}: {
  rows: DocumentAdminSummaryDTO[];
  onArchive: (id: string) => void;
  onView: (id: string, title: string) => void;
  busyId: string | null;
  archived?: boolean;
  versioningId?: string | null;
  onVersioningToggle?: (id: string) => void;
  onUploadVersion?: (id: string, file: File) => void;
  versionError?: string;
  draggingId: string | null;
  onGripPointerDown?: (doc: DocumentAdminSummaryDTO, e: React.PointerEvent) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
      {rows.map((doc) => (
        <div
          key={doc.id}
          className={`px-4 py-3.5 transition-opacity ${draggingId === doc.id ? "opacity-40" : ""}`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex items-center gap-2">
              {/* CB, Oct 2026: "click and hold and drag documents into a folder" — a dedicated
                  handle rather than the whole row, so pressing "View"/"Archive"/etc. never races
                  against the drag's own long-press timer. touchAction: none stops the browser's
                  own scroll gesture from competing with a finger holding this down. */}
              {!archived && onGripPointerDown && (
                <button
                  type="button"
                  onPointerDown={(e) => onGripPointerDown(doc, e)}
                  aria-label={`Drag ${doc.title} into a folder`}
                  style={{ touchAction: "none" }}
                  className="h-7 w-5 shrink-0 flex items-center justify-center text-muted/50 hover:text-muted cursor-grab active:cursor-grabbing"
                >
                  <GripIcon className="h-4 w-4" />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {doc.title}
                  {doc.version > 1 ? ` · v${doc.version}` : ""}
                </p>
                <p className="text-xs text-muted">
                  {DOCUMENT_CATEGORY_LABEL[doc.category]} · {DOCUMENT_VISIBILITY_LABEL[doc.visibility]}
                  {doc.visibility !== "GLOBAL" ? ` (${doc.assignedToLabel})` : ""} · Added{" "}
                  {formatDocumentDate(doc.createdAt)}
                </p>
                {doc.requiresAcknowledgment && (
                  <p className="text-xs text-muted mt-0.5">
                    {doc.acknowledgedCount} / {doc.eligibleCount} acknowledged at current version
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Archived documents aren't resolvable through the download endpoint (see
                  getDocumentForDownload in src/lib/documents.ts) — kept for the audit trail, not
                  for viewing, so there's no live link to offer here once archived. */}
              {!archived && (
                <>
                  <button
                    onClick={() => onView(doc.id, doc.title)}
                    className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <EyeIcon className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    onClick={() => triggerDownload(doc.id)}
                    className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    Download
                  </button>
                </>
              )}
              {!archived && (
                <>
                  {onVersioningToggle && (
                    <button
                      onClick={() => onVersioningToggle(doc.id)}
                      disabled={busyId === doc.id}
                      className="btn-neutral text-xs px-3 py-1.5"
                    >
                      New version
                    </button>
                  )}
                  <button
                    onClick={() => onArchive(doc.id)}
                    disabled={busyId === doc.id}
                    className="btn-neutral text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <ArchiveIcon className="h-3.5 w-3.5" />
                    {busyId === doc.id ? "Archiving…" : "Archive"}
                  </button>
                </>
              )}
            </div>
          </div>

          {versioningId === doc.id && onUploadVersion && (
            <NewVersionForm
              busy={busyId === doc.id}
              error={versionError}
              onSubmit={(file) => onUploadVersion(doc.id, file)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function NewVersionForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="mt-3 bg-black/[0.02] rounded-lg p-3">
      <p className="text-xs text-muted mb-2">
        Uploading a new version replaces the file team members see and requires everyone to
        acknowledge it again, if this document requires acknowledgment. The old file stays on
        record.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 items-start">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-black/[0.04] file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-black/[0.08]"
        />
        <button
          onClick={() => file && onSubmit(file)}
          disabled={!file || busy}
          className="btn-primary text-xs px-3 py-1.5 shrink-0"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-accent mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

function UploadDocumentForm({ folderId, onUploaded }: { folderId: string | null; onUploaded: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("HR_POLICY");
  const [visibility, setVisibility] = useState<DocumentVisibility>("GLOBAL");
  const [requiresAcknowledgment, setRequiresAcknowledgment] = useState(false);
  const [assigneeEmployeeId, setAssigneeEmployeeId] = useState("");
  const [assigneeDepartmentId, setAssigneeDepartmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<AssignmentOptionsDTO | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    fetch("/api/documents/assignable")
      .then((res) => res.json())
      .then(setOptions)
      .catch(() => setOptions({ departments: [], employees: [] }));
  }, []);

  const needsDepartment = visibility === "DEPARTMENT";
  const needsEmployee = visibility === "INDIVIDUAL" || visibility === "CONFIDENTIAL_HR";
  const confidentialAckDisabled = visibility === "CONFIDENTIAL_HR";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setStatus("error");
      setErrorMessage("Choose a file to upload.");
      return;
    }
    setStatus("submitting");
    setErrorMessage("");

    const form = new FormData();
    form.set("title", title);
    form.set("category", category);
    form.set("visibility", visibility);
    form.set("requiresAcknowledgment", String(requiresAcknowledgment && !confidentialAckDisabled));
    if (needsDepartment) form.set("assigneeDepartmentId", assigneeDepartmentId);
    if (needsEmployee) form.set("assigneeEmployeeId", assigneeEmployeeId);
    if (folderId) form.set("folderId", folderId);
    form.set("file", file);

    try {
      const res = await fetch("/api/documents/manage", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Unable to upload. Please try again.");
        return;
      }
      onUploaded();
    } catch {
      setStatus("error");
      setErrorMessage("Unable to reach the server. Check your connection and try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-5 space-y-4 mb-5">
      <div>
        <label className="block text-sm font-medium mb-1.5">Title</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. 2026 Team Member Handbook"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Visible to</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as DocumentVisibility)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            {VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {DOCUMENT_VISIBILITY_LABEL[v]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {needsDepartment && (
        <div>
          <label className="block text-sm font-medium mb-1.5">Department</label>
          <select
            required
            value={assigneeDepartmentId}
            onChange={(e) => setAssigneeDepartmentId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Choose a department…</option>
            {options?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsEmployee && (
        <div>
          <label className="block text-sm font-medium mb-1.5">Team Member</label>
          <select
            required
            value={assigneeEmployeeId}
            onChange={(e) => setAssigneeEmployeeId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Choose a team member…</option>
            {options?.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {visibility === "CONFIDENTIAL_HR" && (
            <p className="text-xs text-muted mt-1.5">
              This team member will never see this document — confidential means HR/Admin only, regardless
              of who it&apos;s about.
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1.5">File</label>
        <input
          type="file"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-black/[0.04] file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-black/[0.08]"
        />
      </div>

      <label className={`flex items-center gap-2 text-sm ${confidentialAckDisabled ? "text-muted" : ""}`}>
        <input
          type="checkbox"
          checked={requiresAcknowledgment && !confidentialAckDisabled}
          disabled={confidentialAckDisabled}
          onChange={(e) => setRequiresAcknowledgment(e.target.checked)}
          className="h-4 w-4 accent-[var(--ttc-pink)]"
        />
        Require team members to acknowledge they&apos;ve read this
        {confidentialAckDisabled ? " (unavailable — confidential documents aren't shown to team members)" : ""}
      </label>

      {status === "error" && (
        <p role="alert" className="text-sm text-accent">
          {errorMessage}
        </p>
      )}

      <button type="submit" disabled={status === "submitting"} className="btn-primary px-5 py-2.5 text-sm">
        {status === "submitting" ? "Uploading…" : "Upload Document"}
      </button>
    </form>
  );
}
