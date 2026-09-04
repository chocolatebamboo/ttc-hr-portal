import { withRlsContext } from "@/lib/db";
import { isAdmin, assertIsAdmin, ForbiddenError, assertCanReviewOnboarding } from "@/lib/authorization";
import { OnboardingNotFoundError, InvalidOnboardingError, loadActionableOnboardingItem } from "@/lib/onboarding";
import type {
  CurrentEmployee,
  CertificationAnswerInput,
  CertificationAttemptDTO,
  CertificationAttemptStatus,
  CertificationOptionDTO,
  CertificationQuestionAdminDTO,
  CertificationQuestionDTO,
  CertificationQuestionType,
  CertificationReviewOutcome,
  CertificationResponseDTO,
} from "@/types";

/**
 * TTC's real New Hire Excellence Certification Test (Aug 2026 document gap analysis, item 5).
 * Deliberately NOT a general quiz/LMS builder — see CertificationQuestion's doc comment in
 * prisma/schema.prisma: the question bank mirrors the source document one-for-one and only the
 * answer key (not the questions themselves) is meant to be admin-editable. This file owns
 * scoring, attempt submission, manual review, and the admin answer-key editor; the surrounding
 * onboarding step (submit → AWAITING_APPROVAL → approve/return) is loadActionableOnboardingItem/
 * decideOnboardingItem in src/lib/onboarding.ts, reused rather than duplicated here.
 */

export class CertificationNotFoundError extends Error {
  constructor(message = "That certification question or attempt doesn't exist.") {
    super(message);
    this.name = "CertificationNotFoundError";
  }
}

export class InvalidCertificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCertificationError";
  }
}

type RawQuestion = {
  id: string;
  number: number;
  section: string;
  sortOrder: number;
  prompt: string;
  type: string;
  points: number;
  options: unknown;
  correctOptionKeys: string[];
  acceptedAnswers: string[];
  requiredMatchCount: number | null;
  rubric: string | null;
  active: boolean;
};

function toOptions(raw: unknown): CertificationOptionDTO[] | null {
  if (!raw || !Array.isArray(raw)) return null;
  return raw as CertificationOptionDTO[];
}

function toQuestionDTO(q: RawQuestion): CertificationQuestionDTO {
  return {
    id: q.id,
    number: q.number,
    section: q.section,
    sortOrder: q.sortOrder,
    prompt: q.prompt,
    type: q.type as CertificationQuestionType,
    points: q.points,
    options: toOptions(q.options),
    requiredMatchCount: q.requiredMatchCount,
  };
}

function toQuestionAdminDTO(q: RawQuestion): CertificationQuestionAdminDTO {
  return {
    ...toQuestionDTO(q),
    correctOptionKeys: q.correctOptionKeys,
    acceptedAnswers: q.acceptedAnswers,
    rubric: q.rubric,
    active: q.active,
  };
}

/** Trimmed, lowercased, hyphen/underscore-as-space, punctuation-stripped, whitespace-collapsed
 *  — so "Self-Esteem", "self esteem", and "Self esteem." all compare equal. Used for both
 *  FILL_IN_BLANK and LIST_MATCH matching. */
function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/[.,!?'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ScoredResponse {
  answerText: string | null;
  selectedKeys: string[];
  isAutoScored: boolean;
  isCorrect: boolean | null;
  pointsEarned: number | null;
  needsManualReview: boolean;
}

/**
 * Pure scoring function for one question given the employee's raw answer. An auto-scorable
 * question type with no answer key configured yet (empty correctOptionKeys/acceptedAnswers) —
 * Q11 "Name three TTC programs" at launch, see the LIST_MATCH doc comment in schema.prisma — is
 * deliberately treated as needing manual review rather than silently graded wrong; once an admin
 * fills in a key, only FUTURE attempts pick it up (see CertificationAttempt.objectivePointsEarned's
 * doc comment on snapshotting).
 */
function scoreResponse(question: RawQuestion, answer: CertificationAnswerInput): ScoredResponse {
  const answerText = answer.answerText?.trim() || null;
  const selectedKeys = (answer.selectedKeys ?? []).filter((k) => k.trim().length > 0);

  if (question.type === "SHORT_ANSWER") {
    return { answerText, selectedKeys, isAutoScored: false, isCorrect: null, pointsEarned: null, needsManualReview: true };
  }

  if (question.type === "MULTIPLE_CHOICE") {
    if (question.correctOptionKeys.length === 0) {
      return { answerText, selectedKeys, isAutoScored: false, isCorrect: null, pointsEarned: null, needsManualReview: true };
    }
    const isCorrect = selectedKeys.length === 1 && selectedKeys[0] === question.correctOptionKeys[0];
    return {
      answerText,
      selectedKeys,
      isAutoScored: true,
      isCorrect,
      pointsEarned: isCorrect ? question.points : 0,
      needsManualReview: false,
    };
  }

  if (question.type === "CHECKBOX_ALL") {
    if (question.correctOptionKeys.length === 0) {
      return { answerText, selectedKeys, isAutoScored: false, isCorrect: null, pointsEarned: null, needsManualReview: true };
    }
    const correctSet = new Set(question.correctOptionKeys);
    const selectedSet = new Set(selectedKeys);
    const isCorrect =
      correctSet.size === selectedSet.size && [...correctSet].every((k) => selectedSet.has(k));
    return {
      answerText,
      selectedKeys,
      isAutoScored: true,
      isCorrect,
      pointsEarned: isCorrect ? question.points : 0,
      needsManualReview: false,
    };
  }

  if (question.type === "FILL_IN_BLANK") {
    if (question.acceptedAnswers.length === 0) {
      return { answerText, selectedKeys, isAutoScored: false, isCorrect: null, pointsEarned: null, needsManualReview: true };
    }
    const accepted = new Set(question.acceptedAnswers.map(normalizeAnswer));
    const isCorrect = answerText !== null && accepted.has(normalizeAnswer(answerText));
    return {
      answerText,
      selectedKeys,
      isAutoScored: true,
      isCorrect,
      pointsEarned: isCorrect ? question.points : 0,
      needsManualReview: false,
    };
  }

  // LIST_MATCH — see Q11's doc comment: an empty acceptedAnswers is a valid, deliberate "not
  // configured yet" state, not a data gap, and always falls back to manual review.
  if (question.acceptedAnswers.length === 0) {
    return { answerText, selectedKeys, isAutoScored: false, isCorrect: null, pointsEarned: null, needsManualReview: true };
  }
  const accepted = new Set(question.acceptedAnswers.map(normalizeAnswer));
  const matched = new Set<string>();
  for (const entry of selectedKeys) {
    const normalized = normalizeAnswer(entry);
    if (accepted.has(normalized)) matched.add(normalized);
  }
  const required = question.requiredMatchCount ?? question.acceptedAnswers.length;
  const matchedCount = Math.min(matched.size, required);
  const isCorrect = matchedCount >= required;
  const pointsEarned = Math.round((question.points * matchedCount) / required);
  return { answerText, selectedKeys, isAutoScored: true, isCorrect, pointsEarned, needsManualReview: false };
}

/** The sanitized question list an employee sees while taking (or reviewing their own past
 *  answers to) the test — NEVER includes correctOptionKeys/acceptedAnswers, regardless of who's
 *  asking. Self, or an admin previewing (never a supervisor — same as DOCUMENT's self-only rule,
 *  see advanceOnboardingItem). */
export async function getCertificationQuestionsForTaking(
  actor: CurrentEmployee,
  itemId: string
): Promise<CertificationQuestionDTO[]> {
  const item = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.findUnique({ where: { id: itemId }, include: { onboarding: true } })
  );
  if (!item) throw new OnboardingNotFoundError("That checklist item doesn't exist.");
  if (item.itemType !== "CERTIFICATION") {
    throw new InvalidCertificationError("This step isn't a certification test.");
  }
  if (actor.id !== item.onboarding.employeeId && !isAdmin(actor)) throw new ForbiddenError();

  const questions = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationQuestion.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
  );
  return questions.map((q) => toQuestionDTO(q as RawQuestion));
}

/**
 * The employee submits their full set of answers in one action — there's no draft/resume state,
 * matching how every other onboarding step type is a single click/acknowledgment. Auto-scores
 * every question it can immediately (see scoreResponse); anything left needing manual review
 * keeps the surrounding OnboardingItem in AWAITING_APPROVAL until a reviewer finishes grading
 * (see reviewCertificationResponse) — the same AWAITING_APPROVAL state DOCUMENT/TRAINING/MEETING
 * steps already use, just gated on a richer condition at approval time (decideOnboardingItem).
 */
export async function submitCertificationAttempt(
  actor: CurrentEmployee,
  itemId: string,
  answers: CertificationAnswerInput[]
): Promise<{ attemptId: string }> {
  const { item, employeeId } = await loadActionableOnboardingItem(actor, itemId);
  if (item.itemType !== "CERTIFICATION") {
    throw new InvalidCertificationError("This step isn't a certification test.");
  }
  if (actor.id !== employeeId) {
    throw new ForbiddenError("Only the team member themselves can take this test.");
  }
  if (item.status === "COMPLETED") {
    throw new InvalidCertificationError("This step is already complete.");
  }
  if (item.status === "AWAITING_APPROVAL") {
    throw new InvalidCertificationError("This step is already waiting on approval.");
  }

  const questions = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationQuestion.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
  );
  if (questions.length === 0) {
    throw new InvalidCertificationError("The certification test has no questions configured yet — ask HR.");
  }

  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));
  const missing = questions.find((q) => {
    const a = answerByQuestionId.get(q.id);
    return !a || (!a.answerText?.trim() && (!a.selectedKeys || a.selectedKeys.filter((k) => k.trim()).length === 0));
  });
  if (missing) {
    throw new InvalidCertificationError(`Answer every question before submitting — "${missing.prompt}" is still blank.`);
  }

  const scored = questions.map((q) => ({
    question: q as RawQuestion,
    scored: scoreResponse(q as RawQuestion, answerByQuestionId.get(q.id)!),
  }));

  const objectivePointsEarned = scored.reduce((sum, s) => sum + (s.scored.isAutoScored ? s.scored.pointsEarned ?? 0 : 0), 0);
  const objectivePointsPossible = scored.reduce((sum, s) => sum + (s.scored.isAutoScored ? s.question.points : 0), 0);
  const totalPointsPossible = scored.reduce((sum, s) => sum + s.question.points, 0);
  const anyManual = scored.some((s) => s.scored.needsManualReview);

  const now = new Date();
  const resolvedStatus: CertificationAttemptStatus = anyManual
    ? "SUBMITTED"
    : objectivePointsEarned / totalPointsPossible * 100 >= 85
      ? "PASSED"
      : "FAILED";

  const attempt = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationAttempt.create({
      data: {
        employeeId,
        onboardingItemId: itemId,
        status: resolvedStatus,
        objectivePointsEarned,
        objectivePointsPossible,
        totalPointsPossible,
        manualPointsEarned: anyManual ? null : 0,
        finalScorePercent: anyManual ? null : (objectivePointsEarned / totalPointsPossible) * 100,
        reviewedAt: anyManual ? null : now,
        reviewedBy: null,
        responses: {
          create: scored.map(({ question, scored: s }) => ({
            questionId: question.id,
            answerText: s.answerText,
            selectedKeys: s.selectedKeys,
            isAutoScored: s.isAutoScored,
            isCorrect: s.isCorrect,
            pointsEarned: s.pointsEarned,
            pointsPossible: question.points,
            needsManualReview: s.needsManualReview,
          })),
        },
      },
    })
  );

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.update({
      where: { id: itemId },
      data: { status: "AWAITING_APPROVAL", submittedAt: now, returnReason: null },
    })
  );

  return { attemptId: attempt.id };
}

function toResponseDTO(
  r: {
    id: string;
    questionId: string;
    answerText: string | null;
    selectedKeys: string[];
    isAutoScored: boolean;
    isCorrect: boolean | null;
    pointsEarned: number | null;
    pointsPossible: number;
    needsManualReview: boolean;
    reviewOutcome: string | null;
    reviewComment: string | null;
    reviewedAt: Date | null;
  },
  question: RawQuestion
): CertificationResponseDTO {
  return {
    id: r.id,
    questionId: r.questionId,
    number: question.number,
    section: question.section,
    prompt: question.prompt,
    type: question.type as CertificationQuestionType,
    options: toOptions(question.options),
    rubric: question.rubric,
    answerText: r.answerText,
    selectedKeys: r.selectedKeys,
    isAutoScored: r.isAutoScored,
    isCorrect: r.isCorrect,
    pointsEarned: r.pointsEarned,
    pointsPossible: r.pointsPossible,
    needsManualReview: r.needsManualReview,
    reviewOutcome: (r.reviewOutcome as CertificationReviewOutcome | null) ?? null,
    reviewComment: r.reviewComment,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  };
}

/** Attempt history for one CERTIFICATION onboarding step, newest first — the employee's own
 *  results view and the HR/supervisor review panel share this same DTO (self, or
 *  assertCanReviewOnboarding). */
export async function listCertificationAttempts(
  actor: CurrentEmployee,
  itemId: string
): Promise<CertificationAttemptDTO[]> {
  const item = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.onboardingItem.findUnique({ where: { id: itemId }, include: { onboarding: true } })
  );
  if (!item) throw new OnboardingNotFoundError("That checklist item doesn't exist.");
  const employeeId = item.onboarding.employeeId;
  if (actor.id !== employeeId) await assertCanReviewOnboarding(actor, employeeId);

  const attempts = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationAttempt.findMany({
      where: { onboardingItemId: itemId },
      orderBy: { submittedAt: "desc" },
      include: { responses: { include: { question: true } } },
    })
  );

  return attempts.map((a) => ({
    id: a.id,
    status: a.status as CertificationAttemptStatus,
    submittedAt: a.submittedAt.toISOString(),
    objectivePointsEarned: a.objectivePointsEarned,
    objectivePointsPossible: a.objectivePointsPossible,
    totalPointsPossible: a.totalPointsPossible,
    manualPointsEarned: a.manualPointsEarned,
    finalScorePercent: a.finalScorePercent,
    passThresholdPercent: a.passThresholdPercent,
    reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
    responses: a.responses
      .sort((x, y) => x.question.sortOrder - y.question.sortOrder)
      .map((r) => toResponseDTO(r, r.question as RawQuestion)),
  }));
}

/**
 * HR/admin, or the employee's own supervisor, grades one manual-review response. The moment
 * every needs-manual-review response on the attempt has been graded, this same action finalizes
 * the attempt (computes manualPointsEarned/finalScorePercent, flips status to PASSED/FAILED) —
 * there's no separate "finish review" step for a reviewer to remember to click. Only valid while
 * the attempt is still SUBMITTED; once finalized, re-grading isn't supported (retake instead —
 * see decideOnboardingItem's CERTIFICATION handling in src/lib/onboarding.ts).
 */
export async function reviewCertificationResponse(
  actor: CurrentEmployee,
  responseId: string,
  outcome: CertificationReviewOutcome,
  comment?: string
): Promise<void> {
  const response = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationResponse.findUnique({ where: { id: responseId }, include: { attempt: true } })
  );
  if (!response) throw new CertificationNotFoundError("That response doesn't exist.");
  if (!response.needsManualReview) {
    throw new InvalidCertificationError("This question was already auto-scored — there's nothing to review.");
  }
  if (response.attempt.status !== "SUBMITTED") {
    throw new InvalidCertificationError("This attempt has already been finalized.");
  }

  await assertCanReviewOnboarding(actor, response.attempt.employeeId);

  const now = new Date();
  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationResponse.update({
      where: { id: responseId },
      data: {
        reviewOutcome: outcome,
        reviewComment: comment?.trim() || null,
        pointsEarned: outcome === "MEETS" ? response.pointsPossible : 0,
        reviewedAt: now,
        reviewedBy: actor.id,
      },
    })
  );

  const siblings = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationResponse.findMany({ where: { attemptId: response.attemptId } })
  );
  const stillPending = siblings.some((r) => r.needsManualReview && !r.reviewedAt && r.id !== responseId);
  if (stillPending) return;

  const manualPointsEarned = siblings
    .filter((r) => r.needsManualReview)
    .reduce((sum, r) => sum + (r.id === responseId ? (outcome === "MEETS" ? response.pointsPossible : 0) : r.pointsEarned ?? 0), 0);
  const finalScorePercent =
    ((response.attempt.objectivePointsEarned + manualPointsEarned) / response.attempt.totalPointsPossible) * 100;
  const status: CertificationAttemptStatus =
    finalScorePercent >= response.attempt.passThresholdPercent ? "PASSED" : "FAILED";

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationAttempt.update({
      where: { id: response.attemptId },
      data: { manualPointsEarned, finalScorePercent, status, reviewedAt: now, reviewedBy: actor.id },
    })
  );
}

/** Admin-only question bank view, answer key included — powers the "Manage Certification Test"
 *  editor. See CertificationQuestion's doc comment: only the key fields are meant to be edited
 *  here, not the question wording/order/points. */
export async function listCertificationQuestionsForAdmin(
  actor: CurrentEmployee
): Promise<CertificationQuestionAdminDTO[]> {
  assertIsAdmin(actor);
  const questions = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationQuestion.findMany({ orderBy: { sortOrder: "asc" } })
  );
  return questions.map((q) => toQuestionAdminDTO(q as RawQuestion));
}

export interface CertificationQuestionKeyInput {
  correctOptionKeys?: string[];
  acceptedAnswers?: string[];
  requiredMatchCount?: number | null;
  rubric?: string | null;
}

/** Admin-only — edits ONLY the answer-key fields of one question (correctOptionKeys/
 *  acceptedAnswers/requiredMatchCount/rubric). Question wording, type, order, and points stay
 *  code-seeded and aren't editable here — see CertificationQuestion's doc comment in
 *  schema.prisma for why. This is what lets HR fill in Q11's program-name key later without a
 *  code change, per CB's own instruction. */
export async function updateCertificationQuestionKey(
  actor: CurrentEmployee,
  questionId: string,
  input: CertificationQuestionKeyInput
): Promise<void> {
  assertIsAdmin(actor);
  const existing = await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationQuestion.findUnique({ where: { id: questionId } })
  );
  if (!existing) throw new CertificationNotFoundError("That question doesn't exist.");

  if (input.correctOptionKeys && existing.type !== "MULTIPLE_CHOICE" && existing.type !== "CHECKBOX_ALL") {
    throw new InvalidCertificationError("Only multiple-choice or select-all questions have correct options.");
  }
  if (
    (input.acceptedAnswers || input.requiredMatchCount !== undefined) &&
    existing.type !== "FILL_IN_BLANK" &&
    existing.type !== "LIST_MATCH"
  ) {
    throw new InvalidCertificationError("Only fill-in-the-blank or list questions accept text answer variants.");
  }

  await withRlsContext({ employeeId: actor.id, role: actor.role }, (tx) =>
    tx.certificationQuestion.update({
      where: { id: questionId },
      data: {
        ...(input.correctOptionKeys ? { correctOptionKeys: input.correctOptionKeys } : {}),
        ...(input.acceptedAnswers ? { acceptedAnswers: input.acceptedAnswers } : {}),
        ...(input.requiredMatchCount !== undefined ? { requiredMatchCount: input.requiredMatchCount } : {}),
        ...(input.rubric !== undefined ? { rubric: input.rubric } : {}),
        updatedBy: actor.id,
      },
    })
  );
}
