-- AlterEnum
-- New OnboardingItemType value — a step whose completion means passing a CertificationAttempt
-- (see below) rather than a plain click/acknowledgment. Additive only, like every other value in
-- this enum; nothing existing needs to change meaning or get backfilled.
ALTER TYPE "OnboardingItemType" ADD VALUE 'CERTIFICATION';

-- CreateEnum
CREATE TYPE "CertificationQuestionType" AS ENUM ('MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'CHECKBOX_ALL', 'LIST_MATCH', 'SHORT_ANSWER');

-- CreateEnum
CREATE TYPE "CertificationAttemptStatus" AS ENUM ('SUBMITTED', 'PASSED', 'FAILED');

-- CreateTable
-- TTC's real New Hire Excellence Certification Test (TTC_TEST.pdf), seeded question-for-question
-- — see the seed script this migration folder also carries. Only the answer-key columns
-- (correctOptionKeys/acceptedAnswers/requiredMatchCount/rubric) are meant to be edited later from
-- the admin UI; question wording/order/points are code-seeded, not admin-editable.
CREATE TABLE "CertificationQuestion" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "CertificationQuestionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "options" JSONB,
    "correctOptionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requiredMatchCount" INTEGER,
    "rubric" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "CertificationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificationQuestion_number_key" ON "CertificationQuestion"("number");

-- CreateIndex
CREATE INDEX "CertificationQuestion_active_idx" ON "CertificationQuestion"("active");

-- CreateTable
CREATE TABLE "CertificationAttempt" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "onboardingItemId" TEXT,
    "status" "CertificationAttemptStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectivePointsEarned" INTEGER NOT NULL,
    "objectivePointsPossible" INTEGER NOT NULL,
    "totalPointsPossible" INTEGER NOT NULL,
    "manualPointsEarned" INTEGER,
    "finalScorePercent" DOUBLE PRECISION,
    "passThresholdPercent" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CertificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificationAttempt_employeeId_idx" ON "CertificationAttempt"("employeeId");

-- CreateIndex
CREATE INDEX "CertificationAttempt_onboardingItemId_idx" ON "CertificationAttempt"("onboardingItemId");

-- AddForeignKey
ALTER TABLE "CertificationAttempt" ADD CONSTRAINT "CertificationAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationAttempt" ADD CONSTRAINT "CertificationAttempt_onboardingItemId_fkey" FOREIGN KEY ("onboardingItemId") REFERENCES "OnboardingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CertificationResponse" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerText" TEXT,
    "selectedKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isAutoScored" BOOLEAN NOT NULL DEFAULT false,
    "isCorrect" BOOLEAN,
    "pointsEarned" INTEGER,
    "pointsPossible" INTEGER NOT NULL,
    "needsManualReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewOutcome" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    CONSTRAINT "CertificationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificationResponse_attemptId_idx" ON "CertificationResponse"("attemptId");

-- CreateIndex
CREATE INDEX "CertificationResponse_questionId_idx" ON "CertificationResponse"("questionId");

-- AddForeignKey
ALTER TABLE "CertificationResponse" ADD CONSTRAINT "CertificationResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CertificationAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationResponse" ADD CONSTRAINT "CertificationResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CertificationQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: TTC's real New Hire Excellence Certification Test (TTC_TEST.pdf), 26 questions.

-- Answer key per CB's Aug 2026 message, EXCEPT Q11 (deliberately left unconfigured —

-- see CertificationQuestionType.LIST_MATCH's doc comment in schema.prisma) and Q15

-- (kept as SHORT_ANSWER / manual review per CB's instruction).

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-1', 1, $q$TTC Mission & Identity$q$, 0, $q$What does TTC stand for?$q$, 'MULTIPLE_CHOICE', 3, $j$[{"key": "A", "label": "Talented Teen Club"}, {"key": "B", "label": "Teen Training Center"}, {"key": "C", "label": "Tomorrow's Talent Community"}, {"key": "D", "label": "Teaching Teens Creatively"}]$j$::jsonb, ARRAY[$q$A$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-2', 2, $q$TTC Mission & Identity$q$, 1, $q$What is TTC's mission?$q$, 'MULTIPLE_CHOICE', 3, $j$[{"key": "A", "label": "To provide entertainment programs for youth"}, {"key": "B", "label": "To reach, teach, and guide underserved youth toward healthy living while building self-esteem and leadership skills"}, {"key": "C", "label": "To prepare students only for sports careers"}, {"key": "D", "label": "To provide financial assistance only"}]$j$::jsonb, ARRAY[$q$B$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-3', 3, $q$TTC Mission & Identity$q$, 2, $q$Complete the TTC tagline: "Planting Seeds of ______________."$q$, 'FILL_IN_BLANK', 3, NULL, ARRAY[]::TEXT[], ARRAY[$q$self-esteem$q$, $q$self esteem$q$, $q$selfesteem$q$]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-4', 4, $q$TTC Mission & Identity$q$, 3, $q$Explain in your own words: Why is self-esteem at the center of TTC's work?$q$, 'SHORT_ANSWER', 3, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-5', 5, $q$TTC Mission & Identity$q$, 4, $q$TTC believes every young person should be seen as:$q$, 'MULTIPLE_CHOICE', 3, $j$[{"key": "A", "label": "A problem to solve"}, {"key": "B", "label": "A future leader with potential"}, {"key": "C", "label": "A number in a program"}, {"key": "D", "label": "A participant only"}]$j$::jsonb, ARRAY[$q$B$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-6', 6, $q$TTC Culture & Values$q$, 5, $q$Which of these best represents TTC culture? (select all that apply)$q$, 'CHECKBOX_ALL', 4, $j$[{"key": "excellence", "label": "Excellence"}, {"key": "accountability", "label": "Accountability"}, {"key": "community", "label": "Community"}, {"key": "leadership", "label": "Leadership"}, {"key": "respect", "label": "Respect"}, {"key": "giving_back", "label": "Giving back"}]$j$::jsonb, ARRAY[$q$excellence$q$, $q$accountability$q$, $q$community$q$, $q$leadership$q$, $q$respect$q$, $q$giving_back$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-7', 7, $q$TTC Culture & Values$q$, 6, $q$A student walks into a TTC event alone and looks uncomfortable. What should a TTC team member do?$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Ignore them because someone else will help"}, {"key": "B", "label": "Wait until they ask for help"}, {"key": "C", "label": "Welcome them, introduce yourself, and make them feel included"}, {"key": "D", "label": "Tell another staff member only"}]$j$::jsonb, ARRAY[$q$C$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-8', 8, $q$TTC Culture & Values$q$, 7, $q$The TTC standard is:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Do the minimum required"}, {"key": "B", "label": "Do what is expected and create experiences beyond expectations"}, {"key": "C", "label": "Focus only on your job description"}, {"key": "D", "label": "Avoid taking initiative"}]$j$::jsonb, ARRAY[$q$B$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-9', 9, $q$TTC Culture & Values$q$, 8, $q$Explain the phrase: "Listen. Connect. Support."$q$, 'SHORT_ANSWER', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-10', 10, $q$TTC Culture & Values$q$, 9, $q$Why does TTC believe every guest, student, mentor, and partner should leave with a positive experience?$q$, 'SHORT_ANSWER', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-11', 11, $q$TTC Programs Knowledge$q$, 10, $q$Name three TTC programs:$q$, 'LIST_MATCH', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], 3, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-12', 12, $q$TTC Programs Knowledge$q$, 11, $q$The PUSH Leadership Academy focuses on:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Leadership development, confidence, life skills, and workforce preparation"}, {"key": "B", "label": "Only academic tutoring"}, {"key": "C", "label": "Only athletics"}, {"key": "D", "label": "Entertainment activities"}]$j$::jsonb, ARRAY[$q$A$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-13', 13, $q$TTC Programs Knowledge$q$, 12, $q$TTC mentors are expected to:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Provide guidance, encouragement, and positive relationships"}, {"key": "B", "label": "Replace parents"}, {"key": "C", "label": "Discipline students"}, {"key": "D", "label": "Complete paperwork only"}]$j$::jsonb, ARRAY[$q$A$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-14', 14, $q$TTC Programs Knowledge$q$, 13, $q$TTC works with youth because:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Every student deserves access to opportunities, guidance, and support"}, {"key": "B", "label": "Only top-performing students matter"}, {"key": "C", "label": "Programs should only serve athletes"}, {"key": "D", "label": "Youth should figure things out alone"}]$j$::jsonb, ARRAY[$q$A$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-15', 15, $q$TTC Programs Knowledge$q$, 14, $q$List two ways TTC creates leadership opportunities for students:$q$, 'SHORT_ANSWER', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Treated as manual review for now — the source test doesn't specify two official answers. Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-16', 16, $q$Professional Expectations$q$, 15, $q$As a TTC employee, you represent TTC:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Only during events"}, {"key": "B", "label": "Only when wearing a TTC shirt"}, {"key": "C", "label": "Anytime you interact with students, families, partners, or the community"}, {"key": "D", "label": "Never outside office hours"}]$j$::jsonb, ARRAY[$q$C$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-17', 17, $q$Professional Expectations$q$, 16, $q$Confidential student information should:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Be shared with friends"}, {"key": "B", "label": "Be posted online"}, {"key": "C", "label": "Be protected and only shared with authorized individuals"}, {"key": "D", "label": "Be discussed publicly"}]$j$::jsonb, ARRAY[$q$C$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-18', 18, $q$Professional Expectations$q$, 17, $q$What should you do if you disagree with a team member?$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "Discuss it publicly"}, {"key": "B", "label": "Ignore the issue"}, {"key": "C", "label": "Communicate respectfully and follow the proper process"}, {"key": "D", "label": "Post about it online"}]$j$::jsonb, ARRAY[$q$C$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-19', 19, $q$Professional Expectations$q$, 18, $q$TTC employees should arrive at events:$q$, 'MULTIPLE_CHOICE', 4, $j$[{"key": "A", "label": "After the guests arrive"}, {"key": "B", "label": "On time and prepared"}, {"key": "C", "label": "Whenever convenient"}, {"key": "D", "label": "Only if needed"}]$j$::jsonb, ARRAY[$q$B$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-20', 20, $q$Professional Expectations$q$, 19, $q$What does professionalism look like at TTC?$q$, 'SHORT_ANSWER', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-21', 21, $q$Community Engagement & Events$q$, 20, $q$At a TTC event, your responsibility is to: (select all that apply)$q$, 'CHECKBOX_ALL', 4, $j$[{"key": "create_connections", "label": "Create connections"}, {"key": "welcome_guests", "label": "Welcome guests"}, {"key": "support_students", "label": "Support students"}, {"key": "help_solve_problems", "label": "Help solve problems"}, {"key": "protect_experience", "label": "Protect the TTC experience"}]$j$::jsonb, ARRAY[$q$create_connections$q$, $q$welcome_guests$q$, $q$support_students$q$, $q$help_solve_problems$q$, $q$protect_experience$q$]::TEXT[], ARRAY[]::TEXT[], NULL, NULL, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-22', 22, $q$Community Engagement & Events$q$, 21, $q$If you see someone standing alone at an event, you should:$q$, 'SHORT_ANSWER', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-23', 23, $q$Community Engagement & Events$q$, 22, $q$Why are partnerships important to TTC?$q$, 'SHORT_ANSWER', 4, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-24', 24, $q$Community Engagement & Events$q$, 23, $q$How do you demonstrate gratitude to TTC partners and supporters?$q$, 'SHORT_ANSWER', 3, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-25', 25, $q$Scenario-Based Questions$q$, 24, $q$Scenario 1: A student says, "Nobody believes in me." How would you respond?$q$, 'SHORT_ANSWER', 5, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);

INSERT INTO "CertificationQuestion" (id, "number", "section", "sortOrder", "prompt", "type", "points", "options", "correctOptionKeys", "acceptedAnswers", "requiredMatchCount", "rubric", "updatedAt")
VALUES ('cert-q-26', 26, $q$Scenario-Based Questions$q$, 25, $q$Scenario 2: A parent complains about an issue during an event. What steps would you take?$q$, 'SHORT_ANSWER', 5, NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, $q$Look for whether the employee's answer demonstrates understanding of TTC's stated standards: building confidence and self-esteem, creating opportunities, supporting youth and families, professionalism, respectful communication, positive experiences, leadership, accountability, confidentiality, and appropriate problem-solving.$q$, CURRENT_TIMESTAMP);
