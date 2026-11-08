// @vitest-environment node
// Question detection on your own past meetings: `npm run report:questions`.
// Reads the local NexQ database read-only and prints, for each line from the
// other party, whether a question was found and what Auto-Answer would answer.
// Runs only on demand (NEXQ_QUESTION_REPORT names the database), never in CI.

import { describe, expect, it } from "vitest";
import { isClosingQuestion, isFeedback, lastSentence, looksLikeQuestion, whatToAnswer } from "./QuestionDetector";

const dbPath = process.env.NEXQ_QUESTION_REPORT;

describe.runIf(!!dbPath)("question detection on your past meetings", () => {
  it("reports what is found and what is missed", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath!, { readOnly: true });
    const rows = db
      .prepare("SELECT text FROM transcript_segments WHERE speaker IN ('Them', 'Interviewer') ORDER BY rowid")
      .all() as Array<{ text: string }>;
    db.close();

    let questions = 0, turns = 0, feedback = 0, closing = 0, nothing = 0;
    const lines: string[] = [];
    for (const { text } of rows) {
      const question = whatToAnswer(text, false);
      const turn = whatToAnswer(text, true);
      let verdict: string;
      if (question) { questions++; verdict = isClosingQuestion(question) ? (closing++, "CLOSING ") : "QUESTION"; }
      else if (turn) { turns++; verdict = "TURN    "; }
      else if (isFeedback(text)) { feedback++; verdict = "FEEDBACK"; }
      else { nothing++; verdict = "-       "; }
      const shown = question ?? turn ?? lastSentence(text);
      // A "?" in the line that no rule caught is worth a look.
      const flag = !question && /[?？]/u.test(text) && !looksLikeQuestion(lastSentence(text)) ? "  <- has '?'" : "";
      lines.push(`${verdict} ${shown.slice(0, 140)}${flag}`);
    }
    console.log(
      [
        `\n${rows.length} lines from the other party:`,
        `  ${questions} with a question (${closing} "any questions for us?")`,
        `  ${turns} answered only in "They stop talking" mode`,
        `  ${feedback} feedback left alone, ${nothing} with nothing to answer`,
        "",
        ...lines,
      ].join("\n"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
