/**
 * Placeholder for a module scheduled later in the build order (see README.md "Roadmap").
 * Renders honestly rather than faking functionality — per the brief: "If something is not
 * connected yet, clearly identify it as incomplete." Styled after the reference product's
 * own empty-state pattern (centered icon, bold heading, muted subtext) rather than a plain
 * gray box, so an unbuilt page still looks intentional instead of broken.
 */
export default function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="max-w-xl">
      <h1 className="page-title text-2xl mb-4">{title}</h1>
      <div className="bg-surface border border-border rounded-2xl px-6 py-16 flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-full bg-accent/10 flex items-center justify-center mb-4">
          <ToolsIcon className="h-6 w-6 text-accent-ink" />
        </div>
        <p className="font-semibold text-foreground mb-1">Not built yet</p>
        <p className="text-sm text-muted max-w-sm">
          {note ??
            `${title} is on the Phase 1 roadmap but hasn't been built in this codebase yet — see README.md for the build order.`}
        </p>
      </div>
    </div>
  );
}

function ToolsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        d="M14.5 6.5a3 3 0 0 0-3.9 3.9L4 17v3h3l6.6-6.6a3 3 0 0 0 3.9-3.9l-2.4 2.4-2-2 2.4-2.4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
