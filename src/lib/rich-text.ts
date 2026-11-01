import sanitizeHtml from "sanitize-html";

/**
 * Round seventeen (CB, Oct 2026: "if we're creating like text for tasks and whatnot... I feel
 * like it would be appropriate for us to have like a toolbar with... bold, italicized, bullet
 * points... alignment... you could change the font size" — scoped, per her answer when asked
 * where this should show up first, to "Task descriptions only"). RichTextEditor.tsx is the one
 * place in this app that produces this HTML (contentEditable + document.execCommand, never a
 * literal <script>/<img>/<a> — see that component), but a client is still a client: this is the
 * one, authoritative place that HTML is ever sanitized before it reaches the database, called
 * from createDateTask (src/lib/date-tasks.ts) and nowhere else, since that's the only function
 * that ever writes DateTask.description. Nothing downstream (DateTaskRow.tsx's render) needs to
 * sanitize again — anything already in the database is already safe to render as-is.
 *
 * Allow-list is deliberately narrow: exactly what RichTextEditor's toolbar can produce (bold,
 * italic, underline, bulleted/numbered lists, left/center/right alignment, font size) and nothing
 * else — no links, images, tables, or any other tag, and no inline style beyond the two
 * properties the toolbar itself ever sets.
 */
export function sanitizeRichText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";

  return sanitizeHtml(trimmed, {
    allowedTags: ["b", "strong", "i", "em", "u", "p", "div", "br", "ul", "ol", "li", "span"],
    allowedAttributes: {
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(left|center|right|justify)$/],
        "font-size": [/^\d+(\.\d+)?px$/],
      },
    },
    // Strip anything else (scripts, on* handlers, links, images) down to its text content
    // rather than dropping it outright — losing a stray disallowed tag's own text would silently
    // eat part of what the admin typed.
    nonTextTags: ["style", "script", "textarea", "option"],
  }).trim();
}
