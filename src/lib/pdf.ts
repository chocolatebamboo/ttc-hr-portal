/**
 * Minimal, dependency-free PDF writer (CB, Oct 2026: "let's also have the option to download
 * pdf" on the Payroll Hours report). Deliberately hand-rolled rather than pulling in a PDF
 * library (pdfkit, puppeteer, etc.) — this repo's deploy story is "CB pastes files into
 * GitHub's web editor by hand" (see this project's own workflow conventions), and a new
 * dependency means a multi-thousand-line package-lock.json diff she'd have to paste too. A
 * one-table report doesn't need more than the PDF spec's own base-14 fonts (Helvetica/
 * Helvetica-Bold — every PDF reader already has them, nothing to embed) and a handful of text/
 * line/rect operators, so this file writes those bytes directly instead.
 *
 * Coordinates throughout this API are top-down (y = distance from the top of the page, same
 * sense as CSS/canvas) even though PDF's own coordinate space is bottom-up — the flip happens
 * once, internally, when each page's content stream is generated, so every caller gets to think
 * in the same "top of the page is y=0" terms the rest of this app's layout code already uses.
 */

const PAGE_WIDTH = 612; // US Letter, points (72pt = 1in)
const PAGE_HEIGHT = 792;

export type PdfColor = [number, number, number]; // r, g, b, each 0..1

type TextOp = { kind: "text"; x: number; y: number; value: string; font: "F1" | "F2"; size: number; color: PdfColor };
type LineOp = { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: PdfColor; width: number };
type RectOp = { kind: "rect"; x: number; y: number; w: number; h: number; color: PdfColor };
type PageOp = TextOp | LineOp | RectOp;

// WinAnsi (the standard-14 fonts' default encoding when no /Encoding is given) matches Latin-1
// one-for-one across \xa0-\xff — which covers this app's own "·" separator (U+00B7) and any
// accented name — so those pass straight through as single bytes; only the \x80-\x9f range
// actually differs (WinAnsi puts the curly quotes/en-dash/em-dash this codebase does use there,
// which Latin-1 leaves as control codes), so those few are special-cased. Anything still outside
// \x20-\xff after that (an emoji, a rare symbol) falls back to "?" rather than corrupting the
// byte stream — same "degrade, don't crash" spirit as this file's own best-effort fetches
// elsewhere in the app. toBuffer() below writes the whole document as latin1, which is what
// makes emitting these as raw single bytes here correct rather than mojibake. The font objects
// themselves declare /Encoding /WinAnsiEncoding explicitly (rather than relying on a reader's
// default) — an unencoded standard-14 Type1 font falls back to StandardEncoding per the PDF
// spec, which doesn't define 0x96/0x97 as dashes at all, so without this declaration the bytes
// below would render as blank glyphs in a fully spec-compliant reader.
function escapePdfText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "\x96")
    .replace(/—/g, "\x97")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\xff]/g, "?");
}

export class PdfDocument {
  readonly pageWidth = PAGE_WIDTH;
  readonly pageHeight = PAGE_HEIGHT;
  readonly margin: number;
  private pages: PageOp[][] = [];
  private current: PageOp[];

  constructor(opts?: { margin?: number }) {
    this.margin = opts?.margin ?? 50;
    this.current = [];
    this.pages.push(this.current);
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
  }

  text(x: number, y: number, value: string, opts?: { bold?: boolean; size?: number; color?: PdfColor }) {
    this.current.push({
      kind: "text",
      x,
      y,
      value: escapePdfText(value),
      font: opts?.bold ? "F2" : "F1",
      size: opts?.size ?? 10,
      color: opts?.color ?? [0.125, 0.102, 0.133],
    });
  }

  line(x1: number, y: number, x2: number, opts?: { color?: PdfColor; width?: number }) {
    this.current.push({
      kind: "line",
      x1,
      y1: y,
      x2,
      y2: y,
      color: opts?.color ?? [0.894, 0.878, 0.839],
      width: opts?.width ?? 1,
    });
  }

  rect(x: number, y: number, w: number, h: number, opts?: { fill?: PdfColor }) {
    this.current.push({ kind: "rect", x, y, w, h, color: opts?.fill ?? [0, 0, 0] });
  }

  toBuffer(): Buffer {
    const fontRegularId = 3;
    const fontBoldId = 4;
    let nextId = 5;
    const pageObjIds: number[] = [];
    const contentObjIds: number[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      pageObjIds.push(nextId++);
      contentObjIds.push(nextId++);
    }
    const totalObjects = nextId - 1;

    const contentStreams = this.pages.map((ops) => {
      let s = "";
      for (const o of ops) {
        if (o.kind === "line") {
          const y = this.pageHeight - o.y1;
          s += `${o.width} w\n${o.color[0].toFixed(3)} ${o.color[1].toFixed(3)} ${o.color[2].toFixed(3)} RG\n${o.x1.toFixed(2)} ${y.toFixed(2)} m ${o.x2.toFixed(2)} ${y.toFixed(2)} l S\n`;
        } else if (o.kind === "rect") {
          const yBottom = this.pageHeight - (o.y + o.h);
          s += `${o.color[0].toFixed(3)} ${o.color[1].toFixed(3)} ${o.color[2].toFixed(3)} rg\n${o.x.toFixed(2)} ${yBottom.toFixed(2)} ${o.w.toFixed(2)} ${o.h.toFixed(2)} re f\n`;
        } else {
          const y = this.pageHeight - o.y;
          s += `BT\n/${o.font} ${o.size} Tf\n${o.color[0].toFixed(3)} ${o.color[1].toFixed(3)} ${o.color[2].toFixed(3)} rg\n1 0 0 1 ${o.x.toFixed(2)} ${y.toFixed(2)} Tm\n(${o.value}) Tj\nET\n`;
        }
      }
      return s;
    });

    const objects: string[] = [];
    objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
    objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjIds.length} >>\nendobj\n`;
    objects[fontRegularId] = `${fontRegularId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
    objects[fontBoldId] = `${fontBoldId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

    this.pages.forEach((_, i) => {
      const pageId = pageObjIds[i];
      const contentId = contentObjIds[i];
      const stream = contentStreams[i];
      const byteLength = Buffer.byteLength(stream, "latin1");
      objects[pageId] =
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${contentId} 0 R >>\nendobj\n`;
      objects[contentId] = `${contentId} 0 obj\n<< /Length ${byteLength} >>\nstream\n${stream}endstream\nendobj\n`;
    });

    let body = "%PDF-1.4\n";
    const offsets: number[] = new Array(totalObjects + 1).fill(0);
    for (let id = 1; id <= totalObjects; id++) {
      offsets[id] = Buffer.byteLength(body, "latin1");
      body += objects[id];
    }
    const xrefStart = Buffer.byteLength(body, "latin1");
    let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= totalObjects; id++) {
      xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    body += xref;
    body += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(body, "latin1");
  }
}
