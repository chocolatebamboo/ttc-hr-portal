"use client";

import { useEffect, useRef, useState } from "react";

const FONT_SIZES = [12, 14, 16, 18, 24];
const ALIGNMENTS = ["left", "center", "right"] as const;

/**
 * Round seventeen (CB, Oct 2026: "if we're creating like text for tasks and whatnot... I feel
 * like it would be appropriate for us to have like a toolbar with... bold, italicized, bullet
 * points... alignment... you could change the font size, something simple" — asked where this
 * should show up first, CB answered "Task descriptions only"). A deliberately small toolbar over
 * a plain contentEditable div rather than reaching for a full editor library — matches CB's own
 * "I want the UI to be clean... something simple" framing, and this app has exactly one field
 * that needs it so far (DateTasksPanel's description field).
 *
 * Emits sanitized-on-the-way-in-eventually HTML via `onChange` on every edit — this component
 * itself does NOT sanitize (a contentEditable div plus document.execCommand only ever produces
 * the handful of tags its own toolbar below triggers, never a script/img/link), but the actual
 * authoritative sanitization happens server-side, once, in sanitizeRichText (src/lib/rich-text.ts)
 * at the moment a task is created — see that function's own doc comment for why trusting the
 * client here is still safe.
 *
 * `value`/`onChange` is a controlled-ish pair rather than a fully controlled input: a
 * contentEditable element doesn't take React children as its real content, so this only pushes
 * `value` into the DOM when it changed for a reason OTHER than this editor's own last `onChange`
 * (an external reset, e.g. DateTasksPanel clearing the field back to "" after a successful
 * submit) — never on every keystroke's own round trip back down as a prop, which would otherwise
 * fight the caret position on every character typed.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(value);
  const [empty, setEmpty] = useState(!value);
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastEmittedRef.current) {
      el.innerHTML = value;
      lastEmittedRef.current = value;
    }
    setEmpty(el.innerText.trim() === "");
  }, [value]);

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmittedRef.current = html;
    setEmpty(el.innerText.trim() === "");
    onChange(html);
  }

  // Toolbar buttons use onMouseDown + e.preventDefault(), not onClick — clicking a button
  // normally moves focus to it first, which collapses whatever text was selected in the editor
  // before document.execCommand ever runs. Preventing the mousedown's default keeps the editor's
  // own selection intact through the click, the standard trick for a contentEditable toolbar.
  // One flat handler per action (rather than factory functions returning a handler per command)
  // so each button's own onMouseDown reads editorRef.current directly inside a single real event
  // handler, not through a closure built during render.
  function runCommand(e: React.MouseEvent, command: string) {
    e.preventDefault();
    editorRef.current?.focus();
    document.execCommand(command);
    handleInput();
  }

  function applyFontSize(e: React.MouseEvent, px: number) {
    e.preventDefault();
    setFontSizeOpen(false);
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    el.focus();
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = `${px}px`;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(span);
    after.collapse(false);
    sel.addRange(after);
    handleInput();
  }

  function applyAlign(e: React.MouseEvent, align: (typeof ALIGNMENTS)[number]) {
    setAlignOpen(false);
    runCommand(e, `justify${align.charAt(0).toUpperCase()}${align.slice(1)}`);
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-surface">
      <div className="flex items-center gap-0.5 flex-wrap bg-black/[0.025] border-b border-border px-1.5 py-1">
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              setAlignOpen(false);
              setFontSizeOpen((v) => !v);
            }}
            className="h-7 px-2 rounded text-xs font-semibold text-muted hover:bg-black/[0.05]"
          >
            Size ▾
          </button>
          {fontSizeOpen && (
            <div className="absolute left-0 top-full mt-1 z-10 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
              {FONT_SIZES.map((px) => (
                <button
                  key={px}
                  type="button"
                  onMouseDown={(e) => applyFontSize(e, px)}
                  style={{ fontSize: `${Math.min(px, 16)}px` }}
                  className="block w-full text-left px-3 py-1.5 hover:bg-black/[0.04] whitespace-nowrap"
                >
                  {px}px
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="w-px h-5 bg-border mx-0.5" />
        <button type="button" onMouseDown={(e) => runCommand(e, "bold")} title="Bold" className="h-7 w-7 rounded text-sm font-bold text-muted hover:bg-black/[0.05]">
          B
        </button>
        <button type="button" onMouseDown={(e) => runCommand(e, "italic")} title="Italic" className="h-7 w-7 rounded text-sm italic text-muted hover:bg-black/[0.05]">
          I
        </button>
        <button type="button" onMouseDown={(e) => runCommand(e, "underline")} title="Underline" className="h-7 w-7 rounded text-sm underline text-muted hover:bg-black/[0.05]">
          U
        </button>
        <span className="w-px h-5 bg-border mx-0.5" />
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              setFontSizeOpen(false);
              setAlignOpen((v) => !v);
            }}
            title="Alignment"
            className="h-7 px-2 rounded text-xs font-semibold text-muted hover:bg-black/[0.05]"
          >
            ☰ ▾
          </button>
          {alignOpen && (
            <div className="absolute left-0 top-full mt-1 z-10 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
              {ALIGNMENTS.map((align) => (
                <button
                  key={align}
                  type="button"
                  onMouseDown={(e) => applyAlign(e, align)}
                  className="block w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-black/[0.04] whitespace-nowrap"
                >
                  {align}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onMouseDown={(e) => runCommand(e, "insertUnorderedList")}
          title="Bulleted list"
          className="h-7 px-2 rounded text-xs font-semibold text-muted hover:bg-black/[0.05]"
        >
          • List
        </button>
        <button
          type="button"
          onMouseDown={(e) => runCommand(e, "insertOrderedList")}
          title="Numbered list"
          className="h-7 px-2 rounded text-xs font-semibold text-muted hover:bg-black/[0.05]"
        >
          1. List
        </button>
      </div>
      <div className="relative">
        {empty && placeholder && (
          <span className="absolute left-2.5 top-2 text-sm text-muted pointer-events-none">{placeholder}</span>
        )}
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onBlur={handleInput}
          suppressContentEditableWarning
          className="rich-text-content min-h-[4.5rem] max-h-56 overflow-y-auto px-2.5 py-2 text-sm outline-none"
        />
      </div>
    </div>
  );
}
