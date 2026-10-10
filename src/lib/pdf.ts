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
    .replace(/…/g, "\x85")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\xff]/g, "?");
}

// Helvetica/Helvetica-Bold glyph widths (Adobe's own standard-14 AFM metrics, 1000 units per
// em) for the printable ASCII range, plus the handful of extra WinAnsi codepoints
// escapePdfText above actually emits (– — … ·) — curly quotes get normalized to straight ones
// before any of this runs, so they never reach here as the actual curly glyphs. Round ten (CB,
// on a downloaded Payroll Hours report, a long Job Title running straight into the Regular-
// hours number next to it: "the words are kind of jumbled up on the PDF... if titles are too
// long"): this file has no access to a real font's metrics otherwise, being a dependency-free
// writer (see this file's own top-of-file doc comment on why) — measureText/truncateToWidth
// below use this table to find out how wide a string will actually render, so a column that's
// too narrow for its content can truncate with an ellipsis instead of silently overlapping
// whatever's drawn next to it.
const HELV_WIDTHS: Record<number, number> = {
  0x20: 278, 0x21: 278, 0x22: 355, 0x23: 556, 0x24: 556, 0x25: 889, 0x26: 667, 0x27: 191,
  0x28: 333, 0x29: 333, 0x2a: 389, 0x2b: 584, 0x2c: 278, 0x2d: 333, 0x2e: 278, 0x2f: 278,
  0x30: 556, 0x31: 556, 0x32: 556, 0x33: 556, 0x34: 556, 0x35: 556, 0x36: 556, 0x37: 556,
  0x38: 556, 0x39: 556, 0x3a: 278, 0x3b: 278, 0x3c: 584, 0x3d: 584, 0x3e: 584, 0x3f: 556,
  0x40: 1015, 0x41: 667, 0x42: 667, 0x43: 722, 0x44: 722, 0x45: 667, 0x46: 611, 0x47: 778,
  0x48: 722, 0x49: 278, 0x4a: 500, 0x4b: 667, 0x4c: 556, 0x4d: 833, 0x4e: 722, 0x4f: 778,
  0x50: 667, 0x51: 778, 0x52: 722, 0x53: 667, 0x54: 611, 0x55: 722, 0x56: 667, 0x57: 944,
  0x58: 667, 0x59: 667, 0x5a: 611, 0x5b: 278, 0x5c: 278, 0x5d: 278, 0x5e: 469, 0x5f: 556,
  0x60: 333, 0x61: 556, 0x62: 556, 0x63: 500, 0x64: 556, 0x65: 556, 0x66: 278, 0x67: 556,
  0x68: 556, 0x69: 222, 0x6a: 222, 0x6b: 500, 0x6c: 222, 0x6d: 833, 0x6e: 556, 0x6f: 556,
  0x70: 556, 0x71: 556, 0x72: 333, 0x73: 500, 0x74: 278, 0x75: 556, 0x76: 500, 0x77: 722,
  0x78: 500, 0x79: 500, 0x7a: 500, 0x7b: 334, 0x7c: 260, 0x7d: 334, 0x7e: 584,
  0x85: 1000, 0x96: 556, 0x97: 1000, 0xb7: 400,
};
const HELV_BOLD_WIDTHS: Record<number, number> = {
  0x20: 278, 0x21: 333, 0x22: 474, 0x23: 556, 0x24: 556, 0x25: 889, 0x26: 722, 0x27: 238,
  0x28: 333, 0x29: 333, 0x2a: 389, 0x2b: 584, 0x2c: 278, 0x2d: 333, 0x2e: 278, 0x2f: 278,
  0x30: 556, 0x31: 556, 0x32: 556, 0x33: 556, 0x34: 556, 0x35: 556, 0x36: 556, 0x37: 556,
  0x38: 556, 0x39: 556, 0x3a: 333, 0x3b: 333, 0x3c: 584, 0x3d: 584, 0x3e: 584, 0x3f: 611,
  0x40: 975, 0x41: 722, 0x42: 722, 0x43: 722, 0x44: 722, 0x45: 667, 0x46: 611, 0x47: 778,
  0x48: 722, 0x49: 278, 0x4a: 556, 0x4b: 722, 0x4c: 611, 0x4d: 833, 0x4e: 722, 0x4f: 778,
  0x50: 667, 0x51: 778, 0x52: 722, 0x53: 667, 0x54: 611, 0x55: 722, 0x56: 667, 0x57: 944,
  0x58: 667, 0x59: 667, 0x5a: 611, 0x5b: 333, 0x5c: 278, 0x5d: 333, 0x5e: 584, 0x5f: 556,
  0x60: 333, 0x61: 556, 0x62: 611, 0x63: 556, 0x64: 611, 0x65: 556, 0x66: 333, 0x67: 611,
  0x68: 611, 0x69: 278, 0x6a: 278, 0x6b: 556, 0x6c: 278, 0x6d: 889, 0x6e: 611, 0x6f: 611,
  0x70: 611, 0x71: 611, 0x72: 389, 0x73: 556, 0x74: 333, 0x75: 611, 0x76: 556, 0x77: 778,
  0x78: 556, 0x79: 556, 0x7a: 500, 0x7b: 389, 0x7c: 280, 0x7d: 389, 0x7e: 584,
  0x85: 1000, 0x96: 556, 0x97: 1000, 0xb7: 400,
};
// Fallback for any byte outside both tables above (an accented Latin-1 letter in someone's
// name, say) — close to Helvetica's own average lowercase width, good enough to keep
// truncation conservative rather than exact down to the point for the rare character it
// doesn't have real metrics for.
const DEFAULT_GLYPH_WIDTH = 556;

function glyphWidth(code: number, bold: boolean): number {
  const table = bold ? HELV_BOLD_WIDTHS : HELV_WIDTHS;
  return table[code] ?? DEFAULT_GLYPH_WIDTH;
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

  /** `maxWidth`, when given, shortens `value` (via truncateToWidth below) to fit before it's
   *  drawn — opt-in per call since most text() calls in this app are short, known-safe labels
   *  that don't need the extra measurement work. */
  text(x: number, y: number, value: string, opts?: { bold?: boolean; size?: number; color?: PdfColor; maxWidth?: number }) {
    const rendered = opts?.maxWidth != null ? this.truncateToWidth(value, opts.maxWidth, opts) : value;
    this.current.push({
      kind: "text",
      x,
      y,
      value: escapePdfText(rendered),
      font: opts?.bold ? "F2" : "F1",
      size: opts?.size ?? 10,
      color: opts?.color ?? [0.125, 0.102, 0.133],
    });
  }

  /** Width, in points, that `value` will actually render at. Measures the exact bytes
   *  escapePdfText will emit (so a curly quote, an em dash, an ellipsis each measure as what
   *  they actually become on the page, not as the original JS character), summed against
   *  Helvetica's own glyph metrics (HELV_WIDTHS/HELV_BOLD_WIDTHS above). */
  measureText(value: string, opts?: { bold?: boolean; size?: number }): number {
    const size = opts?.size ?? 10;
    const escaped = escapePdfText(value);
    let units = 0;
    for (let i = 0; i < escaped.length; i++) {
      const ch = escaped[i];
      // escapePdfText backslash-escapes ( ) and \ themselves with a leading backslash for the
      // PDF string literal's own syntax — that leading backslash isn't a glyph that gets drawn,
      // so it contributes no width of its own; the character right after it is the real glyph.
      if (ch === "\\" && i + 1 < escaped.length && "()\\".includes(escaped[i + 1])) continue;
      units += glyphWidth(escaped.charCodeAt(i), !!opts?.bold);
    }
    return (units / 1000) * size;
  }

  /** Shortens `value` to fit within `maxWidth` points at the given font/size, trimming from the
   *  end and appending an ellipsis — returns `value` unchanged when it already fits. Binary-
   *  searches the longest prefix that fits rather than walking character by character, since a
   *  very long value (an unusually long name, say) would otherwise cost one measureText call per
   *  character removed. */
  truncateToWidth(value: string, maxWidth: number, opts?: { bold?: boolean; size?: number }): string {
    if (this.measureText(value, opts) <= maxWidth) return value;
    const ellipsis = "…";
    if (this.measureText(ellipsis, opts) > maxWidth) return ellipsis;
    let lo = 0;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = value.slice(0, mid).trimEnd() + ellipsis;
      if (this.measureText(candidate, opts) <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo === 0 ? ellipsis : value.slice(0, lo).trimEnd() + ellipsis;
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
