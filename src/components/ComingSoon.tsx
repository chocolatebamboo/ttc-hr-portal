/**
 * Placeholder for a module scheduled later in the build order (see README.md "Roadmap").
 * Renders honestly rather than faking functionality — per the brief: "If something is not
 * connected yet, clearly identify it as incomplete."
 */
export default function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold mb-2">{title}</h1>
      <div className="bg-surface border border-border rounded-xl p-6 text-sm text-muted">
        <p className="font-medium text-foreground mb-1">Not built yet.</p>
        <p>
          {note ??
            `${title} is on the Phase 1 roadmap but hasn't been built in this codebase yet — see README.md for the build order.`}
        </p>
      </div>
    </div>
  );
}
