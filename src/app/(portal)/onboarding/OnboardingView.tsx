// ---------------------------------------------------------------------------
// Admin: certification answer-key editor. Only the KEY fields are editable here — question
// wording, order, and points are code-seeded (see CertificationQuestion's doc comment in
// schema.prisma) since they mirror the real source document; this is deliberately narrower than
// TemplateEditor above, which builds whole steps from scratch.
// ---------------------------------------------------------------------------

type CertKeyDraft = {
  correctOptionKeys: string[];
  acceptedAnswers: string; // comma-separated for editing; split/joined on save
  requiredMatchCount: string;
  rubric: string;
};

function CertificationQuestionBankEditor() {
  const [questions, setQuestions] = useState<CertificationQuestionAdminDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CertKeyDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch("/api/onboarding/certification/questions");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuestions(data.questions);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function openDraft(q: CertificationQuestionAdminDTO) {
    setDrafts((d) => ({
      ...d,
      [q.id]: {
        correctOptionKeys: q.correctOptionKeys,
        acceptedAnswers: q.acceptedAnswers.join(", "),
        requiredMatchCount: q.requiredMatchCount != null ? String(q.requiredMatchCount) : "",
        rubric: q.rubric ?? "",
      },
    }));
    setOpenId(openId === q.id ? null : q.id);
    setError("");
  }

  function setSingleCorrect(id: string, key: string) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], correctOptionKeys: [key] } }));
  }

  function toggleCorrect(id: string, key: string) {
    setDrafts((d) => {
      const current = d[id].correctOptionKeys;
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...d, [id]: { ...d[id], correctOptionKeys: next } };
    });
  }

  async function save(q: CertificationQuestionAdminDTO) {
    const draft = drafts[q.id];
    if (!draft) return;
    setBusyId(q.id);
    setError("");
    try {
      const body: Record<string, unknown> = { rubric: draft.rubric || null };
      if (q.type === "MULTIPLE_CHOICE" || q.type === "CHECKBOX_ALL") {
        body.correctOptionKeys = draft.correctOptionKeys;
      }
      if (q.type === "FILL_IN_BLANK" || q.type === "LIST_MATCH") {
        body.acceptedAnswers = draft.acceptedAnswers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (q.type === "LIST_MATCH") {
          body.requiredMatchCount = draft.requiredMatchCount ? Number(draft.requiredMatchCount) : null;
        }
      }
      const res = await fetch(`/api/onboarding/certification/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to save this question's answer key.");
        return;
      }
      setOpenId(null);
      await load();
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (loadState === "loading") {
    return <div className="h-20 rounded-xl border border-border bg-background animate-pulse" />;
  }
  if (loadState === "error") {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-sm text-accent">
        Unable to load the certification question bank.
      </div>
    );
  }

  let currentSection = "";

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
      <p className="text-xs text-muted mb-1">
        Only the answer key is editable here — question wording and order mirror TTC&rsquo;s real
        certification test. A fill-in-the-blank or list question with no accepted answers yet
        (like &ldquo;Name three TTC programs&rdquo;) falls back to manual review until you set one.
      </p>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {questions.map((q) => {
          const showSectionHeader = q.section !== currentSection;
          currentSection = q.section;
          const isOpen = openId === q.id;
          const draft = drafts[q.id];
          const busy = busyId === q.id;
          const unconfigured =
            (q.type === "FILL_IN_BLANK" || q.type === "LIST_MATCH") && q.acceptedAnswers.length === 0;
          return (
            <div key={q.id}>
              {showSectionHeader && (
                <p className="px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {q.section}
                </p>
              )}
              <button onClick={() => openDraft(q)} className="w-full text-left px-4 py-2.5">
                <p className="text-sm truncate">
                  {q.number}. {q.prompt}
                </p>
                <p className="text-xs text-muted">
                  {q.type === "SHORT_ANSWER" ? "Manual review only" : q.type.replace(/_/g, " ").toLowerCase()}
                  {unconfigured && <span className="text-amber-700"> · Key not configured — manual review for now</span>}
                </p>
              </button>
              {isOpen && draft && (
                <div className="px-4 pb-3.5 space-y-2">
                  {q.type === "MULTIPLE_CHOICE" && q.options && (
                    <div className="space-y-1">
                      {q.options.map((opt) => (
                        <label key={opt.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            checked={draft.correctOptionKeys[0] === opt.key}
                            onChange={() => setSingleCorrect(q.id, opt.key)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === "CHECKBOX_ALL" && q.options && (
                    <div className="space-y-1">
                      {q.options.map((opt) => (
                        <label key={opt.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.correctOptionKeys.includes(opt.key)}
                            onChange={() => toggleCorrect(q.id, opt.key)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  )}
                  {(q.type === "FILL_IN_BLANK" || q.type === "LIST_MATCH") && (
                    <>
                      <label className="block text-xs text-muted">Accepted answers (comma-separated)</label>
                      <input
                        type="text"
                        value={draft.acceptedAnswers}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [q.id]: { ...draft, acceptedAnswers: e.target.value } }))
                        }
                        placeholder="e.g. PUSH Leadership Academy, Camp Talent, Youth Mentorship Circle"
                        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                      />
                      {q.type === "LIST_MATCH" && (
                        <>
                          <label className="block text-xs text-muted">Entries required to pass this question</label>
                          <input
                            type="number"
                            min={1}
                            value={draft.requiredMatchCount}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [q.id]: { ...draft, requiredMatchCount: e.target.value } }))
                            }
                            className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                          />
                        </>
                      )}
                    </>
                  )}
                  <label className="block text-xs text-muted">Reviewer rubric (shown when grading manually)</label>
                  <textarea
                    value={draft.rubric}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: { ...draft, rubric: e.target.value } }))}
                    rows={2}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <div className="flex justify-end">
                    <button onClick={() => save(q)} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
                      {busy ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  );
}

// Admin/supervisor grading UI for one CERTIFICATION step's attempt history — embedded inline
// under that item's row in EmployeeChecklistDetail (below). Fetches independently, same pattern
// as ReadinessChecklistPanel/CheckpointsPanel: this has nothing to do with the plain-item
// approve/return flow above it beyond sharing a row.
function CertificationReviewPanel({ itemId, onGraded }: { itemId: string; onGraded: () => void }) {
  const [attempts, setAttempts] = useState<CertificationAttemptDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyResponseId, setBusyResponseId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/certification/attempts`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAttempts(data.attempts);
      if (data.attempts.length > 0) setExpandedAttemptId((id: string | null) => id ?? data.attempts[0].id);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the selected step changes
  }, [itemId]);

  async function grade(responseId: string, outcome: CertificationReviewOutcome) {
    setBusyResponseId(responseId);
    setError("");
    try {
      const res = await fetch(`/api/onboarding/certification/responses/${responseId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, comment: comments[responseId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to save this grade.");
        return;
      }
      await load();
      onGraded();
    } finally {
      setBusyResponseId(null);
    }
  }

  if (loadState === "loading") {
    return <div className="mx-4 mb-3 h-16 rounded-lg border border-border bg-surface animate-pulse" />;
  }
  if (loadState === "error") {
    return (
      <p className="mx-4 mb-3 text-sm text-accent">Unable to load this team member&rsquo;s certification attempts.</p>
    );
  }
  if (attempts.length === 0) {
    return <p className="mx-4 mb-3 text-sm text-muted">No attempts submitted yet.</p>;
  }

  return (
    <div className="mx-4 mb-3 rounded-lg border border-border bg-surface p-3 space-y-2.5">
      {attempts.map((attempt, i) => {
        const isOpen = expandedAttemptId === attempt.id;
        const isLatest = i === 0;
        return (
          <div key={attempt.id} className={i > 0 ? "pt-2.5 border-t border-border" : ""}>
            <button
              onClick={() => setExpandedAttemptId(isOpen ? null : attempt.id)}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <span className="text-xs text-muted">
                {isLatest ? "Latest attempt" : "Earlier attempt"} · {new Date(attempt.submittedAt).toLocaleString()}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  attempt.status === "PASSED"
                    ? "bg-emerald-100 text-emerald-800"
                    : attempt.status === "FAILED"
                      ? "bg-rose-100 text-rose-800"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {attempt.status === "SUBMITTED"
                  ? "Needs review"
                  : `${attempt.status === "PASSED" ? "Passed" : "Failed"} · ${Math.round(attempt.finalScorePercent ?? 0)}%`}
              </span>
            </button>
            {isOpen && (
              <div className="mt-2 space-y-2">
                {attempt.responses.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border bg-background p-2.5">
                    <p className="text-xs font-medium mb-1">
                      {r.number}. {r.prompt}
                    </p>
                    <p className="text-xs text-muted mb-1.5">
                      {r.selectedKeys.length > 0 ? r.selectedKeys.join(", ") : r.answerText || "(no answer)"}
                    </p>
                    {r.isAutoScored ? (
                      <span
                        className={`text-xs font-medium ${r.isCorrect ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {r.isCorrect ? "Correct" : "Incorrect"} ({r.pointsEarned}/{r.pointsPossible} pts)
                      </span>
                    ) : r.reviewedAt ? (
                      <p className="text-xs">
                        <span className={r.reviewOutcome === "MEETS" ? "text-emerald-700" : "text-rose-700"}>
                          {r.reviewOutcome === "MEETS" ? "Meets expectations" : "Does not meet expectations"}
                        </span>
                        {r.reviewComment && <span className="text-muted"> — {r.reviewComment}</span>}
                      </p>
                    ) : attempt.status === "SUBMITTED" ? (
                      <div className="space-y-1.5">
                        {r.rubric && <p className="text-[11px] text-muted italic">{r.rubric}</p>}
                        <input
                          type="text"
                          value={comments[r.id] ?? ""}
                          onChange={(e) => setComments((c) => ({ ...c, [r.id]: e.target.value }))}
                          placeholder="Comment (optional)"
                          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-accent"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => grade(r.id, "MEETS")}
                            disabled={busyResponseId === r.id}
                            className="btn-primary text-xs px-2.5 py-1"
                          >
                            Meets Expectations
                          </button>
                          <button
                            onClick={() => grade(r.id, "DOES_NOT_MEET")}
                            disabled={busyResponseId === r.id}
                            className="btn-neutral text-xs px-2.5 py-1"
                          >
                            Does Not Meet
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted">Not graded (attempt already finalized).</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  );
}

function EmployeeChecklistDetail({
  employeeId,
  canAddItems,
  onChanged,
}: {
  employeeId: string;
  canAddItems: boolean;
  onChanged: () => void;
}) {
  const [onboarding, setOnboarding] = useState<EmployeeOnboardingDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [certOpenItemId, setCertOpenItemId] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/onboarding/manage/${employeeId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setOnboarding(data.onboarding);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the selected employee changes
  }, [employeeId]);

  async function toggleTask(itemId: string) {
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/advance`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError(data.error ?? "Unable to update this step.");
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  async function approve(itemId: string) {
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/approve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError(data.error ?? "Unable to approve this step.");
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  // CB, Sept 2026: onboarding steps "shouldn't feel like it's final" — sends a COMPLETED
  // DOCUMENT/TRAINING/MEETING/CERTIFICATION step back to NOT_STARTED so the employee goes
  // through it again. A TASK's own Undo button above already covers that item type.
  async function revert(itemId: string) {
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/revert`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError(data.error ?? "Unable to revert this step.");
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  async function submitReturn(itemId: string) {
    if (!returnReason.trim()) return;
    setBusyItemId(itemId);
    setActionError("");
    try {
      const res = await fetch(`/api/onboarding/items/${itemId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: returnReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error ?? "Unable to return this step.");
      } else {
        setReturningId(null);
        setReturnReason("");
      }
      await load();
      onChanged();
    } finally {
      setBusyItemId(null);
    }
  }

  if (loadState === "loading") {
    return <div className="h-24 rounded-xl border border-border bg-background animate-pulse" />;
  }
  if (loadState === "error" || !onboarding) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-sm text-accent">
        Unable to load this checklist.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3">
      {actionError && (
        <p role="alert" className="text-sm text-accent">
          {actionError}
        </p>
      )}

      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {onboarding.items.map((item) => {
          const Icon = TYPE_ICON[item.itemType];
          const busy = busyItemId === item.id;
          return (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${item.status === "COMPLETED" ? "text-muted line-through" : "text-foreground"}`}>
                    {item.label}
                  </p>
                  {item.status === "RETURNED" && item.returnReason && (
                    <p className="text-xs text-rose-700 mt-0.5">Returned: {item.returnReason}</p>
                  )}
                </div>
                <StatusBadge item={item} />
                {!item.locked && item.itemType === "TASK" && (
                  <button
                    onClick={() => toggleTask(item.id)}
                    disabled={busy}
                    className="btn-neutral text-xs px-2.5 py-1 shrink-0"
                  >
                    {item.status === "COMPLETED" ? "Undo" : "Mark Done"}
                  </button>
                )}
                {!item.locked && item.status === "AWAITING_APPROVAL" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => approve(item.id)} disabled={busy} className="btn-primary text-xs px-2.5 py-1">
                      Approve
                    </button>
                    <button
                      onClick={() => setReturningId(returningId === item.id ? null : item.id)}
                      disabled={busy}
                      className="btn-neutral text-xs px-2.5 py-1"
                    >
                      Return
                    </button>
                  </div>
                )}
                {item.itemType !== "TASK" && item.status === "COMPLETED" && (
                  <button
                    onClick={() => revert(item.id)}
                    disabled={busy}
                    title="Send this step back to not started"
                    className="btn-neutral text-xs px-2.5 py-1 shrink-0"
                  >
                    {busy ? "Working…" : "Revert"}
                  </button>
                )}
                {item.itemType === "CERTIFICATION" && item.status !== "NOT_STARTED" && (
                  <button
                    onClick={() => setCertOpenItemId(certOpenItemId === item.id ? null : item.id)}
                    className="btn-neutral text-xs px-2.5 py-1 shrink-0"
                  >
                    {certOpenItemId === item.id ? "Close" : "Review Test"}
                  </button>
                )}
              </div>
              {certOpenItemId === item.id && <CertificationReviewPanel itemId={item.id} onGraded={load} />}
              {returningId === item.id && (
                <div className="mt-2.5 flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="Why is this being sent back?"
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={() => submitReturn(item.id)}
                    disabled={busy || !returnReason.trim()}
                    className="btn-neutral text-xs px-3 py-1.5 whitespace-nowrap"
                  >
                    Send Back
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canAddItems && (
        <AddItemForm
          employeeId={employeeId}
          onboardingId={onboarding.id}
          onAdded={() => {
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// Internal admin/supervisor-only readiness tasks (background check, TTC email created,
// equipment issued, etc.) — a separate, unordered checklist from the employee's own onboarding
// steps above. Never shown to, or fetchable by, the employee (see prisma/rls.sql). Fetches
// independently rather than folding into EmployeeChecklistDetail's own state, since these two
// checklists have nothing to do with each other beyond being managed from the same screen.
function ReadinessChecklistPanel({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<OnboardingReadinessItemDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/onboarding/manage/${employeeId}/readiness`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the selected employee changes
  }, [employeeId]);

  async function toggle(itemId: string) {
    setBusyItemId(itemId);
    try {
      await fetch(`/api/onboarding/readiness/${itemId}/toggle`, { method: "POST" });
      await load();
    } finally {
      setBusyItemId(null);
    }
  }

  if (loadState === "loading") {
    return <div className="h-16 rounded-xl border border-border bg-background animate-pulse" />;
  }
  // Not an error state worth surfacing loudly — most likely this employee's checklist hasn't
  // been started yet, so there's nothing seeded here (see startOnboarding).
  if (loadState === "error" || items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-medium text-muted mb-2">Internal Readiness (not visible to team member)</p>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {items.map((item) => {
          const busy = busyItemId === item.id;
          return (
            <div key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <p className={`text-sm ${item.completed ? "text-muted line-through" : "text-foreground"}`}>
                {item.label}
              </p>
              <button
                onClick={() => toggle(item.id)}
                disabled={busy}
                className="btn-neutral text-xs px-2.5 py-1 shrink-0"
              >
                {item.completed ? "Undo" : "Mark Done"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatCheckpointDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Lightweight 30/60/90-day follow-ups — a plain due date, a done/not-done status, and freeform
// notes. Explicitly NOT a performance-review form: no ratings, no scoring, just what CB's
// document review asked for. Same admin/supervisor-only visibility and independent-fetch
// pattern as ReadinessChecklistPanel above.
function CheckpointsPanel({ employeeId }: { employeeId: string }) {
  const [checkpoints, setCheckpoints] = useState<OnboardingCheckpointDTO[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { notes: string; trainingMilestones: string; developmentGoals: string; followUpNeeded: boolean }>>({});

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/onboarding/manage/${employeeId}/checkpoints`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCheckpoints(data.checkpoints);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the selected employee changes
  }, [employeeId]);

  function openDraft(cp: OnboardingCheckpointDTO) {
    setDrafts((d) => ({
      ...d,
      [cp.id]: {
        notes: cp.notes ?? "",
        trainingMilestones: cp.trainingMilestones ?? "",
        developmentGoals: cp.developmentGoals ?? "",
        followUpNeeded: cp.followUpNeeded,
      },
    }));
    setOpenId(openId === cp.id ? null : cp.id);
  }

  async function toggleComplete(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/onboarding/checkpoints/${id}/toggle`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function saveDraft(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    try {
      await fetch(`/api/onboarding/checkpoints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      await load();
      setOpenId(null);
    } finally {
      setBusyId(null);
    }
  }

  if (loadState === "loading") {
    return <div className="h-16 rounded-xl border border-border bg-background animate-pulse" />;
  }
  // Not started yet is the common case (nothing seeded until the main checklist begins) — no
  // need for a loud error state either way.
  if (loadState === "error" || checkpoints.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-medium text-muted mb-2">30/60/90-Day Checkpoints (not visible to team member)</p>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
        {checkpoints.map((cp) => {
          const isOpen = openId === cp.id;
          const busy = busyId === cp.id;
          const draft = drafts[cp.id];
          return (
            <div key={cp.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => openDraft(cp)} className="min-w-0 flex-1 text-left">
                  <p className={`text-sm ${cp.status === "COMPLETED" ? "text-muted line-through" : "text-foreground"}`}>
                    {cp.milestone}
                  </p>
                  <p className="text-xs text-muted">
                    Due {formatCheckpointDueDate(cp.dueDate)}
                    {cp.followUpNeeded && cp.status !== "COMPLETED" && (
                      <span className="text-rose-700"> · Follow-up needed</span>
                    )}
                  </p>
                </button>
                <button
                  onClick={() => toggleComplete(cp.id)}
                  disabled={busy}
                  className="btn-neutral text-xs px-2.5 py-1 shrink-0"
                >
                  {cp.status === "COMPLETED" ? "Reopen" : "Mark Complete"}
                </button>
              </div>
              {isOpen && draft && (
                <div className="mt-2.5 space-y-2">
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDrafts((d) => ({ ...d, [cp.id]: { ...draft, notes: e.target.value } }))}
                    placeholder="Notes"
                    rows={2}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <textarea
                    value={draft.trainingMilestones}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [cp.id]: { ...draft, trainingMilestones: e.target.value } }))
                    }
                    placeholder="Training milestones (if applicable)"
                    rows={2}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <textarea
                    value={draft.developmentGoals}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [cp.id]: { ...draft, developmentGoals: e.target.value } }))
                    }
                    placeholder="Development goals (if applicable)"
                    rows={2}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                  />
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={draft.followUpNeeded}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [cp.id]: { ...draft, followUpNeeded: e.target.checked } }))
                      }
                    />
                    Needs follow-up
                  </label>
                  <div className="flex justify-end">
                    <button
                      onClick={() => saveDraft(cp.id)}
                      disabled={busy}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddItemForm({
  employeeId,
  onboardingId,
  onAdded,
}: {
  employeeId: string;
  onboardingId: string;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("");
  const [itemType, setItemType] = useState<OnboardingItemType>("TASK");
  const [documentId, setDocumentId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [documents, setDocuments] = useState<DocumentAdminSummaryDTO[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (itemType !== "DOCUMENT" || documents.length > 0) return;
    fetch("/api/documents/manage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setDocuments(data.documents.filter((d: DocumentAdminSummaryDTO) => !d.archivedAt));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once, the first time Document is selected
  }, [itemType]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    if (itemType === "DOCUMENT" && !documentId) {
      setError("Choose a document for this step.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`/api/onboarding/manage/${employeeId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingId,
          label,
          itemType,
          documentId: itemType === "DOCUMENT" ? documentId : undefined,
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Unable to add this step.");
        return;
      }
      setLabel("");
      setItemType("TASK");
      setDocumentId("");
      setDueDate("");
      onAdded();
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={addItem} className="space-y-2 pt-1">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a step…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={itemType}
          onChange={(e) => setItemType(e.target.value as OnboardingItemType)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="TASK">Task</option>
          <option value="DOCUMENT">Document</option>
          <option value="TRAINING">Training</option>
          <option value="MEETING">Meeting</option>
          <option value="CERTIFICATION">Certification</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <button type="submit" disabled={adding} className="btn-neutral text-sm px-4 py-2 whitespace-nowrap">
          {adding ? "Adding…" : "Add Step"}
        </button>
      </div>
      {itemType === "DOCUMENT" && (
        <select
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">— Choose a document —</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}
    </form>
  );
}
